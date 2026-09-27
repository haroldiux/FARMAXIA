-- Core SaaS: planes comerciales, cobro manual, comprobantes, operadores de plataforma
-- y rol de base de datos para el alta de farmacias y la administración del SaaS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'farmaxia_platform') THEN
    CREATE ROLE farmaxia_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD 'local-development-only';
  ELSE
    ALTER ROLE farmaxia_platform NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "description" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "subscription_plans" ADD COLUMN "price_monthly_bob" numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE "subscription_plans" ADD COLUMN "audit_retention_days" integer;
ALTER TABLE "subscription_plans" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;
ALTER TABLE "subscription_plans" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_price_non_negative_check" CHECK ("price_monthly_bob" >= 0);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_retention_positive_check" CHECK ("audit_retention_days" is null or "audit_retention_days" > 0);
--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD COLUMN "current_period_end" timestamp with time zone;
ALTER TABLE "tenant_subscriptions" ADD COLUMN "suspended_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "saas_features" (
	"code" varchar(120) PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"module" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_feature_overrides" (
	"subscription_id" uuid NOT NULL,
	"feature_code" varchar(120) NOT NULL,
	"is_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_feature_overrides_pk" PRIMARY KEY("subscription_id","feature_code")
);
--> statement-breakpoint
CREATE SEQUENCE "saas_invoice_number_seq" AS bigint START WITH 1;
--> statement-breakpoint
CREATE TABLE "saas_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"plan_code" varchar(80) NOT NULL,
	"plan_name" varchar(160) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount_bob" numeric(12,2) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	CONSTRAINT "saas_invoices_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "saas_invoices_status_check" CHECK ("status" in ('OPEN', 'PAID', 'VOID')),
	CONSTRAINT "saas_invoices_amount_positive_check" CHECK ("amount_bob" > 0),
	CONSTRAINT "saas_invoices_period_check" CHECK ("period_end" > "period_start")
);
--> statement-breakpoint
CREATE TABLE "saas_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" varchar(16) NOT NULL,
	"reference" varchar(120) NOT NULL,
	"amount_bob" numeric(12,2) NOT NULL,
	"paid_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attachment_media_type" varchar(80),
	"attachment_data" bytea,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_operator_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(500),
	CONSTRAINT "saas_payments_method_check" CHECK ("method" in ('QR', 'TRANSFER', 'GATEWAY', 'CASH')),
	CONSTRAINT "saas_payments_status_check" CHECK ("status" in ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "saas_payments_amount_positive_check" CHECK ("amount_bob" > 0),
	CONSTRAINT "saas_payments_attachment_pair_check" CHECK (("attachment_data" is null) = ("attachment_media_type" is null)),
	CONSTRAINT "saas_payments_attachment_size_check" CHECK ("attachment_data" is null or octet_length("attachment_data") <= 2097152)
);
--> statement-breakpoint
CREATE TABLE "platform_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid,
	"tenant_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_feature_overrides" ADD CONSTRAINT "subscription_feature_overrides_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tenant_subscriptions"("id") ON DELETE cascade;
ALTER TABLE "subscription_feature_overrides" ADD CONSTRAINT "subscription_feature_overrides_feature_fk" FOREIGN KEY ("feature_code") REFERENCES "public"."saas_features"("code");
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_feature_fk" FOREIGN KEY ("feature_code") REFERENCES "public"."saas_features"("code") NOT VALID;
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_tenant_subscription_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."tenant_subscriptions"("tenant_id","id");
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."saas_invoices"("tenant_id","id");
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_submitted_by_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id");
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_reviewed_by_fk" FOREIGN KEY ("reviewed_by_operator_id") REFERENCES "public"."platform_operators"("id");
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."platform_operators"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "saas_invoices_number_unique" ON "saas_invoices" USING btree ("number");
-- Un único comprobante vigente por periodo: el ciclo de cobro puede repetirse sin duplicar.
CREATE UNIQUE INDEX "saas_invoices_subscription_period_unique" ON "saas_invoices" USING btree ("subscription_id","period_start") WHERE "status" <> 'VOID';
CREATE INDEX "saas_invoices_tenant_issued_idx" ON "saas_invoices" USING btree ("tenant_id","issued_at");
-- Un solo pago en revisión por comprobante.
CREATE UNIQUE INDEX "saas_payments_one_pending_per_invoice" ON "saas_payments" USING btree ("invoice_id") WHERE "status" = 'PENDING';
CREATE INDEX "saas_payments_status_submitted_idx" ON "saas_payments" USING btree ("status","submitted_at");
CREATE UNIQUE INDEX "platform_operators_email_unique" ON "platform_operators" USING btree ("email");
CREATE INDEX "platform_audit_events_occurred_idx" ON "platform_audit_events" USING btree ("occurred_at");
CREATE INDEX "audit_events_tenant_occurred_at_idx" ON "audit_events" USING btree ("tenant_id","occurred_at");
--> statement-breakpoint
CREATE TRIGGER trg_platform_audit_events_immutable
BEFORE UPDATE OR DELETE ON platform_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
--> statement-breakpoint
-- Catálogo de funcionalidades contratables (una por capacidad de la matriz de planes).
INSERT INTO saas_features (code, name, module, sort_order) VALUES
  ('catalog', 'Catálogo y fraccionamiento', 'Operación', 10),
  ('inventory', 'Inventario por lotes y FEFO', 'Operación', 20),
  ('procurement', 'Compras y proveedores', 'Operación', 30),
  ('pos', 'Punto de venta y caja', 'Operación', 40),
  ('reports.basic', 'Reportes básicos', 'Operación', 50),
  ('audit', 'Bitácora de auditoría', 'Operación', 60),
  ('siat', 'Facturación SIAT', 'Facturación', 70),
  ('siat.contingency', 'SIAT en modo contingencia', 'Facturación', 80),
  ('transfers', 'Traspasos entre sucursales', 'Multi-sucursal', 90),
  ('transfers.approval', 'Traspasos con flujo de aprobación', 'Multi-sucursal', 100),
  ('controlled.manual', 'Recetas controladas: registro manual', 'Regencia', 110),
  ('controlled.assisted', 'Recetas controladas: validación asistida', 'Regencia', 120),
  ('controlled.book', 'Libro digital AGEMED', 'Regencia', 130),
  ('staff.shifts', 'Turnos y guardias', 'Personal', 140),
  ('staff.commissions', 'Comisiones de venta', 'Personal', 150),
  ('staff.commissions.multilevel', 'Comisiones multinivel', 'Personal', 160),
  ('crm.customers', 'Registro de clientes', 'Clientes', 170),
  ('crm.loyalty', 'Puntos y convenios básicos', 'Clientes', 180),
  ('crm.agreements', 'Convenios con copago y factura global', 'Clientes', 190),
  ('analytics.profitability', 'Reportes de rentabilidad y stock', 'Analítica', 200),
  ('analytics.abc', 'Analítica ABC y predictiva', 'Analítica', 210),
  ('public_api', 'API pública e integraciones', 'Integraciones', 220)
ON CONFLICT (code) DO UPDATE SET name = excluded.name, module = excluded.module, sort_order = excluded.sort_order;
--> statement-breakpoint
-- Planes de la matriz comercial. Precios iniciales editables desde el panel de plataforma.
INSERT INTO subscription_plans (code, name, description, allows_all_features, price_monthly_bob, audit_retention_days, is_public, sort_order) VALUES
  ('BASICO', 'Básico', 'Una sucursal, una caja y la operación esencial.', false, 150.00, 7, true, 10),
  ('PROFESIONAL', 'Profesional', 'Hasta 3 sucursales, SIAT incluido, traspasos y personal.', false, 350.00, 30, true, 20),
  ('PREMIUM', 'Premium', 'Sucursales ilimitadas, analítica avanzada e integraciones.', false, 700.00, NULL, true, 30)
ON CONFLICT (code) DO NOTHING;
UPDATE subscription_plans
SET description = 'Plan interno con todas las funcionalidades y sin cobro.', is_public = false, sort_order = 100
WHERE code = 'COMPLETO';
--> statement-breakpoint
INSERT INTO plan_quotas (plan_id, resource_code, limit_units)
SELECT plan.id, quota.resource_code, quota.limit_units
FROM subscription_plans AS plan
JOIN (VALUES
  ('BASICO', 'branches', 1::bigint), ('BASICO', 'cash_registers', 1), ('BASICO', 'users', 2), ('BASICO', 'storage_bytes', NULL),
  ('PROFESIONAL', 'branches', 3), ('PROFESIONAL', 'cash_registers', 4), ('PROFESIONAL', 'users', 8), ('PROFESIONAL', 'storage_bytes', NULL),
  ('PREMIUM', 'branches', NULL), ('PREMIUM', 'cash_registers', NULL), ('PREMIUM', 'users', NULL), ('PREMIUM', 'storage_bytes', NULL)
) AS quota(plan_code, resource_code, limit_units) ON quota.plan_code = plan.code
ON CONFLICT (plan_id, resource_code) DO UPDATE SET limit_units = excluded.limit_units;
--> statement-breakpoint
INSERT INTO plan_features (plan_id, feature_code, is_enabled)
SELECT plan.id, feature.feature_code, true
FROM subscription_plans AS plan
JOIN (VALUES
  ('BASICO', 'catalog'), ('BASICO', 'inventory'), ('BASICO', 'procurement'), ('BASICO', 'pos'), ('BASICO', 'reports.basic'),
  ('BASICO', 'audit'), ('BASICO', 'controlled.manual'), ('BASICO', 'crm.customers'),
  ('PROFESIONAL', 'catalog'), ('PROFESIONAL', 'inventory'), ('PROFESIONAL', 'procurement'), ('PROFESIONAL', 'pos'),
  ('PROFESIONAL', 'reports.basic'), ('PROFESIONAL', 'audit'), ('PROFESIONAL', 'siat'), ('PROFESIONAL', 'transfers'),
  ('PROFESIONAL', 'controlled.manual'), ('PROFESIONAL', 'controlled.assisted'), ('PROFESIONAL', 'staff.shifts'),
  ('PROFESIONAL', 'staff.commissions'), ('PROFESIONAL', 'crm.customers'), ('PROFESIONAL', 'crm.loyalty'),
  ('PROFESIONAL', 'analytics.profitability'),
  ('PREMIUM', 'catalog'), ('PREMIUM', 'inventory'), ('PREMIUM', 'procurement'), ('PREMIUM', 'pos'), ('PREMIUM', 'reports.basic'),
  ('PREMIUM', 'audit'), ('PREMIUM', 'siat'), ('PREMIUM', 'siat.contingency'), ('PREMIUM', 'transfers'),
  ('PREMIUM', 'transfers.approval'), ('PREMIUM', 'controlled.manual'), ('PREMIUM', 'controlled.assisted'),
  ('PREMIUM', 'controlled.book'), ('PREMIUM', 'staff.shifts'), ('PREMIUM', 'staff.commissions'),
  ('PREMIUM', 'staff.commissions.multilevel'), ('PREMIUM', 'crm.customers'), ('PREMIUM', 'crm.loyalty'),
  ('PREMIUM', 'crm.agreements'), ('PREMIUM', 'analytics.profitability'), ('PREMIUM', 'analytics.abc'),
  ('PREMIUM', 'public_api')
) AS feature(plan_code, feature_code) ON feature.plan_code = plan.code
ON CONFLICT (plan_id, feature_code) DO UPDATE SET is_enabled = true;
--> statement-breakpoint
-- Permisos de tenant. Los permisos operativos existían solo en el seed de desarrollo;
-- se registran aquí para que una farmacia recién dada de alta pueda recibirlos.
INSERT INTO permissions (code, description) VALUES
  ('catalog.manage', 'Manage catalog and prices'),
  ('inventory.manage', 'Manage inventory operations'),
  ('cash.manage', 'Manage cash registers and shifts'),
  ('audit.read', 'Read the tenant audit log within the plan retention'),
  ('billing.manage', 'View the subscription, invoices and submit payments')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- farmaxia_app: la farmacia ve su propia suscripción, sus comprobantes y registra pagos.
GRANT SELECT ON TABLE saas_features, subscription_feature_overrides, saas_invoices TO farmaxia_app;
GRANT SELECT, INSERT ON TABLE saas_payments TO farmaxia_app;
ALTER TABLE saas_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_features FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_features_app_read ON saas_features FOR SELECT TO farmaxia_app USING (true);
ALTER TABLE subscription_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_feature_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_feature_overrides_app_read ON subscription_feature_overrides
  FOR SELECT TO farmaxia_app
  USING (
    EXISTS (
      SELECT 1 FROM tenant_subscriptions
      WHERE tenant_subscriptions.id = subscription_feature_overrides.subscription_id
        AND tenant_subscriptions.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );
ALTER TABLE saas_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_invoices_app_read ON saas_invoices
  FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE saas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_payments_app_read ON saas_payments
  FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- La farmacia solo puede declarar pagos pendientes a su nombre; la aprobación es de la plataforma.
CREATE POLICY saas_payments_app_submit ON saas_payments
  FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND submitted_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND status = 'PENDING'
    AND reviewed_by_operator_id IS NULL
    AND reviewed_at IS NULL
  );
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operators FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- farmaxia_platform: alta de farmacias y administración del SaaS. Solo lo usan las rutas
-- públicas de alta y las rutas /api/v1/platform protegidas por token de operador.
GRANT USAGE ON SCHEMA public TO farmaxia_platform;
GRANT USAGE, SELECT ON SEQUENCE saas_invoice_number_seq TO farmaxia_platform;
GRANT SELECT, INSERT ON TABLE tenants, legal_entities, branches, warehouses, cash_registers,
  user_branch_memberships, roles, user_roles, role_permissions TO farmaxia_platform;
GRANT SELECT, INSERT ON TABLE users, permissions TO farmaxia_platform;
GRANT SELECT, UPDATE ON TABLE subscription_plans TO farmaxia_platform;
GRANT SELECT ON TABLE plan_quotas, plan_features, saas_features TO farmaxia_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant_subscriptions, tenant_resource_usage, saas_invoices, saas_payments TO farmaxia_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subscription_feature_overrides TO farmaxia_platform;
GRANT SELECT ON TABLE platform_operators TO farmaxia_platform;
GRANT SELECT, INSERT ON TABLE platform_audit_events, audit_events TO farmaxia_platform;
--> statement-breakpoint
CREATE POLICY tenants_platform_all ON tenants FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY legal_entities_platform_all ON legal_entities FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY branches_platform_all ON branches FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY warehouses_platform_all ON warehouses FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY cash_registers_platform_all ON cash_registers FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY user_branch_memberships_platform_all ON user_branch_memberships FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY roles_platform_all ON roles FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY user_roles_platform_all ON user_roles FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY users_platform_all ON users FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY subscription_plans_platform_all ON subscription_plans FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY plan_quotas_platform_read ON plan_quotas FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY plan_features_platform_read ON plan_features FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY saas_features_platform_read ON saas_features FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY tenant_subscriptions_platform_all ON tenant_subscriptions FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_resource_usage_platform_all ON tenant_resource_usage FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY subscription_feature_overrides_platform_all ON subscription_feature_overrides FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY saas_invoices_platform_all ON saas_invoices FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY saas_payments_platform_all ON saas_payments FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_operators_platform_read ON platform_operators FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY platform_audit_events_platform_all ON platform_audit_events FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
CREATE POLICY audit_events_platform_all ON audit_events FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
