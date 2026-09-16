CREATE TABLE "plan_features" (
	"plan_id" uuid NOT NULL,
	"feature_code" varchar(120) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plan_features_pk" PRIMARY KEY("plan_id","feature_code")
);
--> statement-breakpoint
CREATE TABLE "plan_quotas" (
	"plan_id" uuid NOT NULL,
	"resource_code" varchar(80) NOT NULL,
	"limit_units" bigint,
	CONSTRAINT "plan_quotas_pk" PRIMARY KEY("plan_id","resource_code"),
	CONSTRAINT "plan_quotas_non_negative_check" CHECK ("plan_quotas"."limit_units" is null or "plan_quotas"."limit_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"allows_all_features" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_quota_overrides" (
	"subscription_id" uuid NOT NULL,
	"resource_code" varchar(80) NOT NULL,
	"limit_units" bigint,
	CONSTRAINT "subscription_quota_overrides_pk" PRIMARY KEY("subscription_id","resource_code"),
	CONSTRAINT "subscription_quota_overrides_non_negative_check" CHECK ("subscription_quota_overrides"."limit_units" is null or "subscription_quota_overrides"."limit_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_resource_usage" (
	"tenant_id" uuid NOT NULL,
	"resource_code" varchar(80) NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_resource_usage_pk" PRIMARY KEY("tenant_id","resource_code"),
	CONSTRAINT "tenant_resource_usage_non_negative_check" CHECK ("tenant_resource_usage"."used_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_subscriptions_status_check" CHECK ("tenant_subscriptions"."status" in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_quotas" ADD CONSTRAINT "plan_quotas_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quota_overrides" ADD CONSTRAINT "subscription_quota_overrides_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tenant_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_resource_usage" ADD CONSTRAINT "tenant_resource_usage_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_code_unique" ON "subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscriptions_one_current_per_tenant" ON "tenant_subscriptions" USING btree ("tenant_id") WHERE "tenant_subscriptions"."status" <> 'CANCELED';
--> statement-breakpoint
INSERT INTO subscription_plans (code, name, allows_all_features)
VALUES ('COMPLETO', 'Plan Completo', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO plan_quotas (plan_id, resource_code, limit_units)
SELECT id, resource_code, NULL
FROM subscription_plans
CROSS JOIN (VALUES ('branches'), ('users'), ('cash_registers'), ('storage_bytes')) AS resources(resource_code)
WHERE code = 'COMPLETO'
ON CONFLICT (plan_id, resource_code) DO NOTHING;
--> statement-breakpoint
GRANT SELECT ON TABLE subscription_plans, plan_features, plan_quotas, tenant_subscriptions, subscription_quota_overrides TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant_resource_usage TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_plans_app_read ON subscription_plans
  FOR SELECT TO farmaxia_app USING (true);
ALTER TABLE plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_features FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_features_app_read ON plan_features
  FOR SELECT TO farmaxia_app USING (true);
ALTER TABLE plan_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_quotas FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_quotas_app_read ON plan_quotas
  FOR SELECT TO farmaxia_app USING (true);
--> statement-breakpoint
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_subscriptions_app_read ON tenant_subscriptions
  FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE tenant_resource_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_resource_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_resource_usage_app_isolation ON tenant_resource_usage
  FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE subscription_quota_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_quota_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_quota_overrides_app_read ON subscription_quota_overrides
  FOR SELECT TO farmaxia_app
  USING (
    EXISTS (
      SELECT 1
      FROM tenant_subscriptions
      WHERE tenant_subscriptions.id = subscription_quota_overrides.subscription_id
        AND tenant_subscriptions.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );
