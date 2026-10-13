/**
 * bench/run.ts must exit non-zero when any target's compiler run fails, so a
 * shell or CI job cannot mistake a FAILED result for success (issue: a failed
 * run printed "FAILED" and still exited 0).
 *
 * Runs an isolated copy of the runner (its own bench/ dir, with node_modules
 * symlinked in so it finds a real tsc) against a tsconfig with an invalid
 * compiler option, so the checked-in bench/results.json is never touched.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function makeIsolatedRunner(): { runnerDir: string; cleanup: () => void } {
  const runnerDir = mkdtempSync(path.join(tmpdir(), "gdp-bench-isolated-"));
  mkdirSync(path.join(runnerDir, "bench"));
  writeFileSync(path.join(runnerDir, "bench", "run.ts"), readFileSync(path.join(root, "bench/run.ts")));
  // run.ts resolves its own repo root as "..", and reads node_modules/typescript and
  // node_modules/.bin/tsc from it; symlink the real ones in instead of copying them.
  symlinkSync(path.join(root, "node_modules"), path.join(runnerDir, "node_modules"));
  return { runnerDir, cleanup: () => rmSync(runnerDir, { recursive: true, force: true }) };
}

function makeInvalidProject(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "gdp-invalid-project-"));
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "invalid-target" } }));
  writeFileSync(path.join(dir, "index.ts"), "export const x = 1;\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("bench/run.ts exits non-zero when a target's compiler run fails", () => {
  const { runnerDir, cleanup: cleanupRunner } = makeIsolatedRunner();
  const { dir: invalidProject, cleanup: cleanupProject } = makeInvalidProject();
  const resultsFile = path.join(runnerDir, "bench", "results.json");
  const realResultsBefore = readFileSync(path.join(root, "bench/results.json"), "utf8");

  try {
    const r = spawnSync(
      process.execPath,
      [path.join(runnerDir, "bench/run.ts"), "--ts", "local", "--runs", "1", "--warmup", "0", invalidProject],
      { cwd: runnerDir, encoding: "utf8" },
    );

    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /FAILED/, "the failing target's diagnostic should still be printed");

    // The failure is still recorded in results.json, isolated-copy's own file only.
    assert.ok(existsSync(resultsFile), "results.json should still be written for the failed run");
    const results = JSON.parse(readFileSync(resultsFile, "utf8"));
    assert.ok(
      results.some((entry: { error: string | null }) => typeof entry.error === "string" && entry.error.length > 0),
      "the recorded entry should carry the compiler error",
    );
  } finally {
    // The real, checked-in results.json must never be touched by this test.
    assert.equal(readFileSync(path.join(root, "bench/results.json"), "utf8"), realResultsBefore);
    cleanupProject();
    cleanupRunner();
  }
});
