import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { TenantDatabase, type TenantScope } from "../src/database/tenant-database.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(process.env.DATABASE_APP_URL ?? "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia", "farmaxia_test");

const tenantId = "00000000-0000-4000-8000-000000000701";
const branchId = "00000000-0000-4000-8000-000000000711";
const userId = "00000000-0000-4000-8000-000000000721";
const legalEntityId = "00000000-0000-4000-8000-000000000731";
const otherTenantId = "00000000-0000-4000-8000-000000000702";
const otherBranchId = "00000000-0000-4000-8000-000000000712";
const otherUserId = "00000000-0000-4000-8000-000000000722";
const otherLegalEntityId = "00000000-0000-4000-8000-000000000732";

const scope: TenantScope = { tenantId, userId, branchId };
const otherScope: TenantScope = { tenantId: otherTenantId, userId: otherUserId, branchId: otherBranchId };
const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);
const catalog = new CatalogService(tenantDatabase);

const amoxicilina = {
  name: "Amoxil",
  genericName: "Amoxicilina",
  activeIngredient: "Amoxicilina trihidrato",
  concentration: "500 mg",
  pharmaceuticalForm: "Cápsula",
  laboratory: "Laboratorios Bagó",
  sanitaryRegistration: "NN-12345/2024",
  saleClassification: "PRESCRIPTION",
  sinActivityCode: "477300",
  sinProductCode: "35270",
  sinUnitCode: "57"
};

async function auditActions(): Promise<string[]> {
  const { rows } = await ownerPool.query<{ action: string }>(
    "select action from audit_events where tenant_id = $1 order by occurred_at, action",
    [tenantId]
  );
  return rows.map((row) => row.action);
}

describe("Catálogo farmacéutico: ficha, categorías y presentaciones", () => {
  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        audit_events, idempotency_records, product_homologations, presentation_prices, product_barcodes,
        price_lists, product_presentations, products, product_categories,
        user_branch_memberships, branches, legal_entities, users, tenants
      cascade
    `);
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, 'ficha', 'Ficha'), ($2, 'otra', 'Otra')", [tenantId, otherTenantId]);
    await ownerPool.query(
      "insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Ficha SRL', '1'), ($3, $4, 'Otra SRL', '2')",
      [legalEntityId, tenantId, otherLegalEntityId, otherTenantId]
    );
    await ownerPool.query(
      "insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'S1', 'Central'), ($4, $5, $6, 'S1', 'Otra')",
      [branchId, tenantId, legalEntityId, otherBranchId, otherTenantId, otherLegalEntityId]
    );
    await ownerPool.query(
      "insert into users (id, email, display_name, password_hash) values ($1, 'ficha@test', 'Ficha', 'x'), ($2, 'otra@test', 'Otra', 'x')",
      [userId, otherUserId]
    );
    await ownerPool.query(
      "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3), ($4, $5, $6)",
      [userId, tenantId, branchId, otherUserId, otherTenantId, otherBranchId]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await ownerPool.end();
  });

  describe("ficha sanitaria", () => {
    it("guarda la ficha completa y la devuelve en el detalle", async () => {
      const { id } = await catalog.createProduct(scope, amoxicilina);
      const detail = await catalog.getProduct(scope, id);
      expect(detail).toMatchObject({
        ...amoxicilina,
        isControlled: false,
        requiresColdChain: false,
        coldChainMinCelsius: null,
        isActive: true,
        presentations: []
      });
      expect(await auditActions()).toEqual(["catalog.product_created"]);
    });

    it("aplica 2 a 8 °C por defecto a la cadena de frío y marca controlado lo de venta controlada", async () => {
      const insulin = await catalog.createProduct(scope, { name: "Insulina NPH", requiresColdChain: true });
      expect(await catalog.getProduct(scope, insulin.id)).toMatchObject({ coldChainMinCelsius: "2.0", coldChainMaxCelsius: "8.0" });

      const custom = await catalog.createProduct(scope, { name: "Vacuna", requiresColdChain: true, coldChainMinCelsius: "-25", coldChainMaxCelsius: -15 });
      expect(await catalog.getProduct(scope, custom.id)).toMatchObject({ coldChainMinCelsius: "-25.0", coldChainMaxCelsius: "-15.0" });

      const clonazepam = await catalog.createProduct(scope, { name: "Clonazepam", saleClassification: "CONTROLLED", isControlled: false });
      expect(await catalog.getProduct(scope, clonazepam.id)).toMatchObject({ isControlled: true, saleClassification: "CONTROLLED" });
    });

    it("rechaza datos inválidos sin crear nada", async () => {
      const invalid = [
        { name: "  " },
        { name: "X", saleClassification: "LIBRE" },
        { name: "X", sinProductCode: "ABC123" },
        { name: "X", requiresColdChain: true, coldChainMinCelsius: 8, coldChainMaxCelsius: 2 },
        { name: "X", requiresColdChain: true, coldChainMinCelsius: 2.55 },
        { name: "X", categoryId: "00000000-0000-4000-8000-000000009999" },
        { name: "X", isControlled: "sí" }
      ];
      for (const input of invalid) {
        await expect(catalog.createProduct(scope, input as never)).rejects.toMatchObject({ status: 400 });
      }
      expect((await catalog.listProducts(scope, { includeInactive: true })).total).toBe(0);
    });

    it("edita solo lo que cambia y deja cada cambio en la bitácora", async () => {
      const { id } = await catalog.createProduct(scope, amoxicilina);
      await catalog.updateProduct(scope, id, { concentration: "875 mg", laboratory: "Bagó Bolivia" });
      await catalog.updateProduct(scope, id, { concentration: "875 mg" });

      expect(await catalog.getProduct(scope, id)).toMatchObject({ concentration: "875 mg", laboratory: "Bagó Bolivia", genericName: "Amoxicilina" });
      const { rows } = await ownerPool.query<{ payload: { changes: Record<string, unknown> } }>(
        "select payload from audit_events where tenant_id = $1 and action = 'catalog.product_updated'",
        [tenantId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload.changes).toEqual({
        concentration: { from: "500 mg", to: "875 mg" },
        laboratory: { from: "Laboratorios Bagó", to: "Bagó Bolivia" }
      });
    });

    it("desactivar oculta el producto de la búsqueda y de la lectura de códigos, sin borrarlo", async () => {
      const { id } = await catalog.createProduct(scope, amoxicilina);
      const presentation = await catalog.createPresentation(scope, { productId: id, name: "Caja x 12", baseUnitFactor: 12, isSellable: true });
      await catalog.registerBarcode(scope, { presentationId: presentation.id, barcode: "7770001112223" });
      expect(await catalog.findByBarcode(scope, "7770001112223")).not.toBeNull();

      await catalog.updateProduct(scope, id, { isActive: false });
      expect((await catalog.listProducts(scope)).total).toBe(0);
      expect(await catalog.findByBarcode(scope, "7770001112223")).toBeNull();
      expect((await catalog.listProducts(scope, { includeInactive: true })).items[0]).toMatchObject({ productId: id, isActive: false });

      await catalog.updateProduct(scope, id, { isActive: true });
      expect((await catalog.listProducts(scope)).total).toBe(1);
      expect(await auditActions()).toEqual(expect.arrayContaining(["catalog.product_deactivated", "catalog.product_reactivated"]));
    });
  });

  describe("búsqueda y filtros", () => {
    it("busca por genérico, laboratorio y código de barras, y filtra controlados y frío", async () => {
      const amoxil = await catalog.createProduct(scope, amoxicilina);
      await catalog.createProduct(scope, { name: "Insulina", requiresColdChain: true, laboratory: "Novo Nordisk" });
      await catalog.createProduct(scope, { name: "Clonazepam", saleClassification: "CONTROLLED" });
      const box = await catalog.createPresentation(scope, { productId: amoxil.id, name: "Caja", baseUnitFactor: 12, isSellable: true });
      await catalog.registerBarcode(scope, { presentationId: box.id, barcode: "7790001" });

      const names = async (query: Parameters<CatalogService["listProducts"]>[1]) =>
        (await catalog.listProducts(scope, query)).items.map((item) => item.name);
      expect(await names({ search: "amoxicilina" })).toEqual(["Amoxil"]);
      expect(await names({ search: "novo" })).toEqual(["Insulina"]);
      expect(await names({ search: "7790001" })).toEqual(["Amoxil"]);
      expect(await names({ controlled: true })).toEqual(["Clonazepam"]);
      expect(await names({ coldChain: true })).toEqual(["Insulina"]);
    });
  });

  describe("categorías", () => {
    it("lista, renombra y vuelve controlados los productos de una categoría controlada", async () => {
      const category = await catalog.createCategory(scope, { name: "Psicotrópicos", isControlled: false });
      const product = await catalog.createProduct(scope, { name: "Alprazolam", categoryId: category.id });
      await expect(catalog.createCategory(scope, { name: "Psicotrópicos", isControlled: false })).rejects.toMatchObject({ status: 409 });

      await catalog.updateCategory(scope, category.id, { name: "Psicotrópicos y estupefacientes", isControlled: true });
      expect(await catalog.listCategories(scope)).toEqual([
        { id: category.id, name: "Psicotrópicos y estupefacientes", isControlled: true, isActive: true, products: 1 }
      ]);
      expect(await catalog.getProduct(scope, product.id)).toMatchObject({ isControlled: true, categoryIsControlled: true });

      await catalog.updateCategory(scope, category.id, { isActive: false });
      await expect(catalog.createProduct(scope, { name: "Otro", categoryId: category.id })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("presentaciones", () => {
    it("edita nombre y venta, desactiva, y nunca cambia el factor", async () => {
      const { id } = await catalog.createProduct(scope, amoxicilina);
      const box = await catalog.createPresentation(scope, { productId: id, name: "Caja x 12", baseUnitFactor: 12, isSellable: true });
      const blister = await catalog.createPresentation(scope, { productId: id, name: "Blíster x 6", baseUnitFactor: 6, isSellable: true });
      await expect(catalog.createPresentation(scope, { productId: id, name: "Caja x 12", baseUnitFactor: 12, isSellable: true }))
        .rejects.toMatchObject({ status: 409 });
      await expect(catalog.createPresentation(scope, { productId: id, name: "Media", baseUnitFactor: 0.5, isSellable: true }))
        .rejects.toMatchObject({ status: 400 });

      await catalog.updatePresentation(scope, box.id, { name: "Caja x 12 cápsulas", isSellable: false });
      await expect(catalog.updatePresentation(scope, box.id, { baseUnitFactor: 24 } as never)).rejects.toMatchObject({ status: 409 });
      await catalog.updatePresentation(scope, blister.id, { isActive: false });

      const detail = await catalog.getProduct(scope, id);
      expect(detail.presentations.map((item) => [item.name, item.baseUnitFactor, item.isSellable, item.isActive])).toEqual([
        ["Caja x 12 cápsulas", 12, false, true],
        ["Blíster x 6", 6, true, false]
      ]);
      expect((await catalog.listProducts(scope)).items[0]?.presentations.map((item) => item.name)).toEqual(["Caja x 12 cápsulas"]);
    });

    it("muestra códigos de barras y el precio vigente de cada presentación", async () => {
      const { id } = await catalog.createProduct(scope, amoxicilina);
      const box = await catalog.createPresentation(scope, { productId: id, name: "Caja", baseUnitFactor: 12, isSellable: true });
      await catalog.registerBarcode(scope, { presentationId: box.id, barcode: "7791" });
      const list = await catalog.createPriceList(scope, { name: "General", currency: "BOB" });
      await catalog.setPrice(scope, { priceListId: list.id, presentationId: box.id, amount: "45.5000", validFrom: new Date(Date.now() - 60_000) });

      const [presentation] = (await catalog.getProduct(scope, id)).presentations;
      expect(presentation).toMatchObject({ barcodes: ["7791"], currentPrice: { amount: "45.5000", currency: "BOB", priceListName: "General" } });
    });
  });

  it("no deja ver ni editar el catálogo de otra farmacia", async () => {
    const { id } = await catalog.createProduct(scope, amoxicilina);
    const category = await catalog.createCategory(scope, { name: "Antibióticos", isControlled: false });
    await expect(catalog.getProduct(otherScope, id)).rejects.toMatchObject({ status: 404 });
    await expect(catalog.updateProduct(otherScope, id, { name: "Hack" })).rejects.toMatchObject({ status: 404 });
    await expect(catalog.updateCategory(otherScope, category.id, { name: "Hack" })).rejects.toMatchObject({ status: 404 });
    await expect(catalog.createProduct(otherScope, { name: "X", categoryId: category.id })).rejects.toMatchObject({ status: 400 });
    expect((await catalog.getProduct(scope, id)).name).toBe("Amoxil");
  });
});
