import assert from "node:assert/strict";
import test from "node:test";
import { canViewCatalog, catalogDetailMode } from "./catalog-access.ts";

test("allows catalog read access for catalog managers and sales users", () => {
  assert.equal(canViewCatalog(["catalog.manage"]), true);
  assert.equal(canViewCatalog(["sales.confirm"]), true);
  assert.equal(canViewCatalog(["inventory.manage"]), false);
});

test("selects a truthful product-detail mode for each catalog role", () => {
  assert.equal(catalogDetailMode(["catalog.manage"]), "manage");
  assert.equal(catalogDetailMode(["sales.confirm"]), "read-only");
  assert.equal(catalogDetailMode(["inventory.manage"]), "denied");
});
