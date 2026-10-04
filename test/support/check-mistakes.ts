/**
 * `// @ts-expect-error` only proves that *some* error happens on the next
 * line. This checks that each mistake fails for the reason it claims to:
 *
 *   1. Type-check a copy of the file with the directives disabled.
 *   2. Every directive's next line must have exactly one error, and no other
 *      line in the file may have one.
 *   3. The errors, keyed by the directive's comment, must match a recorded
 *      snapshot. Run with UPDATE_SNAPSHOTS=1 to re-record after a deliberate
 *      change, and review the diff.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIRECTIVE = /^\s*\/\/ @ts-expect-error\b\s*(.*)$/;

interface Diagnostic {
  line: number;
  code: string;
  message: string;
}

export function checkMistakes(options: { project: string; file: string; snapshot: string }): void {
  const { project, file, snapshot } = options;
  const source = readFileSync(file, "utf8");

  // 1-based line number of the code under each directive, with the reason given.
  const expected = new Map<number, string>();
  source.split("\n").forEach((text, i) => {
    const match = DIRECTIVE.exec(text);
    if (match) expected.set(i + 2, match[1] ?? "");
  });
  assert.ok(expected.size > 0, `${file} has no @ts-expect-error directives`);

  const errors = typecheckUnsuppressed(project, file, source);

  const unexpected = errors.filter((e) => !expected.has(e.line));
  assert.deepEqual(unexpected, [], "errors on lines that are not marked as mistakes");
  for (const [line, reason] of expected) {
    const count = errors.filter((e) => e.line === line).length;
    assert.equal(count, 1, `line ${line} (${reason}): expected exactly one error, got ${count}`);
  }

  const actual =
    [...expected]
      .map(([line, reason]) => {
        const error = errors.find((e) => e.line === line);
        return `${reason}\n  ${error?.code} ${error?.message}`;
      })
      .join("\n\n") + "\n";

  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snapshot)) writeFileSync(snapshot, actual);
  assert.equal(actual, readFileSync(snapshot, "utf8"), `errors differ from ${path.basename(snapshot)}`);
}

function typecheckUnsuppressed(project: string, file: string, source: string): Diagnostic[] {
  // Same directory, so relative imports keep working; same line numbers.
  const copy = file.replace(/\.ts$/, ".unsuppressed.tmp.ts");
  writeFileSync(copy, source.replace(/\/\/ @ts-expect-error\b/g, "// (disabled) ts-expect-error"));
  let output: string;
  try {
    output = execFileSync(path.join(project, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--pretty", "false"], {
      cwd: project,
      encoding: "utf8",
    });
  } catch (error) {
    output = String((error as { stdout?: unknown }).stdout ?? "");
  } finally {
    rmSync(copy, { force: true });
  }

  const diagnostics: Diagnostic[] = [];
  for (const text of output.split("\n")) {
    const match = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(text);
    if (!match || path.resolve(project, match[1] ?? "") !== copy) continue;
    diagnostics.push({ line: Number(match[2]), code: match[3] ?? "", message: normalize(match[4] ?? "") });
  }
  return diagnostics;
}

/** Drop machine-specific `import("/abs/path", ...).` qualifiers from type names. */
function normalize(message: string): string {
  return message.replace(/import\("[^"]*"(?:, \{[^)]*\})?\)\./g, "");
}
