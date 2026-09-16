CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" varchar(80) NOT NULL,
	"status" varchar(24) NOT NULL,
	"payload" jsonb NOT NULL,
	"result_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"storage_key" varchar(700) NOT NULL,
	"media_type" varchar(160) NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_files_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_files_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "tenant_files_storage_key_scope_check" CHECK ("tenant_files"."storage_key" like ('tenants/' || "tenant_files"."tenant_id"::text || '/branches/' || "tenant_files"."branch_id"::text || '/files/%'))
);
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_tenant_branch_file_fk" FOREIGN KEY ("tenant_id","branch_id","result_file_id") REFERENCES "public"."tenant_files"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_files" ADD CONSTRAINT "tenant_files_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_jobs_tenant_branch_status_created_at_idx" ON "background_jobs" USING btree ("tenant_id","branch_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_files_storage_key_unique" ON "tenant_files" USING btree ("storage_key");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant_files, background_jobs TO farmaxia_app;
--> statement-breakpoint
DROP POLICY branches_tenant_isolation ON branches;
CREATE POLICY branches_branch_isolation ON branches
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = branches.tenant_id
        AND membership.branch_id = branches.id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = branches.tenant_id
        AND membership.branch_id = branches.id
    )
  );
--> statement-breakpoint
DROP POLICY warehouses_tenant_isolation ON warehouses;
CREATE POLICY warehouses_branch_isolation ON warehouses
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = warehouses.tenant_id
        AND membership.branch_id = warehouses.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = warehouses.tenant_id
        AND membership.branch_id = warehouses.branch_id
    )
  );
--> statement-breakpoint
DROP POLICY cash_registers_tenant_isolation ON cash_registers;
CREATE POLICY cash_registers_branch_isolation ON cash_registers
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_registers.tenant_id
        AND membership.branch_id = cash_registers.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_registers.tenant_id
        AND membership.branch_id = cash_registers.branch_id
    )
  );
--> statement-breakpoint
DROP POLICY user_branch_memberships_tenant_isolation ON user_branch_memberships;
REVOKE INSERT, UPDATE, DELETE ON TABLE user_branch_memberships FROM farmaxia_app;
CREATE POLICY user_branch_memberships_scope_read ON user_branch_memberships
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE tenant_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_files_branch_isolation ON tenant_files
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = tenant_files.tenant_id
        AND membership.branch_id = tenant_files.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = tenant_files.tenant_id
        AND membership.branch_id = tenant_files.branch_id
    )
  );
--> statement-breakpoint
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY background_jobs_branch_isolation ON background_jobs
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = background_jobs.tenant_id
        AND membership.branch_id = background_jobs.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = background_jobs.tenant_id
        AND membership.branch_id = background_jobs.branch_id
    )
  );
