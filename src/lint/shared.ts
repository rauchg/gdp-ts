/** Options and rule scoping shared by the ESLint and Oxlint presets. */

export interface GdpLintOptions {
  /** Files the rules apply to. Default: TypeScript files. */
  files?: string[];
  /** Trusted modules: the only files that may call `defineProof`. Default: `**\/proofs/**`. */
  proofs?: string[];
  /**
   * Import paths (regular expressions) whose types count as proof types for
   * `no-proof-assertion`. Default: any path with a `proofs` segment.
   */
  proofImports?: string[];
  /**
   * Strict mode also bans every type assertion and every `any` outside the
   * trusted modules (and `allowAssertions`). Default: false, which only bans
   * assertions *to* gdp-ts and proof types, so it is safe to turn on in an
   * existing codebase.
   */
  strict?: boolean;
  /** Strict mode only: files that may still use `as`, such as branded-id constructors. Default: `**\/lib/ids.ts`. */
  allowAssertions?: string[];
}

export type RuleLevel = "error" | "off" | ["error", ...unknown[]];

export interface Scoped {
  files: string[];
  rules: Record<string, RuleLevel>;
}

export const PLUGIN = "gdp-ts";

/** Which rules apply to which files, in order (later entries override earlier ones). */
export function scopes(options: GdpLintOptions = {}): Scoped[] {
  const {
    files = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    proofs = ["**/proofs/**"],
    proofImports,
    strict = false,
    allowAssertions = ["**/lib/ids.ts"],
  } = options;
  const rule = (name: string) => `${PLUGIN}/${name}`;

  const everywhere: Scoped = {
    files,
    rules: {
      [rule("no-define-proof")]: "error",
      [rule("no-proof-assertion")]: proofImports ? ["error", { proofImports }] : "error",
      [rule("no-name-rebind")]: "error",
      ...(strict ? { [rule("no-type-assertion")]: "error", [rule("no-any")]: "error" } : {}),
    },
  };
  const trusted: Scoped = {
    files: proofs,
    rules: {
      [rule("no-define-proof")]: "off",
      [rule("no-proof-assertion")]: "off",
      [rule("no-name-rebind")]: "off",
      [rule("no-type-assertion")]: "off",
      [rule("no-any")]: "off",
      [rule("no-exported-prover")]: "error",
    },
  };
  const assertionsAllowed: Scoped = { files: allowAssertions, rules: { [rule("no-type-assertion")]: "off" } };

  return strict ? [everywhere, trusted, assertionsAllowed] : [everywhere, trusted];
}
