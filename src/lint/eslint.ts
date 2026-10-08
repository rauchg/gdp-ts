/**
 * ESLint (flat config) preset. Add it after your TypeScript setup, which must
 * already parse `.ts` files (typescript-eslint):
 *
 *   import tseslint from "typescript-eslint";
 *   import gdp from "@gdp-ts/core/lint/eslint";
 *
 *   export default [
 *     ...tseslint.configs.recommended,
 *     {
 *       files: ["**\/*.ts"],
 *       rules: {
 *         // `interface X<P> extends Proof<"X", [P]> {}` is the proof recipe.
 *         "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
 *         // Proof parameters are frequently unused at runtime; name them `_proof`.
 *         "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
 *       },
 *     },
 *     ...gdp(),
 *   ];
 *
 * `tseslint.configs.recommended` alone flags the recipe's own proof shapes
 * (an empty interface extending Proof, an unused `_proof` parameter); the two
 * overrides above keep it quiet. See `GdpLintOptions` for `proofs`, `strict`
 * and friends.
 */
import plugin from "./plugin.ts";
import { PLUGIN, scopes, type GdpLintOptions, type Scoped } from "./shared.ts";

export type { GdpLintOptions } from "./shared.ts";

export interface FlatConfig {
  name: string;
  files?: string[];
  plugins?: Record<string, typeof plugin>;
  rules?: Scoped["rules"];
}

export default function gdp(options: GdpLintOptions = {}): FlatConfig[] {
  const names = ["gdp-ts/everywhere", "gdp-ts/trusted-modules", "gdp-ts/allowed-assertions"];
  return [
    { name: "gdp-ts/plugin", plugins: { [PLUGIN]: plugin } },
    ...scopes(options).map((scope, i) => ({ name: names[i] ?? `gdp-ts/${i}`, files: scope.files, rules: scope.rules })),
  ];
}
