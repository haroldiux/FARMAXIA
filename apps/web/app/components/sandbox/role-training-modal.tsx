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
      className="ax-training-backdrop"
      onClick={closeModal}
    >
      <div
        className="ax-training-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ax-training-modal-header">
          <div>
            <div className="ax-training-eyebrow">
              Modo Entrenamiento Interactivo
            </div>
            <h2 id="role-training-title" className="ax-training-modal-title">
              Elige tu rol para iniciar la práctica guiada
            </h2>
            <p className="ax-training-modal-subtitle">
              Aprende ejecutando flujos reales paso a paso con datos aislados en memoria.
            </p>
          </div>

          <button
            type="button"
            onClick={closeModal}
            aria-label="Cerrar modal"
            className="ax-training-close"
          >
            <NavIcon name="close" />
          </button>
        </div>

        {/* Roles Grid */}
        {availableTracks.length === 0 ? (
          <p className="ax-training-modal-subtitle">
            Tu rol no tiene prácticas disponibles: ninguna ruta de entrenamiento coincide con tus permisos actuales.
          </p>
        ) : null}
        <div className="ax-training-grid">
          {availableTracks.map((track) => (
            <div
              key={track.id}
              className="ax-training-role"
            >
              <div>
                <div className="ax-training-role-head">
                  <span className="ax-training-role-title">
                    {track.title}
                  </span>
                  <span className="ax-training-duration">
                    ~{track.estimatedDurationMinutes} min
                  </span>
                </div>

                <p className="ax-training-role-desc">
                  {track.description}
                </p>
              </div>

              <div className="ax-training-role-foot">
                <span className="ax-training-role-steps">
                  {track.steps.length} pasos prácticos
                </span>
                <button
                  type="button"
                  onClick={() => startTraining(track.roleCode)}
                  className="ax-training-start"
                >
                  Comenzar práctica →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Teardown Security Note */}
        <div className="ax-training-note">
          <span className="ax-training-note-icon">🛡️</span>
          <span>
            <strong>Aislamiento total garantizado:</strong> Las operaciones simuladas nunca tocan la base de datos de producción y se purgan por completo al salir.
          </span>
        </div>
      </div>
    </div>
  );
}
