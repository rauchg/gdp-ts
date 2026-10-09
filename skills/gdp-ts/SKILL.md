---
name: gdp-ts
description: Authorization and other preconditions as compile-time proofs in TypeScript, with the gdp-ts library (Ghosts of Departed Proofs). Use when adding, changing or reviewing authorization, entitlement or ownership checks in a TypeScript codebase that uses gdp-ts (imports of `name`, `Named`, `Proof` or `defineProof`), when adopting the pattern in a codebase, or when fixing type errors that mention `Named<...>` or proof types.
---

# gdp-ts

A sensitive function (one that reads or changes something only some callers
may touch) takes a *proof* about its exact arguments, so calling it without
the check, or with a check about a different value, does not compile.

1. **Name values.** `name(viewer.id, projectId, async (user, project) => ...)`
   gives each value a compile-time-only name, valid inside the callback.
2. **Prove facts about names.** A small trusted module in `proofs/` runs the
   check and returns a proof such as `UserIsProjectAdmin<U, P>`, or `null`.
   Only that module can mint it.
3. **Demand proofs.** The sensitive function takes `project: Named<P, ProjectId>`
   and `_proof: UserIsProjectAdmin<U, P>`. The wrong proof, a proof about
   another value, a raw id or no proof is a compile error.

This is not a theorem prover. Prove the facts whose absence would be an
incident, and stop there ([where to stop](references/where-to-stop.md)).

## Compiler options

Use TypeScript 5.4 or newer with `strictFunctionTypes` and `strictNullChecks`
enabled. We recommend `"strict": true` in `tsconfig.json`; check that neither
option is explicitly overridden with `false`.

These compiler options are separate from the lint preset's `strict` option.
See [compiler requirements and limits](references/limits.md#compiler-options)
for the guarantees that depend on them.

## Workflow

When adding or changing authorization in a codebase that uses this pattern:

1. Is the id branded? If not, brand it first.
2. Is there a proof for the fact you need in `proofs/`? If yes, reuse it. If
   no, add one file: private `defineProof`, exported `interface X<...> extends Proof<"X", [...]> {}`,
   exported `async function x(...named): Promise<X<...> | null>`. Nothing else.
3. Does the sensitive function take proofs about its named arguments? If it
   takes raw ids, change the signature; let the compiler list the call sites
   to fix.
4. Does the request carry *other* values the operation trusts (a token in a
   cookie, an id in the body)? Check them in a trusted module against the
   resource they claim to unlock (`TokenUnlocksUrl<H>`). This is where
   cross-resource and cross-tenant bugs live.
5. Are there non-user preconditions (plan, scope, state)? Make them proofs
   too (`PlanIncludesPasswordProtection<P>`).
6. In the handler body (not middleware): `name(...)`, call the policy
   function, turn `null` into the right HTTP response, do all sensitive work
   inside the callback. If that block will likely be called from many places,
   consider moving it into a shared function ([recipe step 5](references/recipe.md#5-name-and-prove-in-the-handler-turn-null-into-a-response)).
7. Never write `as` to satisfy a proof or `Named` type. If you feel the need,
   the signature is wrong or you are outside `proofs/`. If the codebase has no
   gdp-ts lint preset yet, add it ([recipe step 6](references/recipe.md#6-turn-on-the-lint-preset));
   if it does, fix lint errors rather than disabling them.
8. Never export a prover, never call `defineProof` outside `proofs/`, never
   return a `Named`, or a proof that mentions that callback's names, from a
   `name()` callback.
9. Add the new mistake you almost made to `mistakes.ts` (a type-checked file
   that never runs) as one line under `// @ts-expect-error`. It is the
   cheapest regression test you will write ([details](references/errors.md)).
10. Test the proof function you added. It is the only thing that can be wrong
    at runtime.

The [recipe](references/recipe.md) shows each step in full.

## References

Read the one you need:

| File | Read it when |
|---|---|
| [`references/recipe.md`](references/recipe.md) | Adding a proof, a policy or a sensitive function, or adopting the pattern. Six steps: brand ids, trusted modules, policies as unions, sensitive functions, naming in the handler, lint rules. |
| [`references/patterns.md`](references/patterns.md) | Reusing proofs, weaker-from-stronger proofs, proofs that carry evidence, preconditions that are not about users. |
| [`references/errors.md`](references/errors.md) | A type error mentions `Named<...>`, a proof type, or "two different types with this name". |
| [`references/limits.md`](references/limits.md) | Judging what the types do and do not guarantee (forging, stale proofs, older TypeScript). |
| [`references/where-to-stop.md`](references/where-to-stop.md) | Deciding how much to prove. |

## API

Everything is exported from `@gdp-ts/core`.

| Export | What it is |
|---|---|
| `Named<N, A>` | A value of type `A` with compile-time name `N`. Read it with `.value`. `N` is invariant. |
| `name(a, k)` / `name(a, b, k)` / `name(a, b, c, k)` | Gives one to three values fresh names, scoped to `k`. Returns what `k` returns (Promises included). |
| `Proof<Kind, About>` | Evidence that fact `Kind` holds about the tuple of names `About`. Has a runtime `kind: Kind`. Both parameters are invariant. |
| `defineProof(kind)` | Returns a `Prover`: `{ kind, prove(...named) }`. `prove` infers `About` from its arguments. Keep it private to the module that performs the check. |
| `NameOf<T>` | The `N` of a `Named<N, A>`. Rarely needed. |
| `NamesOf<S>` | The names of a tuple of `Named` values. Used in `prove`'s signature. |

Lint presets, for the gaps the type system cannot close ([recipe step 6](references/recipe.md#6-turn-on-the-lint-preset)):

| Import | What it is |
|---|---|
| `@gdp-ts/core/lint/eslint` | `gdp(options?)`: ESLint flat-config entries. Spread after your typescript-eslint config. |
| `@gdp-ts/core/lint/oxlint` | `gdp(options?)`: an Oxlint config (works on TypeScript 7). |
| `@gdp-ts/core/lint/plugin` | The rules themselves (`gdp-ts/no-define-proof`, `no-exported-prover`, `no-proof-assertion`, `no-type-assertion`, `no-any`), for custom setups. |

Options: `proofs` (trusted-module globs, default `**/proofs/**`), `strict`
(also ban every `as` and `any` outside them, default `false`),
`allowAssertions` (strict-mode exceptions, default `**/lib/ids.ts`),
`proofImports` and `files`.

The only place the library asserts a proof type is inside `prove`, so code
using it never needs to. The runtime footprint is one frozen `{ kind }` object per `defineProof` call;
`prove` returns that same object every time, and `name` wraps each value in a
frozen `{ value }`.
