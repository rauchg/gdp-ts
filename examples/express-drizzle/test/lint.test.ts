/**
 * The gdp-ts Oxlint preset, in both modes, against the shared lint cases
 * (test/support/lint-cases.ts at the repository root). The ESLint preset runs
 * the same cases in examples/express-basic.
 *
 * Oxlint is a CLI, so each case is written to its own directory under
 * test/.lint-tmp/ (inside this package, so `gdp-ts/lint/plugin` resolves),
 * linted in one run per mode, and removed afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import gdp from "gdp-ts/lint/oxlint";
import { lintCases } from "../../../test/support/lint-cases.ts";

const project = fileURLToPath(new URL("..", import.meta.url));
const tmp = path.join(project, "test/.lint-tmp");
after(() => rmSync(tmp, { recursive: true, force: true }));

interface Diagnostic {
  code: string;
  filename: string;
  message: string;
}

/** Oxlint's `--format json` output, narrowed without type assertions (strict mode applies here too). */
function diagnosticsOf(output: string): Diagnostic[] {
  const parsed: unknown = JSON.parse(output);
  const list = typeof parsed === "object" && parsed && "diagnostics" in parsed ? parsed.diagnostics : [];
  const text = (value: object, key: string) => (key in value ? String(Reflect.get(value, key)) : "");
  return (Array.isArray(list) ? list : []).flatMap((d: unknown) =>
    typeof d === "object" && d ? [{ code: text(d, "code"), filename: text(d, "filename"), message: text(d, "message") }] : [],
  );
}

function lint(mode: "targeted" | "strict"): Map<number, string[]> {
  const dir = path.join(tmp, mode);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ".oxlintrc.json"), JSON.stringify(gdp({ strict: mode === "strict" }), null, 2));
  const files = lintCases.map(({ filePath, code }, i) => {
    const file = path.join(`case-${i}`, filePath);
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(dir, file), code);
    return file;
  });

  let output: string;
  try {
    // Explicit paths: test/.lint-tmp/ is gitignored, which Oxlint would otherwise honor.
    output = execFileSync(path.join(project, "node_modules/.bin/oxlint"), ["-c", ".oxlintrc.json", "--format", "json", ...files], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (error) {
    // Oxlint exits non-zero when it reports errors; the JSON is still on stdout.
    output = typeof error === "object" && error && "stdout" in error ? String(error.stdout) : "";
  }

  const byCase = new Map<number, string[]>(lintCases.map((_, i) => [i, []]));
  for (const d of diagnosticsOf(output)) {
    const index = Number(/case-(\d+)/.exec(d.filename)?.[1]);
    // "gdp-ts(no-any)" -> "gdp-ts/no-any"; anything else is reported as-is so it fails loudly.
    const rule = /^([\w-]+)\(([\w-]+)\)$/.exec(d.code);
    byCase.get(index)?.push(rule ? `${rule[1]}/${rule[2]}` : `${d.code || "error"}: ${d.message}`);
  }
  return byCase;
}

for (const mode of ["targeted", "strict"] as const) {
  const reports = lint(mode);
  lintCases.forEach(({ name, ...expected }, i) => {
    test(`oxlint (${mode}): ${name}`, () => {
      assert.deepEqual([...(reports.get(i) ?? [])].sort(), [...expected[mode]].sort());
    });
  });
}
