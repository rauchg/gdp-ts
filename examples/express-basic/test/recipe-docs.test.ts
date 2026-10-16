/**
 * recipe.md's "Turn on the lint preset" step tells readers to add the gdp-ts ESLint preset
 * with a short snippet, after their own typescript-eslint setup. This test runs that exact
 * snippet (read from the doc itself, not hand-copied) against code shaped the way the rest
 * of the recipe (steps 1, 2 and 4) tells readers to write it, the same way `npx eslint .`
 * would in a real project. See issue #15.
 *
 * The snippet is written next to this package so its own imports ("typescript-eslint" and
 * "@gdp-ts/core/lint/eslint") resolve through node_modules the normal way, and ESLint loads
 * it as a real config file instead of us re-interpreting its source.
 *
 * Everything lints in one project, one ESLint instance, one `lintFiles` call: two instances
 * side by side confuse typescript-eslint's tsconfigRootDir auto-detection, which scans
 * sibling directories and otherwise reports "multiple candidate TSConfigRootDirs".
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const packageRoot = fileURLToPath(new URL("..", import.meta.url)); // examples/express-basic
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const RECIPE_FILES: Record<string, string> = {
  "src/lib/ids.ts": [
    `declare const brand: unique symbol;`,
    `type Brand<T, B extends string> = T & { readonly [brand]: B };`,
    ``,
    `export type Host = Brand<string, "Host">;`,
    `export const Host = (host: string) => host as Host;`,
    ``,
  ].join("\n"),
  // Step 2's own shape: a trusted module exporting the proof interface and the checking
  // function, never the prover.
  "src/proofs/token-unlocks-url.ts": [
    `import { defineProof, type Named, type Proof } from "@gdp-ts/core";`,
    `import type { Host } from "../lib/ids.ts";`,
    ``,
    `const TokenUnlocksUrl = defineProof("TokenUnlocksUrl");`,
    `/** The visitor's token was issued for exactly URL H, for its current password. */`,
    `export interface TokenUnlocksUrl<H> extends Proof<"TokenUnlocksUrl", [H]> {}`,
    ``,
    `export async function tokenUnlocksUrl<H>(`,
    `  url: Named<H, Host>,`,
    `  token: string | undefined,`,
    `): Promise<TokenUnlocksUrl<H> | null> {`,
    `  return token ? TokenUnlocksUrl.prove(url) : null;`,
    `}`,
    ``,
  ].join("\n"),
  // Step 4's own shape: a sensitive function outside proofs/ with a trailing proof
  // parameter that is usually unused at runtime.
  "src/serve-page.ts": [
    `import type { Named } from "@gdp-ts/core";`,
    `import type { Host } from "./lib/ids.ts";`,
    `import type { TokenUnlocksUrl } from "./proofs/token-unlocks-url.ts";`,
    ``,
    `export function servePage<H>(url: Named<H, Host>, _proof: TokenUnlocksUrl<H>): Promise<string> {`,
    `  return Promise.resolve(url.value);`,
    `}`,
    ``,
  ].join("\n"),
  // The control: a forged proof outside proofs/, which the preset must keep catching.
  "src/forged.ts": [
    `import type { TokenUnlocksUrl } from "./proofs/token-unlocks-url.ts";`,
    `export const forged = {} as TokenUnlocksUrl<string>;`,
    ``,
  ].join("\n"),
};

async function extractStep6EslintSnippet(): Promise<string> {
  const recipe = await readFile(path.join(repoRoot, "skills/gdp-ts/references/recipe.md"), "utf8");
  const heading = recipe.indexOf("## 6. Turn on the lint preset");
  assert.ok(heading !== -1, "recipe.md no longer has a '## 6. Turn on the lint preset' heading");
  const match = /```js\n\/\/ eslint\.config\.js\n([\s\S]*?)```/.exec(recipe.slice(heading));
  const snippet = match?.[1];
  assert.ok(snippet, "recipe.md's step 6 ESLint snippet (the ```js // eslint.config.js fence) was not found");
  return snippet;
}

let dir = "";
let results: ESLint.LintResult[] = [];

before(async () => {
  // Nested under examples/express-basic so Node's module resolution walks up into its
  // node_modules (typescript-eslint, @gdp-ts/core) the same way it would for a real project
  // that installed those packages.
  dir = await mkdtemp(path.join(packageRoot, ".recipe-docs-test-"));
  await writeFile(path.join(dir, "eslint.config.js"), await extractStep6EslintSnippet());
  for (const [relativePath, content] of Object.entries(RECIPE_FILES)) {
    const full = path.join(dir, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  const eslint = new ESLint({ cwd: dir });
  results = await eslint.lintFiles(["src/**/*.ts"]);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function messagesFor(relativePath: string) {
  const result = results.find((r) => r.filePath === path.join(dir, relativePath));
  assert.ok(result, `no lint result for ${relativePath}`);
  return result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

test("the recipe's own step 6 ESLint snippet lints the recipe's step 1/2/4 shapes clean", () => {
  assert.deepEqual(messagesFor("src/proofs/token-unlocks-url.ts"), []);
  assert.deepEqual(messagesFor("src/serve-page.ts"), []);
});

test("the recipe's own step 6 ESLint snippet still catches a forged proof outside proofs/", () => {
  assert.deepEqual(messagesFor("src/forged.ts"), ["gdp-ts/no-proof-assertion"]);
});
