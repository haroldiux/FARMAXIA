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
      className="ax-tour-card"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {/* Header with step pill and dismiss button */}
      <div className="ax-tour-card-head">
        <div className="ax-tour-card-meta">
          <span className="ax-tour-step-pill">
            Paso {stepNumber} de {totalSteps}
          </span>
          {currentStep.badge && (
            <span className="ax-tour-badge">
              {currentStep.badge}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={skip}
          aria-label="Cerrar tutorial"
          title="Cerrar tutorial (Esc)"
          className="ax-tour-close"
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
        className="ax-tour-title"
      >
        {currentStep.title}
      </h3>
      <p
        id="farmaxia-tour-card-description"
        className="ax-tour-description"
      >
        {currentStep.description}
      </p>

      {/* Progress Bar */}
      <div className="ax-tour-progress">
        <div
          className="ax-tour-progress-bar"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Footer Actions */}
      <div className="ax-tour-footer">
        <button
          type="button"
          onClick={skip}
          className="ax-tour-skip"
        >
          Omitir
        </button>

        <div className="ax-tour-actions">
          {!isFirstStep && (
            <button
              type="button"
              onClick={prev}
              className="ax-tour-btn"
            >
              Anterior
            </button>
          )}

          <button
            type="button"
            onClick={next}
            className="ax-tour-btn is-primary"
          >
            {isLastStep ? "Finalizar" : currentStep.actionLabel ?? "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
