import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../../", import.meta.url));

// apps/web has no Tailwind: every class used by the training/tour UI must be a project class.
const UI_FILES = [
  "components/sandbox/sandbox-banner.tsx",
  "components/sandbox/role-training-modal.tsx",
  "components/sandbox/training-spotlight.tsx",
  "components/sandbox/training-dialogs.tsx",
  "components/sandbox/training-dialogs.tsx",
  "components/tours/tour-card.tsx",
  "components/tours/tour-overlay.tsx",
];
const STYLESHEETS = ["globals.css", "bento.css", "login.css"];

// Modifier classes toggled dynamically that are only styled in combination with a parent selector.
const ALLOWED_DYNAMIC = new Set<string>(["is-active"]);

function definedSelectors(): Set<string> {
  const defined = new Set<string>();
  for (const sheet of STYLESHEETS) {
    const css = readFileSync(appDir + sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(match[1]);
  }
  return defined;
}

function classTokens(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
  for (const match of source.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    tokens.push(...raw.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

test("training and tour UI only use classes defined in the project stylesheets", () => {
  const defined = definedSelectors();
  const missing: string[] = [];
  for (const file of UI_FILES) {
    const source = readFileSync(appDir + file, "utf8");
    for (const token of new Set(classTokens(source))) {
      if (!defined.has(token) && !ALLOWED_DYNAMIC.has(token)) missing.push(`${file}: ${token}`);
    }
  }
  assert.deepEqual(missing, [], `classes without a CSS definition:\n${missing.join("\n")}`);
});

test("training UI components actually declare class names (guards against an empty scan)", () => {
  for (const file of UI_FILES.filter((f) => !f.endsWith("training-spotlight.tsx"))) {
    assert.ok(classTokens(readFileSync(appDir + file, "utf8")).length > 0, file);
  }
});
