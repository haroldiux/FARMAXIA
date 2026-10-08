-- Module 5 (T4): manual petty-cash movements (IN/OUT) inside an OPEN cash shift. Append-only.
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"type" varchar(8) NOT NULL,
	"amount_bob" numeric(18, 4) NOT NULL,
	"reason" varchar(200) NOT NULL,
	"category" varchar(24),
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "cash_movements_type_check" CHECK ("cash_movements"."type" in ('IN', 'OUT')),
	CONSTRAINT "cash_movements_amount_positive_check" CHECK ("cash_movements"."amount_bob" > 0),
	CONSTRAINT "cash_movements_reason_check" CHECK (length(btrim("cash_movements"."reason")) > 0),
	CONSTRAINT "cash_movements_category_check" CHECK ("cash_movements"."category" is null or "cash_movements"."category" in ('CHANGE_FUND', 'EXPENSE', 'DEPOSIT', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_fk" FOREIGN KEY ("tenant_id","branch_id","cash_shift_id") REFERENCES "public"."cash_shifts"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_membership_fk" FOREIGN KEY ("created_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_shift_idx" ON "cash_movements" ("tenant_id","branch_id","cash_shift_id","created_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE cash_movements TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_movements_branch_select ON cash_movements FOR SELECT TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );
CREATE POLICY cash_movements_branch_insert ON cash_movements FOR INSERT TO farmaxia_app
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND created_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_cash_movements_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'cash movements are immutable and append-only, cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_cash_movements_immutable
BEFORE UPDATE OR DELETE ON cash_movements
FOR EACH ROW EXECUTE FUNCTION prevent_cash_movements_mutation();
