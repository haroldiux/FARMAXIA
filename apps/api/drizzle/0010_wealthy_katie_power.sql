CREATE TABLE "inventory_operation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"operation_type" varchar(32) NOT NULL,
	"reason_code" varchar(32),
	"reason" varchar(255) NOT NULL,
	"quantity_base" bigint,
	"temperature_celsius" numeric(8, 2),
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_operation_events_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_operation_events_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "inventory_operation_events_type_check" CHECK ("inventory_operation_events"."operation_type" in ('QUARANTINE', 'RELEASE_QUARANTINE', 'WASTE')),
	CONSTRAINT "inventory_operation_events_reason_code_check" CHECK ("inventory_operation_events"."reason_code" is null or "inventory_operation_events"."reason_code" in ('QUALITY', 'COLD_CHAIN', 'DAMAGE', 'OTHER')),
	CONSTRAINT "inventory_operation_events_quantity_check" CHECK ("inventory_operation_events"."quantity_base" is null or "inventory_operation_events"."quantity_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_operation_events" ADD CONSTRAINT "inventory_operation_events_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operation_events" ADD CONSTRAINT "inventory_operation_events_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_operation_events_tenant_warehouse_created_idx" ON "inventory_operation_events" USING btree ("tenant_id","warehouse_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_status_check" CHECK ("inventory_batches"."status" in ('AVAILABLE', 'QUARANTINED', 'DISPOSED'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory_operation_events TO farmaxia_app;
ALTER TABLE inventory_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_operation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_operation_events_scope ON inventory_operation_events
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_operation_events.tenant_id
        AND warehouse.id = inventory_operation_events.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_operation_events.tenant_id
        AND warehouse.id = inventory_operation_events.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
