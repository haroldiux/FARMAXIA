/**
 * FARMAXIA - Interactive Product Tours & Guided Walkthroughs Core Engine
 * State machine and client-side persistence utilities.
 */

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export type TourStatus = "idle" | "running" | "completed" | "skipped";

export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  placement?: TourPlacement;
  badge?: string;
  actionLabel?: string;
  route?: string;
}

export interface TourDefinition {
  id: string;
  title: string;
  description?: string;
  steps: TourStep[];
  module?: string;
}

export interface TourState {
  tourId: string | null;
  status: TourStatus;
  currentStepIndex: number;
  totalSteps: number;
  currentStep: TourStep | null;
  steps: TourStep[];
  isFirstStep: boolean;
  isLastStep: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type TourStorage = StorageLike | Record<string, string>;

/**
 * Creates the initial TourState for a given tour definition.
 */
export function createInitialTourState(definition: TourDefinition): TourState {
  const totalSteps = definition.steps.length;

  if (totalSteps === 0) {
    return {
      tourId: definition.id,
      status: "idle",
      currentStepIndex: 0,
      totalSteps: 0,
      currentStep: null,
      steps: [],
      isFirstStep: true,
      isLastStep: true,
    };
  }

  return {
    tourId: definition.id,
    status: "running",
    currentStepIndex: 0,
    totalSteps,
    currentStep: definition.steps[0] ?? null,
    steps: [...definition.steps],
    isFirstStep: true,
    isLastStep: totalSteps <= 1,
  };
}

/**
 * Advances the active tour to the next step, or transitions to completed if at the end.
 */
export function nextTourStep(state: TourState): TourState {
  if (state.status !== "running" || state.totalSteps === 0) {
    return state;
  }

  const nextIndex = state.currentStepIndex + 1;
  if (nextIndex >= state.totalSteps) {
    return {
      ...state,
      status: "completed",
      currentStep: null,
    };
  }

  return {
    ...state,
    currentStepIndex: nextIndex,
    currentStep: state.steps[nextIndex] ?? null,
    isFirstStep: false,
    isLastStep: nextIndex === state.totalSteps - 1,
  };
}

/**
 * Navigates to the previous step in an active tour.
 */
export function prevTourStep(state: TourState): TourState {
  if (state.status !== "running" || state.totalSteps === 0) {
    return state;
  }

  if (state.currentStepIndex <= 0) {
    return state;
  }

  const prevIndex = state.currentStepIndex - 1;
  return {
    ...state,
    currentStepIndex: prevIndex,
    currentStep: state.steps[prevIndex] ?? null,
    isFirstStep: prevIndex === 0,
    isLastStep: prevIndex === state.totalSteps - 1,
  };
}

/**
 * Skips/dismisses the active tour.
 */
export function skipTour(state: TourState): TourState {
  return {
    ...state,
    status: "skipped",
    currentStep: null,
  };
}

/**
 * Marks the active tour as completed.
 */
export function completeTour(state: TourState): TourState {
  return {
    ...state,
    status: "completed",
    currentStep: null,
  };
}

/**
 * Calculates current progress percentage from 0 to 100.
 */
export function progressPercentage(state: TourState): number {
  if (state.totalSteps === 0) {
    return 0;
  }

  if (state.status === "completed") {
    return 100;
  }

  const currentStepNumber = state.currentStepIndex + 1;
  const raw = (currentStepNumber / state.totalSteps) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Computes a scoped storage key for tracking tour completion per tenant and user.
 */
export function getTourStorageKey(tenantId: string, userId: string, tourId: string): string {
  const cleanTenant = (tenantId || "default").trim();
  const cleanUser = (userId || "anonymous").trim();
  const cleanTour = (tourId || "general").trim();
  return `farmaxia_tour_${cleanTenant}_${cleanUser}_${cleanTour}`;
}

function readFromStorage(storage: TourStorage | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    if (typeof (storage as StorageLike).getItem === "function") {
      return (storage as StorageLike).getItem(key);
    }
    return (storage as Record<string, string>)[key] ?? null;
  } catch {
    return null;
  }
}

function writeToStorage(storage: TourStorage | null | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    if (typeof (storage as StorageLike).setItem === "function") {
      (storage as StorageLike).setItem(key, value);
    } else {
      (storage as Record<string, string>)[key] = value;
    }
  } catch {
    // Gracefully ignore storage quota or permission errors
  }
}

function removeFromStorage(storage: TourStorage | null | undefined, key: string): void {
  if (!storage) return;
  try {
    if (typeof (storage as StorageLike).removeItem === "function") {
      (storage as StorageLike).removeItem(key);
    } else {
      delete (storage as Record<string, string>)[key];
    }
  } catch {
    // Gracefully ignore storage access errors
  }
}

/**
 * Checks whether the given tour has been marked completed in storage.
 */
export function isTourCompleted(
  storage: TourStorage | null | undefined,
  tenantId: string,
  userId: string,
  tourId: string,
): boolean {
  const key = getTourStorageKey(tenantId, userId, tourId);
  const value = readFromStorage(storage, key);
  return Boolean(value);
}

/**
 * Records completion of a tour in storage.
 */
export function markTourCompleted(
  storage: TourStorage | null | undefined,
  tenantId: string,
  userId: string,
  tourId: string,
): void {
  const key = getTourStorageKey(tenantId, userId, tourId);
  writeToStorage(storage, key, new Date().toISOString());
}

/**
 * Clears completion record of a tour in storage (enables replay).
 */
export function resetTourProgress(
  storage: TourStorage | null | undefined,
  tenantId: string,
  userId: string,
  tourId: string,
): void {
  const key = getTourStorageKey(tenantId, userId, tourId);
  removeFromStorage(storage, key);
}

/**
 * Safe accessor for window.localStorage that returns null in SSR or if restricted.
 */
export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
