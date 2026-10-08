-- F20 Branch administration: allow tenant-level operations for farmaxia_app on branches, warehouses, cash_registers, user_branch_memberships.

CREATE POLICY branches_tenant_admin_insert ON branches
  FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY branches_tenant_admin_update ON branches
  FOR UPDATE TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY warehouses_tenant_admin_insert ON warehouses
  FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY cash_registers_tenant_admin_insert ON cash_registers
  FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY user_branch_memberships_tenant_admin_insert ON user_branch_memberships
  FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
GRANT INSERT ON TABLE user_branch_memberships TO farmaxia_app;
--> statement-breakpoint
CREATE POLICY cash_shift_controls_tenant_admin_select ON cash_shift_controls
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY cash_shifts_tenant_admin_select ON cash_shifts
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
