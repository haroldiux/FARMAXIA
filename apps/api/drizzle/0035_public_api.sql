-- F19 Module 12 (public API and integrations): API keys, webhook endpoints and webhook deliveries,
-- permission integrations.manage (owner only). Provisional defaults D77-D80 (pending teacher review).
--
-- integrations.manage (owner only): seeded to existing tenants here and to new signups via role-templates.ts.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('integrations.manage', 'Manage API keys, webhooks and integrations', 'Administrar integraciones y API', 'Administración', 85)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'integrations.manage' FROM roles WHERE is_system AND code = 'owner'
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- API keys belong to one branch and act as their creator in that branch (read-only public API).
-- Only the SHA-256 hex hash of the key is stored; the plaintext is returned once on creation.
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");
CREATE INDEX "api_keys_tenant_branch_idx" ON "api_keys" USING btree ("tenant_id","branch_id","created_at");
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id");
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id");
--> statement-breakpoint
-- Webhook endpoints are tenant-wide. The secret signs payloads (HMAC-SHA256), so it is kept to sign; shown once on creation.
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" varchar(500) NOT NULL,
	"description" varchar(200),
	"secret" varchar(128) NOT NULL,
	"event_types" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_tenant_id_unique" UNIQUE ("tenant_id","id")
);
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" USING btree ("tenant_id","is_active");
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
--> statement-breakpoint
-- One delivery per (endpoint, outbox event): the dispatcher can repeat its fan-out without duplicating.
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" varchar(500),
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" in ('PENDING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "webhook_deliveries_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_unique" ON "webhook_deliveries" USING btree ("endpoint_id","outbox_event_id");
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");
CREATE INDEX "webhook_deliveries_tenant_idx" ON "webhook_deliveries" USING btree ("tenant_id","created_at");
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_fk" FOREIGN KEY ("tenant_id","endpoint_id") REFERENCES "public"."webhook_endpoints"("tenant_id","id");
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_event_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id");
--> statement-breakpoint
-- farmaxia_app: API keys of the session branch (member of that branch); endpoints and deliveries of the tenant.
GRANT SELECT, INSERT, UPDATE ON TABLE api_keys TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE webhook_endpoints TO farmaxia_app;
GRANT SELECT ON TABLE webhook_deliveries TO farmaxia_app;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_branch_access ON api_keys FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = api_keys.tenant_id
        AND membership.branch_id = api_keys.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = api_keys.tenant_id
        AND membership.branch_id = api_keys.branch_id
    )
  );
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoints_tenant_access ON webhook_endpoints FOR ALL TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant_read ON webhook_deliveries FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- farmaxia_auth: resolve an API key only by its hash (the caller must know the key), and stamp last use.
GRANT SELECT ON TABLE api_keys TO farmaxia_auth;
GRANT UPDATE (last_used_at) ON TABLE api_keys TO farmaxia_auth;
CREATE POLICY api_keys_auth_lookup ON api_keys
  FOR SELECT TO farmaxia_auth
  USING (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''));
CREATE POLICY api_keys_auth_touch ON api_keys
  FOR UPDATE TO farmaxia_auth
  USING (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''))
  WITH CHECK (key_hash = NULLIF(current_setting('app.api_key_hash', true), ''));
--> statement-breakpoint
-- farmaxia_platform: cross-tenant webhook dispatcher. Reads outbox events and endpoints, writes deliveries only.
GRANT SELECT ON TABLE outbox_events TO farmaxia_platform;
GRANT SELECT ON TABLE webhook_endpoints TO farmaxia_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE webhook_deliveries TO farmaxia_platform;
CREATE POLICY outbox_events_platform_read ON outbox_events FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY webhook_endpoints_platform_read ON webhook_endpoints FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY webhook_deliveries_platform_all ON webhook_deliveries FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
