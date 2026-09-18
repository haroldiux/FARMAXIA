import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";
import {
  IdempotencyService,
  type IdempotentExecutionResult
} from "../transversal/idempotency.service.js";

export interface SupplierInput {
  name: string;
  taxId?: string;
}

export interface PurchaseOrderLineInput {
  presentationId: string;
  quantityBase: number;
  unitCost: string;
}

export interface PurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  lines: readonly PurchaseOrderLineInput[];
}

export interface ReceiptLineInput {
  presentationId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: number;
  unitCost: string;
}

export interface ReceiveInput {
  idempotencyKey: string;
  supplierId: string;
  purchaseOrderId: string;
  warehouseId: string;
  receivedAt: string;
  lines: readonly ReceiptLineInput[];
}

export interface ReceiveResult {
  receiptId: string;
  lineCount: number;
}

export interface SupplierInvoiceInput {
  supplierId: string;
  goodsReceiptId: string;
  invoiceNumber: string;
  issuedOn: string;
  currency: string;
  totalAmount: string;
  dueOn: string;
}

export interface InvoiceResult {
  invoiceId: string;
  payableId: string;
}

interface CreatedRow {
  id: string;
}

interface PurchaseOrderRow {
  id: string;
  supplierId: string;
  warehouseId: string;
  status: string;
}

interface QuantityRow {
  quantityBase: string;
}

interface BatchRow {
  id: string;
  expiresOn: string;
  unitCost: string;
}

function text(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return normalized;
}

function quantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function cost(value: string, field = "Unit cost"): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error(`${field} must be a positive decimal with up to four places.`);
  }
  return normalized;
}

function currency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  return normalized;
}

function dateOnly(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error(`${field} must be an ISO date.`);
  }
  return normalized;
}

function dateTime(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }
  return parsed;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

export class ProcurementService {
  private readonly idempotency: IdempotencyService;

  constructor(private readonly database: TenantDatabase) {
    this.idempotency = new IdempotencyService();
  }

  async createSupplier(scope: TenantScope, input: SupplierInput): Promise<CreatedRow> {
    const name = text(input.name, "Supplier name", 200);
    const taxId = input.taxId?.trim() || null;
    if (taxId && taxId.length > 32) {
      throw new Error("Supplier tax ID must be at most 32 characters.");
    }
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<CreatedRow>(
        `insert into suppliers (tenant_id, name, tax_id)
         values ($1, $2, $3)
         returning id`,
        [scope.tenantId, name, taxId]
      );
      return requireRow(rows[0], "Supplier was not created.");
    });
  }

  async createPurchaseOrder(
    scope: TenantScope,
    input: PurchaseOrderInput
  ): Promise<CreatedRow> {
    if (input.lines.length === 0) {
      throw new Error("Purchase order must contain at least one line.");
    }
    const lines = input.lines.map((line) => ({
      presentationId: line.presentationId,
      quantityBase: quantity(line.quantityBase, "Purchase quantity"),
      unitCost: cost(line.unitCost)
    }));

    return this.database.withScope(scope, async (client) => {
      const order = await client.query<CreatedRow>(
        `insert into purchase_orders (tenant_id, supplier_id, warehouse_id, status)
         values ($1, $2, $3, 'SUBMITTED')
         returning id`,
        [scope.tenantId, input.supplierId, input.warehouseId]
      );
      const created = requireRow(order.rows[0], "Purchase order was not created.");
      for (const line of lines) {
        await client.query(
          `insert into purchase_order_items
             (tenant_id, purchase_order_id, presentation_id, quantity_base, unit_cost)
           values ($1, $2, $3, $4, $5)`,
          [scope.tenantId, created.id, line.presentationId, line.quantityBase, line.unitCost]
        );
      }
      return created;
    });
  }

  async receive(scope: TenantScope, input: ReceiveInput): Promise<ReceiveResult> {
    const normalized = this.normalizeReceive(input);
    const result = await this.idempotency.execute(
      this.database,
      scope,
      "inventory.receive",
      normalized.idempotencyKey,
      normalized,
      async (client) => this.postReceipt(client, scope, normalized)
    );
    return (result.body ?? result.data) as ReceiveResult;
  }

  async createSupplierInvoice(
    scope: TenantScope,
    input: SupplierInvoiceInput
  ): Promise<InvoiceResult> {
    const invoiceNumber = text(input.invoiceNumber, "Invoice number", 80);
    const issuedOn = dateOnly(input.issuedOn, "Issued date");
    const dueOn = dateOnly(input.dueOn, "Due date");
    const totalAmount = cost(input.totalAmount, "Invoice total");
    const currencyCode = currency(input.currency);
    return this.database.withScope(scope, async (client) => {
      const invoice = await client.query<CreatedRow>(
        `insert into supplier_invoices
           (tenant_id, supplier_id, goods_receipt_id, invoice_number, issued_on,
            currency, total_amount)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          scope.tenantId,
          input.supplierId,
          input.goodsReceiptId,
          invoiceNumber,
          issuedOn,
          currencyCode,
          totalAmount
        ]
      );
      const createdInvoice = requireRow(invoice.rows[0], "Supplier invoice was not created.");
      const payable = await client.query<CreatedRow>(
        `insert into payables
           (tenant_id, supplier_invoice_id, due_on, original_amount, outstanding_amount)
         values ($1, $2, $3, $4, $4)
         returning id`,
        [scope.tenantId, createdInvoice.id, dueOn, totalAmount]
      );
      const createdPayable = requireRow(payable.rows[0], "Payable was not created.");
      return { invoiceId: createdInvoice.id, payableId: createdPayable.id };
    });
  }

  private normalizeReceive(input: ReceiveInput): ReceiveInput {
    const idempotencyKey = text(input.idempotencyKey, "Idempotency key", 255);
    const receivedAt = dateTime(input.receivedAt, "Received date").toISOString();
    if (input.lines.length === 0) {
      throw new Error("Goods receipt must contain at least one line.");
    }
    const keys = new Set<string>();
    const lines = input.lines.map((line) => {
      const lotCode = text(line.lotCode, "Lot code", 100);
      const key = `${line.presentationId}:${lotCode}`;
      if (keys.has(key)) {
        throw new Error("Goods receipt cannot repeat a presentation and lot.");
      }
      keys.add(key);
      return {
        presentationId: line.presentationId,
        lotCode,
        expiresOn: dateOnly(line.expiresOn, "Expiration date"),
        quantityBase: quantity(line.quantityBase, "Received quantity"),
        unitCost: cost(line.unitCost)
      };
    });
    return {
      idempotencyKey,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      warehouseId: input.warehouseId,
      receivedAt,
      lines
    };
  }

  private async postReceipt(
    client: PoolClient,
    scope: TenantScope,
    input: ReceiveInput
  ): Promise<IdempotentExecutionResult<ReceiveResult>> {
    const orderResult = await client.query<PurchaseOrderRow>(
      `select id, supplier_id as "supplierId", warehouse_id as "warehouseId", status
       from purchase_orders
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, input.purchaseOrderId]
    );
    const order = requireRow(orderResult.rows[0], "Purchase order is not available in this scope.");
    if (order.supplierId !== input.supplierId || order.warehouseId !== input.warehouseId) {
      throw new Error("Receipt supplier and warehouse must match the purchase order.");
    }
    if (order.status === "CANCELED") {
      throw new Error("Canceled purchase orders cannot be received.");
    }

    const receiptResult = await client.query<CreatedRow>(
      `insert into goods_receipts
         (tenant_id, purchase_order_id, supplier_id, warehouse_id, idempotency_key, received_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        scope.tenantId,
        input.purchaseOrderId,
        input.supplierId,
        input.warehouseId,
        input.idempotencyKey,
        input.receivedAt
      ]
    );
    const receipt = requireRow(receiptResult.rows[0], "Goods receipt was not created.");

    for (const line of input.lines) {
      const ordered = await client.query<QuantityRow>(
        `select quantity_base as "quantityBase"
         from purchase_order_items
         where tenant_id = $1 and purchase_order_id = $2 and presentation_id = $3`,
        [scope.tenantId, input.purchaseOrderId, line.presentationId]
      );
      const orderedQuantity = Number(ordered.rows[0]?.quantityBase ?? 0);
      if (orderedQuantity < line.quantityBase) {
        throw new Error("Received quantity exceeds the purchase order.");
      }
      const previous = await client.query<QuantityRow>(
        `select coalesce(sum(receipt_item.quantity_base), 0)::text as "quantityBase"
         from goods_receipt_items receipt_item
         join goods_receipts previous_receipt
           on previous_receipt.tenant_id = receipt_item.tenant_id
          and previous_receipt.id = receipt_item.goods_receipt_id
         where previous_receipt.tenant_id = $1
           and previous_receipt.purchase_order_id = $2
           and receipt_item.presentation_id = $3`,
        [scope.tenantId, input.purchaseOrderId, line.presentationId]
      );
      const alreadyReceived = Number(previous.rows[0]?.quantityBase ?? 0);
      if (alreadyReceived + line.quantityBase > orderedQuantity) {
        throw new Error("Cumulative received quantity exceeds the purchase order.");
      }

      const existingBatchResult = await client.query<BatchRow>(
        `select id, expires_on as "expiresOn", unit_cost as "unitCost"
         from inventory_batches
         where tenant_id = $1 and presentation_id = $2 and lot_code = $3`,
        [scope.tenantId, line.presentationId, line.lotCode]
      );
      let batch = existingBatchResult.rows[0];
      if (batch) {
        if (batch.expiresOn !== line.expiresOn || batch.unitCost !== line.unitCost) {
          throw new Error("A lot cannot change expiration date or provisional unit cost.");
        }
      } else {
        const batchResult = await client.query<BatchRow>(
          `insert into inventory_batches
             (tenant_id, presentation_id, supplier_id, lot_code, expires_on, unit_cost, status)
           values ($1, $2, $3, $4, $5, $6, case when $5::date <= $7::date then 'QUARANTINED' else 'AVAILABLE' end)
           returning id, expires_on as "expiresOn", unit_cost as "unitCost"`,
          [
            scope.tenantId,
            line.presentationId,
            input.supplierId,
            line.lotCode,
            line.expiresOn,
            line.unitCost,
            input.receivedAt.slice(0, 10)
          ]
        );
        batch = requireRow(batchResult.rows[0], "Inventory batch was not created.");
      }

      await client.query(
        `insert into goods_receipt_items
           (tenant_id, goods_receipt_id, presentation_id, batch_id, quantity_base, unit_cost)
         values ($1, $2, $3, $4, $5, $6)`,
        [scope.tenantId, receipt.id, line.presentationId, batch.id, line.quantityBase, line.unitCost]
      );
      await client.query(
        `insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, warehouse_id, batch_id)
         do update set quantity_base = inventory_balances.quantity_base + excluded.quantity_base,
                       updated_at = now()`,
        [scope.tenantId, input.warehouseId, batch.id, line.quantityBase]
      );
      await client.query(
        `insert into inventory_movements
           (tenant_id, warehouse_id, batch_id, movement_type, movement_direction,
            quantity_base, reference_type, reference_id)
         values ($1, $2, $3, 'RECEIPT', 'IN', $4, 'GOODS_RECEIPT', $5)`,
        [scope.tenantId, input.warehouseId, batch.id, line.quantityBase, receipt.id]
      );
    }

    await client.query(
      `update purchase_orders set status = 'RECEIVED'
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, input.purchaseOrderId]
    );
    return { statusCode: 201, body: { receiptId: receipt.id, lineCount: input.lines.length } };
  }
}
