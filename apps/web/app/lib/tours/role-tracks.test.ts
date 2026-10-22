import assert from "node:assert/strict";
import test from "node:test";
import {
  type RoleTrainingTrack,
  type TrainingStep,
  cajeroTrainingTrack,
  almaceneroTrainingTrack,
  regenteTrainingTrack,
  encargadoTrainingTrack,
  ownerTrainingTrack,
  allRoleTracks,
  getTrainingTrackForRole,
  shouldNavigateToStep,
  stepMatchesPath,
} from "./role-tracks.ts";

test("all 5 role training tracks exist and are distinct", () => {
  assert.equal(allRoleTracks.length, 5);

  const ids = allRoleTracks.map((t) => t.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 5);

  const roleCodes = allRoleTracks.map((t) => t.roleCode);
  assert.ok(roleCodes.includes("cajero"));
  assert.ok(roleCodes.includes("almacenero"));
  assert.ok(roleCodes.includes("regente"));
  assert.ok(roleCodes.includes("encargado"));
  assert.ok(roleCodes.includes("owner"));
});

test("every role track has valid metadata and structured sequential steps", () => {
  for (const track of allRoleTracks) {
    assert.ok(track.id.length > 0, `Track ${track.id} has empty id`);
    assert.ok(track.title.length > 0, `Track ${track.id} has empty title`);
    assert.ok(track.description.length > 0, `Track ${track.id} has empty description`);
    assert.ok(track.icon.length > 0, `Track ${track.id} has empty icon`);
    assert.ok(track.steps.length >= 4, `Track ${track.id} has fewer than 4 steps`);

    for (const step of track.steps) {
      assert.ok(step.id.length > 0, `Step in ${track.id} has empty id`);
      assert.ok(step.path.startsWith("/"), `Step in ${track.id} path must start with '/': ${step.path}`);
      assert.ok(step.targetSelector.length > 0, `Step in ${track.id} has empty targetSelector`);
      assert.ok(step.title.length > 0, `Step in ${track.id} has empty title`);
      assert.ok(step.description.length > 0, `Step in ${track.id} has empty description`);
      assert.ok(step.actionPrompt.length > 0, `Step in ${track.id} has empty actionPrompt`);
    }
  }
});

test("cajeroTrainingTrack covers full POS counter and cash shift lifecycle", () => {
  assert.equal(cajeroTrainingTrack.roleCode, "cajero");
  const paths = cajeroTrainingTrack.steps.map((s) => s.path);

  // Must cover /cash and /sales
  assert.ok(paths.includes("/cash"));
  assert.ok(paths.includes("/sales"));

  // Check specific operational actions
  const actions = cajeroTrainingTrack.steps.map((s) => s.interactiveAction).filter(Boolean);
  assert.ok(actions.includes("open_shift"));
  assert.ok(actions.includes("search_product"));
  assert.ok(actions.includes("confirm_sale"));
  assert.ok(actions.includes("record_movement"));
  assert.ok(actions.includes("close_shift"));
});

test("cajeroTrainingTrack covers customer loyalty and the receipt preview in order", () => {
  const actions = cajeroTrainingTrack.steps.map((s) => s.interactiveAction);
  const index = (action: string) => actions.indexOf(action as never);
  assert.ok(index("link_customer") > index("search_product"), "customer is linked after the product is in the cart");
  assert.ok(index("link_customer") < index("confirm_sale"), "customer is linked before the sale is confirmed");
  assert.ok(index("open_receipt") > index("confirm_sale"), "receipt opens after the sale");
  assert.equal(index("choose_receipt_width"), index("open_receipt") + 1);
  assert.ok(index("choose_receipt_width") < index("record_movement"));
  const widthStep = cajeroTrainingTrack.steps[index("choose_receipt_width")]!;
  assert.equal(widthStep.landingPath, "/sales/[saleId]");
});

test("stepMatchesPath supports static and dynamic landing pages", () => {
  assert.equal(stepMatchesPath({ path: "/cash" }, "/cash"), true);
  assert.equal(stepMatchesPath({ path: "/cash" }, "/sales"), false);
  assert.equal(stepMatchesPath({ path: "/branches", landingPath: "/users" }, "/users"), true);
  const dynamic = { path: "/sales", landingPath: "/sales/[saleId]" };
  assert.equal(stepMatchesPath(dynamic, "/sales/sale-demo-0001"), true);
  assert.equal(stepMatchesPath(dynamic, "/sales/a/b"), false);
  assert.equal(stepMatchesPath(dynamic, "/sales"), false);
});

test("shouldNavigateToStep never bounces the learner off a dynamic landing page", () => {
  const dynamic = { path: "/sales", landingPath: "/sales/[saleId]" };
  assert.equal(shouldNavigateToStep(dynamic, "/sales/sale-demo-0001"), false);
  assert.equal(shouldNavigateToStep(dynamic, "/cash"), true);
  assert.equal(shouldNavigateToStep({ path: "/cash" }, "/cash"), false);
  assert.equal(shouldNavigateToStep({ path: "/cash" }, "/sales"), true);
  // A redirecting path is always visited so the redirect (and its tab) is applied.
  assert.equal(shouldNavigateToStep({ path: "/branches", landingPath: "/users" }, "/users"), true);
});

test("almaceneroTrainingTrack covers procurement receiving, FEFO alerts, quarantine, and waste acts", () => {
  assert.equal(almaceneroTrainingTrack.roleCode, "almacenero");
  const paths = almaceneroTrainingTrack.steps.map((s) => s.path);

  assert.ok(paths.some((p) => p.startsWith("/procurement")));
  assert.ok(paths.some((p) => p.startsWith("/inventory")));

  const actions = almaceneroTrainingTrack.steps.map((s) => s.interactiveAction).filter(Boolean);
  assert.ok(actions.includes("view_orders"));
  assert.ok(actions.includes("receive_batch"));
  assert.ok(actions.includes("quarantine_batch"));
  assert.ok(actions.includes("create_waste_act"));
});

test("regenteTrainingTrack covers controlled drugs, strict medical prescriptions, and AGEMED book", () => {
  assert.equal(regenteTrainingTrack.roleCode, "regente");
  const paths = regenteTrainingTrack.steps.map((s) => s.path);

  assert.ok(paths.some((p) => p.startsWith("/catalog")));
  assert.ok(paths.some((p) => p.startsWith("/sales")));
  assert.ok(paths.some((p) => p.startsWith("/controlled")));

  const actions = regenteTrainingTrack.steps.map((s) => s.interactiveAction).filter(Boolean);
  assert.ok(actions.includes("view_controlled_catalog"));
  assert.ok(actions.includes("submit_prescription"));
  assert.ok(actions.includes("view_controlled_book"));
});

test("encargadoTrainingTrack covers inter-branch transfers, staff scheduling, and shift audit approval", () => {
  assert.equal(encargadoTrainingTrack.roleCode, "encargado");
  const paths = encargadoTrainingTrack.steps.map((s) => s.path);

  assert.ok(paths.some((p) => p.startsWith("/transfers")));
  assert.ok(paths.some((p) => p.startsWith("/staff")));
  assert.ok(paths.some((p) => p.startsWith("/cash")));

  const actions = encargadoTrainingTrack.steps.map((s) => s.interactiveAction).filter(Boolean);
  assert.ok(actions.includes("request_transfer"));
  assert.ok(actions.includes("schedule_shift"));
  assert.ok(actions.includes("approve_difference"));
});

test("ownerTrainingTrack covers executive dashboard KPIs, user quotas, branches, and margin analytics", () => {
  assert.equal(ownerTrainingTrack.roleCode, "owner");
  const paths = ownerTrainingTrack.steps.map((s) => s.path);

  assert.ok(paths.includes("/dashboard"));
  assert.ok(paths.includes("/users"));
  assert.ok(paths.includes("/branches"));
  assert.ok(paths.includes("/analytics"));

  const actions = ownerTrainingTrack.steps.map((s) => s.interactiveAction).filter(Boolean);
  assert.ok(actions.includes("review_kpis"));
  assert.ok(actions.includes("create_user"));
  assert.ok(actions.includes("check_quotas"));
  assert.ok(actions.includes("review_analytics"));
});

test("getTrainingTrackForRole resolves track by role code with alias normalization", () => {
  assert.equal(getTrainingTrackForRole("cajero")?.id, cajeroTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("almacenero")?.id, almaceneroTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("regente")?.id, regenteTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("encargado")?.id, encargadoTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("owner")?.id, ownerTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("propietario")?.id, ownerTrainingTrack.id);

  // Case insensitive and trimmed
  assert.equal(getTrainingTrackForRole(" CAJERO ")?.id, cajeroTrainingTrack.id);
  assert.equal(getTrainingTrackForRole("Regente")?.id, regenteTrainingTrack.id);

  // Unknown role returns null
  assert.equal(getTrainingTrackForRole("visitante"), null);
  assert.equal(getTrainingTrackForRole(""), null);
});
