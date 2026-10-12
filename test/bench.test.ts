import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("a failed compiler run records the failure and exits nonzero", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gdp-bench-"));
  try {
    mkdirSync(path.join(dir, "bench"));
    copyFileSync(path.join(root, "bench/run.ts"), path.join(dir, "bench/run.ts"));
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");
    const project = path.join(dir, "invalid-project");
    mkdirSync(project);
    writeFileSync(path.join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "invalid-target" } }));
    const result = spawnSync(process.execPath, [path.join(dir, "bench/run.ts"), "--runs", "1", "--warmup", "0", project], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    const entries = JSON.parse(readFileSync(path.join(dir, "bench/results.json"), "utf8"));
    assert.match(entries[0].error, /error TS/);
    assert.equal(entries[0].median, null);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
