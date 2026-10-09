/**
 * What the gdp-ts lint presets must report, per mode. Shared by the ESLint
 * test (examples/express-basic) and the Oxlint test (examples/express-drizzle),
 * so both linters are held to exactly the same behavior.
 *
 * `targeted` and `strict` list the rule ids expected, one entry per report.
 */
export interface LintCase {
  name: string;
  filePath: string;
  code: string;
  targeted: string[];
  strict: string[];
}

const r = (name: string) => `gdp-ts/${name}`;

export const lintCases: LintCase[] = [
  // --- minting proofs outside the trusted modules ---------------------------
  {
    name: "importing defineProof outside proofs/",
    filePath: "src/app.ts",
    code: `import { defineProof } from "@gdp-ts/core";\nexport const kind = defineProof("Forged").kind;\n`,
    targeted: [r("no-define-proof")],
    strict: [r("no-define-proof")],
  },
  {
    name: "calling defineProof through a namespace import outside proofs/",
    filePath: "src/app.ts",
    code: `import * as gdp from "@gdp-ts/core";\nexport const kind = gdp.defineProof("Forged").kind;\n`,
    targeted: [r("no-define-proof")],
    strict: [r("no-define-proof")],
  },

  {
    name: "calling defineProof through static bracket access outside proofs/",
    filePath: "src/app.ts",
    code: `import * as gdp from "@gdp-ts/core";\nexport const kind = gdp["defineProof"]("Forged").kind;\n`,
    targeted: [r("no-define-proof")],
    strict: [r("no-define-proof")],
  },
  {
    name: "computed identifiers are not property names",
    filePath: "src/app.ts",
    code: `import * as gdp from "@gdp-ts/core";\nconst defineProof = "name";\nexport const value = gdp[defineProof]("id", (id) => id.value);\n`,
    targeted: [],
    strict: [],
  },

  // --- leaking the prover ---------------------------------------------------
  {
    name: "exporting a prover",
    filePath: "src/proofs/forged.ts",
    code: `import { defineProof } from "@gdp-ts/core";\nexport const Forged = defineProof("Forged");\n`,
    targeted: [r("no-exported-prover")],
    strict: [r("no-exported-prover")],
  },
  {
    name: "re-exporting a prover",
    filePath: "src/proofs/forged.ts",
    code: `import { defineProof } from "@gdp-ts/core";\nconst Forged = defineProof("Forged");\nexport { Forged };\n`,
    targeted: [r("no-exported-prover")],
    strict: [r("no-exported-prover")],
  },
  {
    name: "default-exporting a prover",
    filePath: "src/proofs/forged.ts",
    code: `import { defineProof } from "@gdp-ts/core";\nexport default defineProof("Forged");\n`,
    targeted: [r("no-exported-prover")],
    strict: [r("no-exported-prover")],
  },

  {
    name: "exporting a prover created through static bracket access",
    filePath: "src/proofs/forged.ts",
    code: `import * as gdp from "@gdp-ts/core";\nexport const Forged = gdp["defineProof"]("Forged");\n`,
    targeted: [r("no-exported-prover")],
    strict: [r("no-exported-prover")],
  },
  {
    name: "re-exporting a prover created through static bracket access",
    filePath: "src/proofs/forged.ts",
    code: `import * as gdp from "@gdp-ts/core";\nconst Forged = gdp["defineProof"]("Forged");\nexport { Forged };\n`,
    targeted: [r("no-exported-prover")],
    strict: [r("no-exported-prover")],
  },

  // --- forging a proof with a type assertion ---------------------------------
  {
    name: "asserting a proof type imported from proofs/",
    filePath: "src/app.ts",
    code: `import type { UserIsProjectAdmin } from "./proofs/user-is-project-admin.ts";\nexport const forged = {} as UserIsProjectAdmin<1, 2>;\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion"), r("no-type-assertion")],
  },
  {
    name: "asserting a proof type through an @/ alias",
    filePath: "src/app.ts",
    code: `import type { CanManageProtection } from "@/proofs/protection-policy";\nexport const forged = null as unknown as CanManageProtection<1, 2>;\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion"), r("no-type-assertion"), r("no-type-assertion")],
  },
  {
    name: "asserting Named via unknown",
    filePath: "src/app.ts",
    code: `import type { Named } from "@gdp-ts/core";\nexport const named = "id" as unknown as Named<1, string>;\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion"), r("no-type-assertion"), r("no-type-assertion")],
  },

  // --- forging a proof without any assertion node ------------------------------
  {
    name: "definite assignment to a proof type",
    filePath: "src/app.ts",
    code: `import type { UserIsProjectAdmin } from "./proofs/user-is-project-admin.ts";\nexport let forged!: UserIsProjectAdmin<1, 2>;\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion")],
  },
  {
    name: "declaring a variable of a proof type",
    filePath: "src/app.ts",
    code: `import type { UserIsProjectAdmin } from "./proofs/user-is-project-admin.ts";\ndeclare const forged: UserIsProjectAdmin<1, 2>;\nexport const use = () => forged;\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion")],
  },
  {
    name: "declaring a function that returns a proof",
    filePath: "src/app.ts",
    code: `import type { UserIsProjectAdmin } from "./proofs/user-is-project-admin.ts";\ndeclare function forge(): UserIsProjectAdmin<1, 2>;\nexport const use = () => forge();\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion")],
  },
  {
    name: "returning null! where a proof is expected",
    filePath: "src/app.ts",
    code: `import type { CanManageProtection } from "@/proofs/protection-policy";\nexport const forge = (): CanManageProtection<1, 2> => null!;\n`,
    targeted: [r("no-null-assertion")],
    strict: [r("no-null-assertion")],
  },
  {
    name: "augmenting the gdp-ts module",
    filePath: "src/app.ts",
    code: `declare module "@gdp-ts/core" {\n  interface Proof<in out Kind extends string, in out About extends readonly unknown[]> {\n    readonly escalated: 1;\n  }\n}\nexport {};\n`,
    targeted: [r("no-proof-assertion")],
    strict: [r("no-proof-assertion")],
  },

  // --- ordinary code: only strict mode objects --------------------------------
  {
    name: "an ordinary type assertion",
    filePath: "src/app.ts",
    code: `export const n = JSON.parse("1") as number;\n`,
    targeted: [],
    strict: [r("no-type-assertion")],
  },
  {
    name: "`as any`",
    filePath: "src/app.ts",
    code: `export const x = null as any;\n`,
    targeted: [],
    strict: [r("no-type-assertion"), r("no-any")],
  },
  {
    name: "`as const`",
    filePath: "src/app.ts",
    code: `export const xs = [1, 2] as const;\n`,
    targeted: [],
    strict: [],
  },

  // --- allowed in every mode ---------------------------------------------------
  {
    name: "a trusted module with a private prover",
    filePath: "src/proofs/allowed.ts",
    code: [
      `import { defineProof, type Named, type Proof } from "@gdp-ts/core";`,
      `const Allowed = defineProof("Allowed");`,
      `export interface Allowed<X> extends Proof<"Allowed", [X]> {}`,
      `export function allowed<X>(x: Named<X, string>): Allowed<X> {`,
      `  return Allowed.prove(x);`,
      `}`,
      ``,
    ].join("\n"),
    targeted: [],
    strict: [],
  },
  {
    name: "assertions inside a trusted module",
    filePath: "src/proofs/internal.ts",
    code: `export const raw = JSON.parse("{}") as unknown;\n`,
    targeted: [],
    strict: [],
  },
  {
    name: "the branded-id constructors in lib/ids.ts",
    filePath: "src/lib/ids.ts",
    code: `export type Id = string & { readonly __brand: "Id" };\nexport const Id = (id: string) => id as Id;\n`,
    targeted: [],
    strict: [],
  },
];
