CREATE TABLE "sales" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "cash_shift_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'CONFIRMED',
  "total_amount_bob" numeric(18,4) NOT NULL,
  "paid_amount_bob" numeric(18,4) NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sales_tenant_branch_id_unique" UNIQUE("tenant_id", "branch_id", "id"),
  CONSTRAINT "sales_status_check" CHECK ("status" in ('CONFIRMED')),
  CONSTRAINT "sales_total_nonnegative_check" CHECK ("total_amount_bob" >= 0),
  CONSTRAINT "sales_paid_nonnegative_check" CHECK ("paid_amount_bob" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "sale_id" uuid NOT NULL,
  "presentation_id" uuid NOT NULL,
  "quantity" bigint NOT NULL,
  "quantity_base" bigint NOT NULL,
  "unit_price_bob" numeric(18,4) NOT NULL,
  "line_total_bob" numeric(18,4) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sale_items_tenant_branch_id_unique" UNIQUE("tenant_id", "branch_id", "id"),
  CONSTRAINT "sale_items_quantity_positive_check" CHECK ("quantity" > 0 and "quantity_base" > 0),
  CONSTRAINT "sale_items_price_nonnegative_check" CHECK ("unit_price_bob" >= 0 and "line_total_bob" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "sale_id" uuid NOT NULL,
  "method" varchar(16) NOT NULL,
  "amount_bob" numeric(18,4) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sale_payments_tenant_branch_id_unique" UNIQUE("tenant_id", "branch_id", "id"),
  CONSTRAINT "sale_payments_method_check" CHECK ("method" = 'CASH'),
  CONSTRAINT "sale_payments_amount_nonnegative_check" CHECK ("amount_bob" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "sale_item_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "quantity_base" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sale_allocations_tenant_branch_id_unique" UNIQUE("tenant_id", "branch_id", "id"),
  CONSTRAINT "sale_allocations_quantity_positive_check" CHECK ("quantity_base" > 0)
);
--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_tenant_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id);
ALTER TABLE sales ADD CONSTRAINT sales_tenant_branch_shift_fk FOREIGN KEY (tenant_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, branch_id, id);
ALTER TABLE warehouses ADD CONSTRAINT warehouses_tenant_branch_id_unique UNIQUE (tenant_id, branch_id, id);
ALTER TABLE sales ADD CONSTRAINT sales_tenant_branch_warehouse_fk FOREIGN KEY (tenant_id, branch_id, warehouse_id) REFERENCES warehouses(tenant_id, branch_id, id);
ALTER TABLE sales ADD CONSTRAINT sales_creator_membership_fk FOREIGN KEY (created_by_user_id, tenant_id, branch_id) REFERENCES user_branch_memberships(user_id, tenant_id, branch_id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_sale_fk FOREIGN KEY (tenant_id, branch_id, sale_id) REFERENCES sales(tenant_id, branch_id, id);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_presentation_fk FOREIGN KEY (tenant_id, presentation_id) REFERENCES product_presentations(tenant_id, id);
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_sale_fk FOREIGN KEY (tenant_id, branch_id, sale_id) REFERENCES sales(tenant_id, branch_id, id);
ALTER TABLE sale_allocations ADD CONSTRAINT sale_allocations_item_fk FOREIGN KEY (tenant_id, branch_id, sale_item_id) REFERENCES sale_items(tenant_id, branch_id, id);
ALTER TABLE sale_allocations ADD CONSTRAINT sale_allocations_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory_batches(tenant_id, id);
--> statement-breakpoint
CREATE INDEX sales_branch_created_idx ON sales(tenant_id, branch_id, created_at);
CREATE INDEX sale_items_sale_idx ON sale_items(tenant_id, branch_id, sale_id);
CREATE INDEX sale_allocations_item_idx ON sale_allocations(tenant_id, branch_id, sale_item_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sales, sale_items, sale_payments, sale_allocations TO farmaxia_app;
INSERT INTO permissions (code, description) VALUES ('sales.confirm', 'Confirm non-fiscal cash sales') ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_branch_isolation ON sales FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY sale_items_branch_isolation ON sale_items FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_payments_branch_isolation ON sale_payments FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_allocations_branch_isolation ON sale_allocations FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
