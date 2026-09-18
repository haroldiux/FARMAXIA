CREATE TABLE "inventory_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"expected_quantity" bigint NOT NULL,
	"counted_quantity" bigint NOT NULL,
	"delta_quantity" bigint NOT NULL,
	"reason" varchar(255) NOT NULL,
	"status" varchar(24) DEFAULT 'POSTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reconciliations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_reconciliations_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "inventory_reconciliations_expected_non_negative_check" CHECK ("inventory_reconciliations"."expected_quantity" >= 0),
	CONSTRAINT "inventory_reconciliations_counted_non_negative_check" CHECK ("inventory_reconciliations"."counted_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "movement_direction" varchar(3) DEFAULT 'IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_tenant_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_direction_check" CHECK ("inventory_movements"."movement_direction" in ('IN', 'OUT'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory_reconciliations TO farmaxia_app;
ALTER TABLE inventory_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reconciliations_scope ON inventory_reconciliations
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_reconciliations.tenant_id
        AND warehouse.id = inventory_reconciliations.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = inventory_reconciliations.tenant_id
        AND warehouse.id = inventory_reconciliations.warehouse_id
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
