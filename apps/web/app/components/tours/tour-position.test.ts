import assert from "node:assert/strict";
import test from "node:test";
import {
  type DOMRectLike,
  calculateTargetRect,
  calculatePopoverPosition,
} from "./tour-position.ts";

test("calculateTargetRect returns null if element is null", () => {
  assert.equal(calculateTargetRect(null), null);
});

test("calculateTargetRect extracts DOMRectLike from an element", () => {
  const mockElement = {
    getBoundingClientRect() {
      return {
        top: 100,
        left: 200,
        width: 150,
        height: 50,
        bottom: 150,
        right: 350,
      };
    },
  } as unknown as Element;

  const rect = calculateTargetRect(mockElement);
  assert.deepEqual(rect, {
    top: 100,
    left: 200,
    width: 150,
    height: 50,
    bottom: 150,
    right: 350,
  });
});

test("calculatePopoverPosition centers modal if targetRect is null", () => {
  const popoverSize = { width: 320, height: 200 };
  const viewportSize = { width: 1000, height: 800 };

  const pos = calculatePopoverPosition(null, popoverSize, "bottom", viewportSize);

  // Center horizontally: (1000 - 320) / 2 = 340
  // Center vertically: (800 - 200) / 2 = 300
  assert.equal(pos.left, 340);
  assert.equal(pos.top, 300);
});

test("calculatePopoverPosition positions below target for placement=bottom with space", () => {
  const targetRect: DOMRectLike = {
    top: 100,
    left: 200,
    width: 200,
    height: 50,
    bottom: 150,
    right: 400,
  };
  const popoverSize = { width: 300, height: 160 };
  const viewportSize = { width: 1200, height: 900 };

  const pos = calculatePopoverPosition(targetRect, popoverSize, "bottom", viewportSize);

  // top should be target bottom (150) + gap (12) = 162
  assert.equal(pos.top, 162);
  // horizontal center of target is 200 + 100 = 300. Popover width is 300, so left = 300 - 150 = 150
  assert.equal(pos.left, 150);
  assert.equal(pos.actualPlacement, "bottom");
});

test("calculatePopoverPosition positions above target for placement=top with space", () => {
  const targetRect: DOMRectLike = {
    top: 500,
    left: 400,
    width: 100,
    height: 60,
    bottom: 560,
    right: 500,
  };
  const popoverSize = { width: 280, height: 140 };
  const viewportSize = { width: 1200, height: 900 };

  const pos = calculatePopoverPosition(targetRect, popoverSize, "top", viewportSize);

  // top should be target top (500) - popover height (140) - gap (12) = 348
  assert.equal(pos.top, 348);
  // target center X = 450. Popover left = 450 - 140 = 310
  assert.equal(pos.left, 310);
  assert.equal(pos.actualPlacement, "top");
});

test("calculatePopoverPosition flips from top to bottom when not enough room above", () => {
  const targetRect: DOMRectLike = {
    top: 40, // only 40px from top
    left: 300,
    width: 100,
    height: 40,
    bottom: 80,
    right: 400,
  };
  const popoverSize = { width: 300, height: 180 };
  const viewportSize = { width: 1000, height: 800 };

  const pos = calculatePopoverPosition(targetRect, popoverSize, "top", viewportSize);

  assert.equal(pos.actualPlacement, "bottom");
  // Placed below: targetRect.bottom (80) + gap (12) = 92
  assert.equal(pos.top, 92);
});

test("calculatePopoverPosition flips from bottom to top when not enough room below", () => {
  const targetRect: DOMRectLike = {
    top: 720,
    left: 300,
    width: 100,
    height: 40,
    bottom: 760, // only 40px from bottom in 800px viewport
    right: 400,
  };
  const popoverSize = { width: 300, height: 180 };
  const viewportSize = { width: 1000, height: 800 };

  const pos = calculatePopoverPosition(targetRect, popoverSize, "bottom", viewportSize);

  assert.equal(pos.actualPlacement, "top");
  // Placed above: target top (720) - popover height (180) - gap (12) = 528
  assert.equal(pos.top, 528);
});

test("calculatePopoverPosition clamps within viewport margins", () => {
  // Target is on the extreme right edge
  const targetRect: DOMRectLike = {
    top: 300,
    left: 950,
    width: 40,
    height: 40,
    bottom: 340,
    right: 990,
  };
  const popoverSize = { width: 300, height: 150 };
  const viewportSize = { width: 1000, height: 800 };
  const margin = 16;

  const pos = calculatePopoverPosition(targetRect, popoverSize, "bottom", viewportSize);

  // Right edge must be <= 1000 - 16 = 984, so left <= 984 - 300 = 684
  assert.equal(pos.left, viewportSize.width - popoverSize.width - margin);
});

test("calculatePopoverPosition handles placement=left and placement=right", () => {
  const targetRect: DOMRectLike = {
    top: 300,
    left: 500,
    width: 100,
    height: 80,
    bottom: 380,
    right: 600,
  };
  const popoverSize = { width: 200, height: 100 };
  const viewportSize = { width: 1200, height: 800 };

  const rightPos = calculatePopoverPosition(targetRect, popoverSize, "right", viewportSize);
  assert.equal(rightPos.actualPlacement, "right");
  assert.equal(rightPos.left, targetRect.right + 12); // 612
  // vertical center: 340 - 50 = 290
  assert.equal(rightPos.top, 290);

  const leftPos = calculatePopoverPosition(targetRect, popoverSize, "left", viewportSize);
  assert.equal(leftPos.actualPlacement, "left");
  assert.equal(leftPos.left, targetRect.left - popoverSize.width - 12); // 500 - 200 - 12 = 288
  assert.equal(leftPos.top, 290);
});

test("calculatePopoverPosition handles placement=auto intelligently", () => {
  // More room below than above
  const targetRect: DOMRectLike = {
    top: 100,
    left: 400,
    width: 100,
    height: 50,
    bottom: 150,
    right: 500,
  };
  const popoverSize = { width: 250, height: 150 };
  const viewportSize = { width: 1000, height: 800 };

  const pos = calculatePopoverPosition(targetRect, popoverSize, "auto", viewportSize);
  assert.equal(pos.actualPlacement, "bottom");
});
