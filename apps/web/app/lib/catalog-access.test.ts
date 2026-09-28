import assert from "node:assert/strict";
import test from "node:test";
import { canViewCatalog } from "./catalog-access.ts";

test("allows catalog read access for catalog managers and sales users", () => {
  assert.equal(canViewCatalog(["catalog.manage"]), true);
  assert.equal(canViewCatalog(["sales.confirm"]), true);
  assert.equal(canViewCatalog(["inventory.manage"]), false);
});