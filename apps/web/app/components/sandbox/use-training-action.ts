"use client";

import { useEffect, useRef } from "react";
import type { TrainingAction } from "../../lib/tours/role-tracks.ts";
import { useSandbox } from "./sandbox-context.tsx";

/**
 * Reports a "look at this screen" training action once the page content is ready.
 * The report is delayed so the learner can read the highlighted area before the track advances.
 */
export function useTrainingViewAction(action: TrainingAction, ready: boolean, delayMs = 4000): void {
  const { notifyAction, currentStep } = useSandbox();
  const notifyRef = useRef(notifyAction);
  notifyRef.current = notifyAction;
  const isCurrent = currentStep?.interactiveAction === action;

  useEffect(() => {
    if (!ready || !isCurrent) return;
    const timer = setTimeout(() => notifyRef.current(action), delayMs);
    return () => clearTimeout(timer);
  }, [action, ready, isCurrent, delayMs]);
}
