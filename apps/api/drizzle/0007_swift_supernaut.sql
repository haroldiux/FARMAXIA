CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity_base" bigint NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_items_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "goods_receipt_items_quantity_positive_check" CHECK ("goods_receipt_items"."quantity_base" > 0),
	CONSTRAINT "goods_receipt_items_cost_non_negative_check" CHECK ("goods_receipt_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(24) DEFAULT 'POSTED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "goods_receipts_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity_base" bigint DEFAULT 0 NOT NULL,
	"reserved_base" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_pk" PRIMARY KEY("tenant_id","warehouse_id","batch_id"),
	CONSTRAINT "inventory_balances_quantity_non_negative_check" CHECK ("inventory_balances"."quantity_base" >= 0),
	CONSTRAINT "inventory_balances_reserved_non_negative_check" CHECK ("inventory_balances"."reserved_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"supplier_id" uuid,
	"lot_code" varchar(100) NOT NULL,
	"expires_on" date NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"status" varchar(24) DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_batches_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_batches_tenant_presentation_lot_unique" UNIQUE("tenant_id","presentation_id","lot_code"),
	CONSTRAINT "inventory_batches_cost_non_negative_check" CHECK ("inventory_batches"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"movement_type" varchar(24) NOT NULL,
	"quantity_base" bigint NOT NULL,
	"reference_type" varchar(80) NOT NULL,
	"reference_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_quantity_positive_check" CHECK ("inventory_movements"."quantity_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"original_amount" numeric(18, 4) NOT NULL,
	"outstanding_amount" numeric(18, 4) NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payables_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payables_tenant_invoice_unique" UNIQUE("tenant_id","supplier_invoice_id"),
	CONSTRAINT "payables_original_amount_non_negative_check" CHECK ("payables"."original_amount" >= 0),
	CONSTRAINT "payables_outstanding_amount_non_negative_check" CHECK ("payables"."outstanding_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"quantity_base" bigint NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_items_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_items_quantity_positive_check" CHECK ("purchase_order_items"."quantity_base" > 0),
	CONSTRAINT "purchase_order_items_cost_non_negative_check" CHECK ("purchase_order_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"goods_receipt_id" uuid,
	"invoice_number" varchar(80) NOT NULL,
	"issued_on" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"total_amount" numeric(18, 4) NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_invoices_tenant_supplier_number_unique" UNIQUE("tenant_id","supplier_id","invoice_number"),
	CONSTRAINT "supplier_invoices_amount_non_negative_check" CHECK ("supplier_invoices"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"tax_id" varchar(32),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_receipt_fk" FOREIGN KEY ("tenant_id","goods_receipt_id") REFERENCES "public"."goods_receipts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_order_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_tenant_invoice_fk" FOREIGN KEY ("tenant_id","supplier_invoice_id") REFERENCES "public"."supplier_invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_order_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_receipt_fk" FOREIGN KEY ("tenant_id","goods_receipt_id") REFERENCES "public"."goods_receipts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_warehouse_occurred_idx" ON "inventory_movements" USING btree ("tenant_id","warehouse_id","occurred_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  suppliers,
  purchase_orders,
  purchase_order_items,
  goods_receipts,
  goods_receipt_items,
  inventory_batches,
  inventory_balances,
  inventory_movements,
  supplier_invoices,
  payables
TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_scope ON suppliers
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = suppliers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = suppliers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_scope ON purchase_orders
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = purchase_orders.tenant_id
        AND warehouse.id = purchase_orders.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = purchase_orders.tenant_id
        AND warehouse.id = purchase_orders.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_items_scope ON purchase_order_items
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM purchase_orders purchase_order
      WHERE purchase_order.tenant_id = purchase_order_items.tenant_id
        AND purchase_order.id = purchase_order_items.purchase_order_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM purchase_orders purchase_order
      WHERE purchase_order.tenant_id = purchase_order_items.tenant_id
        AND purchase_order.id = purchase_order_items.purchase_order_id)
  );
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipts_scope ON goods_receipts
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM purchase_orders purchase_order
      WHERE purchase_order.tenant_id = goods_receipts.tenant_id
        AND purchase_order.id = goods_receipts.purchase_order_id
        AND purchase_order.warehouse_id = goods_receipts.warehouse_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM purchase_orders purchase_order
      WHERE purchase_order.tenant_id = goods_receipts.tenant_id
        AND purchase_order.id = goods_receipts.purchase_order_id
        AND purchase_order.warehouse_id = goods_receipts.warehouse_id)
  );
ALTER TABLE goods_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_items FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipt_items_scope ON goods_receipt_items
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM goods_receipts receipt
      WHERE receipt.tenant_id = goods_receipt_items.tenant_id
        AND receipt.id = goods_receipt_items.goods_receipt_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM goods_receipts receipt
      WHERE receipt.tenant_id = goods_receipt_items.tenant_id
        AND receipt.id = goods_receipt_items.goods_receipt_id)
  );
ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_batches_scope ON inventory_batches
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = inventory_batches.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = inventory_batches.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_balances_scope ON inventory_balances
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_balances.tenant_id
        AND warehouse.id = inventory_balances.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_balances.tenant_id
        AND warehouse.id = inventory_balances.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movements_scope ON inventory_movements
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_movements.tenant_id
        AND warehouse.id = inventory_movements.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_movements.tenant_id
        AND warehouse.id = inventory_movements.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_invoices_scope ON supplier_invoices
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = supplier_invoices.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = supplier_invoices.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables FORCE ROW LEVEL SECURITY;
CREATE POLICY payables_scope ON payables
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = payables.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = payables.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
