"use client";

import { usePathname, useRouter } from "next/navigation";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { purgeSandbox } from "../../lib/sandbox/sandbox-store.ts";
import {
  type RoleTrainingTrack,
  type TrainingStep,
  getTrainingTrackForRole,
  allRoleTracks,
} from "../../lib/tours/role-tracks.ts";

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
}

const defaultContextValue: SandboxContextValue = {
  isSandboxActive: false,
  activeTrack: null,
  currentStepIndex: 0,
  currentStep: null,
  isModalOpen: false,
  availableTracks: allRoleTracks,
  openModal: () => {},
  closeModal: () => {},
  startTraining: () => {},
  nextStep: () => {},
  prevStep: () => {},
  exitTraining: () => {},
  notifyAction: () => {},
};

const SandboxContext = createContext<SandboxContextValue | null>(null);

export interface SandboxProviderProps {
  children: ReactNode;
}

export function SandboxProvider({ children }: SandboxProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isSandboxActive, setIsSandboxActive] = useState(false);
  const [activeTrack, setActiveTrack] = useState<RoleTrainingTrack | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const exitTraining = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("farmaxia.sandbox_active");
    }
    purgeSandbox();
    setIsSandboxActive(false);
    setActiveTrack(null);
    setCurrentStepIndex(0);
    setIsModalOpen(false);
    if (pathname !== "/dashboard") {
      router.push("/dashboard");
    }
  }, [pathname, router]);

  const startTraining = useCallback(
    (roleCode: string) => {
      purgeSandbox();
      const track = getTrainingTrackForRole(roleCode);
      if (!track || !track.steps.length) {
        return;
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("farmaxia.sandbox_active", "true");
      }
      setActiveTrack(track);
      setCurrentStepIndex(0);
      setIsSandboxActive(true);
      setIsModalOpen(false);

      const firstStep = track.steps[0]!;
      if (pathname !== firstStep.path) {
        router.push(firstStep.path);
      }
    },
    [pathname, router],
  );

  const nextStep = useCallback(() => {
    if (!activeTrack) return;

    if (currentStepIndex >= activeTrack.steps.length - 1) {
      // Completed all steps in the track!
      alert(
        `¡Entrenamiento de ${activeTrack.title} finalizado!\nTodos los datos de prueba han sido eliminados de la sesión.`,
      );
      exitTraining();
      return;
    }

    const nextIndex = currentStepIndex + 1;
    setCurrentStepIndex(nextIndex);
    const step = activeTrack.steps[nextIndex];
    if (step && pathname !== step.path) {
      router.push(step.path);
    }
  }, [activeTrack, currentStepIndex, exitTraining, pathname, router]);

  const prevStep = useCallback(() => {
    if (!activeTrack || currentStepIndex <= 0) return;

    const prevIndex = currentStepIndex - 1;
    setCurrentStepIndex(prevIndex);
    const step = activeTrack.steps[prevIndex];
    if (step && pathname !== step.path) {
      router.push(step.path);
    }
  }, [activeTrack, currentStepIndex, pathname, router]);

  const notifyAction = useCallback(
    (actionType: string) => {
      if (!isSandboxActive || !currentStep) return;

      if (currentStep.interactiveAction === actionType) {
        // Automatically advance to the next step when interactive condition is met
        setTimeout(() => {
          nextStep();
        }, 300);
      }
    },
    [isSandboxActive, currentStep, nextStep],
  );

  const contextValue = useMemo<SandboxContextValue>(
    () => ({
      isSandboxActive,
      activeTrack,
      currentStepIndex,
      currentStep,
      isModalOpen,
      availableTracks: allRoleTracks,
      openModal,
      closeModal,
      startTraining,
      nextStep,
      prevStep,
      exitTraining,
      notifyAction,
    }),
    [
      isSandboxActive,
      activeTrack,
      currentStepIndex,
      currentStep,
      isModalOpen,
      openModal,
      closeModal,
      startTraining,
      nextStep,
      prevStep,
      exitTraining,
      notifyAction,
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
