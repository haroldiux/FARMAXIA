-- F13 (T1): technical scaffold for module 6 fiscal invoicing (SIAT). D03 (SIN modality, contract,
-- digital certificate) is external and still pending with the teacher: this migration adds ONLY the
-- data model for a FiscalProvider port + StubFiscalProvider, never a real SIN connection. See D50-D52
-- in REGISTRO_DECISIONES.md.
CREATE TABLE "fiscal_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING_PROVIDER' NOT NULL,
	"cuf" varchar(100),
	"cufd" varchar(100),
	"xml" text,
	"qr_data" text,
	"provider_name" varchar(60),
	"error_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_invoices_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "fiscal_invoices_tenant_branch_sale_unique" UNIQUE("tenant_id","branch_id","sale_id"),
	CONSTRAINT "fiscal_invoices_status_check" CHECK ("status" in ('PENDING_PROVIDER', 'ISSUED', 'CONTINGENCY', 'VOIDED', 'ERROR'))
);
--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_sale_fk" FOREIGN KEY ("tenant_id","branch_id","sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiscal_invoices_branch_status_idx" ON "fiscal_invoices" ("tenant_id","branch_id","status");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE fiscal_invoices TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE fiscal_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_invoices_branch_select ON fiscal_invoices FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY fiscal_invoices_branch_insert ON fiscal_invoices FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY fiscal_invoices_branch_update ON fiscal_invoices FOR UPDATE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
-- fiscal.read permission, seeded to the same role templates that already carry sales.read
-- (new tenants get it from role-templates.ts at signup; see the final report for that gap).
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('fiscal.read', 'Read the fiscal invoice status of a sale', 'Consultar comprobante fiscal', 'Caja y ventas', 66)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'fiscal.read' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado', 'cajero')
ON CONFLICT (role_id, permission_code) DO NOTHING;
