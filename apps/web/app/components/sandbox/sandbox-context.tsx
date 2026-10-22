"use client";

import { usePathname, useRouter } from "next/navigation";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { purgeSandbox, setSandboxUserId } from "../../lib/sandbox/sandbox-store.ts";
import {
  exitSandboxSession,
  restoreSandboxSession,
  saveSandboxSession,
  startSandboxSession,
} from "../../lib/sandbox/sandbox-session.ts";
import {
  type RoleTrainingTrack,
  type TrainingStep,
  shouldNavigateToStep,
} from "../../lib/tours/role-tracks.ts";
import {
  INITIAL_TRAINING_DIALOG,
  trainingDialogReducer,
  type TrainingDialogState,
} from "../../lib/sandbox/training-dialog.ts";
import { getAvailableTracks } from "../../lib/tours/track-access.ts";

export interface SandboxContextValue {
  isSandboxActive: boolean;
  activeTrack: RoleTrainingTrack | null;
  currentStepIndex: number;
  currentStep: TrainingStep | null;
  isModalOpen: boolean;
  availableTracks: RoleTrainingTrack[];
  openModal: () => void;
  closeModal: () => void;
  startTraining: (roleCode: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  exitTraining: () => void;
  notifyAction: (actionType: string) => void;
  /** In-app dialogs replacing alert()/confirm(). */
  dialog: TrainingDialogState;
  requestExit: () => void;
  cancelExit: () => void;
  confirmExit: () => void;
  dismissCompletion: () => void;
}

const defaultContextValue: SandboxContextValue = {
  isSandboxActive: false,
  activeTrack: null,
  currentStepIndex: 0,
  currentStep: null,
  isModalOpen: false,
  availableTracks: [],
  openModal: () => {},
  closeModal: () => {},
  startTraining: () => {},
  nextStep: () => {},
  prevStep: () => {},
  exitTraining: () => {},
  notifyAction: () => {},
  dialog: INITIAL_TRAINING_DIALOG,
  requestExit: () => {},
  cancelExit: () => {},
  confirmExit: () => {},
  dismissCompletion: () => {},
};

const SandboxContext = createContext<SandboxContextValue | null>(null);

export interface SandboxProviderProps {
  children: ReactNode;
  /** Signed-in user id: simulated cash shifts and staff are assigned to this person. */
  userId?: string;
  /** Signed-in permissions: only tracks the user can fully complete are offered. */
  permissions?: readonly string[];
}

export function SandboxProvider({ children, userId, permissions }: SandboxProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isSandboxActive, setIsSandboxActive] = useState(false);
  const [activeTrack, setActiveTrack] = useState<RoleTrainingTrack | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dialog, dispatchDialog] = useReducer(trainingDialogReducer, INITIAL_TRAINING_DIALOG);
  // Furthest step reached. Revisiting an earlier step never auto-advances again.
  const maxReachedRef = useRef(0);

  // Until the permissions are known nothing is offered (never everything).
  const availableTracks = useMemo(() => getAvailableTracks(permissions ?? []), [permissions]);

  const currentStep = useMemo<TrainingStep | null>(() => {
    if (!activeTrack || !activeTrack.steps.length) return null;
    return activeTrack.steps[currentStepIndex] ?? null;
  }, [activeTrack, currentStepIndex]);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Must run before the restore effect below so reseeded data is assigned to the signed-in user.
  useEffect(() => {
    if (userId) setSandboxUserId(userId);
  }, [userId]);

  // Restore the track after a reload: the sessionStorage flag survives but React state does not.
  useEffect(() => {
    // Wait for the session: restoring early would exit a legitimate track.
    if (!permissions) return;
    const restored = restoreSandboxSession(window.sessionStorage, permissions);
    if (restored) {
      setActiveTrack(restored.track);
      setCurrentStepIndex(restored.stepIndex);
      maxReachedRef.current = restored.stepIndex;
      setIsSandboxActive(true);
    }
  }, [permissions]);

  // Keep the persisted step in sync while training is active.
  useEffect(() => {
    if (isSandboxActive && activeTrack) {
      saveSandboxSession(window.sessionStorage, {
        roleCode: activeTrack.roleCode,
        stepIndex: currentStepIndex,
      });
    }
  }, [isSandboxActive, activeTrack, currentStepIndex]);

  const exitTraining = useCallback(() => {
    if (typeof window !== "undefined") {
      exitSandboxSession(window.sessionStorage);
    } else {
      purgeSandbox();
    }
    setIsSandboxActive(false);
    setActiveTrack(null);
    setCurrentStepIndex(0);
    maxReachedRef.current = 0;
    setIsModalOpen(false);
    if (pathname !== "/dashboard") {
      router.push("/dashboard");
    }
  }, [pathname, router]);

  const startTraining = useCallback(
    (roleCode: string) => {
      if (!availableTracks.some((item) => item.roleCode === roleCode)) return;
      const track =
        typeof window !== "undefined" ? startSandboxSession(window.sessionStorage, roleCode) : null;
      if (!track) {
        return;
      }
      setActiveTrack(track);
      setCurrentStepIndex(0);
      maxReachedRef.current = 0;
      setIsSandboxActive(true);
      setIsModalOpen(false);

      const firstStep = track.steps[0]!;
      if (shouldNavigateToStep(firstStep, pathname)) {
        router.push(firstStep.path);
      }
    },
    [availableTracks, pathname, router],
  );

  const nextStep = useCallback(() => {
    if (!activeTrack) return;

    if (currentStepIndex >= activeTrack.steps.length - 1) {
      // Completed all steps in the track: celebrate in-app, then purge.
      dispatchDialog({ type: "finish", roleTitle: activeTrack.title });
      exitTraining();
      return;
    }

    const nextIndex = currentStepIndex + 1;
    maxReachedRef.current = Math.max(maxReachedRef.current, nextIndex);
    setCurrentStepIndex(nextIndex);
    const step = activeTrack.steps[nextIndex];
    if (step && shouldNavigateToStep(step, pathname)) {
      router.push(step.path);
    }
  }, [activeTrack, currentStepIndex, exitTraining, pathname, router]);

  const requestExit = useCallback(() => dispatchDialog({ type: "request_exit" }), []);
  const cancelExit = useCallback(() => dispatchDialog({ type: "cancel_exit" }), []);
  const dismissCompletion = useCallback(() => dispatchDialog({ type: "dismiss_completion" }), []);
  const confirmExit = useCallback(() => {
    dispatchDialog({ type: "cancel_exit" });
    exitTraining();
  }, [exitTraining]);

  const prevStep = useCallback(() => {
    if (!activeTrack || currentStepIndex <= 0) return;

    const prevIndex = currentStepIndex - 1;
    setCurrentStepIndex(prevIndex);
    const step = activeTrack.steps[prevIndex];
    if (step && shouldNavigateToStep(step, pathname)) {
      router.push(step.path);
    }
  }, [activeTrack, currentStepIndex, pathname, router]);

  const notifyAction = useCallback(
    (actionType: string) => {
      if (!isSandboxActive || !currentStep) return;
      if (currentStepIndex < maxReachedRef.current) return;

      if (currentStep.interactiveAction === actionType) {
        // Automatically advance to the next step when interactive condition is met
        setTimeout(() => {
          nextStep();
        }, 300);
      }
    },
    [isSandboxActive, currentStep, currentStepIndex, nextStep],
  );

  const contextValue = useMemo<SandboxContextValue>(
    () => ({
      isSandboxActive,
      activeTrack,
      currentStepIndex,
      currentStep,
      isModalOpen,
      availableTracks,
      openModal,
      closeModal,
      startTraining,
      nextStep,
      prevStep,
      exitTraining,
      notifyAction,
      dialog,
      requestExit,
      cancelExit,
      confirmExit,
      dismissCompletion,
    }),
    [
      isSandboxActive,
      activeTrack,
      currentStepIndex,
      currentStep,
      isModalOpen,
      availableTracks,
      openModal,
      closeModal,
      startTraining,
      nextStep,
      prevStep,
      exitTraining,
      notifyAction,
      dialog,
      requestExit,
      cancelExit,
      confirmExit,
      dismissCompletion,
    ],
  );

  return (
    <SandboxContext.Provider value={contextValue}>
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox(): SandboxContextValue {
  const context = useContext(SandboxContext);
  return context ?? defaultContextValue;
}
