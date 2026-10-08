/**
 * The gdp-ts recipe (skills/gdp-ts/references/recipe.md, step 6) and the
 * module comment on `@gdp-ts/core/lint/eslint` both show an ESLint flat
 * config that is `tseslint.configs.recommended` plus the gdp-ts preset.
 * That alone reports real errors on the recipe's own proof code:
 * `@typescript-eslint/no-empty-object-type` on
 * `interface X<P> extends Proof<"X", [P]> {}` (recipe step 2), and
 * `@typescript-eslint/no-unused-vars` on a `_proof` parameter nothing else
 * uses (recipe step 4). This example's own eslint.config.js carries two
 * rule overrides that keep those quiet.
 *
 * These tests check the recipe and the module comment keep the same two
 * overrides this example has (so the docs do not drift from the one config
 * that is actually exercised), and that the recipe's ESLint snippet, run
 * verbatim, really does lint recipe-shaped code clean.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const canonicalConfig = read("examples/express-basic/eslint.config.js");

/** The two rule overrides this example's own config has, read from it so there is one source of truth. */
const overrideLines = [...canonicalConfig.matchAll(/^\s*"@typescript-eslint\/[a-z-]+":.*$/gm)].map((m) => m[0].trim());

function recipeStepSix(): string {
  const recipe = read("skills/gdp-ts/references/recipe.md");
  const start = recipe.indexOf("ESLint, after your typescript-eslint setup");
  const end = recipe.indexOf("\nOxlint:", start);
  assert.ok(start >= 0 && end > start, "could not find recipe step 6's ESLint section");
  return recipe.slice(start, end);
}

function jsCodeBlock(markdown: string): string {
  const match = /```js\n([\s\S]*?)```/.exec(markdown);
  assert.ok(match, "no ```js code block found");
  return match[1] ?? "";
}

test("recipe.md step 6 keeps the same ESLint overrides as examples/express-basic", () => {
  const block = jsCodeBlock(recipeStepSix());
  for (const line of overrideLines) {
    assert.ok(block.includes(line), `recipe.md step 6's ESLint snippet is missing: ${line}`);
  }
});

test("the @gdp-ts/core/lint/eslint module comment keeps the same ESLint overrides", () => {
  const comment = read("src/lint/eslint.ts");
  for (const line of overrideLines) {
    assert.ok(comment.includes(line), `src/lint/eslint.ts's module comment is missing: ${line}`);
  }
});

test("recipe.md step 6's ESLint snippet, run verbatim, reports nothing on recipe-shaped proof code", async () => {
  const block = jsCodeBlock(recipeStepSix()).replace(/^\/\/ eslint\.config\.js\n/, "");
  // Inside this example's own test/.lint-tmp/ (gitignored, same as the
  // Oxlint test's scratch dir), not the OS tmpdir, so the config module's
  // bare imports ("typescript-eslint", "@gdp-ts/core/...") resolve through
  // this workspace package's node_modules.
  const lintTmp = path.join(exampleDir, "test", ".lint-tmp");
  mkdirSync(lintTmp, { recursive: true });
  const dir = mkdtempSync(path.join(lintTmp, "recipe-config-"));
  try {
    const configFile = path.join(dir, "recipe.eslint.config.mjs");
    writeFileSync(configFile, block);
    // A dynamic import() of a path built at runtime (not a string literal)
    // is not statically resolvable, so TypeScript already gives `configModule`
    // type `any` here with no assertion and no written `any` needed.
    const configModule = await import(pathToFileURL(configFile).href);

    const eslint = new ESLint({ cwd: exampleDir, overrideConfigFile: true, overrideConfig: configModule.default });
    const recipeCode = [
      `import { defineProof, type Named, type Proof } from "@gdp-ts/core";`,
      ``,
      `const UserIsProjectAdmin = defineProof("UserIsProjectAdmin");`,
      `export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}`,
      ``,
      `export async function userIsProjectAdmin<U, P>(`,
      `  user: Named<U, string>,`,
      `  project: Named<P, string>,`,
      `): Promise<UserIsProjectAdmin<U, P> | null> {`,
      `  return user.value === "admin" ? UserIsProjectAdmin.prove(user, project) : null;`,
      `}`,
      ``,
      `export function usesProof(_proof: UserIsProjectAdmin<string, string>) {`,
      `  return true;`,
      `}`,
      ``,
    ].join("\n");
    const [result] = await eslint.lintText(recipeCode, { filePath: "src/proofs/user-is-project-admin.ts" });
    const reported = (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
    assert.deepEqual(reported, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
