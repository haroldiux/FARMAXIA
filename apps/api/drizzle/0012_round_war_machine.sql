CREATE TABLE "cash_shift_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"opening_amount_bob" numeric(18, 4) NOT NULL,
	"expected_amount_bob" numeric(18, 4) NOT NULL,
	"counted_amount_bob" numeric(18, 4),
	"difference_amount_bob" numeric(18, 4),
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"opened_by_user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_by_user_id" uuid,
	"counted_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"approval_note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_shift_controls_tenant_branch_id_unique" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "cash_shift_controls_tenant_branch_shift_unique" UNIQUE("tenant_id","branch_id","cash_shift_id"),
	CONSTRAINT "cash_shift_controls_status_check" CHECK ("cash_shift_controls"."status" in ('OPEN', 'PENDING_APPROVAL', 'CLOSED')),
	CONSTRAINT "cash_shift_controls_opening_nonnegative_check" CHECK ("cash_shift_controls"."opening_amount_bob" >= 0 and "cash_shift_controls"."expected_amount_bob" >= 0),
	CONSTRAINT "cash_shift_controls_counted_nonnegative_check" CHECK ("cash_shift_controls"."counted_amount_bob" is null or "cash_shift_controls"."counted_amount_bob" >= 0),
	CONSTRAINT "cash_shift_controls_difference_check" CHECK ("cash_shift_controls"."difference_amount_bob" is null or ("cash_shift_controls"."counted_amount_bob" is not null and "cash_shift_controls"."difference_amount_bob" = "cash_shift_controls"."counted_amount_bob" - "cash_shift_controls"."expected_amount_bob"))
);
--> statement-breakpoint
ALTER TABLE "cash_shift_controls" ADD CONSTRAINT "cash_shift_controls_shift_fk" FOREIGN KEY ("tenant_id","branch_id","cash_shift_id") REFERENCES "public"."cash_shifts"("tenant_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_controls" ADD CONSTRAINT "cash_shift_controls_opened_membership_fk" FOREIGN KEY ("opened_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_controls" ADD CONSTRAINT "cash_shift_controls_counted_membership_fk" FOREIGN KEY ("counted_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_controls" ADD CONSTRAINT "cash_shift_controls_approved_membership_fk" FOREIGN KEY ("approved_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_controls" ADD CONSTRAINT "cash_shift_controls_closed_membership_fk" FOREIGN KEY ("closed_by_user_id","tenant_id","branch_id") REFERENCES "public"."user_branch_memberships"("user_id","tenant_id","branch_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cash_shift_controls TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE cash_shift_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shift_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_shift_controls_branch_isolation ON cash_shift_controls
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shift_controls.tenant_id
        AND membership.branch_id = cash_shift_controls.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = cash_shift_controls.tenant_id
        AND membership.branch_id = cash_shift_controls.branch_id
    )
  );
--> statement-breakpoint
INSERT INTO permissions (code, description)
VALUES ('cash.shift.approve', 'Approve non-zero cash shift differences')
ON CONFLICT (code) DO NOTHING;
