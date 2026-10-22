import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SUPPORTED_TRAINING_ACTIONS, allRoleTracks } from "./role-tracks.ts";

const appDir = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(): Array<{ path: string; text: string }> {
  return (readdirSync(appDir, { recursive: true }) as string[])
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => ({ path: relative(appDir, join(appDir, entry)), text: readFileSync(join(appDir, entry), "utf8") }));
}

test("SUPPORTED_TRAINING_ACTIONS equals the set of interactive actions used by the tracks", () => {
  const used = new Set<string>();
  for (const track of allRoleTracks) {
    for (const step of track.steps) {
      if (step.interactiveAction) used.add(step.interactiveAction);
    }
  }
  assert.deepEqual([...used].sort(), [...SUPPORTED_TRAINING_ACTIONS].sort());
  assert.equal(new Set(SUPPORTED_TRAINING_ACTIONS).size, SUPPORTED_TRAINING_ACTIONS.length, "no duplicates");
});

test("every track step declares an interactive action", () => {
  for (const track of allRoleTracks) {
    for (const step of track.steps) {
      assert.ok(step.interactiveAction, `${step.id} has no interactiveAction`);
    }
  }
});

test("every supported action is reported by the UI via notifyAction or useTrainingViewAction", () => {
  const files = sourceFiles().filter((file) => !file.path.startsWith("lib"));
  for (const action of SUPPORTED_TRAINING_ACTIONS) {
    const pattern = new RegExp(`(?:notifyAction|useTrainingViewAction)\\(\\s*"${action}"`);
    const hit = files.find((file) => pattern.test(file.text));
    assert.ok(hit, `no UI call reports the training action "${action}"`);
  }
});
