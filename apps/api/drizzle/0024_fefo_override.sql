-- Module 5 (T6): authorized FEFO lot override, plus the sales.fefo.override permission.
ALTER TABLE "sale_items" ADD COLUMN "fefo_override" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "fefo_override_reason" varchar(200);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_fefo_override_check" CHECK (("fefo_override" and "fefo_override_reason" is not null and length(btrim("fefo_override_reason")) > 0) or (not "fefo_override" and "fefo_override_reason" is null));
--> statement-breakpoint
ALTER TABLE "sale_allocations" ADD COLUMN "fefo_override" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('sales.fefo.override', 'Choose a lot different from FEFO when selling', 'Elegir lote distinto al FEFO', 'Caja y ventas', 68)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'sales.fefo.override' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
