-- Module 5 (T7): quotes (proformas). No stock reservation and no cash impact. EXPIRED is derived at read time.
CREATE TABLE "sales_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quote_number" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"customer_name" varchar(120),
	"customer_note" varchar(500),
	"valid_until" timestamp with time zone NOT NULL,
	"total_amount_bob" numeric(18, 4) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_sale_id" uuid,
	"converted_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"canceled_by_user_id" uuid,
	CONSTRAINT "sales_quotes_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "sales_quotes_tenant_branch_number_unique" UNIQUE("tenant_id","branch_id","quote_number"),
	CONSTRAINT "sales_quotes_status_check" CHECK ("status" in ('OPEN', 'CONVERTED', 'CANCELED')),
	CONSTRAINT "sales_quotes_total_nonnegative_check" CHECK ("total_amount_bob" >= 0),
	CONSTRAINT "sales_quotes_customer_name_check" CHECK ("customer_name" is null or length(btrim("customer_name")) > 0),
	CONSTRAINT "sales_quotes_state_check" CHECK (
		("status" = 'OPEN' and "converted_sale_id" is null and "converted_at" is null and "canceled_at" is null and "canceled_by_user_id" is null)
		or ("status" = 'CONVERTED' and "converted_sale_id" is not null and "converted_at" is not null and "canceled_at" is null and "canceled_by_user_id" is null)
		or ("status" = 'CANCELED' and "converted_sale_id" is null and "converted_at" is null and "canceled_at" is not null and "canceled_by_user_id" is not null)
	)
);
--> statement-breakpoint
CREATE TABLE "sales_quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"presentation_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price_bob" numeric(18, 4) NOT NULL,
	"line_total_bob" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quote_items_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "sales_quote_items_position_unique" UNIQUE("tenant_id","branch_id","quote_id","position"),
	CONSTRAINT "sales_quote_items_quantity_positive_check" CHECK ("quantity" > 0),
	CONSTRAINT "sales_quote_items_price_nonnegative_check" CHECK ("unit_price_bob" >= 0 and "line_total_bob" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_created_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_canceled_membership_fk" FOREIGN KEY ("canceled_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_sale_fk" FOREIGN KEY ("tenant_id","branch_id","converted_sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_items" ADD CONSTRAINT "sales_quote_items_quote_fk" FOREIGN KEY ("tenant_id","branch_id","quote_id") REFERENCES "public"."sales_quotes"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_items" ADD CONSTRAINT "sales_quote_items_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_quotes_branch_created_idx" ON "sales_quotes" ("tenant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_quote_items_quote_idx" ON "sales_quote_items" ("tenant_id","branch_id","quote_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE sales_quotes TO farmaxia_app;
GRANT SELECT, INSERT ON TABLE sales_quote_items TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE sales_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_quote_items FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_quotes_branch_select ON sales_quotes FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sales_quotes_branch_insert ON sales_quotes FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY sales_quotes_branch_update ON sales_quotes FOR UPDATE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sales_quote_items_branch_select ON sales_quote_items FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sales_quote_items_branch_insert ON sales_quote_items FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
-- Quote lines are immutable; a quote only moves OPEN -> CONVERTED/CANCELED and keeps every other column.
CREATE OR REPLACE FUNCTION prevent_sales_quote_items_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'quote items are immutable and append-only, cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_sales_quote_items_immutable
BEFORE UPDATE OR DELETE ON sales_quote_items
FOR EACH ROW EXECUTE FUNCTION prevent_sales_quote_items_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_sales_quotes_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quotes cannot be deleted';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'quote status % is terminal and cannot change', OLD.status;
  END IF;
  IF (NEW.tenant_id, NEW.branch_id, NEW.quote_number, NEW.customer_name, NEW.customer_note, NEW.valid_until,
      NEW.total_amount_bob, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.quote_number, OLD.customer_name, OLD.customer_note, OLD.valid_until,
      OLD.total_amount_bob, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'only the status fields of a quote may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_sales_quotes_guard
BEFORE UPDATE OR DELETE ON sales_quotes
FOR EACH ROW EXECUTE FUNCTION guard_sales_quotes_update();
