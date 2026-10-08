-- F16 (T1): staff module (module 9). Branch roster of work shifts (distinct from cash shifts),
-- tenant-wide commission rules and tiers. Rules: D61-D65 (provisional, pending Harold).
CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"notes" varchar(300),
	"status" varchar(12) DEFAULT 'SCHEDULED' NOT NULL,
	"cancel_reason" varchar(200),
	"canceled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shifts_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "staff_shifts_kind_check" CHECK ("kind" in ('REGULAR', 'NIGHT_DUTY')),
	CONSTRAINT "staff_shifts_status_check" CHECK ("status" in ('SCHEDULED', 'CANCELED')),
	CONSTRAINT "staff_shifts_window_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "staff_shifts_cancel_check" CHECK (("status" = 'CANCELED') = ("cancel_reason" is not null)),
	CONSTRAINT "staff_shifts_attendance_check" CHECK ("checked_out_at" is null or ("checked_in_at" is not null and "checked_out_at" >= "checked_in_at"))
);
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_user_membership_fk" FOREIGN KEY ("user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_creator_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_shifts_branch_start_idx" ON "staff_shifts" ("tenant_id","branch_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_shifts_user_start_idx" ON "staff_shifts" ("tenant_id","branch_id","user_id","starts_at");--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" varchar(12) NOT NULL,
	"target_id" uuid,
	"rate_percent" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_scope_check" CHECK ("scope" in ('DEFAULT', 'CATEGORY', 'PRODUCT')),
	CONSTRAINT "commission_rules_target_check" CHECK (("scope" = 'DEFAULT') = ("target_id" is null)),
	CONSTRAINT "commission_rules_rate_check" CHECK ("rate_percent" >= 0 and "rate_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_target_unique" ON "commission_rules" ("tenant_id","scope","target_id") WHERE "target_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_default_unique" ON "commission_rules" ("tenant_id") WHERE "scope" = 'DEFAULT';--> statement-breakpoint
CREATE TABLE "commission_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"min_net_sales_bob" numeric(18, 2) NOT NULL,
	"rate_percent" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_tiers_tenant_min_unique" UNIQUE("tenant_id","min_net_sales_bob"),
	CONSTRAINT "commission_tiers_min_check" CHECK ("min_net_sales_bob" >= 0),
	CONSTRAINT "commission_tiers_rate_check" CHECK ("rate_percent" >= 0 and "rate_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE staff_shifts TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE commission_rules TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE commission_tiers TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_shifts_branch_select ON staff_shifts FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY staff_shifts_branch_insert ON staff_shifts FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY staff_shifts_branch_update ON staff_shifts FOR UPDATE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
--> statement-breakpoint
-- Commission rules and tiers are tenant-wide: any member of the pharmacy in their active branch.
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY commission_rules_scope ON commission_rules
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = commission_rules.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = commission_rules.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE commission_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_tiers FORCE ROW LEVEL SECURITY;
CREATE POLICY commission_tiers_scope ON commission_tiers
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = commission_tiers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = commission_tiers.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
--> statement-breakpoint
-- staff.* permissions, seeded to existing tenants here and to new signups via role-templates.ts.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('staff.shifts.manage', 'Manage the branch work-shift roster', 'Administrar turnos del personal', 'Personal', 72),
  ('staff.commissions.manage', 'Manage sales commission rules and tiers', 'Administrar comisiones de ventas', 'Personal', 73),
  ('staff.reports.read', 'Read staff commission and productivity reports', 'Ver reportes de personal', 'Personal', 74)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'staff.shifts.manage' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'staff.reports.read' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'staff.commissions.manage' FROM roles WHERE is_system AND code = 'owner'
ON CONFLICT (role_id, permission_code) DO NOTHING;
