import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";
import {
  IdempotencyKeyReusedError,
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";
import { OutboxService } from "../transversal/outbox.service.js";
import { fromUnits, toUnits } from "./sales-money.js";
import { currentPriceLateral, resolveCurrentPrice } from "./sales-lookup.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const quoteStatuses = ["OPEN", "CONVERTED", "CANCELED", "EXPIRED"] as const;
const BUSINESS_TIME_ZONE = "America/La_Paz";
const DEFAULT_VALID_DAYS = 7;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Status shown to users: an OPEN quote past its validity is EXPIRED (derived, never stored). */
const effectiveStatus = `case when q.status = 'OPEN' and q.valid_until <= now() then 'EXPIRED' else q.status end`;

export interface CreateQuoteLineInput {
  presentationId: string;
  quantity: number;
}

export interface CreateQuoteInput {
  idempotencyKey: string;
  lines: readonly CreateQuoteLineInput[];
  customerName?: string;
  customerNote?: string;
  /** Validity in whole days, 1 to 30 (7 by default). */
  validDays?: number;
}

export interface CancelQuoteInput {
  idempotencyKey: string;
}

export interface QuotesListQuery {
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface QuoteListItem {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  validUntil: string;
  customerName: string | null;
  totalBob: string;
  createdByName: string | null;
  convertedSaleId: string | null;
}

export interface QuotesListResult {
  items: QuoteListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface QuoteDetailItem {
  presentationId: string;
  productName: string;
  presentationName: string;
  quantity: number;
  quotedUnitPriceBob: string;
  lineTotalBob: string;
  /** Null when the presentation has no current price. */
  currentUnitPriceBob: string | null;
  currentLineTotalBob: string | null;
  priceChanged: boolean;
}

export interface QuoteDetail {
  id: string;
  number: string;
  /** OPEN, CONVERTED, CANCELED, or EXPIRED (derived from valid_until). */
  status: string;
  createdAt: string;
  validUntil: string;
  customerName: string | null;
  customerNote: string | null;
  totalBob: string;
  /** Sum at today's prices; null when any line has no current price. */
  currentTotalBob: string | null;
  pricesChanged: boolean;
  createdBy: { id: string; name: string | null };
  convertedSaleId: string | null;
  convertedSaleNumber: string | null;
  branch: { id: string; code: string; name: string };
  pharmacy: { name: string; legalName: string; taxId: string };
  items: QuoteDetailItem[];
}

function normalizeCreate(input: CreateQuoteInput) {
  const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new BadRequestException("Idempotency key must be non-empty and at most 255 characters.");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 100) {
    throw new BadRequestException("At least one and at most 100 quote lines are required.");
  }
  const lines = input.lines.map((line) => {
    const presentationId = typeof line?.presentationId === "string" ? line.presentationId.trim() : "";
    if (!uuidPattern.test(presentationId)) throw new BadRequestException("Presentation ID must be a valid UUID.");
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1_000_000_000) {
      throw new BadRequestException("Quote quantity must be a positive safe integer.");
    }
    return { presentationId, quantity: line.quantity };
  });
  const validDays = input.validDays ?? DEFAULT_VALID_DAYS;
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 30) {
    throw new BadRequestException("Quote validity must be a whole number of days between 1 and 30.");
  }
  return {
    idempotencyKey,
    lines,
    validDays,
    customerName: optionalText(input.customerName, "Customer name", 120),
    customerNote: optionalText(input.customerNote, "Customer note", 500)
  };
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} must be at most ${max} characters.`);
  return trimmed === "" ? null : trimmed;
}

function optionalDate(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${label} must be a date in YYYY-MM-DD format.`);
  }
  return value;
}

function pageNumber(value: number | undefined, label: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new BadRequestException(`${label} must be an integer between 0 and ${max}.`);
  }
  return value;
}

function rethrowIdempotency(error: unknown): never {
  if (error instanceof IdempotencyKeyReusedError) {
    throw new ConflictException({ code: error.code, message: error.message });
  }
  throw error;
}

/** Quotes (proformas): priced offers that reserve no stock and never touch the cash drawer. */
export class SalesQuotes {
  private readonly idempotency = new IdempotencyService();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();
  private readonly sequences = new DocumentSequenceService();

  constructor(private readonly database: TenantDatabase) {}

  async create(scope: TenantScope, input: CreateQuoteInput): Promise<QuoteDetail> {
    const normalized = normalizeCreate(input);
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        "sales.quote_create",
        normalized.idempotencyKey,
        normalized,
        async (client) => ({
          statusCode: 201,
          body: await this.insertQuote(client, scope, normalized)
        } satisfies IdempotentExecutionResult<QuoteDetail>)
      );
      return (result.body ?? result.data) as QuoteDetail;
    } catch (error) {
      return rethrowIdempotency(error);
    }
  }

  async cancel(scope: TenantScope, quoteId: string, input: CancelQuoteInput): Promise<QuoteDetail> {
    if (!uuidPattern.test(quoteId)) throw new NotFoundException("Quote not found.");
    const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException("Idempotency key must be non-empty and at most 255 characters.");
    }
    try {
      const result = await this.idempotency.execute(
        this.database,
        scope,
        "sales.quote_cancel",
        idempotencyKey,
        { quoteId },
        async (client) => ({
          statusCode: 201,
          body: await this.cancelQuote(client, scope, quoteId)
        } satisfies IdempotentExecutionResult<QuoteDetail>)
      );
      return (result.body ?? result.data) as QuoteDetail;
    } catch (error) {
      return rethrowIdempotency(error);
    }
  }

  async list(scope: TenantScope, query: QuotesListQuery): Promise<QuotesListResult> {
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");
    const status = query.status === undefined || query.status === "" ? undefined : query.status.toUpperCase();
    if (status !== undefined && !(quoteStatuses as readonly string[]).includes(status)) {
      throw new BadRequestException("Quote status must be one of OPEN, CONVERTED, CANCELED or EXPIRED.");
    }
    const limit = pageNumber(query.limit, "limit", DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pageNumber(query.offset, "offset", 0, 1_000_000);

    const params: unknown[] = [scope.tenantId, scope.branchId];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = ["q.tenant_id = $1", "q.branch_id = $2"];
    if (from) conditions.push(`q.created_at >= (${bind(from)}::date::timestamp at time zone '${BUSINESS_TIME_ZONE}')`);
    if (to) conditions.push(`q.created_at < ((${bind(to)}::date + 1)::timestamp at time zone '${BUSINESS_TIME_ZONE}')`);
    if (status) conditions.push(`(${effectiveStatus}) = ${bind(status)}`);
    const where = conditions.join(" and ");

    return this.database.withScope(scope, async (client) => {
      const count = await client.query<{ total: number }>(
        `select count(*)::int as total from sales_quotes q where ${where}`,
        params
      );
      const rows = await client.query<{
        id: string;
        number: string;
        status: string;
        createdAt: Date;
        validUntil: Date;
        customerName: string | null;
        totalBob: string;
        createdByName: string | null;
        convertedSaleId: string | null;
      }>(
        `select q.id, q.quote_number as number, (${effectiveStatus}) as status, q.created_at as "createdAt",
                q.valid_until as "validUntil", q.customer_name as "customerName",
                q.total_amount_bob::text as "totalBob", u.display_name as "createdByName",
                q.converted_sale_id as "convertedSaleId"
         from sales_quotes q left join users u on u.id = q.created_by_user_id
         where ${where}
         order by q.created_at desc, q.id desc
         limit ${bind(limit)} offset ${bind(offset)}`,
        params
      );
      return {
        items: rows.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          validUntil: row.validUntil.toISOString()
        })),
        total: count.rows[0]?.total ?? 0,
        limit,
        offset
      };
    });
  }

  async detail(scope: TenantScope, quoteId: string): Promise<QuoteDetail> {
    if (!uuidPattern.test(quoteId)) throw new NotFoundException("Quote not found.");
    return this.database.withScope(scope, async (client) => {
      const quote = await this.loadDetail(client, scope, quoteId);
      if (!quote) throw new NotFoundException("Quote not found.");
      return quote;
    });
  }

  /**
   * Called inside the sale transaction: locks the quote and marks it CONVERTED. A quote that is
   * not OPEN (converted, canceled or past its validity) rejects the whole sale.
   */
  async convertInTransaction(client: PoolClient, scope: TenantScope, quoteId: string, saleId: string): Promise<void> {
    const locked = await client.query<{ status: string }>(
      `select (${effectiveStatus}) as status from sales_quotes q
       where q.tenant_id = $1 and q.branch_id = $2 and q.id = $3 for update`,
      [scope.tenantId, scope.branchId, quoteId]
    );
    const row = locked.rows[0];
    if (!row) throw new NotFoundException("Quote not found.");
    if (row.status !== "OPEN") throw this.notOpen(row.status);
    await client.query(
      `update sales_quotes set status = 'CONVERTED', converted_sale_id = $4, converted_at = now()
       where tenant_id = $1 and branch_id = $2 and id = $3`,
      [scope.tenantId, scope.branchId, quoteId, saleId]
    );
    await this.audit.recordInTransaction(client, scope, {
      action: "sales.quote_converted",
      entityType: "sales_quote",
      entityId: quoteId,
      payload: { saleId }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sales_quote",
      aggregateId: quoteId,
      eventType: "sales.quote_converted",
      payload: { quoteId, saleId }
    });
  }

  private notOpen(status: string): ConflictException {
    return new ConflictException({
      code: "QUOTE_NOT_OPEN",
      message: "The quote is not open: it was already converted, canceled or has expired.",
      status
    });
  }

  private async insertQuote(
    client: PoolClient,
    scope: TenantScope,
    input: ReturnType<typeof normalizeCreate>
  ): Promise<QuoteDetail> {
    const priced: Array<{ presentationId: string; quantity: number; unitPriceBob: string }> = [];
    for (const line of input.lines) {
      const presentation = await client.query(
        `select 1 from product_presentations pr
         where pr.tenant_id = $1 and pr.id = $2 and pr.is_sellable = true and pr.is_active = true
           and exists (select 1 from products p where p.tenant_id = pr.tenant_id and p.id = pr.product_id and p.is_active)`,
        [scope.tenantId, line.presentationId]
      );
      if (!presentation.rows[0]) {
        throw new NotFoundException("The product presentation is not available in this tenant.");
      }
      const price = await resolveCurrentPrice(client, scope, line.presentationId);
      if (price === null) {
        throw new ConflictException({
          code: "PRICE_NOT_FOUND",
          message: "The presentation has no current price.",
          presentationId: line.presentationId
        });
      }
      priced.push({ ...line, unitPriceBob: price });
    }
    const total = priced.reduce((sum, line) => sum + toUnits(line.unitPriceBob) * BigInt(line.quantity), 0n);
    const number = await this.nextNumber(client, scope);
    const created = await client.query<{ id: string }>(
      `insert into sales_quotes
         (tenant_id, branch_id, quote_number, customer_name, customer_note, valid_until, total_amount_bob, created_by_user_id)
       values ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 day'), $7::numeric, $8)
       returning id`,
      [scope.tenantId, scope.branchId, number, input.customerName, input.customerNote, input.validDays, fromUnits(total), scope.userId]
    );
    const quoteId = created.rows[0]?.id;
    if (!quoteId) throw new Error("Quote was not created.");
    for (const [index, line] of priced.entries()) {
      await client.query(
        `insert into sales_quote_items
           (tenant_id, branch_id, quote_id, position, presentation_id, quantity, unit_price_bob, line_total_bob)
         values ($1, $2, $3, $7, $4, $5::bigint, $6::numeric, ($5::bigint * $6::numeric))`,
        [scope.tenantId, scope.branchId, quoteId, line.presentationId, line.quantity, line.unitPriceBob, index]
      );
    }
    await this.audit.recordInTransaction(client, scope, {
      action: "sales.quote_created",
      entityType: "sales_quote",
      entityId: quoteId,
      payload: { number, totalBob: fromUnits(total), lines: priced.length, validDays: input.validDays }
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sales_quote",
      aggregateId: quoteId,
      eventType: "sales.quote_created",
      payload: { quoteId, number, totalBob: fromUnits(total) }
    });
    const detail = await this.loadDetail(client, scope, quoteId);
    if (!detail) throw new Error("Quote was not readable after creation.");
    return detail;
  }

  private async cancelQuote(client: PoolClient, scope: TenantScope, quoteId: string): Promise<QuoteDetail> {
    const locked = await client.query<{ status: string }>(
      `select (${effectiveStatus}) as status from sales_quotes q
       where q.tenant_id = $1 and q.branch_id = $2 and q.id = $3 for update`,
      [scope.tenantId, scope.branchId, quoteId]
    );
    const row = locked.rows[0];
    if (!row) throw new NotFoundException("Quote not found.");
    if (row.status !== "OPEN") throw this.notOpen(row.status);
    await client.query(
      `update sales_quotes set status = 'CANCELED', canceled_at = now(), canceled_by_user_id = $4
       where tenant_id = $1 and branch_id = $2 and id = $3`,
      [scope.tenantId, scope.branchId, quoteId, scope.userId]
    );
    await this.audit.recordInTransaction(client, scope, {
      action: "sales.quote_canceled",
      entityType: "sales_quote",
      entityId: quoteId,
      payload: {}
    });
    await this.outbox.enqueueInTransaction(client, scope, {
      aggregateType: "sales_quote",
      aggregateId: quoteId,
      eventType: "sales.quote_canceled",
      payload: { quoteId }
    });
    const detail = await this.loadDetail(client, scope, quoteId);
    if (!detail) throw new Error("Quote was not readable after cancellation.");
    return detail;
  }

  private async nextNumber(client: PoolClient, scope: TenantScope): Promise<string> {
    const branch = await client.query<{ code: string }>(
      "select code from branches where tenant_id = $1 and id = $2",
      [scope.tenantId, scope.branchId]
    );
    const number = await this.sequences.nextNumberInTransaction(client, "QUOTE");
    return `P-${branch.rows[0]?.code ?? "SUC"}-${number.toString().padStart(6, "0")}`;
  }

  private async loadDetail(client: PoolClient, scope: TenantScope, quoteId: string): Promise<QuoteDetail | undefined> {
    const header = await client.query<{
      id: string;
      number: string;
      status: string;
      createdAt: Date;
      validUntil: Date;
      customerName: string | null;
      customerNote: string | null;
      totalBob: string;
      createdById: string;
      createdByName: string | null;
      convertedSaleId: string | null;
      convertedSaleNumber: string | null;
      branchId: string;
      branchCode: string;
      branchName: string;
      pharmacyName: string;
      legalName: string;
      taxId: string;
    }>(
      `select q.id, q.quote_number as number, (${effectiveStatus}) as status, q.created_at as "createdAt",
              q.valid_until as "validUntil", q.customer_name as "customerName", q.customer_note as "customerNote",
              q.total_amount_bob::text as "totalBob", q.created_by_user_id as "createdById",
              u.display_name as "createdByName", q.converted_sale_id as "convertedSaleId",
              s.sale_number as "convertedSaleNumber",
              br.id as "branchId", br.code as "branchCode", br.name as "branchName",
              t.name as "pharmacyName", le.legal_name as "legalName", le.tax_id as "taxId"
       from sales_quotes q
       join branches br on br.tenant_id = q.tenant_id and br.id = q.branch_id
       join legal_entities le on le.tenant_id = br.tenant_id and le.id = br.legal_entity_id
       join tenants t on t.id = q.tenant_id
       left join users u on u.id = q.created_by_user_id
       left join sales s on s.tenant_id = q.tenant_id and s.branch_id = q.branch_id and s.id = q.converted_sale_id
       where q.tenant_id = $1 and q.branch_id = $2 and q.id = $3`,
      [scope.tenantId, scope.branchId, quoteId]
    );
    const row = header.rows[0];
    if (!row) return undefined;
    const items = await client.query<{
      presentationId: string;
      productName: string;
      presentationName: string;
      quantity: string;
      quotedUnitPriceBob: string;
      lineTotalBob: string;
      currentUnitPriceBob: string | null;
    }>(
      `select i.presentation_id as "presentationId", p.name as "productName", pp.name as "presentationName",
              i.quantity::text as quantity, i.unit_price_bob::text as "quotedUnitPriceBob",
              i.line_total_bob::text as "lineTotalBob", selected_price.amount::text as "currentUnitPriceBob"
       from sales_quote_items i
       join product_presentations pp on pp.tenant_id = i.tenant_id and pp.id = i.presentation_id
       join products p on p.tenant_id = pp.tenant_id and p.id = pp.product_id
       ${currentPriceLateral("pp.id", "pp.tenant_id", "$2")}
       where i.tenant_id = $1 and i.branch_id = $2 and i.quote_id = $3
       order by i.position`,
      [scope.tenantId, scope.branchId, quoteId]
    );
    const detailItems: QuoteDetailItem[] = items.rows.map((item) => {
      const quantity = Number(item.quantity);
      const current = item.currentUnitPriceBob;
      return {
        presentationId: item.presentationId,
        productName: item.productName,
        presentationName: item.presentationName,
        quantity,
        quotedUnitPriceBob: item.quotedUnitPriceBob,
        lineTotalBob: item.lineTotalBob,
        currentUnitPriceBob: current === null ? null : fromUnits(toUnits(current)),
        currentLineTotalBob: current === null ? null : fromUnits(toUnits(current) * BigInt(quantity)),
        priceChanged: current === null || toUnits(current) !== toUnits(item.quotedUnitPriceBob)
      };
    });
    const allPriced = detailItems.every((item) => item.currentLineTotalBob !== null);
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      validUntil: row.validUntil.toISOString(),
      customerName: row.customerName,
      customerNote: row.customerNote,
      totalBob: row.totalBob,
      currentTotalBob: allPriced
        ? fromUnits(detailItems.reduce((sum, item) => sum + toUnits(item.currentLineTotalBob as string), 0n))
        : null,
      pricesChanged: detailItems.some((item) => item.priceChanged),
      createdBy: { id: row.createdById, name: row.createdByName },
      convertedSaleId: row.convertedSaleId,
      convertedSaleNumber: row.convertedSaleNumber,
      branch: { id: row.branchId, code: row.branchCode, name: row.branchName },
      pharmacy: { name: row.pharmacyName, legalName: row.legalName, taxId: row.taxId },
      items: detailItems
    };
  }
}
