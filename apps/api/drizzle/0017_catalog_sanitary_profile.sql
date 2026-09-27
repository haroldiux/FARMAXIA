-- Módulo 2: ficha sanitaria del producto, controlados, cadena de frío, códigos SIN y
-- edición/desactivación de productos, categorías y presentaciones.
-- Las tablas ya tienen RLS por farmacia (0006); las columnas nuevas heredan esas políticas.
ALTER TABLE "products" ADD COLUMN "generic_name" varchar(240);
ALTER TABLE "products" ADD COLUMN "concentration" varchar(120);
ALTER TABLE "products" ADD COLUMN "pharmaceutical_form" varchar(80);
ALTER TABLE "products" ADD COLUMN "laboratory" varchar(160);
ALTER TABLE "products" ADD COLUMN "sanitary_registration" varchar(80);
-- Clasificación de venta (lista provisional: D32 pendiente de validar con regencia).
ALTER TABLE "products" ADD COLUMN "sale_classification" varchar(24) DEFAULT 'OTC' NOT NULL;
ALTER TABLE "products" ADD COLUMN "is_controlled" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN "requires_cold_chain" boolean DEFAULT false NOT NULL;
ALTER TABLE "products" ADD COLUMN "cold_chain_min_celsius" numeric(4,1);
ALTER TABLE "products" ADD COLUMN "cold_chain_max_celsius" numeric(4,1);
-- Códigos para facturar con SIAT (se guardan; la validación contra el SIN espera D03).
ALTER TABLE "products" ADD COLUMN "sin_activity_code" varchar(10);
ALTER TABLE "products" ADD COLUMN "sin_product_code" varchar(10);
ALTER TABLE "products" ADD COLUMN "sin_unit_code" varchar(10);
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_sale_classification_check"
  CHECK ("sale_classification" in ('OTC', 'PRESCRIPTION', 'RETAINED_PRESCRIPTION', 'CONTROLLED'));
-- Un producto de venta controlada siempre queda marcado como controlado.
ALTER TABLE "products" ADD CONSTRAINT "products_controlled_classification_check"
  CHECK ("sale_classification" <> 'CONTROLLED' OR "is_controlled");
ALTER TABLE "products" ADD CONSTRAINT "products_cold_chain_range_check"
  CHECK (
    ("requires_cold_chain" OR ("cold_chain_min_celsius" IS NULL AND "cold_chain_max_celsius" IS NULL))
    AND ("cold_chain_min_celsius" IS NULL OR "cold_chain_max_celsius" IS NULL OR "cold_chain_min_celsius" < "cold_chain_max_celsius")
  );
ALTER TABLE "products" ADD CONSTRAINT "products_sin_codes_digits_check"
  CHECK (
    ("sin_activity_code" IS NULL OR "sin_activity_code" ~ '^[0-9]{1,10}$')
    AND ("sin_product_code" IS NULL OR "sin_product_code" ~ '^[0-9]{1,10}$')
    AND ("sin_unit_code" IS NULL OR "sin_unit_code" ~ '^[0-9]{1,10}$')
  );
--> statement-breakpoint
CREATE INDEX "products_tenant_active_name_idx" ON "products" USING btree ("tenant_id", "is_active", "name");
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "product_presentations" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "product_presentations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Productos existentes en una categoría controlada pasan a controlados.
UPDATE products SET is_controlled = true
WHERE category_id IN (SELECT id FROM product_categories WHERE is_controlled);
