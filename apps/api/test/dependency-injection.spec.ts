import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { CashService } from "../src/cash/cash.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { TenantDatabase } from "../src/database/tenant-database.js";
import { InventoryService } from "../src/inventory/inventory.service.js";
import { ProcurementService } from "../src/procurement/procurement.service.js";
import { SalesService } from "../src/sales/sales.service.js";

// Las suites de dominio instancian los servicios a mano; esta prueba cubre el
// cableado real de Nest, donde un servicio sin metadatos recibe `undefined`.
describe("AppModule dependency injection", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it.each([
    ["CatalogService", CatalogService],
    ["InventoryService", InventoryService],
    ["ProcurementService", ProcurementService],
    ["CashService", CashService],
    ["SalesService", SalesService]
  ])("injects TenantDatabase into %s", (_name, service) => {
    const instance = moduleRef.get(service, { strict: false }) as unknown as { database?: unknown };
    expect(instance.database).toBeInstanceOf(TenantDatabase);
  });
});
