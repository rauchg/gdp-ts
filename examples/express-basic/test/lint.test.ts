/**
 * `pnpm lint` proves this example's code passes the rules. This proves the
 * rules still catch what they exist for: forging a proof with `as`/`any`,
 * minting one outside proofs/, and exporting a prover. Each case is linted
 * at a virtual path, so the path-based rules apply as they would to a file
 * there; nothing is written to disk.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

const violations = [
  {
    name: "forging a proof with `as` outside proofs/",
    filePath: "src/app.ts",
    code: `import type { UserIsProjectAdmin } from "./proofs/user-is-project-admin.ts";\nexport const forged = {} as UserIsProjectAdmin<1, 2>;\n`,
    rules: ["@typescript-eslint/consistent-type-assertions"],
  },
  {
    name: "forging a proof with `as any` outside proofs/",
    filePath: "src/app.ts",
    code: `export const forged = null as any;\n`,
    rules: ["@typescript-eslint/consistent-type-assertions", "@typescript-eslint/no-explicit-any"],
  },
  {
    name: "calling defineProof outside proofs/",
    filePath: "src/app.ts",
    code: `import { defineProof } from "gdp-ts";\nexport const kind = defineProof("Forged").kind;\n`,
    rules: ["no-restricted-imports"],
  },
  {
    name: "exporting a prover from a trusted module",
    filePath: "src/proofs/forged.ts",
    code: `import { defineProof } from "gdp-ts";\nexport const Forged = defineProof("Forged");\n`,
    rules: ["no-restricted-syntax"],
  },
  {
    name: "re-exporting a prover from a trusted module",
    filePath: "src/proofs/forged.ts",
    code: `import { defineProof } from "gdp-ts";\nconst Forged = defineProof("Forged");\nexport { Forged };\n`,
    rules: ["no-restricted-syntax"],
  },
];

for (const { name, filePath, code, rules } of violations) {
  test(`lint catches ${name}`, async () => {
    const reported = await ruleIds(filePath, code);
    for (const rule of rules) assert.ok(reported.includes(rule), `${rule} did not fire; got [${reported.join(", ")}]`);
  });
}

const allowed = [
  {
    name: "a trusted module with a private prover",
    filePath: "src/proofs/allowed.ts",
    code: [
      `import { defineProof, type Named, type Proof } from "gdp-ts";`,
      `const Allowed = defineProof("Allowed");`,
      `export interface Allowed<X> extends Proof<"Allowed", [X]> {}`,
      `export function allowed<X>(x: Named<X, string>): Allowed<X> {`,
      `  return Allowed.prove(x);`,
      `}`,
      ``,
    ].join("\n"),
  },
  {
    name: "`as` in the branded-id constructors in src/lib/ids.ts",
    filePath: "src/lib/ids.ts",
    code: `export type Id = string & { readonly __brand: "Id" };\nexport const Id = (id: string) => id as Id;\n`,
  },
];

for (const { name, filePath, code } of allowed) {
  test(`lint allows ${name}`, async () => {
    assert.deepEqual(await ruleIds(filePath, code), []);
  });
}
