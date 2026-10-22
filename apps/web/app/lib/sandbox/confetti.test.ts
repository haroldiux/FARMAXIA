import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFETTI_COLORS,
  confettiLifetimeMs,
  createConfettiPieces,
} from "./confetti.ts";

test("creates the requested number of pieces with unique ids", () => {
  const pieces = createConfettiPieces(48, 7);
  assert.equal(pieces.length, 48);
  assert.equal(new Set(pieces.map((p) => p.id)).size, 48);
  assert.deepEqual(createConfettiPieces(0, 7), []);
});

test("piece values stay inside the documented ranges", () => {
  for (const p of createConfettiPieces(200, 12345)) {
    assert.ok(p.angle >= 0 && p.angle < 360);
    assert.ok(p.distance >= 120 && p.distance <= 520);
    assert.ok(p.fall >= 160 && p.fall <= 520);
    assert.ok(p.rotation >= -720 && p.rotation <= 720);
    assert.ok(p.delayMs >= 0 && p.delayMs <= 200);
    assert.ok(p.durationMs >= 1600 && p.durationMs <= 2400);
    assert.ok(p.size >= 6 && p.size <= 12);
    assert.ok(CONFETTI_COLORS.includes(p.color));
  }
});

test("same seed gives the same pieces and a different seed gives different ones", () => {
  assert.deepEqual(createConfettiPieces(40, 99), createConfettiPieces(40, 99));
  assert.notDeepEqual(createConfettiPieces(40, 99), createConfettiPieces(40, 100));
});

test("lifetime covers the longest delay plus duration", () => {
  const pieces = createConfettiPieces(50, 3);
  const longest = Math.max(...pieces.map((p) => p.delayMs + p.durationMs));
  assert.ok(confettiLifetimeMs(pieces) >= longest);
  assert.equal(confettiLifetimeMs([]), 0);
});
