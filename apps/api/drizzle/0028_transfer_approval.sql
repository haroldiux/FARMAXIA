-- F14 (T2): branch-to-branch transfers, approval flow (Premium plan only, D53). Adds the
-- approve/reject bookkeeping columns on `transfers` that T1 deliberately left out (T1/T2 split).
-- The `transfers.status` CHECK already includes APPROVED/REJECTED since 0027_transfers.sql; no
-- change to that constraint is needed here.
ALTER TABLE "transfers" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "approved_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "rejection_reason" varchar(255);
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_approved_by_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
