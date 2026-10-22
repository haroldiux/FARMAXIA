import assert from "node:assert/strict";
import test from "node:test";
import {
  SANDBOX_FLAG_KEY,
  SANDBOX_STATE_KEY,
  clearSandboxSession,
  exitSandboxSession,
  loadSandboxSession,
  restoreSandboxSession,
  saveSandboxSession,
  type StorageLike,
} from "./sandbox-session.ts";
import { getSandboxState, openCashShift, purgeSandbox } from "./sandbox-store.ts";

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test.beforeEach(() => {
  purgeSandbox();
});

test("saveSandboxSession persists the flag and {roleCode, stepIndex}", () => {
  const storage = fakeStorage();
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: 2 });
  assert.equal(storage.getItem(SANDBOX_FLAG_KEY), "true");
  assert.deepEqual(loadSandboxSession(storage), { roleCode: "cajero", stepIndex: 2 });
});

test("loadSandboxSession returns null and cleans up when state is missing, corrupt or unknown", () => {
  const missing = fakeStorage();
  missing.setItem(SANDBOX_FLAG_KEY, "true");
  assert.equal(loadSandboxSession(missing), null);
  assert.equal(missing.getItem(SANDBOX_FLAG_KEY), null);

  const corrupt = fakeStorage();
  corrupt.setItem(SANDBOX_FLAG_KEY, "true");
  corrupt.setItem(SANDBOX_STATE_KEY, "{not json");
  assert.equal(loadSandboxSession(corrupt), null);
  assert.equal(corrupt.getItem(SANDBOX_FLAG_KEY), null);

  const unknown = fakeStorage();
  saveSandboxSession(unknown, { roleCode: "hacker", stepIndex: 0 });
  assert.equal(loadSandboxSession(unknown), null);
  assert.equal(unknown.getItem(SANDBOX_STATE_KEY), null);
});

test("loadSandboxSession returns null when the flag is off even if state remains", () => {
  const storage = fakeStorage();
  storage.setItem(SANDBOX_STATE_KEY, JSON.stringify({ roleCode: "cajero", stepIndex: 1 }));
  assert.equal(loadSandboxSession(storage), null);
});

test("loadSandboxSession clamps a stale step index into the track range", () => {
  const storage = fakeStorage();
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: 999 });
  const restored = loadSandboxSession(storage);
  assert.ok(restored);
  assert.ok(restored.stepIndex < 999);
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: -4 });
  assert.equal(loadSandboxSession(storage)?.stepIndex, 0);
});

test("restoreSandboxSession returns the track and reseeds the baseline store", () => {
  const storage = fakeStorage();
  saveSandboxSession(storage, { roleCode: "almacenero", stepIndex: 1 });
  openCashShift("500.00");
  assert.equal(getSandboxState().shifts.length, 2);

  const restored = restoreSandboxSession(storage);
  assert.ok(restored);
  assert.equal(restored.track.roleCode, "almacenero");
  assert.equal(restored.stepIndex, 1);
  assert.equal(getSandboxState().shifts.length, 1);
});

test("restoreSandboxSession returns null without a stored session", () => {
  assert.equal(restoreSandboxSession(fakeStorage()), null);
});

test("exitSandboxSession clears every key and purges the store", () => {
  const storage = fakeStorage();
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: 0 });
  openCashShift("500.00");
  exitSandboxSession(storage);
  assert.equal(storage.data.size, 0);
  assert.equal(getSandboxState().shifts.length, 1);
});

test("clearSandboxSession only removes sandbox keys", () => {
  const storage = fakeStorage();
  storage.setItem("farmaxia.access_token", "abc");
  saveSandboxSession(storage, { roleCode: "cajero", stepIndex: 0 });
  clearSandboxSession(storage);
  assert.equal(storage.getItem("farmaxia.access_token"), "abc");
  assert.equal(storage.getItem(SANDBOX_FLAG_KEY), null);
  assert.equal(storage.getItem(SANDBOX_STATE_KEY), null);
});
