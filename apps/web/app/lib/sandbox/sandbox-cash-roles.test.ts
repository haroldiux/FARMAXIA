import assert from "node:assert/strict";
import test from "node:test";
import { getSandboxState, purgeSandbox, setSandboxUserId } from "./sandbox-store.ts";
import { handleSandboxRequest } from "./sandbox-interceptor.ts";
import {
  SANDBOX_STATE_KEY,
  restoreSandboxSession,
  saveSandboxSession,
  startSandboxSession,
  type StorageLike,
} from "./sandbox-session.ts";

function fakeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function post(url: string, body: unknown) {
  return handleSandboxRequest(url, { method: "POST", body: JSON.stringify(body) });
}

async function listShifts() {
  const res = await handleSandboxRequest("/api/v1/cash/shifts");
  return (res.body as { items: Array<Record<string, any>> }).items;
}

test.beforeEach(() => {
  setSandboxUserId("user-demo");
  purgeSandbox();
});

test("default baseline keeps an OPEN shift (other roles can sell right away)", async () => {
  const [shift] = await listShifts();
  assert.equal(shift!.control.status, "OPEN");
});

test("cajero starts with a scheduled shift that has no control yet, assigned to the session user", async () => {
  setSandboxUserId("real-user-1");
  purgeSandbox("cajero");
  const shifts = await listShifts();
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0]!.control, undefined);
  assert.equal(shifts[0]!.users[0].id, "real-user-1");

  const eligible = await handleSandboxRequest("/api/v1/cash/eligible-users");
  assert.equal((eligible.body as { items: Array<{ id: string }> }).items[0]!.id, "real-user-1");
});

test("opening the scheduled shift keeps the same shift and opens its control", async () => {
  purgeSandbox("cajero");
  const [scheduled] = await listShifts();
  const res = await post(`/api/v1/cash/shifts/${scheduled!.id}/open`, {
    idempotencyKey: "k",
    openingAmountBob: "200.00",
  });
  assert.equal(res.status, 200);
  assert.equal((res.body as { status: string }).status, "OPEN");
  const shifts = await listShifts();
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0]!.id, scheduled!.id);
  assert.equal(shifts[0]!.control.status, "OPEN");
  assert.equal(shifts[0]!.control.openingAmountBob, "200.00");
});

test("counting with a difference leaves the shift pending approval, approving closes it", async () => {
  const [shift] = await listShifts();
  const counted = await post(`/api/v1/cash/shifts/${shift!.id}/count`, { countedAmountBob: "190.00" });
  assert.equal((counted.body as { status: string }).status, "PENDING_APPROVAL");
  assert.equal((counted.body as { differenceAmountBob: string }).differenceAmountBob, "-10.00");

  const approved = await post(`/api/v1/cash/shifts/${shift!.id}/approve`, { approvalNote: "ok" });
  assert.equal((approved.body as { status: string }).status, "CLOSED");
  assert.equal((await listShifts())[0]!.control.status, "CLOSED");
});

test("counting the exact expected amount closes the shift directly", async () => {
  const [shift] = await listShifts();
  const counted = await post(`/api/v1/cash/shifts/${shift!.id}/count`, { countedAmountBob: "200.00" });
  assert.equal((counted.body as { status: string }).status, "CLOSED");
});

test("encargado starts with a shift pending approval and a difference, ready to approve", async () => {
  purgeSandbox("encargado");
  const [shift] = await listShifts();
  assert.equal(shift!.control.status, "PENDING_APPROVAL");
  assert.equal(shift!.control.differenceAmountBob, "-15.00");
  const approved = await post(`/api/v1/cash/shifts/${shift!.id}/approve`, { approvalNote: "ok" });
  assert.equal((approved.body as { status: string }).status, "CLOSED");
});

test("startSandboxSession seeds the role baseline and persists the session; restore reseeds it", async () => {
  const storage = fakeStorage();
  startSandboxSession(storage, "encargado");
  assert.equal(getSandboxState().shifts[0]!.status, "PENDING_APPROVAL");
  assert.ok(storage.getItem(SANDBOX_STATE_KEY));

  purgeSandbox();
  assert.equal(getSandboxState().shifts[0]!.status, "OPEN");
  const restored = restoreSandboxSession(storage);
  assert.equal(restored?.track.roleCode, "encargado");
  assert.equal(getSandboxState().shifts[0]!.status, "PENDING_APPROVAL");

  const other = fakeStorage();
  saveSandboxSession(other, { roleCode: "cajero", stepIndex: 0 });
  restoreSandboxSession(other);
  assert.equal(getSandboxState().shifts[0]!.status, "SCHEDULED");
});

test("setSandboxUserId keeps the user directory consistent", async () => {
  setSandboxUserId("real-user-2");
  const users = (await handleSandboxRequest("/api/v1/users")).body as Array<{ id: string }>;
  assert.equal(users[0]!.id, "real-user-2");
  const members = (await handleSandboxRequest("/api/v1/staff/members")).body as Array<{ userId: string }>;
  assert.ok(members.some((m) => m.userId === "real-user-2"));
});
