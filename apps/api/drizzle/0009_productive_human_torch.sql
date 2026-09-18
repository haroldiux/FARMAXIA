CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity_base" bigint NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_reservations_quantity_positive_check" CHECK ("inventory_reservations"."quantity_base" > 0),
	CONSTRAINT "inventory_reservations_status_check" CHECK ("inventory_reservations"."status" in ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reservations_tenant_warehouse_status_expiry_idx" ON "inventory_reservations" USING btree ("tenant_id","warehouse_id","status","expires_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory_reservations TO farmaxia_app;
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservations_scope ON inventory_reservations
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
      WHERE warehouse.tenant_id = inventory_reservations.tenant_id
        AND warehouse.id = inventory_reservations.warehouse_id
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
      WHERE warehouse.tenant_id = inventory_reservations.tenant_id
        AND warehouse.id = inventory_reservations.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
