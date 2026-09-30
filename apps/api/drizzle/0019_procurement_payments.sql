-- Módulo 4: cancelación de órdenes, pagos y programación de cuentas por pagar,
-- costo promedio ponderado por presentación y permiso para registrar pagos.
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" timestamp with time zone;
ALTER TABLE "purchase_orders" ADD COLUMN "closed_by_user_id" uuid;
ALTER TABLE "purchase_orders" ADD COLUMN "close_reason" varchar(255);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_fk"
  FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id");
-- CANCELED: se anuló sin recibir nada. CLOSED: se cerró el saldo pendiente de una recepción parcial.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" in ('DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED', 'CLOSED'));
--> statement-breakpoint
-- Cuentas por pagar: fecha programada de pago y estado coherente con el saldo.
ALTER TABLE "payables" ADD COLUMN "scheduled_on" date;
ALTER TABLE "payables" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
UPDATE "payables" SET "status" = CASE
  WHEN "outstanding_amount" = 0 THEN 'PAID'
  WHEN "outstanding_amount" < "original_amount" THEN 'PARTIAL'
  ELSE 'OPEN' END;
ALTER TABLE "payables" ADD CONSTRAINT "payables_status_check" CHECK ("status" in ('OPEN', 'PARTIAL', 'PAID'));
ALTER TABLE "payables" ADD CONSTRAINT "payables_outstanding_le_original_check" CHECK ("outstanding_amount" <= "original_amount");
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"method" varchar(16) NOT NULL,
	"reference" varchar(120),
	"notes" varchar(255),
	"idempotency_key" varchar(255) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payments_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "supplier_payments_amount_positive_check" CHECK ("amount" > 0),
	CONSTRAINT "supplier_payments_method_check" CHECK ("method" in ('CASH', 'TRANSFER', 'CHECK', 'QR', 'OTHER'))
);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payable_fk" FOREIGN KEY ("tenant_id","payable_id") REFERENCES "public"."payables"("tenant_id","id");
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id");
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");
CREATE INDEX "supplier_payments_payable_idx" ON "supplier_payments" USING btree ("tenant_id","payable_id","paid_on");
--> statement-breakpoint
-- Costo promedio ponderado por presentación (a nivel farmacia), en BOB por unidad base.
CREATE TABLE "presentation_costs" (
	"tenant_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"average_unit_cost" numeric(18, 6) NOT NULL,
	"last_unit_cost" numeric(18, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presentation_costs_pk" PRIMARY KEY("tenant_id","presentation_id"),
	CONSTRAINT "presentation_costs_non_negative_check" CHECK ("average_unit_cost" >= 0 and "last_unit_cost" >= 0)
);
ALTER TABLE "presentation_costs" ADD CONSTRAINT "presentation_costs_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id");
-- Punto de partida: el promedio del stock actual según el costo de cada lote.
INSERT INTO "presentation_costs" ("tenant_id", "presentation_id", "average_unit_cost", "last_unit_cost")
SELECT b.tenant_id, b.presentation_id,
       round(sum(ib.quantity_base * b.unit_cost) / nullif(sum(ib.quantity_base), 0), 6),
       (array_agg(b.unit_cost order by b.created_at desc))[1]
FROM inventory_batches b
JOIN inventory_balances ib ON ib.tenant_id = b.tenant_id AND ib.batch_id = b.id
WHERE ib.quantity_base > 0
GROUP BY b.tenant_id, b.presentation_id
HAVING sum(ib.quantity_base) > 0;
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('payables.manage', 'Register supplier payments and schedule payables', 'Registrar pagos a proveedores', 'Compras', 25)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
INSERT INTO role_permissions (role_id, permission_code)
SELECT id, 'payables.manage' FROM roles WHERE is_system AND code in ('owner', 'encargado')
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- Mismas reglas de acceso que las cuentas por pagar: miembros de la farmacia en su sucursal activa.
GRANT SELECT, INSERT ON TABLE supplier_payments TO farmaxia_app;
GRANT SELECT, INSERT, UPDATE ON TABLE presentation_costs TO farmaxia_app;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_payments_scope ON supplier_payments
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = supplier_payments.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = supplier_payments.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
ALTER TABLE presentation_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY presentation_costs_scope ON presentation_costs
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = presentation_costs.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM user_branch_memberships membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = presentation_costs.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
  );
