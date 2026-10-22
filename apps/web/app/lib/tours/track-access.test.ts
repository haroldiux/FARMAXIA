import assert from "node:assert/strict";
import test from "node:test";
import { restoreSandboxSession, saveSandboxSession, type StorageLike } from "../sandbox/sandbox-session.ts";
import { allRoleTracks } from "./role-tracks.ts";
import { getAvailableTracks, missingPermissionsForTrack } from "./track-access.ts";

// Permission sets copied from apps/api/src/identity/role-templates.ts (predefined roles).
const cajero = ["cash.manage", "sales.confirm", "sales.read", "fiscal.read", "customers.manage"];
const almacenero = ["inventory.manage", "transfers.manage"];
const regente = ["catalog.manage", "inventory.manage", "inventory.count.approve", "inventory.report.global", "transfers.manage", "transfers.approve", "controlled.read", "controlled.book.export", "sales.confirm", "sales.read", "fiscal.read", "sales.void", "sales.fefo.override", "audit.read", "staff.shifts.manage", "staff.reports.read", "analytics.read", "customers.manage"];
const encargado = ["catalog.manage", "inventory.manage", "inventory.count.approve", "payables.manage", "inventory.report.global", "transfers.manage", "transfers.approve", "controlled.read", "cash.manage", "cash.shift.approve", "sales.confirm", "sales.read", "fiscal.read", "sales.void", "sales.fefo.override", "audit.read", "staff.shifts.manage", "staff.reports.read", "analytics.read", "customers.manage", "agreements.manage"];
const owner = [...new Set([...regente, ...encargado, "users.manage", "billing.manage", "integrations.manage", "loyalty.manage", "agreements.billing", "staff.commissions.manage", "payables.manage"])];

const codes = (permissions: readonly string[]) => getAvailableTracks(permissions).map((track) => track.roleCode);

test("cashier permissions offer only the cajero track", () => {
  assert.deepEqual(codes(cajero), ["cajero"]);
});

test("warehouse permissions offer only the almacenero track", () => {
  assert.deepEqual(codes(almacenero), ["almacenero"]);
});

test("no permissions offer no tracks", () => {
  assert.deepEqual(codes([]), []);
});

test("owner permissions offer all 5 tracks", () => {
  assert.deepEqual(codes(owner), allRoleTracks.map((track) => track.roleCode));
});

test("regente sees almacenero and regente only (no cash.manage)", () => {
  assert.deepEqual(codes(regente), ["almacenero", "regente"]);
});

test("encargado sees everything except the owner track", () => {
  assert.deepEqual(codes(encargado), ["cajero", "almacenero", "regente", "encargado"]);
});

test("a custom role with just the needed permissions unlocks that track", () => {
  assert.deepEqual(codes(["controlled.read", "catalog.manage", "sales.confirm"]), ["regente"]);
  assert.deepEqual(codes(["analytics.read", "users.manage"]), ["owner"]);
  assert.deepEqual(codes(["analytics.read"]), []);
});

test("approve and schedule steps need their action permission", () => {
  assert.ok(missingPermissionsForTrack(allRoleTracks[3]!, regente).length > 0);
  assert.deepEqual(missingPermissionsForTrack(allRoleTracks[3]!, encargado), []);
});

test("restoring a stored track the user cannot access exits cleanly", () => {
  const data = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  saveSandboxSession(storage, { roleCode: "regente", stepIndex: 2 });
  assert.equal(restoreSandboxSession(storage, cajero), null);
  assert.equal(data.size, 0);
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: 1 });
  assert.equal(restoreSandboxSession(storage, cajero)?.stepIndex, 1);
});
