import fastifyCookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
const role = (name: string) => withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const id = (n: number) => `00000000-0000-4000-8000-${String(994000 + n).padStart(12, "0")}`;
const tenantId = id(1);
const legalEntityId = id(2);
const branchA = id(11);
const branchB = id(12);
const ownerUser = id(21);
const warehouseA = id(31); // dispatch-enabled
const warehouseAQuarantine = id(32); // not dispatch-enabled
const warehouseB = id(33);
const productIbu = id(41); // active
const productOff = id(42); // inactive product
const productZinc = id(43); // active, no price, no stock
const ibuBox = id(51); // Caja x 10, factor 10
const ibuUnit = id(52); // Unidad, factor 1
const ibuInactive = id(53); // inactive presentation
const ibuNotSellable = id(54); // not sellable
const offUnit = id(55);
const zincUnit = id(56);
const generalList = id(61);
const listA = id(62);
const listB = id(63);
const otherTenantId = id(101);
const otherLegalEntityId = id(102);
const otherBranchId = id(111);
const otherUser = id(121);
const otherProduct = id(141);
const otherPresentation = id(151);

const keyA = `fxk_${"a".repeat(43)}`;
const keyB = `fxk_${"b".repeat(43)}`;
const keyOther = `fxk_${"c".repeat(43)}`;

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function setPlan(planCode: string, tenant: string): Promise<void> {
  await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenant]);
  const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
  await ownerPool.query("insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())", [tenant, plan.rows[0]!.id]);
}

let lot = 0;
async function insertStock(warehouse: string, presentationId: string, quantity: number, reserved: number, tenant = tenantId, expiresInDays = 300): Promise<void> {
  lot += 1;
  const batch = await ownerPool.query<{ id: string }>(
    `insert into inventory_batches (tenant_id, presentation_id, lot_code, expires_on, unit_cost, status)
     values ($1, $2, $3, current_date + $4::int, 1.0000, 'AVAILABLE') returning id`,
    [tenant, presentationId, `L-${lot}`, expiresInDays]
  );
  await ownerPool.query("insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, $4, $5)", [
    tenant,
    warehouse,
    batch.rows[0]!.id,
    quantity,
    reserved
  ]);
}

async function seed(): Promise<void> {
  await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'public-api', 'Farmacia Publica'), ($2, 'public-api-other', 'Otra Farmacia')", [tenantId, otherTenantId]);
  await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Publica SRL', '9940001'), ($3, $4, 'Otra SRL', '9940002')", [
    legalEntityId,
    tenantId,
    otherLegalEntityId,
    otherTenantId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')", [
    branchA,
    branchB,
    tenantId,
    legalEntityId
  ]);
  await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTRA', 'Otra')", [otherBranchId, otherTenantId, otherLegalEntityId]);
  await ownerPool.query("insert into users (id, email, display_name, password_hash) values ($1, 'pub-owner@example.test', 'Duena', 'x'), ($2, 'pub-other@example.test', 'Otra', 'x')", [
    ownerUser,
    otherUser
  ]);
  await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3), ($1, $2, $4), ($5, $6, $7)", [
    ownerUser,
    tenantId,
    branchA,
    branchB,
    otherUser,
    otherTenantId,
    otherBranchId
  ]);
  await ownerPool.query(
    `insert into warehouses (id, tenant_id, branch_id, name, warehouse_type, is_dispatch_enabled) values
       ($1, $4, $5, 'Central', 'CENTRAL', true), ($2, $4, $5, 'Cuarentena', 'QUARANTINE', false), ($3, $4, $6, 'Sur', 'CENTRAL', true)`,
    [warehouseA, warehouseAQuarantine, warehouseB, tenantId, branchA, branchB]
  );
  await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Otra', 'CENTRAL')", [id(134), otherTenantId, otherBranchId]);
  await ownerPool.query(
    `insert into products (id, tenant_id, name, generic_name, active_ingredient, laboratory, is_active) values
       ($1, $4, 'Ibuprofeno 400', 'Ibuprofeno', 'Ibuprofeno', 'Bago', true),
       ($2, $4, 'Descontinuado', null, null, null, false),
       ($3, $4, 'Zinc', null, 'Zinc', 'Vita', true)`,
    [productIbu, productOff, productZinc, tenantId]
  );
  await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Producto ajeno')", [otherProduct, otherTenantId]);
  await ownerPool.query(
    `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor, is_active, is_sellable) values
       ($1, $7, $8, 'Caja x 10', 10, true, true), ($2, $7, $8, 'Unidad', 1, true, true),
       ($3, $7, $8, 'Antigua', 1, false, true), ($4, $7, $8, 'Muestra', 1, true, false),
       ($5, $7, $9, 'Unidad', 1, true, true), ($6, $7, $10, 'Frasco', 1, true, true)`,
    [ibuBox, ibuUnit, ibuInactive, ibuNotSellable, offUnit, zincUnit, tenantId, productIbu, productOff, productZinc]
  );
  await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Unidad', 1)", [
    otherPresentation,
    otherTenantId,
    otherProduct
  ]);
  await ownerPool.query("insert into product_barcodes (tenant_id, presentation_id, barcode) values ($1, $2, '7770001112223')", [tenantId, ibuBox]);
  await ownerPool.query(
    `insert into price_lists (id, tenant_id, branch_id, name, currency) values
       ($1, $4, null, 'General', 'BOB'), ($2, $4, $5, 'Central', 'BOB'), ($3, $4, $6, 'Sur', 'BOB')`,
    [generalList, listA, listB, tenantId, branchA, branchB]
  );
  await ownerPool.query(
    `insert into presentation_prices (tenant_id, price_list_id, presentation_id, amount, valid_from) values
       ($1, $2, $5, 50.0000, now() - interval '1 day'), ($1, $2, $6, 6.0000, now() - interval '1 day'),
       ($1, $3, $5, 45.0000, now() - interval '1 day'), ($1, $4, $5, 40.0000, now() - interval '1 day')`,
    [tenantId, generalList, listA, listB, ibuBox, ibuUnit]
  );
  // Branch A: ibuBox 100 - 10 reserved = 90 base (9 boxes); an expired lot and the quarantine warehouse do not count.
  await insertStock(warehouseA, ibuBox, 100, 10);
  await insertStock(warehouseA, ibuBox, 50, 0, tenantId, -1);
  await insertStock(warehouseAQuarantine, ibuBox, 30, 0);
  await insertStock(warehouseA, ibuUnit, 7, 0);
  // Branch B stock is never part of a branch A answer.
  await insertStock(warehouseB, ibuBox, 999, 0);
  await insertStock(id(134), otherPresentation, 5, 0, otherTenantId);

  await ownerPool.query(
    `insert into api_keys (tenant_id, branch_id, created_by_user_id, name, key_prefix, key_hash) values
       ($1, $2, $3, 'A', $4, $5), ($1, $6, $3, 'B', $7, $8)`,
    [tenantId, branchA, ownerUser, keyA.slice(0, 12), sha256(keyA), branchB, keyB.slice(0, 12), sha256(keyB)]
  );
  await ownerPool.query("insert into api_keys (tenant_id, branch_id, created_by_user_id, name, key_prefix, key_hash) values ($1, $2, $3, 'Otra', $4, $5)", [
    otherTenantId,
    otherBranchId,
    otherUser,
    keyOther.slice(0, 12),
    sha256(keyOther)
  ]);
}

let app: NestFastifyApplication | undefined;
async function get(url: string, key = keyA): Promise<{ status: number; body: Record<string, any> }> {
  if (!app) {
    const { AppModule } = await import("../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }
  const response = await app.inject({ method: "GET", url, headers: { "x-api-key": key } });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : {} };
}

describe("F19 public read-only API (T2)", () => {
  beforeAll(async () => {
    await migrate(drizzle(ownerPool), { migrationsFolder });
  });
  afterAll(async () => {
    await app?.close();
    await ownerPool.end();
  });
  beforeEach(async () => {
    lot = 0;
    await ownerPool.query("truncate table tenants, users cascade");
    await seed();
    await setPlan("PREMIUM", tenantId);
    await setPlan("PREMIUM", otherTenantId);
  });

  describe("products", () => {
    it("lists active products with sellable presentations, branch price and branch stock", async () => {
      const response = await get("/api/public/v1/products");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 2, limit: 20, offset: 0 });
      expect(response.body.items.map((item: { productId: string }) => item.productId)).toEqual([productIbu, productZinc]);
      const ibu = response.body.items[0];
      expect(ibu).toMatchObject({ name: "Ibuprofeno 400", genericName: "Ibuprofeno", activeIngredient: "Ibuprofeno", laboratory: "Bago", saleClassification: "OTC" });
      expect(ibu.presentations).toEqual([
        { presentationId: ibuBox, name: "Caja x 10", baseUnitFactor: 10, barcodes: ["7770001112223"], priceBob: "45.0000", availableBase: 90, availableQuantity: 9 },
        { presentationId: ibuUnit, name: "Unidad", baseUnitFactor: 1, barcodes: [], priceBob: "6.0000", availableBase: 7, availableQuantity: 7 }
      ]);
      expect(response.body.items[1].presentations).toEqual([
        { presentationId: zincUnit, name: "Frasco", baseUnitFactor: 1, barcodes: [], priceBob: null, availableBase: 0, availableQuantity: 0 }
      ]);
    });

    it("uses the price and stock of the key's branch", async () => {
      const response = await get("/api/public/v1/products", keyB);
      const box = response.body.items[0].presentations.find((presentation: { presentationId: string }) => presentation.presentationId === ibuBox);
      expect(box).toMatchObject({ priceBob: "40.0000", availableBase: 999, availableQuantity: 99 });
    });

    it("searches by name, ingredient, laboratory or exact barcode and paginates", async () => {
      expect((await get("/api/public/v1/products?search=vita")).body.items.map((item: { productId: string }) => item.productId)).toEqual([productZinc]);
      expect((await get("/api/public/v1/products?search=7770001112223")).body.items.map((item: { productId: string }) => item.productId)).toEqual([productIbu]);
      expect((await get("/api/public/v1/products?search=descontinuado")).body.items).toEqual([]);
      const page = await get("/api/public/v1/products?limit=1&offset=1");
      expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
      expect(page.body.items.map((item: { productId: string }) => item.productId)).toEqual([productZinc]);
      for (const query of ["limit=0", "limit=101", "limit=abc", "offset=-1", `search=${"x".repeat(81)}`]) {
        const invalid = await get(`/api/public/v1/products?${query}`);
        expect(invalid.status).toBe(400);
      }
    });

    it("returns one product detail and 404 for inactive or foreign products", async () => {
      const detail = await get(`/api/public/v1/products/${productIbu}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ productId: productIbu, name: "Ibuprofeno 400" });
      expect(detail.body.presentations.map((presentation: { presentationId: string }) => presentation.presentationId)).toEqual([ibuBox, ibuUnit]);
      expect((await get(`/api/public/v1/products/${productOff}`)).status).toBe(404);
      expect((await get(`/api/public/v1/products/${otherProduct}`)).status).toBe(404);
      expect((await get("/api/public/v1/products/not-a-uuid")).status).toBe(400);
    });

    it("never shows another pharmacy's catalog", async () => {
      const response = await get("/api/public/v1/products", keyOther);
      expect(response.body.items.map((item: { productId: string }) => item.productId)).toEqual([otherProduct]);
      expect(response.body.items[0].presentations[0]).toMatchObject({ presentationId: otherPresentation, availableBase: 5 });
    });
  });

  describe("stock", () => {
    it("lists available quantity per sellable presentation in the key's branch", async () => {
      const response = await get("/api/public/v1/stock");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 3, limit: 50, offset: 0 });
      expect(response.body.items).toEqual([
        { presentationId: ibuBox, productId: productIbu, productName: "Ibuprofeno 400", presentationName: "Caja x 10", baseUnitFactor: 10, availableBase: 90, availableQuantity: 9 },
        { presentationId: ibuUnit, productId: productIbu, productName: "Ibuprofeno 400", presentationName: "Unidad", baseUnitFactor: 1, availableBase: 7, availableQuantity: 7 },
        { presentationId: zincUnit, productId: productZinc, productName: "Zinc", presentationName: "Frasco", baseUnitFactor: 1, availableBase: 0, availableQuantity: 0 }
      ]);
    });

    it("filters by presentation and validates the id", async () => {
      const one = await get(`/api/public/v1/stock?presentationId=${ibuBox}`, keyB);
      expect(one.body.items).toEqual([expect.objectContaining({ presentationId: ibuBox, availableBase: 999 })]);
      expect((await get(`/api/public/v1/stock?presentationId=${ibuInactive}`)).body.items).toEqual([]);
      expect((await get(`/api/public/v1/stock?presentationId=${otherPresentation}`)).body.items).toEqual([]);
      expect((await get("/api/public/v1/stock?presentationId=nope")).status).toBe(400);
    });
  });

  it("exposes no write endpoints", async () => {
    if (!app) await get("/api/public/v1/products");
    const response = await app!.inject({ method: "POST", url: "/api/public/v1/products", headers: { "x-api-key": keyA }, payload: {} });
    expect(response.statusCode).toBe(404);
  });
});
