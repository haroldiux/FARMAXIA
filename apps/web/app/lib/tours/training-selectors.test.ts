import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { allRoleTracks, stepPathname } from "./role-tracks.ts";

const appDir = fileURLToPath(new URL("../../", import.meta.url));

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = join(dirname(fromFile), specifier.replace(/\.(tsx?|jsx?)$/, ""));
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Source of a page plus the local files it imports (transitively, bounded depth). */
function pageSources(pageFile: string, depth = 4, seen = new Set<string>()): string[] {
  if (seen.has(pageFile) || depth < 0 || !existsSync(pageFile)) return [];
  seen.add(pageFile);
  const text = readFileSync(pageFile, "utf8");
  const sources = [text];
  for (const match of text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    const resolved = resolveImport(pageFile, match[1]!);
    if (resolved && !resolved.includes(`${join("app", "lib")}`)) {
      sources.push(...pageSources(resolved, depth - 1, seen));
    }
  }
  return sources;
}

test("stepPathname strips query string and hash", () => {
  assert.equal(stepPathname({ path: "/users?tab=branches" }), "/users");
  assert.equal(stepPathname({ path: "/cash#x" }), "/cash");
  assert.equal(stepPathname({ path: "/sales" }), "/sales");
  assert.equal(stepPathname({ path: "/branches", landingPath: "/users" }), "/users");
});

test("every track selector is a data-tour attribute selector", () => {
  for (const track of allRoleTracks) {
    for (const step of track.steps) {
      assert.match(step.targetSelector, /^\[data-tour="[a-z0-9-]+"\]$/, step.id);
    }
  }
});

test("every track step selector exists in the source of its route page", () => {
  const missing: string[] = [];
  for (const track of allRoleTracks) {
    for (const step of track.steps) {
      const value = /"([^"]+)"/.exec(step.targetSelector)![1]!;
      const pageFile = join(appDir, ...stepPathname(step).split("/").filter(Boolean), "page.tsx");
      const sources = pageSources(pageFile);
      const found = sources.some(
        (text) => text.includes(`data-tour="${value}"`) || text.includes(`"data-tour": "${value}"`),
      );
      if (!found) missing.push(`${step.id} -> ${stepPathname(step)} [data-tour="${value}"]`);
    }
  }
  assert.deepEqual(missing, []);
});
