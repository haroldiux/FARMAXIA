import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

export class IdempotencyKeyReusedError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  readonly statusCode = 409;

  constructor(message = "Idempotency key reused with conflicting request payload.") {
    super(message);
    this.name = "IdempotencyKeyReusedError";
  }
}

export interface IdempotentExecutionResult<T = unknown> {
  statusCode: number;
  body?: T;
  data?: T;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`
  );
  return `{${entries.join(",")}}`;
}

export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

export class IdempotencyService {
  constructor(private readonly tenantDatabase?: TenantDatabase) {}

  execute<T>(
    scope: TenantScope,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    action: (client: PoolClient) => Promise<IdempotentExecutionResult<T>>
  ): Promise<IdempotentExecutionResult<T>>;

  execute<T>(
    tenantDatabase: TenantDatabase,
    scope: TenantScope,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    action: (client: PoolClient) => Promise<IdempotentExecutionResult<T>>
  ): Promise<IdempotentExecutionResult<T>>;

  async execute<T>(
    dbOrScope: TenantDatabase | TenantScope,
    scopeOrOp: TenantScope | string,
    opOrKey: string,
    keyOrPayload: string | unknown,
    payloadOrAction: unknown | ((client: PoolClient) => Promise<IdempotentExecutionResult<T>>),
    maybeAction?: (client: PoolClient) => Promise<IdempotentExecutionResult<T>>
  ): Promise<IdempotentExecutionResult<T>> {
    let db: TenantDatabase;
    let scope: TenantScope;
    let operation: string;
    let idempotencyKey: string;
    let payload: unknown;
    let action: (client: PoolClient) => Promise<IdempotentExecutionResult<T>>;

    if (maybeAction) {
      db = dbOrScope as TenantDatabase;
      scope = scopeOrOp as TenantScope;
      operation = opOrKey;
      idempotencyKey = keyOrPayload as string;
      payload = payloadOrAction;
      action = maybeAction;
    } else {
      if (!this.tenantDatabase) {
        throw new Error("TenantDatabase must be provided to IdempotencyService.");
      }
      db = this.tenantDatabase;
      scope = dbOrScope as TenantScope;
      operation = scopeOrOp as string;
      idempotencyKey = opOrKey;
      payload = keyOrPayload;
      action = payloadOrAction as (client: PoolClient) => Promise<IdempotentExecutionResult<T>>;
    }

    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new Error("Idempotency key must not be empty.");
    }

    const requestHash = computePayloadHash(payload);

    return db.withScope(scope, async (client) => {
      const existing = await client.query<{
        request_hash: string;
        status_code: number;
        response_payload: unknown;
      }>(
        `select request_hash, status_code, response_payload
         from idempotency_records
         where tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
           and operation = $1
           and idempotency_key = $2`,
        [operation, idempotencyKey]
      );

      if (existing.rows.length > 0) {
        const record = existing.rows[0];
        if (!record) {
          throw new Error("Unexpected empty record set.");
        }
        if (record.request_hash !== requestHash) {
          throw new IdempotencyKeyReusedError();
        }
        if (maybeAction) {
          return {
            statusCode: record.status_code,
            data: record.response_payload as T
          };
        }
        return {
          statusCode: record.status_code,
          body: record.response_payload as T
        };
      }

      const result = await action(client);
      const payloadToSave = result.body !== undefined ? result.body : result.data;

      await client.query(
        `insert into idempotency_records (
          tenant_id,
          branch_id,
          user_id,
          operation,
          idempotency_key,
          request_hash,
          status_code,
          response_payload
        )
        values (
          nullif(current_setting('app.tenant_id', true), '')::uuid,
          nullif(current_setting('app.branch_id', true), '')::uuid,
          nullif(current_setting('app.user_id', true), '')::uuid,
          $1, $2, $3, $4, $5
        )`,
        [
          operation,
          idempotencyKey,
          requestHash,
          result.statusCode,
          JSON.stringify(payloadToSave)
        ]
      );

      if (maybeAction) {
        return {
          statusCode: result.statusCode,
          data: payloadToSave as T
        };
      }
      return {
        statusCode: result.statusCode,
        body: payloadToSave as T
      };
    });
  }
}
