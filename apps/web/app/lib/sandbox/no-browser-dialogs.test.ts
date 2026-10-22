import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SANDBOX_COMPONENTS_DIR = join(import.meta.dirname, "..", "..", "components", "sandbox");

test("training flow never falls back to browser alert/confirm dialogs", () => {
  const offenders = readdirSync(SANDBOX_COMPONENTS_DIR)
    .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(SANDBOX_COMPONENTS_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return /(^|[^.\w])(window\.)?(alert|confirm)\s*\(/m.test(source) ? [file] : [];
    });
  assert.deepEqual(offenders, []);
});
