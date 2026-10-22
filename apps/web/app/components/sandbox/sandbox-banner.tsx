"use client";

import React, { useEffect, useRef } from "react";
import { useSandbox } from "./sandbox-context";

/**
 * Top alert banner indicating that Interactive Role Training / Sandbox mode is active.
 * Shows current role, instructional step prompt, and zero-trace exit action.
 */
export function SandboxBanner() {
  const {
    isSandboxActive,
    activeTrack,
    currentStepIndex,
    currentStep,
    nextStep,
    prevStep,
    requestExit,
  } = useSandbox();

  const bannerRef = useRef<HTMLElement | null>(null);
  const isVisible = Boolean(isSandboxActive && activeTrack && currentStep);

  // Publish the banner height so the shell (desktop) and the sticky topbar (mobile) can offset it.
  useEffect(() => {
    const root = document.documentElement;
    const banner = bannerRef.current;
    if (!isVisible || !banner) {
      root.style.removeProperty("--ax-training-banner-h");
      return;
    }
    const publish = () => root.style.setProperty("--ax-training-banner-h", `${banner.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(banner);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--ax-training-banner-h");
    };
  }, [isVisible]);

  if (!isSandboxActive || !activeTrack || !currentStep) {
    return null;
  }

  const stepNumber = currentStepIndex + 1;
  const totalSteps = activeTrack.steps.length;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === totalSteps - 1;

  return (
    <aside
      ref={bannerRef}
      role="status"
      aria-label="Modo entrenamiento activo"
      className="ax-training-banner"
    >
      <div className="ax-training-banner-inner">
        {/* Left: Role Pill & Step Title */}
        <div className="ax-training-banner-title">
          <span className="ax-training-pill">
            <span className="ax-training-pill-dot" />
            Entrenamiento: {activeTrack.roleCode}
          </span>
          <span className="ax-training-step">
            Paso {stepNumber} de {totalSteps}: {currentStep.title}
          </span>
        </div>

        {/* Center: Action prompt guidance */}
        <div className="ax-training-prompt">
          👉 {currentStep.actionPrompt}
        </div>

        {/* Right: Step navigation & Exit purge button */}
        <div className="ax-training-actions">
          {!isFirst && (
            <button
              type="button"
              onClick={prevStep}
              className="ax-training-btn"
            >
              Anterior
            </button>
          )}

          <button
            type="button"
            onClick={nextStep}
            className="ax-training-btn is-primary"
          >
            {isLast ? "Finalizar" : "Siguiente"}
          </button>

          <button
            type="button"
            onClick={requestExit}
            className="ax-training-btn is-danger"
            title="Borra todos los datos de prueba y vuelve al inicio"
          >
            Salir y borrar datos
          </button>
        </div>
      </div>
    </aside>
  );
}
