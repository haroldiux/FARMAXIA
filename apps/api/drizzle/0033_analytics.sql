-- F18 Module 11 (analytics): cost snapshot on sale lines, analytics.read permission, shortage alerts.
-- Cost of the presentation per BASE unit (presentation_costs.average_unit_cost is already per base unit) at confirm time.
-- Null for historical sales and for presentations without a recorded cost.
ALTER TABLE "sale_items" ADD COLUMN "unit_cost_base_bob" numeric(18, 6);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_cost_nonnegative_check" CHECK ("unit_cost_base_bob" IS NULL OR "unit_cost_base_bob" >= 0);
--> statement-breakpoint
-- analytics.read (owner, regente, encargado): seeded to existing tenants here and to new signups via role-templates.ts.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('analytics.read', 'Read analytics reports: ABC, rotation, profitability, stockouts and dashboard', 'Ver analítica del negocio', 'Analítica', 79)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'analytics.read' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- Shortage alerts (one open alert per branch, presentation and kind: the scan can repeat without duplicating).
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"days_of_stock" numeric(10, 1),
	"available_base" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "stock_alerts_kind_check" CHECK ("kind" in ('OUT_OF_STOCK', 'LOW_COVERAGE'))
);
CREATE UNIQUE INDEX "stock_alerts_one_open" ON "stock_alerts" USING btree ("tenant_id","branch_id","presentation_id","kind") WHERE "resolved_at" IS NULL;
CREATE INDEX "stock_alerts_branch_open_idx" ON "stock_alerts" USING btree ("tenant_id","branch_id","resolved_at","created_at");
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id");
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE stock_alerts TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE stock_alerts TO farmaxia_platform;
ALTER TABLE stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_alerts_branch_access ON stock_alerts FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
CREATE POLICY stock_alerts_platform_all ON stock_alerts FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Cross-branch analytics reads run once per branch the user belongs to. Holders of analytics.read may list
-- THEIR OWN memberships in every branch of the pharmacy (other users' memberships stay hidden).
CREATE POLICY user_branch_memberships_analytics_own_read ON user_branch_memberships
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = user_branch_memberships.user_id
        AND ur.tenant_id = user_branch_memberships.tenant_id
        AND rp.permission_code = 'analytics.read'
    )
  );
