/**
 * Oxlint preset, for `oxlint.config.ts`. Oxlint needs no TypeScript compiler
 * API, so this also works on TypeScript 7:
 *
 *   import gdp from "gdp-ts/lint/oxlint";
 *
 *   export default gdp();
 *
 * To combine with your own config, spread it and concatenate `jsPlugins` and
 * `overrides`. The rules run as an Oxlint JS plugin (alpha in Oxlint).
 * See `GdpLintOptions` for `proofs`, `strict` and friends.
 */
import { PLUGIN, scopes, type GdpLintOptions, type Scoped } from "./shared.ts";

export type { GdpLintOptions } from "./shared.ts";

export interface OxlintConfig {
  jsPlugins: { name: string; specifier: string }[];
  overrides: Scoped[];
}

export default function gdp(options: GdpLintOptions = {}): OxlintConfig {
  return {
    jsPlugins: [{ name: PLUGIN, specifier: "gdp-ts/lint/plugin" }],
    overrides: scopes(options),
  };
}
