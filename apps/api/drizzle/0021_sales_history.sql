-- Module 5 (T2): human-readable per-branch sale number (V-<branch>-000001) and the
-- sales.read permission for the history and receipt endpoints.
ALTER TABLE "sales" ADD COLUMN "sale_number" varchar(40);
--> statement-breakpoint
-- Backfill existing sales in creation order, per branch, and move the sequence forward.
WITH numbered AS (
  SELECT s.tenant_id, s.id,
         'V-' || b.code || '-' || lpad((row_number() OVER (PARTITION BY s.tenant_id, s.branch_id ORDER BY s.created_at, s.id))::text, 6, '0') AS sale_number
  FROM sales s
  JOIN branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
)
UPDATE sales SET sale_number = numbered.sale_number
FROM numbered WHERE sales.tenant_id = numbered.tenant_id AND sales.id = numbered.id;
--> statement-breakpoint
INSERT INTO document_sequences (tenant_id, branch_id, document_type, current_number, updated_at)
SELECT tenant_id, branch_id, 'SALE', count(*), now() FROM sales GROUP BY tenant_id, branch_id
ON CONFLICT (tenant_id, branch_id, document_type) DO UPDATE SET current_number = excluded.current_number, updated_at = now();
--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "sale_number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_branch_number_unique" UNIQUE ("tenant_id", "branch_id", "sale_number");
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('sales.read', 'Read sales history, sale details and receipts', 'Consultar ventas', 'Caja y ventas', 65)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'sales.read' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado', 'cajero')
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- Reading: any member of the branch can query its sales (the API narrows non-supervisory users to
-- their own sales). Writing stays limited to the sale's creator, as before.
DROP POLICY sales_branch_isolation ON sales;
CREATE POLICY sales_branch_read ON sales FOR SELECT TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid);
CREATE POLICY sales_creator_insert ON sales FOR INSERT TO farmaxia_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY sales_creator_update ON sales FOR UPDATE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY sales_creator_delete ON sales FOR DELETE TO farmaxia_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
