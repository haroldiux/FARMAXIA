import type { TourPlacement } from "../../lib/tours.ts";

export interface DOMRectLike {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface PopoverPositionResult {
  top: number;
  left: number;
  actualPlacement: TourPlacement;
}

export const POPOVER_GAP = 12;
export const VIEWPORT_MARGIN = 16;

/**
 * Calculates a serializable bounding rect for an Element.
 */
export function calculateTargetRect(element: Element | null): DOMRectLike | null {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    right: rect.right,
  };
}

/**
 * Calculates optimal top/left coordinates for a floating tour popover,
 * flipping placement if clipped and clamping to viewport boundaries.
 */
export function calculatePopoverPosition(
  targetRect: DOMRectLike | null,
  popoverSize: Size2D,
  placement: TourPlacement = "bottom",
  viewportSize?: Size2D,
): PopoverPositionResult {
  const viewport = viewportSize ?? {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  };

  // When no target element is present, center in the viewport modal-style
  if (!targetRect) {
    const top = Math.max(VIEWPORT_MARGIN, Math.round((viewport.height - popoverSize.height) / 2));
    const left = Math.max(VIEWPORT_MARGIN, Math.round((viewport.width - popoverSize.width) / 2));
    return {
      top,
      left,
      actualPlacement: placement === "auto" ? "bottom" : placement,
    };
  }

  const spaceAbove = targetRect.top;
  const spaceBelow = viewport.height - targetRect.bottom;
  const spaceLeft = targetRect.left;
  const spaceRight = viewport.width - targetRect.right;

  let actualPlacement: TourPlacement = placement;

  if (placement === "auto") {
    if (spaceBelow >= spaceAbove && spaceBelow >= popoverSize.height + POPOVER_GAP) {
      actualPlacement = "bottom";
    } else if (spaceAbove >= popoverSize.height + POPOVER_GAP) {
      actualPlacement = "top";
    } else if (spaceBelow >= spaceAbove) {
      actualPlacement = "bottom";
    } else {
      actualPlacement = "top";
    }
  } else if (placement === "top") {
    if (spaceAbove < popoverSize.height + POPOVER_GAP + VIEWPORT_MARGIN && spaceBelow > spaceAbove) {
      actualPlacement = "bottom";
    } else {
      actualPlacement = "top";
    }
  } else if (placement === "bottom") {
    if (spaceBelow < popoverSize.height + POPOVER_GAP + VIEWPORT_MARGIN && spaceAbove > spaceBelow) {
      actualPlacement = "top";
    } else {
      actualPlacement = "bottom";
    }
  } else if (placement === "left") {
    if (spaceLeft < popoverSize.width + POPOVER_GAP + VIEWPORT_MARGIN && spaceRight > spaceLeft) {
      actualPlacement = "right";
    } else {
      actualPlacement = "left";
    }
  } else if (placement === "right") {
    if (spaceRight < popoverSize.width + POPOVER_GAP + VIEWPORT_MARGIN && spaceLeft > spaceRight) {
      actualPlacement = "left";
    } else {
      actualPlacement = "right";
    }
  }

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  let rawTop = 0;
  let rawLeft = 0;

  switch (actualPlacement) {
    case "top":
      rawTop = targetRect.top - popoverSize.height - POPOVER_GAP;
      rawLeft = targetCenterX - popoverSize.width / 2;
      break;
    case "bottom":
      rawTop = targetRect.bottom + POPOVER_GAP;
      rawLeft = targetCenterX - popoverSize.width / 2;
      break;
    case "left":
      rawTop = targetCenterY - popoverSize.height / 2;
      rawLeft = targetRect.left - popoverSize.width - POPOVER_GAP;
      break;
    case "right":
      rawTop = targetCenterY - popoverSize.height / 2;
      rawLeft = targetRect.right + POPOVER_GAP;
      break;
    default:
      rawTop = targetRect.bottom + POPOVER_GAP;
      rawLeft = targetCenterX - popoverSize.width / 2;
      break;
  }

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - popoverSize.width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - popoverSize.height - VIEWPORT_MARGIN);

  const left = Math.min(Math.max(VIEWPORT_MARGIN, Math.round(rawLeft)), maxLeft);
  const top = Math.min(Math.max(VIEWPORT_MARGIN, Math.round(rawTop)), maxTop);

  return {
    top,
    left,
    actualPlacement,
  };
}
