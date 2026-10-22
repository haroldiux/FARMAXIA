import { isTourCompleted, markTourCompleted, type TourStorage } from "../tours.ts";

/** Where exiting or finishing training sends the user. */
export const TRAINING_EXIT_PATH = "/dashboard";

/**
 * Persist that the user has seen a tour. Called when a tour is completed AND when it is
 * skipped/dismissed: either way it must never auto-launch again (only the help button replays it).
 */
export function recordTourClosed(
  storage: TourStorage | null | undefined,
  tenantId: string,
  userId: string,
  tourId: string,
): void {
  markTourCompleted(storage, tenantId, userId, tourId);
}

/** A page tour auto-launches only if this user never completed or dismissed it. */
export function shouldAutoLaunchTour(
  storage: TourStorage | null | undefined,
  tenantId: string,
  userId: string,
  tourId: string,
): boolean {
  return !isTourCompleted(storage, tenantId, userId, tourId);
}

export interface AutoLaunchGate {
  wasTrainingActive: boolean;
  /** Paths where auto-launch stays blocked after training ended; cleared on the next navigation. */
  blockedPaths: readonly string[];
}

export const INITIAL_AUTO_LAUNCH_GATE: AutoLaunchGate = { wasTrainingActive: false, blockedPaths: [] };

/**
 * Decides whether a page tour may auto-launch right now. Blocked during training and, once training
 * ends, on the page where it ended plus the exit destination, until the user navigates elsewhere.
 */
export function stepAutoLaunchGate(
  gate: AutoLaunchGate,
  input: { trainingActive: boolean; pathname: string },
): { gate: AutoLaunchGate; allowed: boolean } {
  const { trainingActive, pathname } = input;
  if (trainingActive) {
    return { gate: { wasTrainingActive: true, blockedPaths: [] }, allowed: false };
  }
  let blockedPaths = gate.blockedPaths;
  if (gate.wasTrainingActive) {
    blockedPaths = [pathname, TRAINING_EXIT_PATH];
  }
  if (blockedPaths.length > 0 && !blockedPaths.includes(pathname)) {
    blockedPaths = [];
  }
  return {
    gate: { wasTrainingActive: false, blockedPaths },
    allowed: blockedPaths.length === 0,
  };
}
