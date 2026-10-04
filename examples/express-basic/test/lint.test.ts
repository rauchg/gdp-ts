/**
 * The gdp-ts ESLint preset, in both modes, against the shared lint cases
 * (test/support/lint-cases.ts at the repository root). The Oxlint preset runs
 * the same cases in examples/express-drizzle.
 *
 * Each case is linted at a virtual path, so the path-based scoping applies as
 * it would to a real file there; nothing is written to disk.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import gdp from "gdp-ts/lint/eslint";
import tseslint from "typescript-eslint";
import { lintCases } from "../../../test/support/lint-cases.ts";

const cwd = fileURLToPath(new URL("..", import.meta.url));

for (const mode of ["targeted", "strict"] as const) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
      ...gdp({ strict: mode === "strict" }),
    ],
  });

  for (const { name, filePath, code, ...expected } of lintCases) {
    test(`eslint (${mode}): ${name}`, async () => {
      const [result] = await eslint.lintText(code, { filePath });
      const reported = (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`).sort();
      assert.deepEqual(reported, [...expected[mode]].sort());
    });
  }
}

test("this example's own eslint.config.js uses the preset in strict mode", async () => {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(`export const x = null as any;\n`, { filePath: "src/app.ts" });
  const reported = (result?.messages ?? []).map((m) => m.ruleId);
  assert.ok(reported.includes("gdp-ts/no-any"), `got [${reported.join(", ")}]`);
});
