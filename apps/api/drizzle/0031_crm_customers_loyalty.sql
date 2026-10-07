-- F17 (Part A): CRM module 10, customers and loyalty. Rules D66-D70 (provisional, pending Harold).
-- Customers are tenant-wide (one pharmacy, many branches); sales stay branch-scoped.
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"doc_type" varchar(10),
	"doc_number" varchar(30),
	"complement" varchar(3),
	"phone" varchar(30),
	"email" varchar(160),
	"notes" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_name_check" CHECK (length(btrim("full_name")) > 0),
	CONSTRAINT "customers_doc_type_check" CHECK ("doc_type" in ('CI', 'NIT', 'PASSPORT', 'OTHER')),
	CONSTRAINT "customers_doc_pair_check" CHECK (("doc_type" is null) = ("doc_number" is null)),
	CONSTRAINT "customers_complement_check" CHECK ("complement" is null or "doc_type" = 'CI')
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_document_unique" ON "customers" ("tenant_id","doc_type","doc_number") WHERE "doc_number" is not null;--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" ("tenant_id","full_name");--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" ("tenant_id","customer_id","created_at") WHERE "customer_id" is not null;--> statement-breakpoint
-- Loyalty configuration, one row per pharmacy (absent row = defaults, enabled).
CREATE TABLE "loyalty_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"bob_per_point" numeric(18, 4) DEFAULT 10 NOT NULL,
	"point_value_bob" numeric(18, 4) DEFAULT 0.10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_settings_bob_per_point_check" CHECK ("bob_per_point" > 0),
	CONSTRAINT "loyalty_settings_point_value_check" CHECK ("point_value_bob" > 0)
);
--> statement-breakpoint
ALTER TABLE "loyalty_settings" ADD CONSTRAINT "loyalty_settings_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Immutable points ledger: the balance of a customer is the sum of its points (tenant-wide).
CREATE TABLE "loyalty_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_id" uuid,
	"sale_return_id" uuid,
	"kind" varchar(10) NOT NULL,
	"points" integer NOT NULL,
	"reason" varchar(300) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_movements_kind_check" CHECK ("kind" in ('EARN', 'REDEEM', 'REVERSAL', 'ADJUST')),
	CONSTRAINT "loyalty_movements_points_check" CHECK ("points" <> 0 and (("kind" = 'EARN' and "points" > 0) or ("kind" = 'REDEEM' and "points" < 0) or "kind" in ('REVERSAL', 'ADJUST'))),
	CONSTRAINT "loyalty_movements_source_check" CHECK (("kind" = 'ADJUST' and "sale_id" is null and "sale_return_id" is null) or ("kind" <> 'ADJUST' and "sale_id" is not null)),
	CONSTRAINT "loyalty_movements_reason_check" CHECK (length(btrim("reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_sale_fk" FOREIGN KEY ("tenant_id","branch_id","sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_return_fk" FOREIGN KEY ("tenant_id","branch_id","sale_return_id") REFERENCES "public"."sale_returns"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_creator_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_movements_customer_idx" ON "loyalty_movements" ("tenant_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_movements_sale_idx" ON "loyalty_movements" ("tenant_id","branch_id","sale_id") WHERE "sale_id" is not null;--> statement-breakpoint
-- POINTS payment method (non-cash, never has a reference). AGREEMENT is added by 0032.
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_method_check";--> statement-breakpoint
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_reference_check";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_method_check" CHECK ("method" in ('CASH', 'CARD', 'QR', 'POINTS'));--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_reference_check" CHECK (
  ("method" in ('CASH', 'POINTS') and "reference" is null)
  or ("method" in ('CARD', 'QR') and "reference" is not null and length(btrim("reference")) > 0)
);--> statement-breakpoint
-- Returns on sales paid partly with points (D70): the points share of the refund goes back as points.
ALTER TABLE "sale_returns" ADD COLUMN "points_returned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "points_refund_bob" numeric(18, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_points_check" CHECK ("points_returned" >= 0 and "points_refund_bob" >= 0 and "points_refund_bob" <= "refund_amount_bob");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE customers TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE loyalty_settings TO farmaxia_app;
GRANT SELECT, INSERT ON TABLE loyalty_movements TO farmaxia_app;
--> statement-breakpoint
-- Customers and loyalty settings are tenant-wide: any member of the pharmacy in their active branch.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_scope ON customers
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = customers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = customers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY loyalty_settings_scope ON loyalty_settings
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = loyalty_settings.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = loyalty_settings.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
--> statement-breakpoint
-- The ledger is read tenant-wide (the balance spans branches) but only written for the active branch.
ALTER TABLE loyalty_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY loyalty_movements_select ON loyalty_movements FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = loyalty_movements.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
CREATE POLICY loyalty_movements_insert ON loyalty_movements FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
--> statement-breakpoint
-- customers.manage / loyalty.manage, seeded to existing tenants here and to new signups via role-templates.ts.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('customers.manage', 'Register and edit customers, read their history and points', 'Administrar clientes', 'Clientes', 75),
  ('loyalty.manage', 'Configure loyalty points and adjust balances manually', 'Administrar puntos de fidelidad', 'Clientes', 76)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'customers.manage' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado', 'cajero')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'loyalty.manage' FROM roles WHERE is_system AND code = 'owner'
ON CONFLICT (role_id, permission_code) DO NOTHING;
