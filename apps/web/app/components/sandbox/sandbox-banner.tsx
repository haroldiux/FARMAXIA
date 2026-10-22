"use client";

import React from "react";
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
    exitTraining,
  } = useSandbox();

  if (!isSandboxActive || !activeTrack || !currentStep) {
    return null;
  }

  const stepNumber = currentStepIndex + 1;
  const totalSteps = activeTrack.steps.length;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === totalSteps - 1;

  const handleExit = () => {
    const confirmed = window.confirm(
      "¿Deseas salir del modo entrenamiento?\nTodos los datos y movimientos de prueba simulados se borrarán por completo de la memoria.",
    );
    if (confirmed) {
      exitTraining();
    }
  };

  return (
    <aside
      role="status"
      aria-label="Modo entrenamiento activo"
      className="sticky top-0 z-[9980] w-full bg-amber-500/15 dark:bg-amber-950/70 border-b border-amber-500/40 text-amber-950 dark:text-amber-100 backdrop-blur-md px-4 py-2.5 transition-all shadow-sm"
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs sm:text-sm">
        {/* Left: Role Pill & Step Title */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider text-[11px] bg-amber-500 text-white shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Entrenamiento: {activeTrack.roleCode}
          </span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            Paso {stepNumber} de {totalSteps}: {currentStep.title}
          </span>
        </div>

        {/* Center: Action prompt guidance */}
        <div className="flex-1 md:px-4 text-xs font-medium text-amber-900 dark:text-amber-200/90 italic">
          👉 {currentStep.actionPrompt}
        </div>

        {/* Right: Step navigation & Exit purge button */}
        <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
          {!isFirst && (
            <button
              type="button"
              onClick={prevStep}
              className="px-2.5 py-1 rounded-md text-xs font-medium border border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-100 transition-colors"
            >
              Anterior
            </button>
          )}

          <button
            type="button"
            onClick={nextStep}
            className="px-3 py-1 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors"
          >
            {isLast ? "Finalizar" : "Siguiente"}
          </button>

          <button
            type="button"
            onClick={handleExit}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-100 hover:bg-red-200 dark:bg-red-950/60 dark:hover:bg-red-900/80 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800/80 transition-colors"
            title="Borra todos los datos de prueba y vuelve al inicio"
          >
            Salir y borrar datos
          </button>
        </div>
      </div>
    </aside>
  );
}
