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
 *       rules: {
 *         // the recipe's proof interface, `interface X<P> extends Proof<"X", [P]> {}`
 *         "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
 *         // the recipe's trailing proof parameter, usually unused at runtime; name it `_proof`
 *         "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
 *       },
 *     },
 *     ...gdp(),
 *   ];
 *
 * See `GdpLintOptions` for `proofs`, `strict` and friends.
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
