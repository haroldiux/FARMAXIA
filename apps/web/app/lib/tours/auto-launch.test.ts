import assert from "node:assert/strict";
import test from "node:test";
import { isTourCompleted, markTourCompleted, type TourStorage } from "../tours.ts";
import {
  INITIAL_AUTO_LAUNCH_GATE,
  TRAINING_EXIT_PATH,
  recordTourClosed,
  shouldAutoLaunchTour,
  stepAutoLaunchGate,
} from "./auto-launch.ts";

const T = "tenant-1";
const U = "user-1";

test("a dismissed (skipped) tour is remembered and never auto-launches again", () => {
  const storage: TourStorage = {};
  assert.equal(shouldAutoLaunchTour(storage, T, U, "sales"), true);
  recordTourClosed(storage, T, U, "sales");
  assert.equal(isTourCompleted(storage, T, U, "sales"), true);
  assert.equal(shouldAutoLaunchTour(storage, T, U, "sales"), false);
});

test("a completed tour never auto-launches, and progress is per user and tenant", () => {
  const storage: TourStorage = {};
  markTourCompleted(storage, T, U, "cash");
  assert.equal(shouldAutoLaunchTour(storage, T, U, "cash"), false);
  assert.equal(shouldAutoLaunchTour(storage, T, "other-user", "cash"), true);
  assert.equal(shouldAutoLaunchTour(storage, "other-tenant", U, "cash"), true);
});

test("auto-launch is blocked while training is active", () => {
  const step = stepAutoLaunchGate(INITIAL_AUTO_LAUNCH_GATE, { trainingActive: true, pathname: "/cash" });
  assert.equal(step.allowed, false);
});

test("finishing training blocks auto-launch on the current page and the exit destination", () => {
  let gate = stepAutoLaunchGate(INITIAL_AUTO_LAUNCH_GATE, { trainingActive: true, pathname: "/cash" }).gate;
  let step = stepAutoLaunchGate(gate, { trainingActive: false, pathname: "/cash" });
  assert.equal(step.allowed, false);
  step = stepAutoLaunchGate(step.gate, { trainingActive: false, pathname: TRAINING_EXIT_PATH });
  assert.equal(step.allowed, false);
});

test("the next real navigation re-enables auto-launch", () => {
  let gate = stepAutoLaunchGate(INITIAL_AUTO_LAUNCH_GATE, { trainingActive: true, pathname: "/cash" }).gate;
  gate = stepAutoLaunchGate(gate, { trainingActive: false, pathname: "/cash" }).gate;
  gate = stepAutoLaunchGate(gate, { trainingActive: false, pathname: TRAINING_EXIT_PATH }).gate;
  const step = stepAutoLaunchGate(gate, { trainingActive: false, pathname: "/sales" });
  assert.equal(step.allowed, true);
  assert.equal(stepAutoLaunchGate(step.gate, { trainingActive: false, pathname: TRAINING_EXIT_PATH }).allowed, true);
});

test("without any training the gate always allows", () => {
  const step = stepAutoLaunchGate(INITIAL_AUTO_LAUNCH_GATE, { trainingActive: false, pathname: "/sales" });
  assert.equal(step.allowed, true);
});
