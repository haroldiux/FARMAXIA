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

export interface SupplierSummary {
  id: string;
  name: string;
  taxId: string | null;
  isActive: boolean;
}

export interface SupplierListResult {
  items: SupplierSummary[];
}

export interface PresentationSummary {
  presentationId: string;
  presentationName: string;
  productName: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

export interface PresentationListResult {
  items: PresentationSummary[];
}

export interface PurchaseOrderLineSummary {
  presentationId: string;
  presentationName: string;
  productName: string;
  quantityBase: number;
  unitCost: string;
}

export interface PurchaseOrderSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  status: string;
  orderedAt: string;
  lines: PurchaseOrderLineSummary[];
}

export interface PurchaseOrderListResult {
  items: PurchaseOrderSummary[];
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

interface PurchaseOrderListRow {
  id: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  status: string;
  orderedAt: string | Date;
  lines: PurchaseOrderLineSummary[];
}

interface QuantityRow {
  quantityBase: string;
}

interface CompletionRow {
  isComplete: boolean;
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

  async listSuppliers(scope: TenantScope): Promise<SupplierListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<SupplierSummary>(
        `select id,
                name,
                tax_id as "taxId",
                is_active as "isActive"
         from suppliers
         where tenant_id = $1 and is_active = true
         order by name asc, id asc`,
        [scope.tenantId]
      );
      return { items: result.rows };
    });
  }

  async listPresentations(scope: TenantScope): Promise<PresentationListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<PresentationSummary>(
        `select presentation.id as "presentationId",
                presentation.name as "presentationName",
                product.name as "productName",
                presentation.base_unit_factor::int as "baseUnitFactor",
                presentation.is_sellable as "isSellable"
         from product_presentations presentation
         join products product
           on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
         where presentation.tenant_id = $1 and product.is_active = true
         order by product.name asc, presentation.name asc, presentation.id asc`,
        [scope.tenantId]
      );
      return { items: result.rows };
    });
  }

  async listPurchaseOrders(scope: TenantScope): Promise<PurchaseOrderListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<PurchaseOrderListRow>(
        `select po.id,
                po.supplier_id as "supplierId",
                supplier.name as "supplierName",
                po.warehouse_id as "warehouseId",
                warehouse.name as "warehouseName",
                po.status,
                po.ordered_at as "orderedAt",
                coalesce(
                  json_agg(
                    json_build_object(
                      'presentationId', item.presentation_id,
                      'presentationName', presentation.name,
                      'productName', product.name,
                      'quantityBase', item.quantity_base,
                      'unitCost', item.unit_cost::text
                    ) order by item.id
                  ) filter (where item.id is not null),
                  '[]'::json
                ) as lines
         from purchase_orders po
         join suppliers supplier
           on supplier.tenant_id = po.tenant_id and supplier.id = po.supplier_id
         join warehouses warehouse
           on warehouse.tenant_id = po.tenant_id and warehouse.id = po.warehouse_id
         left join purchase_order_items item
           on item.tenant_id = po.tenant_id and item.purchase_order_id = po.id
         left join product_presentations presentation
           on presentation.tenant_id = item.tenant_id and presentation.id = item.presentation_id
         left join products product
           on product.tenant_id = presentation.tenant_id and product.id = presentation.product_id
         where po.tenant_id = $1 and warehouse.branch_id = $2
         group by po.id, po.supplier_id, supplier.name, po.warehouse_id,
                  warehouse.name, po.status, po.ordered_at
         order by po.ordered_at desc, po.id desc`,
        [scope.tenantId, scope.branchId]
      );
      return {
        items: result.rows.map((row) => ({
          ...row,
          orderedAt: new Date(row.orderedAt).toISOString(),
          lines: row.lines ?? []
        }))
      };
    });
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
       where tenant_id = $1 and id = $2
       for update`,
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
        `select coalesce(sum(quantity_base), 0)::text as "quantityBase"
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

    const completion = await client.query<CompletionRow>(
      `select not exists (
         select 1
         from (
           select presentation_id, sum(quantity_base) as ordered_base
           from purchase_order_items
           where tenant_id = $1 and purchase_order_id = $2
           group by presentation_id
         ) ordered
         left join (
           select item.presentation_id, sum(item.quantity_base) as received_base
           from goods_receipt_items item
           join goods_receipts receipt
             on receipt.tenant_id = item.tenant_id
            and receipt.id = item.goods_receipt_id
           where receipt.tenant_id = $1 and receipt.purchase_order_id = $2
           group by item.presentation_id
         ) received on received.presentation_id = ordered.presentation_id
         where coalesce(received.received_base, 0) < ordered.ordered_base
       ) as "isComplete"`,
      [scope.tenantId, input.purchaseOrderId]
    );
    const isComplete = completion.rows[0]?.isComplete ?? false;
    await client.query(
      `update purchase_orders set status = $3
       where tenant_id = $1 and id = $2`,
      [scope.tenantId, input.purchaseOrderId, isComplete ? "RECEIVED" : "PARTIALLY_RECEIVED"]
    );
    return { statusCode: 201, body: { receiptId: receipt.id, lineCount: input.lines.length } };
  }
}
