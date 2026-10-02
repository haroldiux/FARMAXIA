-- F14 (T1): branch-to-branch transfers (module 7). Stock leaves the origin's inventory_balances
-- at DISPATCH (not at request) and enters the destination's at RECEPTION, by the quantity actually
-- received, not dispatched (D55). Partial reception is allowed across multiple events (D54).
-- Approval gating (D53, Premium only via the already-existing `transfers.approval` feature) is
-- validated in TransfersService; the `approve`/`reject` endpoints themselves are T2.
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"origin_warehouse_id" uuid NOT NULL,
	"destination_warehouse_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"dispatched_by_user_id" uuid,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "transfers_status_check" CHECK ("status" in ('REQUESTED', 'APPROVED', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "transfers_origin_destination_distinct_check" CHECK ("origin_warehouse_id" <> "destination_warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"requested_qty" bigint NOT NULL,
	"dispatched_qty" bigint,
	"received_qty" bigint DEFAULT 0 NOT NULL,
	"difference_reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_items_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "transfer_items_requested_qty_positive_check" CHECK ("requested_qty" > 0),
	CONSTRAINT "transfer_items_dispatched_qty_non_negative_check" CHECK ("dispatched_qty" is null or "dispatched_qty" >= 0),
	CONSTRAINT "transfer_items_received_qty_non_negative_check" CHECK ("received_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_origin_warehouse_fk" FOREIGN KEY ("tenant_id","origin_warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_destination_warehouse_fk" FOREIGN KEY ("tenant_id","destination_warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatched_by_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_tenant_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "public"."transfers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."inventory_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfers_tenant_status_idx" ON "transfers" ("tenant_id","status");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE transfers, transfer_items TO farmaxia_app;
--> statement-breakpoint
-- A transfer request names a destination (or origin) warehouse that is usually NOT in the
-- requester's current branch, but `warehouses_branch_isolation` (0003) only allows SELECT within
-- the caller's own branch. Grant tenant-wide warehouse SELECT to `transfers.manage` holders, the
-- same escape-hatch shape as `warehouses_global_inventory_report_select` (0013) for
-- `inventory.report.global`. Read-only: it does not relax INSERT/UPDATE/DELETE on warehouses.
CREATE POLICY warehouses_transfers_select ON warehouses
  FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND ur.tenant_id = warehouses.tenant_id
        AND rp.permission_code = 'transfers.manage'
    )
  );
--> statement-breakpoint
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers FORCE ROW LEVEL SECURITY;
-- Visible/writable from EITHER the origin or the destination branch (D55/scope): a transfer
-- crosses branches, so it cannot be scoped to a single branch_id column like fiscal_invoices.
CREATE POLICY transfers_scope ON transfers
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = transfers.tenant_id
        AND warehouse.id IN (transfers.origin_warehouse_id, transfers.destination_warehouse_id)
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM warehouses warehouse
      JOIN user_branch_memberships membership
        ON membership.tenant_id = warehouse.tenant_id
       AND membership.branch_id = warehouse.branch_id
       AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE warehouse.tenant_id = transfers.tenant_id
        AND warehouse.id IN (transfers.origin_warehouse_id, transfers.destination_warehouse_id)
        AND warehouse.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_items FORCE ROW LEVEL SECURITY;
CREATE POLICY transfer_items_scope ON transfer_items
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM transfers transfer
      WHERE transfer.tenant_id = transfer_items.tenant_id
        AND transfer.id = transfer_items.transfer_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM transfers transfer
      WHERE transfer.tenant_id = transfer_items.tenant_id
        AND transfer.id = transfer_items.transfer_id)
  );
--> statement-breakpoint
-- transfers.manage / transfers.approve permissions, seeded to existing tenants here and to new
-- signups via role-templates.ts (same commit, avoiding the F13 gap). D56: owner gets both
-- automatically (tenantPermissions maps to the owner role in role-templates.ts); regente/encargado
-- get both; almacenero gets only transfers.manage; cajero gets neither.
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('transfers.manage', 'Request, dispatch and receive branch-to-branch transfers', 'Solicitar, despachar y recibir traspasos', 'Traspasos', 36),
  ('transfers.approve', 'Approve branch-to-branch transfer requests before dispatch', 'Aprobar traspasos antes del despacho', 'Traspasos', 37)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'transfers.manage' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado', 'almacenero')
ON CONFLICT (role_id, permission_code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'transfers.approve' FROM roles WHERE is_system AND code in ('owner', 'regente', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
