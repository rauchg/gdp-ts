// TypeScript cannot stop `{} as UserIsProjectAdmin<U, P>`. The gdp-ts preset
// makes that, minting proofs outside src/proofs/, and leaking a prover lint
// errors. Strict mode also bans every `as` and `any` outside src/proofs/ and
// src/lib/ids.ts: this example has no other use for them.
import gdp from "gdp-ts/lint/eslint";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // `interface X<P> extends Proof<"X", [P]> {}` is the proof recipe.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
      // Proof parameters are frequently unused at runtime; name them `_proof`.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  ...gdp({ strict: true }),
);
