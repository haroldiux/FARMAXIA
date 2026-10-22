"use client";

import React, { useEffect } from "react";
import { useSandbox } from "./sandbox-context";
import { NavIcon, type NavIconName } from "../nav-icon";

/**
 * Modal dialogue for choosing a role-based interactive training track.
 */
export function RoleTrainingModal() {
  const { isModalOpen, closeModal, availableTracks, startTraining } = useSandbox();

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!isModalOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-training-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={closeModal}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 text-slate-900 dark:text-slate-100 relative my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 mb-1">
              Modo Entrenamiento Interactivo
            </div>
            <h2 id="role-training-title" className="text-xl font-bold tracking-tight">
              Elige tu rol para iniciar la práctica guiada
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Aprende ejecutando flujos reales paso a paso con datos aislados en memoria.
            </p>
          </div>

          <button
            type="button"
            onClick={closeModal}
            aria-label="Cerrar modal"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
          >
            <NavIcon name="close" />
          </button>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-5">
          {availableTracks.map((track) => (
            <div
              key={track.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/60 dark:bg-slate-800/40 p-4 flex flex-col justify-between transition-all hover:shadow-md group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {track.title}
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    ~{track.estimatedDurationMinutes} min
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                  {track.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {track.steps.length} pasos prácticos
                </span>
                <button
                  type="button"
                  onClick={() => startTraining(track.roleCode)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
                >
                  Comenzar práctica →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Teardown Security Note */}
        <div className="mt-5 p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
          <span className="text-base">🛡️</span>
          <span>
            <strong>Aislamiento total garantizado:</strong> Las operaciones simuladas nunca tocan la base de datos de producción y se purgan por completo al salir.
          </span>
        </div>
      </div>
    </div>
  );
}
