import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PlatformDatabase } from "../saas/platform-database.js";

/** D79: attempts per delivery before it is marked FAILED. */
export const WEBHOOK_MAX_ATTEMPTS = 8;
/** Delay before the next attempt, indexed by the number of attempts already made (1m, 5m, 15m, 1h, 3h, 6h, 12h). */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720] as const;
export const WEBHOOK_TIMEOUT_MS = 10_000;
const FAN_OUT_BATCH = 500;
const DELIVERY_BATCH = 20;
/** A claimed delivery is not picked again for this long, so a crash mid-send only delays it. */
const CLAIM_LEASE_MS = 2 * 60_000;
const ERROR_MAX_LENGTH = 500;

export type WebhookFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WebhookDispatchResult {
  enqueued: number;
  attempted: number;
  succeeded: number;
  retried: number;
  failed: number;
}

interface ClaimedDelivery {
  id: string;
  attempts: number;
  url: string;
  secret: string;
  eventType: string;
  tenantId: string;
  branchId: string;
  occurredAt: Date;
  payload: unknown;
}

interface AttemptOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

export function signWebhookPayload(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/**
 * Checks an `X-Farmaxia-Signature` header (`t=<unix>,v1=<hex>`) against the raw request body. Rejects
 * timestamps further than `toleranceSeconds` from `nowSeconds` (replay protection). Constant-time compare.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  rawBody: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const parts = new Map(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    })
  );
  const timestamp = Number(parts.get("t"));
  const received = parts.get("v1") ?? "";
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(received) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = signWebhookPayload(secret, timestamp, rawBody).slice(-64);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function truncate(value: string): string {
  return value.length > ERROR_MAX_LENGTH ? value.slice(0, ERROR_MAX_LENGTH) : value;
}

/**
 * F19 webhook dispatcher (D79/D80). Runs with the platform role because it walks every pharmacy:
 * fans outbox events out into one delivery per subscribed endpoint (only events created after the endpoint),
 * then sends the due deliveries signed with HMAC-SHA256. It never changes `outbox_events` (reserved, D51).
 */
@Injectable()
export class WebhookDispatcherService {
  constructor(@Inject(PlatformDatabase) private readonly platform: PlatformDatabase) {}

  async runOnce(options: { now?: Date; fetchImpl?: WebhookFetch; timeoutMs?: number } = {}): Promise<WebhookDispatchResult> {
    const now = options.now ?? new Date();
    const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    const enqueued = await this.fanOut(now);
    const claimed = await this.claimDue(now);
    const result: WebhookDispatchResult = { enqueued, attempted: claimed.length, succeeded: 0, retried: 0, failed: 0 };
    const outcomes = await Promise.all(claimed.map((delivery) => this.send(delivery, now, fetchImpl, timeoutMs)));
    await this.platform.withTransaction(async (client) => {
      for (const [index, delivery] of claimed.entries()) {
        const outcome = outcomes[index]!;
        const attempts = delivery.attempts + 1;
        if (outcome.ok) {
          result.succeeded += 1;
          await client.query(
            `update webhook_deliveries set status = 'SUCCEEDED', attempts = $2, last_attempt_at = $3, delivered_at = $3,
               last_status_code = $4, last_error = null
             where id = $1 and status = 'PENDING'`,
            [delivery.id, attempts, now, outcome.statusCode]
          );
          continue;
        }
        const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
        const delayMinutes = WEBHOOK_BACKOFF_MINUTES[Math.min(attempts, WEBHOOK_BACKOFF_MINUTES.length) - 1]!;
        if (exhausted) result.failed += 1;
        else result.retried += 1;
        await client.query(
          `update webhook_deliveries set status = $2, attempts = $3, last_attempt_at = $4, next_attempt_at = $5,
             last_status_code = $6, last_error = $7
           where id = $1 and status = 'PENDING'`,
          [
            delivery.id,
            exhausted ? "FAILED" : "PENDING",
            attempts,
            now,
            exhausted ? now : new Date(now.getTime() + delayMinutes * 60_000),
            outcome.statusCode,
            outcome.error
          ]
        );
      }
    });
    return result;
  }

  /** One delivery per (active endpoint, matching event of its tenant created after it). Idempotent. */
  private fanOut(now: Date): Promise<number> {
    return this.platform.withTransaction(async (client) => {
      const result = await client.query(
        `insert into webhook_deliveries (tenant_id, endpoint_id, outbox_event_id, event_type, next_attempt_at)
         select endpoint.tenant_id, endpoint.id, event.id, event.event_type, $1
         from webhook_endpoints as endpoint
         join outbox_events as event
           on event.tenant_id = endpoint.tenant_id
          and event.created_at >= endpoint.created_at
          and (event.event_type = any(endpoint.event_types) or '*' = any(endpoint.event_types))
         where endpoint.is_active
           and not exists (
             select 1 from webhook_deliveries as delivery
             where delivery.endpoint_id = endpoint.id and delivery.outbox_event_id = event.id
           )
         order by event.created_at, event.id
         limit $2
         on conflict (endpoint_id, outbox_event_id) do nothing`,
        [now, FAN_OUT_BATCH]
      );
      return result.rowCount ?? 0;
    });
  }

  /** Locks due deliveries of active endpoints (skip locked) and leases them before sending outside the transaction. */
  private claimDue(now: Date): Promise<ClaimedDelivery[]> {
    return this.platform.withTransaction(async (client) => {
      const result = await client.query<ClaimedDelivery>(
        `with due as (
           select delivery.id
           from webhook_deliveries as delivery
           join webhook_endpoints as endpoint on endpoint.tenant_id = delivery.tenant_id and endpoint.id = delivery.endpoint_id
           where delivery.status = 'PENDING' and delivery.next_attempt_at <= $1 and endpoint.is_active
           order by delivery.next_attempt_at, delivery.id
           limit $2
           for update of delivery skip locked
         ), leased as (
           update webhook_deliveries as delivery set next_attempt_at = $3
           from due where delivery.id = due.id
           returning delivery.id, delivery.attempts, delivery.endpoint_id, delivery.outbox_event_id, delivery.event_type
         )
         select leased.id, leased.attempts, endpoint.url, endpoint.secret, leased.event_type as "eventType",
           event.tenant_id as "tenantId", event.branch_id as "branchId", event.created_at as "occurredAt", event.payload
         from leased
         join webhook_endpoints as endpoint on endpoint.id = leased.endpoint_id
         join outbox_events as event on event.id = leased.outbox_event_id
         order by leased.id`,
        [now, DELIVERY_BATCH, new Date(now.getTime() + CLAIM_LEASE_MS)]
      );
      return result.rows;
    });
  }

  private async send(delivery: ClaimedDelivery, now: Date, fetchImpl: WebhookFetch, timeoutMs: number): Promise<AttemptOutcome> {
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      occurredAt: delivery.occurredAt.toISOString(),
      tenantId: delivery.tenantId,
      branchId: delivery.branchId,
      data: delivery.payload
    });
    const timestamp = Math.floor(now.getTime() / 1000);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(delivery.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Farmaxia-Webhooks/1",
          "X-Farmaxia-Event": delivery.eventType,
          "X-Farmaxia-Delivery": delivery.id,
          "X-Farmaxia-Signature": signWebhookPayload(delivery.secret, timestamp, body)
        },
        body,
        signal: controller.signal,
        redirect: "manual"
      });
      void response.body?.cancel().catch(() => undefined);
      const ok = response.status >= 200 && response.status < 300;
      return { ok, statusCode: response.status, error: ok ? null : truncate(`HTTP ${response.status}`) };
    } catch (error) {
      const message = timedOut ? `Timeout after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error);
      return { ok: false, statusCode: null, error: truncate(message) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Runs the dispatcher every WEBHOOK_DISPATCH_INTERVAL_SECONDS (30 by default); disabled when NODE_ENV is "test". */
@Injectable()
export class WebhookDispatcherScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("WebhookDispatcherScheduler");
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService) {}

  onApplicationBootstrap(): void {
    const seconds = Number(process.env.WEBHOOK_DISPATCH_INTERVAL_SECONDS ?? 30);
    if (process.env.NODE_ENV === "test" || !Number.isFinite(seconds) || seconds <= 0) {
      return;
    }
    const run = () => {
      if (this.running) return;
      this.running = true;
      this.dispatcher
        .runOnce()
        .then(
          (result) => {
            if (result.enqueued || result.attempted) this.logger.log(`Webhook dispatch: ${JSON.stringify(result)}`);
          },
          (error: unknown) => this.logger.error(`Webhook dispatch failed: ${String(error)}`)
        )
        .finally(() => {
          this.running = false;
        });
    };
    setTimeout(run, 15_000).unref();
    this.timer = setInterval(run, seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
