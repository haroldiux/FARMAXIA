"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { confettiLifetimeMs, createConfettiPieces } from "../../lib/sandbox/confetti.ts";
import { useSandbox } from "./sandbox-context";

const CONFETTI_COUNT = 48;

/** Focus the primary button on open, trap Tab, close on Escape and restore focus on close. */
function useDialogBehavior(onEscape: () => void) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // The trigger may be gone (e.g. the banner unmounts on exit): then focus stays on the page.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);

  return { cardRef, primaryRef };
}

/** One-shot confetti burst. Pure CSS animations (transform/opacity only); unmounts when done. */
function ConfettiBurst() {
  const pieces = useMemo(() => createConfettiPieces(CONFETTI_COUNT, Date.now() & 0xffffff), []);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), confettiLifetimeMs(pieces) + 100);
    return () => window.clearTimeout(timer);
  }, [pieces]);

  if (done) return null;

  return (
    <div className="ax-confetti-layer" aria-hidden="true">
      {pieces.map((piece) => {
        const radians = (piece.angle * Math.PI) / 180;
        const style = {
          "--cf-dx": `${Math.round(Math.cos(radians) * piece.distance)}px`,
          "--cf-dy": `${Math.round(Math.sin(radians) * piece.distance)}px`,
          "--cf-fall": `${piece.fall}px`,
          "--cf-rot": `${Math.round(piece.rotation)}deg`,
          "--cf-color": piece.color,
          width: `${piece.size}px`,
          height: `${Math.round(piece.size * 0.55)}px`,
          animationDelay: `${piece.delayMs}ms`,
          animationDuration: `${piece.durationMs}ms`,
        } as React.CSSProperties;
        return <span key={piece.id} className="ax-confetti-piece" style={style} />;
      })}
    </div>
  );
}

interface DialogFrameProps {
  role: "dialog" | "alertdialog";
  titleId: string;
  descriptionId: string;
  onEscape: () => void;
  celebrate?: boolean;
  children: (primaryRef: React.RefObject<HTMLButtonElement | null>) => ReactNode;
}

function DialogFrame({ role, titleId, descriptionId, onEscape, celebrate, children }: DialogFrameProps) {
  const { cardRef, primaryRef } = useDialogBehavior(onEscape);
  // Reduced motion: no confetti at all (checked once on mount).
  const [showConfetti] = useState(
    () => Boolean(celebrate) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  return (
    <div className="ax-training-backdrop ax-training-dialog-backdrop">
      {showConfetti ? <ConfettiBurst /> : null}
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="ax-training-modal ax-training-dialog"
      >
        {children(primaryRef)}
      </div>
    </div>
  );
}

/** In-app replacements for the alert()/confirm() of the training flow. */
export function TrainingDialogs() {
  const { dialog, cancelExit, confirmExit, dismissCompletion } = useSandbox();

  if (dialog.completion) {
    return (
      <DialogFrame
        key="completion"
        role="alertdialog"
        titleId="training-complete-title"
        descriptionId="training-complete-text"
        onEscape={dismissCompletion}
        celebrate
      >
        {(primaryRef) => (
          <>
            <div className="ax-training-eyebrow">Modo Entrenamiento</div>
            <h2 id="training-complete-title" className="ax-training-modal-title">
              ¡Entrenamiento completado!
            </h2>
            <p id="training-complete-text" className="ax-training-dialog-text">
              Terminaste el entrenamiento de {dialog.completion!.roleTitle}. Todos los datos de prueba han sido
              eliminados de la sesión.
            </p>
            <div className="ax-training-dialog-actions">
              <button ref={primaryRef} type="button" className="ax-training-start" onClick={dismissCompletion}>
                Entendido
              </button>
            </div>
          </>
        )}
      </DialogFrame>
    );
  }

  if (dialog.exitConfirmOpen) {
    return (
      <DialogFrame
        key="exit"
        role="alertdialog"
        titleId="training-exit-title"
        descriptionId="training-exit-text"
        onEscape={cancelExit}
      >
        {(primaryRef) => (
          <>
            <h2 id="training-exit-title" className="ax-training-modal-title">
              ¿Deseas salir del modo entrenamiento?
            </h2>
            <p id="training-exit-text" className="ax-training-dialog-text">
              Todos los datos y movimientos de prueba simulados se borrarán por completo de la memoria.
            </p>
            <div className="ax-training-dialog-actions">
              <button ref={primaryRef} type="button" className="ax-training-start is-quiet" onClick={cancelExit}>
                Cancelar
              </button>
              <button type="button" className="ax-training-start is-danger" onClick={confirmExit}>
                Salir y borrar datos
              </button>
            </div>
          </>
        )}
      </DialogFrame>
    );
  }

  return null;
}
