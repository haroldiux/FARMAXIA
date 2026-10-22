"use client";

import React from "react";
import { useTour } from "./tour-context";

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 10;

/**
 * High-contrast SVG spotlight overlay that cuts out the active target element
 * and intercepts interactions outside the active walkthrough step.
 */
export function TourOverlay() {
  const { isRunning, targetRect } = useTour();

  if (!isRunning) {
    return null;
  }

  // Fallback for steps without a DOM anchor: simple semi-transparent backdrop
  if (!targetRect) {
    return (
      <div
        className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-[2px] pointer-events-auto"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        aria-hidden="true"
      />
    );
  }

  const x = Math.max(0, targetRect.left - SPOTLIGHT_PADDING);
  const y = Math.max(0, targetRect.top - SPOTLIGHT_PADDING);
  const width = targetRect.width + SPOTLIGHT_PADDING * 2;
  const height = targetRect.height + SPOTLIGHT_PADDING * 2;

  return (
    <div
      className="fixed inset-0 z-[9990] overflow-hidden pointer-events-auto"
      onClick={(e) => {
        // Intercept all outside clicks
        e.stopPropagation();
        e.preventDefault();
      }}
      aria-hidden="true"
    >
      <svg
        className="w-full h-full block"
        style={{
          width: "100vw",
          height: "100vh",
        }}
      >
        <defs>
          <mask id="farmaxia-tour-spotlight-mask">
            {/* Base white surface makes full canvas dark */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Cutout hole reveals target element underneath */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={SPOTLIGHT_RADIUS}
              ry={SPOTLIGHT_RADIUS}
              fill="black"
              style={{
                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
          </mask>
        </defs>

        {/* Shaded backdrop */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(10, 12, 18, 0.72)"
          mask="url(#farmaxia-tour-spotlight-mask)"
        />

        {/* Accent spotlight stroke and glow */}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={SPOTLIGHT_RADIUS}
          ry={SPOTLIGHT_RADIUS}
          fill="none"
          stroke="var(--ax-indigo, #6366f1)"
          strokeWidth="2.5"
          strokeDasharray="6 4"
          style={{
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            filter: "drop-shadow(0 0 8px rgba(99, 102, 241, 0.55))",
          }}
        />
      </svg>
    </div>
  );
}
