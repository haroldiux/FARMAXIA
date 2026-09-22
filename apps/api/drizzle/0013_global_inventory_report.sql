GRANT SELECT ON TABLE branches, warehouses, inventory_balances, inventory_batches, product_presentations, products TO farmaxia_app;
--> statement-breakpoint
INSERT INTO permissions (code, description)
VALUES ('inventory.report.global', 'Read tenant-wide inventory reports')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
CREATE POLICY branches_global_inventory_report_select ON branches
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = branches.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
--> statement-breakpoint
CREATE POLICY warehouses_global_inventory_report_select ON warehouses
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = warehouses.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
--> statement-breakpoint
CREATE POLICY inventory_balances_global_inventory_report_select ON inventory_balances
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = inventory_balances.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
--> statement-breakpoint
CREATE POLICY inventory_batches_global_inventory_report_select ON inventory_batches
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = inventory_batches.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
--> statement-breakpoint
CREATE POLICY product_presentations_global_inventory_report_select ON product_presentations
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = product_presentations.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
--> statement-breakpoint
CREATE POLICY products_global_inventory_report_select ON products
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = products.tenant_id
        AND rp.permission_code = 'inventory.report.global'
    )
  );
