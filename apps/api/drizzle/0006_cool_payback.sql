CREATE TABLE "presentation_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presentation_prices_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "presentation_prices_amount_non_negative_check" CHECK ("presentation_prices"."amount" >= 0),
	CONSTRAINT "presentation_prices_valid_range_check" CHECK ("presentation_prices"."valid_to" is null or "presentation_prices"."valid_to" > "presentation_prices"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" varchar(120) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "price_lists_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "price_lists_currency_format_check" CHECK ("price_lists"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"barcode" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_barcodes_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_barcodes_tenant_barcode_unique" UNIQUE("tenant_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "product_categories_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_homologations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"authority" varchar(80) NOT NULL,
	"external_code" varchar(120) NOT NULL,
	"external_description" varchar(255),
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_homologations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_homologations_tenant_authority_code_unique" UNIQUE("tenant_id","authority","external_code")
);
--> statement-breakpoint
CREATE TABLE "product_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"base_unit_factor" bigint NOT NULL,
	"is_sellable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_presentations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "product_presentations_tenant_product_name_unique" UNIQUE("tenant_id","product_id","name"),
	CONSTRAINT "product_presentations_factor_positive_check" CHECK ("product_presentations"."base_unit_factor" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"name" varchar(200) NOT NULL,
	"active_ingredient" varchar(240),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "presentation_prices" ADD CONSTRAINT "presentation_prices_tenant_price_list_fk" FOREIGN KEY ("tenant_id","price_list_id") REFERENCES "public"."price_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_prices" ADD CONSTRAINT "presentation_prices_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_tenant_presentation_fk" FOREIGN KEY ("tenant_id","presentation_id") REFERENCES "public"."product_presentations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_homologations" ADD CONSTRAINT "product_homologations_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  product_categories,
  products,
  product_presentations,
  product_barcodes,
  price_lists,
  presentation_prices,
  product_homologations
TO farmaxia_app;
--> statement-breakpoint
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY product_categories_scope ON product_categories
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_categories.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_categories.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_scope ON products
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = products.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = products.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE product_presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_presentations FORCE ROW LEVEL SECURITY;
CREATE POLICY product_presentations_scope ON product_presentations
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_presentations.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_presentations.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes FORCE ROW LEVEL SECURITY;
CREATE POLICY product_barcodes_scope ON product_barcodes
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_barcodes.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_barcodes.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY price_lists_scope ON price_lists
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (branch_id IS NULL OR branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = price_lists.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (branch_id IS NULL OR branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid)
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = price_lists.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE presentation_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY presentation_prices_scope ON presentation_prices
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = presentation_prices.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = presentation_prices.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
ALTER TABLE product_homologations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_homologations FORCE ROW LEVEL SECURITY;
CREATE POLICY product_homologations_scope ON product_homologations
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_homologations.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = product_homologations.tenant_id
        AND membership.branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    )
  );
