-- Module 5 (T5): full voids and partial returns, plus the sales.void permission.
ALTER TABLE "sales" ADD COLUMN "voided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voided_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "void_reason" varchar(200);
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_status_check";
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_status_check" CHECK ("status" in ('CONFIRMED', 'VOIDED', 'PARTIALLY_RETURNED', 'RETURNED'));
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_void_consistency_check" CHECK (
  ("status" = 'VOIDED' and "voided_at" is not null and "voided_by_user_id" is not null and "void_reason" is not null and length(btrim("void_reason")) > 0)
  or ("status" <> 'VOIDED' and "voided_at" is null and "voided_by_user_id" is null and "void_reason" is null)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_membership_fk" FOREIGN KEY ("voided_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Card/QR payments of a voided sale are reversed manually (no gateway).
ALTER TABLE "sale_payments" ADD COLUMN "reversed_at" timestamp with time zone;
--> statement-breakpoint
-- Supervisors (sales.void, enforced by the API) may change the status of any branch sale; the
-- trigger keeps every other column immutable for non-creator app users and makes VOIDED/RETURNED terminal.
CREATE POLICY sales_branch_status_update ON sales FOR UPDATE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_sales_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('VOIDED', 'RETURNED') THEN
    RAISE EXCEPTION 'sale status % is terminal and cannot change', OLD.status;
  END IF;
  IF NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
     AND NULLIF(current_setting('app.user_id', true), '')::uuid IS DISTINCT FROM OLD.created_by_user_id THEN
    IF (NEW.tenant_id, NEW.branch_id, NEW.cash_shift_id, NEW.warehouse_id, NEW.total_amount_bob, NEW.paid_amount_bob,
        NEW.change_amount_bob, NEW.sale_number, NEW.created_by_user_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.branch_id, OLD.cash_shift_id, OLD.warehouse_id, OLD.total_amount_bob, OLD.paid_amount_bob,
        OLD.change_amount_bob, OLD.sale_number, OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION 'only the status fields of a sale may be changed by a supervisor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_sales_guard_update
BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION guard_sales_update();
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"return_number" varchar(40) NOT NULL,
	"refund_method" varchar(8) NOT NULL,
	"refund_reference" varchar(64),
	"refund_amount_bob" numeric(18, 4) NOT NULL,
	"reason" varchar(200) NOT NULL,
	"restock" boolean NOT NULL,
	"cash_shift_id" uuid,
	"cash_movement_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "sale_returns_tenant_branch_number_unique" UNIQUE("tenant_id","branch_id","return_number"),
	CONSTRAINT "sale_returns_method_check" CHECK ("refund_method" in ('CASH', 'CARD', 'QR')),
	CONSTRAINT "sale_returns_reference_check" CHECK (("refund_method" = 'CASH' and "refund_reference" is null) or ("refund_method" in ('CARD', 'QR') and "refund_reference" is not null and length(btrim("refund_reference")) > 0)),
	CONSTRAINT "sale_returns_cash_shift_check" CHECK (("refund_method" = 'CASH') = ("cash_shift_id" is not null)),
	CONSTRAINT "sale_returns_amount_positive_check" CHECK ("refund_amount_bob" > 0),
	CONSTRAINT "sale_returns_reason_check" CHECK (length(btrim("reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_return_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"quantity_base" bigint NOT NULL,
	"unit_price_bob" numeric(18, 4) NOT NULL,
	"line_total_bob" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_return_items_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "sale_return_items_quantity_positive_check" CHECK ("quantity" > 0 and "quantity_base" > 0),
	CONSTRAINT "sale_return_items_price_nonnegative_check" CHECK ("unit_price_bob" >= 0 and "line_total_bob" >= 0)
);
--> statement-breakpoint
-- Where restocked units went back (only populated when the return restocks).
CREATE TABLE "sale_return_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_return_item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity_base" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_return_allocations_quantity_positive_check" CHECK ("quantity_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_fk" FOREIGN KEY ("tenant_id","branch_id","sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_fk" FOREIGN KEY ("tenant_id","branch_id","cash_shift_id") REFERENCES "public"."cash_shifts"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_movement_fk" FOREIGN KEY ("tenant_id","branch_id","cash_movement_id") REFERENCES "public"."cash_movements"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_fk" FOREIGN KEY ("tenant_id","branch_id","sale_return_id") REFERENCES "public"."sale_returns"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_item_fk" FOREIGN KEY ("tenant_id","branch_id","sale_item_id") REFERENCES "public"."sale_items"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_allocations" ADD CONSTRAINT "sale_return_allocations_item_fk" FOREIGN KEY ("tenant_id","branch_id","sale_return_item_id") REFERENCES "public"."sale_return_items"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_allocations" ADD CONSTRAINT "sale_return_allocations_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" ("tenant_id","branch_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_item_idx" ON "sale_return_items" ("tenant_id","branch_id","sale_item_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_return_idx" ON "sale_return_items" ("tenant_id","branch_id","sale_return_id");--> statement-breakpoint
CREATE INDEX "sale_return_allocations_item_idx" ON "sale_return_allocations" ("tenant_id","branch_id","sale_return_item_id");
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE sale_returns, sale_return_items, sale_return_allocations TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_returns FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_items FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_return_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_returns_branch_select ON sale_returns FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_returns_branch_insert ON sale_returns FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY sale_return_items_branch_select ON sale_return_items FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_return_items_branch_insert ON sale_return_items FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_return_allocations_branch_select ON sale_return_allocations FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sale_return_allocations_branch_insert ON sale_return_allocations FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_sale_returns_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'sale returns are immutable and append-only, cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_sale_returns_immutable BEFORE UPDATE OR DELETE ON sale_returns
FOR EACH ROW EXECUTE FUNCTION prevent_sale_returns_mutation();--> statement-breakpoint
CREATE TRIGGER trg_sale_return_items_immutable BEFORE UPDATE OR DELETE ON sale_return_items
FOR EACH ROW EXECUTE FUNCTION prevent_sale_returns_mutation();--> statement-breakpoint
CREATE TRIGGER trg_sale_return_allocations_immutable BEFORE UPDATE OR DELETE ON sale_return_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_sale_returns_mutation();
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('sales.void', 'Void sales and register returns', 'Anular ventas y registrar devoluciones', 'Caja y ventas', 67)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'sales.void' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
