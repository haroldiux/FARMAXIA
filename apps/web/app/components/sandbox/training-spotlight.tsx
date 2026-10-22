"use client";

import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import { stepMatchesPath } from "../../lib/tours/role-tracks.ts";
import {
  calculateTargetRect,
  rectsEqual,
  type DOMRectLike,
} from "../tours/tour-position.ts";
import { useSandbox } from "./sandbox-context";

const RING_PADDING = 6;
const POLL_INTERVAL_MS = 500;

/**
 * Non-blocking highlight of the current training step's target element. Unlike the page tour
 * overlay it never dims the screen or captures clicks, so the learner can perform the action.
 */
export function TrainingSpotlight() {
  const { isSandboxActive, currentStep } = useSandbox();
  const pathname = usePathname();
  const [rect, setRect] = useState<DOMRectLike | null>(null);

  const selector = currentStep?.targetSelector ?? null;
  const onRoute = Boolean(currentStep && stepMatchesPath(currentStep, pathname));

  useEffect(() => {
    if (!isSandboxActive || !selector || !onRoute) {
      setRect(null);
      return;
    }
    let scrolled = false;
    const update = () => {
      const element = document.querySelector(selector);
      if (element && !scrolled) {
        scrolled = true;
        element.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const next = calculateTargetRect(element);
      setRect((previous) => (rectsEqual(previous, next) ? previous : next));
    };
    update();
    // The target may mount after the data loads, and it moves with layout changes.
    const timer = window.setInterval(update, POLL_INTERVAL_MS);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isSandboxActive, selector, onRoute]);

  if (!rect) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="ax-training-spotlight"
      style={{
        top: rect.top - RING_PADDING,
        left: rect.left - RING_PADDING,
        width: rect.width + RING_PADDING * 2,
        height: rect.height + RING_PADDING * 2,
      }}
    />
  );
}
