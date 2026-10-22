import assert from "node:assert/strict";
import test from "node:test";
import {
  type TourStep,
  type TourDefinition,
  type TourState,
  type TourStorage,
  createInitialTourState,
  nextTourStep,
  prevTourStep,
  skipTour,
  completeTour,
  progressPercentage,
  getTourStorageKey,
  isTourCompleted,
  markTourCompleted,
  resetTourProgress,
} from "./tours.ts";

const mockSteps: TourStep[] = [
  {
    id: "step-1",
    targetSelector: '[data-tour="search-input"]',
    title: "Búsqueda Rápida",
    description: "Busca productos por nombre o código de barras.",
    placement: "bottom",
    badge: "F2",
  },
  {
    id: "step-2",
    targetSelector: '[data-tour="customer-select"]',
    title: "Selección de Cliente",
    description: "Asigna un cliente para registrar puntos de fidelidad.",
    placement: "bottom",
  },
  {
    id: "step-3",
    targetSelector: '[data-tour="cart-summary"]',
    title: "Resumen del Carrito",
    description: "Verifica los ítems y los lotes con criterio FEFO.",
    placement: "top",
  },
];

const mockDefinition: TourDefinition = {
  id: "pos-counter",
  title: "Tour del Mostrador POS",
  description: "Aprende a operar el punto de venta de Farmaxia",
  steps: mockSteps,
  module: "sales",
};

test("createInitialTourState initializes state at step 0 for a valid definition", () => {
  const state = createInitialTourState(mockDefinition);

  assert.equal(state.tourId, "pos-counter");
  assert.equal(state.status, "running");
  assert.equal(state.currentStepIndex, 0);
  assert.equal(state.totalSteps, 3);
  assert.deepEqual(state.currentStep, mockSteps[0]);
  assert.equal(state.isFirstStep, true);
  assert.equal(state.isLastStep, false);
});

test("createInitialTourState handles single-step tour as both first and last", () => {
  const singleStepDef: TourDefinition = {
    id: "single-step",
    title: "Single Step",
    steps: [mockSteps[0]!],
  };
  const state = createInitialTourState(singleStepDef);

  assert.equal(state.status, "running");
  assert.equal(state.currentStepIndex, 0);
  assert.equal(state.totalSteps, 1);
  assert.equal(state.isFirstStep, true);
  assert.equal(state.isLastStep, true);
});

test("createInitialTourState handles empty steps list gracefully", () => {
  const emptyDef: TourDefinition = {
    id: "empty",
    title: "Empty Tour",
    steps: [],
  };
  const state = createInitialTourState(emptyDef);

  assert.equal(state.status, "idle");
  assert.equal(state.currentStepIndex, 0);
  assert.equal(state.totalSteps, 0);
  assert.equal(state.currentStep, null);
  assert.equal(state.isFirstStep, true);
  assert.equal(state.isLastStep, true);
});

test("nextTourStep advances step forward until completion", () => {
  let state = createInitialTourState(mockDefinition);

  // Step 0 -> Step 1
  state = nextTourStep(state);
  assert.equal(state.currentStepIndex, 1);
  assert.equal(state.status, "running");
  assert.equal(state.isFirstStep, false);
  assert.equal(state.isLastStep, false);
  assert.deepEqual(state.currentStep, mockSteps[1]);

  // Step 1 -> Step 2 (last step)
  state = nextTourStep(state);
  assert.equal(state.currentStepIndex, 2);
  assert.equal(state.status, "running");
  assert.equal(state.isFirstStep, false);
  assert.equal(state.isLastStep, true);
  assert.deepEqual(state.currentStep, mockSteps[2]);

  // Step 2 -> completion
  state = nextTourStep(state);
  assert.equal(state.status, "completed");
  assert.equal(state.currentStep, null);

  // Advancing while completed does not mutate
  const completedState = nextTourStep(state);
  assert.equal(completedState.status, "completed");
});

test("prevTourStep moves step backward but does not go below step 0", () => {
  let state = createInitialTourState(mockDefinition);

  // At step 0, prev does nothing
  state = prevTourStep(state);
  assert.equal(state.currentStepIndex, 0);
  assert.equal(state.isFirstStep, true);

  // Advance to step 1
  state = nextTourStep(state);
  assert.equal(state.currentStepIndex, 1);

  // Go back to step 0
  state = prevTourStep(state);
  assert.equal(state.currentStepIndex, 0);
  assert.equal(state.isFirstStep, true);
  assert.deepEqual(state.currentStep, mockSteps[0]);

  // If status is not running, prevTourStep leaves it unchanged
  const skippedState = skipTour(state);
  assert.equal(prevTourStep(skippedState).status, "skipped");
});

test("skipTour marks state as skipped and clears currentStep", () => {
  const initial = createInitialTourState(mockDefinition);
  const skipped = skipTour(initial);

  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.currentStep, null);
  assert.equal(skipped.tourId, "pos-counter");
  assert.equal(skipped.totalSteps, 3);
});

test("completeTour marks state as completed and clears currentStep", () => {
  const initial = createInitialTourState(mockDefinition);
  const completed = completeTour(initial);

  assert.equal(completed.status, "completed");
  assert.equal(completed.currentStep, null);
});

test("progressPercentage computes correct completion percentage", () => {
  const initial = createInitialTourState(mockDefinition); // 3 steps, step index 0
  assert.equal(progressPercentage(initial), 33); // Math.round((1/3) * 100)

  const step2 = nextTourStep(initial); // step index 1
  assert.equal(progressPercentage(step2), 67); // Math.round((2/3) * 100)

  const step3 = nextTourStep(step2); // step index 2
  assert.equal(progressPercentage(step3), 100);

  const completed = completeTour(step2);
  assert.equal(progressPercentage(completed), 100);

  const emptyTour = createInitialTourState({ id: "e", title: "E", steps: [] });
  assert.equal(progressPercentage(emptyTour), 0);
});

test("getTourStorageKey constructs clean tenant/user/tour scoped key", () => {
  const key = getTourStorageKey("tenant-alpha", "user-123", "pos-counter");
  assert.equal(key, "farmaxia_tour_tenant-alpha_user-123_pos-counter");

  // Handles whitespace trimming
  const trimmedKey = getTourStorageKey(" tenant-alpha ", " user-123 ", " pos-counter ");
  assert.equal(trimmedKey, "farmaxia_tour_tenant-alpha_user-123_pos-counter");
});

test("persistence functions work with Record<string, string>", () => {
  const mockStorage: Record<string, string> = {};
  const tenant = "t1";
  const user = "u1";
  const tour = "pos-counter";

  assert.equal(isTourCompleted(mockStorage, tenant, user, tour), false);

  markTourCompleted(mockStorage, tenant, user, tour);
  assert.equal(isTourCompleted(mockStorage, tenant, user, tour), true);

  resetTourProgress(mockStorage, tenant, user, tour);
  assert.equal(isTourCompleted(mockStorage, tenant, user, tour), false);
});

test("persistence functions work with Storage API interface", () => {
  const store = new Map<string, string>();
  const mockStorageApi: TourStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  const tenant = "t1";
  const user = "u2";
  const tour = "inventory-overview";

  assert.equal(isTourCompleted(mockStorageApi, tenant, user, tour), false);

  markTourCompleted(mockStorageApi, tenant, user, tour);
  assert.equal(isTourCompleted(mockStorageApi, tenant, user, tour), true);

  resetTourProgress(mockStorageApi, tenant, user, tour);
  assert.equal(isTourCompleted(mockStorageApi, tenant, user, tour), false);
});

test("persistence functions safely handle null or undefined storage", () => {
  const tenant = "t1";
  const user = "u1";
  const tour = "pos-counter";

  assert.equal(isTourCompleted(null, tenant, user, tour), false);
  assert.equal(isTourCompleted(undefined, tenant, user, tour), false);

  // Must not throw
  assert.doesNotThrow(() => {
    markTourCompleted(null, tenant, user, tour);
    markTourCompleted(undefined, tenant, user, tour);
    resetTourProgress(null, tenant, user, tour);
    resetTourProgress(undefined, tenant, user, tour);
  });
});

test("persistence functions safely handle throwing storage (e.g. private browsing)", () => {
  const throwingStorage: TourStorage = {
    getItem: () => {
      throw new Error("QuotaExceeded or SecurityError in private window");
    },
    setItem: () => {
      throw new Error("Storage blocked");
    },
    removeItem: () => {
      throw new Error("Storage blocked");
    },
  };

  const tenant = "t1";
  const user = "u1";
  const tour = "pos-counter";

  assert.doesNotThrow(() => {
    const completed = isTourCompleted(throwingStorage, tenant, user, tour);
    assert.equal(completed, false);
  });

  assert.doesNotThrow(() => {
    markTourCompleted(throwingStorage, tenant, user, tour);
  });

  assert.doesNotThrow(() => {
    resetTourProgress(throwingStorage, tenant, user, tour);
  });
});
