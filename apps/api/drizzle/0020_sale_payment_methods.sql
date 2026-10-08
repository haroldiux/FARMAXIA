-- Module 5 (T1): CASH, CARD and QR payments per sale (mixed allowed), manual reference
-- for CARD/QR (no gateway) and the change given back on the sale.
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_method_check";
--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "reference" varchar(64);
--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_method_check" CHECK ("method" in ('CASH', 'CARD', 'QR'));
--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_reference_check" CHECK (
  ("method" = 'CASH' and "reference" is null)
  or ("method" in ('CARD', 'QR') and "reference" is not null and length(btrim("reference")) > 0)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "change_amount_bob" numeric(18,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_change_nonnegative_check" CHECK ("change_amount_bob" >= 0);
