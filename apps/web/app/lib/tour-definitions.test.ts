import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardWelcomeTour,
  posCounterTour,
  inventoryOverviewTour,
  allTours,
  getTourForPathname,
} from "./tour-definitions.ts";

test("dashboardWelcomeTour has valid structure and required steps", () => {
  assert.equal(dashboardWelcomeTour.id, "dashboard-welcome");
  assert.ok(dashboardWelcomeTour.title.length > 0);
  assert.ok(dashboardWelcomeTour.steps.length >= 4);

  const targets = dashboardWelcomeTour.steps.map((s) => s.targetSelector);
  assert.ok(targets.includes('[data-tour="dashboard-kpis"]'));
  assert.ok(targets.includes('[data-tour="dashboard-modules"]'));
  assert.ok(targets.includes('[data-tour="shell-branch-status"]'));
  assert.ok(targets.includes('[data-tour="shell-plan-card"]'));

  for (const step of dashboardWelcomeTour.steps) {
    assert.ok(step.id.length > 0);
    assert.ok(step.title.length > 0);
    assert.ok(step.description.length > 0);
  }
});

test("posCounterTour has valid structure and required steps", () => {
  assert.equal(posCounterTour.id, "pos-counter");
  assert.ok(posCounterTour.title.length > 0);
  assert.ok(posCounterTour.steps.length >= 5);

  const targets = posCounterTour.steps.map((s) => s.targetSelector);
  assert.ok(targets.includes('[data-tour="pos-search"]'));
  assert.ok(targets.includes('[data-tour="pos-customer"]'));
  assert.ok(targets.includes('[data-tour="pos-cart"]'));
  assert.ok(targets.includes('[data-tour="pos-quick-actions"]'));
  assert.ok(targets.includes('[data-tour="pos-tender"]'));

  for (const step of posCounterTour.steps) {
    assert.ok(step.id.length > 0);
    assert.ok(step.title.length > 0);
    assert.ok(step.description.length > 0);
  }
});

test("inventoryOverviewTour has valid structure and required steps", () => {
  assert.equal(inventoryOverviewTour.id, "inventory-overview");
  assert.ok(inventoryOverviewTour.title.length > 0);
  assert.ok(inventoryOverviewTour.steps.length >= 4);

  const targets = inventoryOverviewTour.steps.map((s) => s.targetSelector);
  assert.ok(targets.includes('[data-tour="inventory-warehouses"]'));
  assert.ok(targets.includes('[data-tour="inventory-expiry-alerts"]'));
  assert.ok(targets.includes('[data-tour="inventory-actions"]'));
  assert.ok(targets.includes('[data-tour="inventory-audit-report"]'));

  for (const step of inventoryOverviewTour.steps) {
    assert.ok(step.id.length > 0);
    assert.ok(step.title.length > 0);
    assert.ok(step.description.length > 0);
  }
});

test("allTours contains all registered walkthrough definitions", () => {
  assert.equal(allTours.length, 3);
  const ids = allTours.map((t) => t.id);
  assert.deepEqual(ids, ["dashboard-welcome", "pos-counter", "inventory-overview"]);
});

test("getTourForPathname resolves correct tour for each core route", () => {
  assert.equal(getTourForPathname("/dashboard")?.id, "dashboard-welcome");
  assert.equal(getTourForPathname("/dashboard/")?.id, "dashboard-welcome");
  assert.equal(getTourForPathname("/sales")?.id, "pos-counter");
  assert.equal(getTourForPathname("/sales/")?.id, "pos-counter");
  assert.equal(getTourForPathname("/inventory")?.id, "inventory-overview");
  assert.equal(getTourForPathname("/inventory/")?.id, "inventory-overview");

  // Non-matching routes return null
  assert.equal(getTourForPathname("/customers"), null);
  assert.equal(getTourForPathname("/login"), null);
  assert.equal(getTourForPathname(""), null);
});
