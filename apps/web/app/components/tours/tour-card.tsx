"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTour } from "./tour-context";
import { calculatePopoverPosition, type Size2D } from "./tour-position";

const DEFAULT_CARD_SIZE: Size2D = {
  width: 360,
  height: 220,
};

/**
 * Floating Bento-styled tour tooltip card.
 * Displays step progress, title, description, and intuitive walkthrough actions.
 */
export function TourCard() {
  const {
    isRunning,
    state,
    currentStep,
    targetRect,
    progress,
    next,
    prev,
    skip,
  } = useTour();

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<Size2D>(DEFAULT_CARD_SIZE);

  // Update measured size whenever current step changes
  useEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize({ width: rect.width, height: rect.height });
    }
  }, [currentStep]);

  if (!isRunning || !currentStep || !state) {
    return null;
  }

  const position = calculatePopoverPosition(
    targetRect,
    cardSize,
    currentStep.placement ?? "bottom",
  );

  const stepNumber = state.currentStepIndex + 1;
  const totalSteps = state.totalSteps;
  const isFirstStep = state.isFirstStep;
  const isLastStep = state.isLastStep;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="farmaxia-tour-card-title"
      aria-describedby="farmaxia-tour-card-description"
      className="fixed z-[9995] w-[360px] max-w-[calc(100vw-32px)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl shadow-indigo-950/20 p-5 text-slate-900 dark:text-slate-100 transition-[top,left] duration-200 ease-out select-none"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {/* Header with step pill and dismiss button */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
            Paso {stepNumber} de {totalSteps}
          </span>
          {currentStep.badge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              {currentStep.badge}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={skip}
          aria-label="Cerrar tutorial"
          title="Cerrar tutorial (Esc)"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Title & Description */}
      <h3
        id="farmaxia-tour-card-title"
        className="text-base font-bold text-slate-900 dark:text-slate-50 tracking-tight"
      >
        {currentStep.title}
      </h3>
      <p
        id="farmaxia-tour-card-description"
        className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
      >
        {currentStep.description}
      </p>

      {/* Progress Bar */}
      <div className="mt-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-indigo-600 dark:bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Footer Actions */}
      <div className="mt-4 flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={skip}
          className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors focus:outline-none focus:underline"
        >
          Omitir
        </button>

        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <button
              type="button"
              onClick={prev}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Anterior
            </button>
          )}

          <button
            type="button"
            onClick={next}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
          >
            {isLastStep ? "Finalizar" : currentStep.actionLabel ?? "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
