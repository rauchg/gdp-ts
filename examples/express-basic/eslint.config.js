// Lint rules that close the gaps the type system cannot.
//
// TypeScript cannot stop `{} as UserIsProjectAdmin<U, P>`. What it can do is make
// the honest path never need an assertion, so that `as` (and minting proofs)
// outside proofs/ is always suspicious. These rules make it an error.
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
  {
    // Everything that is NOT a trusted module.
    files: ["**/*.ts"],
    ignores: ["src/proofs/**", "src/lib/ids.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "gdp-ts",
              importNames: ["defineProof"],
              message: "Only modules in src/proofs/ may define proofs.",
            },
          ],
        },
      ],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Trusted modules: keep the prover private.
    files: ["src/proofs/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > CallExpression[callee.name='defineProof']",
          message: "Do not export the prover. Export the proof interface and the checking function.",
        },
        {
          selector: "ExportSpecifier[local.name=/^[A-Z]/]:not([exportKind='type'])",
          message: "Do not re-export provers. Export the proof interface and the checking function.",
        },
      ],
    },
  },
);
