/**
 * Checks that keep the docs honest:
 *
 * - the skill quotes real compiler output (every error recorded in
 *   examples/basic's mistakes snapshot appears, verbatim, in errors.md);
 * - every relative link in the README, the skill and the example READMEs
 *   points at a file that exists, and at a heading that exists;
 * - SKILL.md has the frontmatter skill installers need.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("errors.md quotes the compiler messages from examples/basic/src/mistakes.ts", () => {
  const docs = read("skills/gdp-ts/references/errors.md");
  const recorded = read("examples/basic/test/mistakes.snapshot.txt")
    .split("\n")
    .flatMap((line) => {
      const match = /^ {2}(TS\d+) (.*)$/.exec(line);
      return match ? [`error ${match[1]}: ${match[2]}`] : [];
    });

  assert.ok(recorded.length > 0, "the snapshot has no errors");
  const missing = recorded.filter((message) => !docs.includes(message));
  assert.deepEqual(missing, [], "errors.md is out of date with the recorded compiler output");
});

const markdownFiles = [
  "README.md",
  "bench/README.md",
  "skills/gdp-ts/SKILL.md",
  ...readdirSync(path.join(root, "skills/gdp-ts/references")).map((f) => `skills/gdp-ts/references/${f}`),
  ...readdirSync(path.join(root, "examples")).map((e) => `examples/${e}/README.md`),
].filter((f) => f.endsWith(".md") && existsSync(path.join(root, f)));

/** GitHub's heading anchors, plus explicit `<a id="...">` anchors. */
function anchors(file: string): Set<string> {
  const found = new Set<string>();
  const seen = new Map<string, number>();
  let inCode = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const base = (heading[1] ?? "")
        .trim()
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s/g, "-");
      const n = seen.get(base);
      seen.set(base, (n ?? -1) + 1);
      found.add(n === undefined ? base : `${base}-${n + 1}`);
    }
    for (const id of line.matchAll(/<a id="([^"]+)"/g)) found.add(id[1] ?? "");
  }
  return found;
}

test("relative links in the docs resolve, including #anchors", () => {
  const broken: string[] = [];
  for (const file of markdownFiles) {
    const text = read(file).replace(/```[\s\S]*?```/g, "");
    for (const [, href = ""] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [target = "", anchor] = href.split("#");
      const resolved = target ? path.resolve(path.dirname(path.join(root, file)), target) : path.join(root, file);
      if (!existsSync(resolved)) broken.push(`${file}: ${href} (no such file)`);
      else if (anchor && statSync(resolved).isFile() && !anchors(resolved).has(anchor)) {
        broken.push(`${file}: ${href} (no such heading)`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("SKILL.md has valid frontmatter", () => {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read("skills/gdp-ts/SKILL.md"))?.[1];
  assert.ok(frontmatter, "SKILL.md must start with --- frontmatter ---");
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter)?.[1]?.trim();

  const name = field("name");
  assert.equal(name, "gdp-ts", "name must match the skill's directory");
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "name: lowercase letters, digits and single hyphens");
  assert.ok(name.length <= 64, "name: at most 64 characters");

  const description = field("description");
  assert.ok(description, "description is required");
  assert.ok(description.length <= 1024, `description: at most 1024 characters (has ${description.length})`);
});
