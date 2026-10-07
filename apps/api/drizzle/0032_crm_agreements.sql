-- F17 (Part B): CRM module 10, agreements (convenios). Rules D69-D71 (provisional, pending Harold).
-- Agreements and their members are tenant-wide; charges are written by the selling branch and read tenant-wide
-- so the billing user (any branch) can consolidate every branch into one monthly statement.
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"payer_name" varchar(160) NOT NULL,
	"payer_tax_id" varchar(30),
	"coverage_percent" numeric(5, 2) NOT NULL,
	"monthly_limit_bob" numeric(18, 4) NOT NULL,
	"notes" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "agreements_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "agreements_name_check" CHECK (length(btrim("name")) > 0 and length(btrim("payer_name")) > 0),
	CONSTRAINT "agreements_kind_check" CHECK ("kind" in ('INSURER', 'COMPANY', 'UNION')),
	CONSTRAINT "agreements_coverage_check" CHECK ("coverage_percent" > 0 and "coverage_percent" <= 100),
	CONSTRAINT "agreements_limit_check" CHECK ("monthly_limit_bob" > 0)
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "agreement_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"member_code" varchar(40) NOT NULL,
	"monthly_limit_bob" numeric(18, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_members_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "agreement_members_customer_unique" UNIQUE("tenant_id","agreement_id","customer_id"),
	CONSTRAINT "agreement_members_code_unique" UNIQUE("tenant_id","agreement_id","member_code"),
	CONSTRAINT "agreement_members_code_check" CHECK (length(btrim("member_code")) > 0),
	CONSTRAINT "agreement_members_limit_check" CHECK ("monthly_limit_bob" is null or "monthly_limit_bob" > 0)
);
--> statement-breakpoint
ALTER TABLE "agreement_members" ADD CONSTRAINT "agreement_members_agreement_fk" FOREIGN KEY ("tenant_id","agreement_id") REFERENCES "public"."agreements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_members" ADD CONSTRAINT "agreement_members_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_members_customer_idx" ON "agreement_members" ("tenant_id","customer_id");--> statement-breakpoint
-- One consolidated, non-fiscal statement per agreement and month (D71). issued_by_name / created_by_name are snapshots:
-- users are visible only inside their own branch, but a statement is read from any branch.
CREATE TABLE "agreement_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"statement_number" varchar(40) NOT NULL,
	"branch_id" uuid NOT NULL,
	"total_bob" numeric(18, 4) NOT NULL,
	"paid_bob" numeric(18, 4) DEFAULT 0 NOT NULL,
	"status" varchar(10) DEFAULT 'ISSUED' NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"issued_by_name" varchar(160) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_statements_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "agreement_statements_period_unique" UNIQUE("tenant_id","agreement_id","period"),
	CONSTRAINT "agreement_statements_number_unique" UNIQUE("tenant_id","statement_number"),
	CONSTRAINT "agreement_statements_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "agreement_statements_status_check" CHECK ("status" in ('ISSUED', 'PARTIAL', 'PAID')),
	CONSTRAINT "agreement_statements_total_check" CHECK ("total_bob" > 0 and "paid_bob" >= 0 and "paid_bob" <= "total_bob"),
	CONSTRAINT "agreement_statements_status_paid_check" CHECK (
		("status" = 'ISSUED' and "paid_bob" = 0)
		or ("status" = 'PARTIAL' and "paid_bob" > 0 and "paid_bob" < "total_bob")
		or ("status" = 'PAID' and "paid_bob" = "total_bob")
	)
);
--> statement-breakpoint
ALTER TABLE "agreement_statements" ADD CONSTRAINT "agreement_statements_agreement_fk" FOREIGN KEY ("tenant_id","agreement_id") REFERENCES "public"."agreements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_statements" ADD CONSTRAINT "agreement_statements_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_statements" ADD CONSTRAINT "agreement_statements_issuer_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "agreement_statement_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"amount_bob" numeric(18, 4) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(120),
	"paid_on" date NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_statement_payments_key_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "agreement_statement_payments_amount_check" CHECK ("amount_bob" > 0),
	CONSTRAINT "agreement_statement_payments_method_check" CHECK ("method" in ('TRANSFER', 'CHECK', 'CASH', 'QR', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "agreement_statement_payments" ADD CONSTRAINT "agreement_statement_payments_statement_fk" FOREIGN KEY ("tenant_id","statement_id") REFERENCES "public"."agreement_statements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_statement_payments" ADD CONSTRAINT "agreement_statement_payments_creator_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_statement_payments_statement_idx" ON "agreement_statement_payments" ("tenant_id","statement_id");--> statement-breakpoint
-- What the agreement covers of one sale (at most one per sale). sale_number and branch_code are snapshots: sales and
-- branches are branch-scoped by RLS, but the statement is read from any branch.
CREATE TABLE "agreement_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_number" varchar(40) NOT NULL,
	"branch_code" varchar(30) NOT NULL,
	"amount_bob" numeric(18, 4) NOT NULL,
	"reduced_amount_bob" numeric(18, 4) DEFAULT 0 NOT NULL,
	"status" varchar(10) DEFAULT 'OPEN' NOT NULL,
	"statement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_charges_sale_unique" UNIQUE("tenant_id","branch_id","sale_id"),
	CONSTRAINT "agreement_charges_status_check" CHECK ("status" in ('OPEN', 'BILLED', 'VOIDED')),
	CONSTRAINT "agreement_charges_amount_check" CHECK ("amount_bob" > 0 and "reduced_amount_bob" >= 0 and "reduced_amount_bob" <= "amount_bob"),
	CONSTRAINT "agreement_charges_statement_check" CHECK (("status" = 'BILLED') = ("statement_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_agreement_fk" FOREIGN KEY ("tenant_id","agreement_id") REFERENCES "public"."agreements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."agreement_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_sale_fk" FOREIGN KEY ("tenant_id","branch_id","sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_charges" ADD CONSTRAINT "agreement_charges_statement_fk" FOREIGN KEY ("tenant_id","statement_id") REFERENCES "public"."agreement_statements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_charges_member_idx" ON "agreement_charges" ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "agreement_charges_open_idx" ON "agreement_charges" ("tenant_id","agreement_id","created_at") WHERE "status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "agreement_charges_statement_idx" ON "agreement_charges" ("tenant_id","statement_id") WHERE "statement_id" is not null;--> statement-breakpoint
-- AGREEMENT payment method (non-cash, never has a reference).
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_method_check";--> statement-breakpoint
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_reference_check";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_method_check" CHECK ("method" in ('CASH', 'CARD', 'QR', 'POINTS', 'AGREEMENT'));--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_reference_check" CHECK (
  ("method" in ('CASH', 'POINTS', 'AGREEMENT') and "reference" is null)
  or ("method" in ('CARD', 'QR') and "reference" is not null and length(btrim("reference")) > 0)
);--> statement-breakpoint
-- Returns on sales paid partly by an agreement (D70): that share reduces the agreement charge instead of being refunded.
ALTER TABLE "sale_returns" ADD COLUMN "agreement_refund_bob" numeric(18, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_agreement_check" CHECK ("agreement_refund_bob" >= 0 and "points_refund_bob" + "agreement_refund_bob" <= "refund_amount_bob");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE agreements TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE agreement_members TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE agreement_statements TO farmaxia_app;
GRANT SELECT, INSERT ON TABLE agreement_statement_payments TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE agreement_charges TO farmaxia_app;
--> statement-breakpoint
-- Tenant-wide tables: any member of the pharmacy in their active branch (permissions are enforced by the API).
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY agreements_scope ON agreements
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreements.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreements.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE agreement_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_members FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_members_scope ON agreement_members
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_members.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_members.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE agreement_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_statements_scope ON agreement_statements
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_statements.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_statements.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE agreement_statement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_statement_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_statement_payments_select ON agreement_statement_payments FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_statement_payments.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
CREATE POLICY agreement_statement_payments_insert ON agreement_statement_payments FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_statement_payments.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
--> statement-breakpoint
-- Charges: INSERT only for the selling (active) branch; SELECT and UPDATE tenant-wide for members of the pharmacy, so
-- the billing user of any branch can read every branch's charges and mark them BILLED when issuing a statement.
-- Void and return of the selling branch also go through UPDATE. No DELETE is granted.
ALTER TABLE agreement_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_charges FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_charges_select ON agreement_charges FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_charges.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
CREATE POLICY agreement_charges_insert ON agreement_charges FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
CREATE POLICY agreement_charges_update ON agreement_charges FOR UPDATE TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = agreement_charges.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- agreements.manage (owner, encargado) and agreements.billing (owner), seeded to existing tenants here and to new signups via role-templates.ts.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('agreements.manage', 'Manage agreements, their members and credit limits', 'Administrar convenios', 'Clientes', 77),
  ('agreements.billing', 'Issue agreement monthly statements and register their payments', 'Facturar convenios', 'Clientes', 78)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'agreements.manage' FROM roles WHERE is_system AND code in ('owner', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'agreements.billing' FROM roles WHERE is_system AND code = 'owner'
ON CONFLICT (role_id, permission_code) DO NOTHING;
