"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type TourDefinition,
  type TourState,
  type TourStep,
  createInitialTourState,
  nextTourStep,
  prevTourStep,
  skipTour,
  completeTour,
  progressPercentage,
  isTourCompleted,
  markTourCompleted,
  resetTourProgress,
  getBrowserStorage,
} from "../../lib/tours";
import {
  type DOMRectLike,
  calculateTargetRect,
} from "./tour-position";
import { TourOverlay } from "./tour-overlay";
import { TourCard } from "./tour-card";

export interface TourContextValue {
  activeTour: TourDefinition | null;
  state: TourState | null;
  targetRect: DOMRectLike | null;
  isRunning: boolean;
  currentStep: TourStep | null;
  progress: number;
  startTour: (definition: TourDefinition, force?: boolean) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  complete: () => void;
  resetTour: (tourId: string) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export interface TourProviderProps {
  children: ReactNode;
  tenantId?: string;
  userId?: string;
}

/**
 * Provider maintaining active tour walkthrough state, element highlighting,
 * smooth scrolling, and keyboard shortcuts.
 */
export function TourProvider({
  children,
  tenantId = "default",
  userId = "default",
}: TourProviderProps) {
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null);
  const [state, setState] = useState<TourState | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRectLike | null>(null);

  const isRunning = Boolean(activeTour && state && state.status === "running");
  const currentStep = isRunning && state ? state.currentStep : null;
  const progress = state ? progressPercentage(state) : 0;

  const startTour = useCallback(
    (definition: TourDefinition, force: boolean = false) => {
      const storage = getBrowserStorage();
      if (!force && isTourCompleted(storage, tenantId, userId, definition.id)) {
        return;
      }
      const initial = createInitialTourState(definition);
      setActiveTour(definition);
      setState(initial);
    },
    [tenantId, userId],
  );

  const complete = useCallback(() => {
    if (!state || !activeTour) return;
    const completed = completeTour(state);
    setState(completed);
    markTourCompleted(getBrowserStorage(), tenantId, userId, activeTour.id);
    setActiveTour(null);
  }, [state, activeTour, tenantId, userId]);

  const next = useCallback(() => {
    if (!state || !activeTour) return;

    if (state.isLastStep) {
      complete();
      return;
    }

    const nextState = nextTourStep(state);
    setState(nextState);
  }, [state, activeTour, complete]);

  const prev = useCallback(() => {
    if (!state || !activeTour) return;
    const prevState = prevTourStep(state);
    setState(prevState);
  }, [state, activeTour]);

  const skip = useCallback(() => {
    if (!state || !activeTour) return;
    const skipped = skipTour(state);
    setState(skipped);
    setActiveTour(null);
  }, [state, activeTour]);

  const resetTour = useCallback(
    (tourId: string) => {
      resetTourProgress(getBrowserStorage(), tenantId, userId, tourId);
    },
    [tenantId, userId],
  );

  // Synchronize target bounding box and auto-scroll element into view
  useEffect(() => {
    if (!isRunning || !currentStep) {
      setTargetRect(null);
      return;
    }

    let isDisposed = false;

    const findAndUpdateTarget = () => {
      if (isDisposed) return;
      const element = document.querySelector(currentStep.targetSelector);

      if (!element) {
        setTargetRect(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      const isVisible =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;

      if (!isVisible) {
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }

      setTargetRect(calculateTargetRect(element));
    };

    // Immediate attempt
    findAndUpdateTarget();

    // Secondary attempt in case element takes a frame to render/animate
    const rafId = requestAnimationFrame(findAndUpdateTarget);

    const handleUpdate = () => {
      const element = document.querySelector(currentStep.targetSelector);
      setTargetRect(calculateTargetRect(element));
    };

    window.addEventListener("resize", handleUpdate, { passive: true });
    window.addEventListener("scroll", handleUpdate, { passive: true });

    let observer: ResizeObserver | null = null;
    const currentEl = document.querySelector(currentStep.targetSelector);
    if (currentEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(handleUpdate);
      observer.observe(currentEl);
    }

    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [isRunning, currentStep]);

  // Keyboard navigation
  useEffect(() => {
    if (!isRunning) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRunning, next, prev, skip]);

  const contextValue = useMemo<TourContextValue>(
    () => ({
      activeTour,
      state,
      targetRect,
      isRunning,
      currentStep,
      progress,
      startTour,
      next,
      prev,
      skip,
      complete,
      resetTour,
    }),
    [
      activeTour,
      state,
      targetRect,
      isRunning,
      currentStep,
      progress,
      startTour,
      next,
      prev,
      skip,
      complete,
      resetTour,
    ],
  );

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      <TourOverlay />
      <TourCard />
    </TourContext.Provider>
  );
}

/**
 * Access the active tour context from anywhere in the application tree.
 */
export function useTour(): TourContextValue {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}
