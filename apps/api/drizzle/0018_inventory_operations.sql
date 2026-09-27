-- Módulo 3: tipos de almacén, inventario físico con conteo ciego y aprobación,
-- actas de baja numeradas y alertas automáticas de vencimiento.
ALTER TABLE "warehouses" ADD COLUMN "warehouse_type" varchar(16) DEFAULT 'GENERAL' NOT NULL;
ALTER TABLE "warehouses" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "warehouses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_type_check"
  CHECK ("warehouse_type" in ('GENERAL', 'CENTRAL', 'QUARANTINE', 'COLD'));
-- De un almacén de cuarentena nunca se despacha.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_quarantine_no_dispatch_check"
  CHECK ("warehouse_type" <> 'QUARANTINE' OR NOT "is_dispatch_enabled");
--> statement-breakpoint
-- Actas de baja: número correlativo por sucursal y responsable de la merma.
ALTER TABLE "inventory_operation_events" ADD COLUMN "act_number" varchar(32);
ALTER TABLE "inventory_operation_events" ADD COLUMN "created_by_user_id" uuid;
ALTER TABLE "inventory_operation_events" ADD COLUMN "disposal_method" varchar(24);
ALTER TABLE "inventory_operation_events" ADD CONSTRAINT "inventory_operation_events_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
ALTER TABLE "inventory_operation_events" ADD CONSTRAINT "inventory_operation_events_disposal_check"
  CHECK ("disposal_method" is null or "disposal_method" in ('DESTRUCTION', 'SUPPLIER_RETURN', 'OTHER'));
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"notes" varchar(500),
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "inventory_counts_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "inventory_counts_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "inventory_counts_status_check" CHECK ("status" in ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"counted_quantity" bigint,
	"expected_quantity" bigint,
	"counted_by_user_id" uuid,
	"counted_at" timestamp with time zone,
	CONSTRAINT "inventory_count_lines_count_batch_unique" UNIQUE("count_id","batch_id"),
	CONSTRAINT "inventory_count_lines_counted_check" CHECK ("counted_quantity" is null or "counted_quantity" >= 0)
);
--> statement-breakpoint
-- Un único conteo abierto o enviado por almacén.
CREATE UNIQUE INDEX "inventory_counts_one_active_per_warehouse" ON "inventory_counts" USING btree ("tenant_id","warehouse_id") WHERE "status" in ('OPEN', 'SUBMITTED');
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id");
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id");
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_fk" FOREIGN KEY ("tenant_id","branch_id","count_id") REFERENCES "public"."inventory_counts"("tenant_id","branch_id","id") ON DELETE cascade;
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id");
ALTER TABLE "inventory_reconciliations" ADD COLUMN "count_id" uuid;
--> statement-breakpoint
CREATE TABLE "inventory_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"alert_type" varchar(16) NOT NULL,
	"expires_on" date NOT NULL,
	"quantity_base" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "inventory_alerts_type_check" CHECK ("alert_type" in ('EXPIRING', 'EXPIRED'))
);
--> statement-breakpoint
-- Una alerta vigente por lote, almacén y tipo: el escaneo puede repetirse sin duplicar.
CREATE UNIQUE INDEX "inventory_alerts_one_open" ON "inventory_alerts" USING btree ("tenant_id","warehouse_id","batch_id","alert_type") WHERE "resolved_at" IS NULL;
CREATE INDEX "inventory_alerts_branch_open_idx" ON "inventory_alerts" USING btree ("tenant_id","branch_id","resolved_at","created_at");
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id");
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id");
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('inventory.count.approve', 'Approve physical inventory counts', 'Aprobar conteos de inventario', 'Inventario', 35)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'inventory.count.approve' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- farmaxia_app: conteos y alertas de su sucursal.
GRANT SELECT, INSERT, UPDATE ON TABLE inventory_counts, inventory_count_lines TO farmaxia_app;
GRANT SELECT, UPDATE ON TABLE inventory_alerts TO farmaxia_app;
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_counts_branch_isolation ON inventory_counts FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_count_lines_branch_isolation ON inventory_count_lines FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_alerts_branch_access ON inventory_alerts FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
--> statement-breakpoint
-- farmaxia_platform: el escaneo programado de vencimientos recorre todas las farmacias.
GRANT SELECT ON TABLE inventory_batches, inventory_balances TO farmaxia_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE inventory_alerts TO farmaxia_platform;
CREATE POLICY inventory_batches_platform_read ON inventory_batches FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY inventory_balances_platform_read ON inventory_balances FOR SELECT TO farmaxia_platform USING (true);
CREATE POLICY inventory_alerts_platform_all ON inventory_alerts FOR ALL TO farmaxia_platform USING (true) WITH CHECK (true);
