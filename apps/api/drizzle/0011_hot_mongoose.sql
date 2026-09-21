CREATE TABLE "cash_shift_users" (
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_shift_users_pk" PRIMARY KEY("tenant_id","branch_id","cash_shift_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'SCHEDULED' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_shifts_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "cash_shifts_schedule_check" CHECK ("cash_shifts"."scheduled_end_at" > "cash_shifts"."scheduled_start_at"),
	CONSTRAINT "cash_shifts_status_check" CHECK ("cash_shifts"."status" in ('SCHEDULED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id");--> statement-breakpoint
ALTER TABLE "cash_shift_users" ADD CONSTRAINT "cash_shift_users_shift_fk" FOREIGN KEY ("tenant_id","branch_id","cash_shift_id") REFERENCES "public"."cash_shifts"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_users" ADD CONSTRAINT "cash_shift_users_membership_fk" FOREIGN KEY ("user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenant_branch_register_fk" FOREIGN KEY ("tenant_id","branch_id","cash_register_id") REFERENCES "public"."cash_registers"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_creator_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_shifts_register_schedule_idx" ON "cash_shifts" USING btree ("tenant_id","branch_id","cash_register_id","scheduled_start_at","scheduled_end_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cash_shifts, cash_shift_users TO farmaxia_app;
GRANT SELECT (id, display_name, is_active) ON TABLE users TO farmaxia_app;
--> statement-breakpoint
DROP POLICY user_branch_memberships_scope_read ON user_branch_memberships;
CREATE POLICY user_branch_memberships_branch_read ON user_branch_memberships
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY users_app_branch_directory_read ON users
  FOR SELECT TO farmaxia_app
  USING (
    EXISTS (
      SELECT 1
      FROM user_branch_memberships AS target_membership
      WHERE target_membership.user_id = users.id
        AND target_membership.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND target_membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
--> statement-breakpoint
ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_shifts_branch_isolation ON cash_shifts
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shifts.tenant_id
        AND membership.branch_id = cash_shifts.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shifts.tenant_id
        AND membership.branch_id = cash_shifts.branch_id
    )
  );
--> statement-breakpoint
ALTER TABLE cash_shift_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shift_users FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_shift_users_branch_isolation ON cash_shift_users
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shift_users.tenant_id
        AND membership.branch_id = cash_shift_users.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shift_users.tenant_id
        AND membership.branch_id = cash_shift_users.branch_id
    )
  );
