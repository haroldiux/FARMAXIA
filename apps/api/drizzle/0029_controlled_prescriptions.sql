-- F15 (T1): controlled medicines (module 8). One immutable prescription row per sale that
-- dispenses a controlled product (D57). Branch-scoped RLS; the app role can only SELECT/INSERT,
-- so a recorded prescription can never be edited or deleted (legal archive, D58).
CREATE TABLE "controlled_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"folio" varchar(40) NOT NULL,
	"doctor_name" varchar(160) NOT NULL,
	"doctor_license" varchar(40) NOT NULL,
	"patient_name" varchar(160) NOT NULL,
	"patient_document" varchar(40) NOT NULL,
	"issuing_center" varchar(160) NOT NULL,
	"prescribed_at" date NOT NULL,
	"notes" varchar(500),
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "controlled_prescriptions_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "controlled_prescriptions_tenant_branch_sale_unique" UNIQUE("tenant_id","branch_id","sale_id"),
	CONSTRAINT "controlled_prescriptions_tenant_branch_folio_unique" UNIQUE("tenant_id","branch_id","folio")
);
--> statement-breakpoint
ALTER TABLE "controlled_prescriptions" ADD CONSTRAINT "controlled_prescriptions_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_prescriptions" ADD CONSTRAINT "controlled_prescriptions_sale_fk" FOREIGN KEY ("tenant_id","branch_id","sale_id") REFERENCES "public"."sales"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_prescriptions" ADD CONSTRAINT "controlled_prescriptions_creator_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "controlled_prescriptions_branch_created_idx" ON "controlled_prescriptions" ("tenant_id","branch_id","created_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE controlled_prescriptions TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE controlled_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_prescriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY controlled_prescriptions_branch_select ON controlled_prescriptions FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY controlled_prescriptions_branch_insert ON controlled_prescriptions FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
-- controlled.read / controlled.book.export permissions, seeded to existing tenants here and to new
-- signups via role-templates.ts (same commit). Owner gets both, regente both, encargado read only.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('controlled.read', 'Read the controlled-medicine prescription archive, balances and book', 'Consultar medicamentos controlados', 'Controlados', 38),
  ('controlled.book.export', 'Export the controlled-medicine book', 'Exportar libro de controlados', 'Controlados', 39)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'controlled.read' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'controlled.book.export' FROM roles WHERE is_system AND code in ('owner', 'regente')
ON CONFLICT (role_id, permission_code) DO NOTHING;
