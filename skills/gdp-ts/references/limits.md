# What this does not guarantee

TypeScript is not Haskell, and this is not a proof assistant. Be clear-eyed
about the boundary:

| Concern | Haskell | TypeScript, with gdp-ts |
|---|---|---|
| Forging a proof | Impossible outside the trusted module | `{} as UserIsProjectAdmin<U, P>` compiles. The honest path never needs `as`, so lint `as`/`any` outside `proofs/` (see [recipe step 6](recipe.md#6-lint-the-two-escape-hatches)) and review that directory with care. |
| Minting from the wrong place | Constructor not exported | `defineProof` is importable anywhere. Lint it to `proofs/`. |
| Phantom type parameters | Nominal | Must be used structurally or TypeScript ignores them. `Named` and `Proof` keep their names in an invariant `(n: N) => N` slot, which also survives the structural fallback TypeScript applies to discriminated-union targets. |
| Names mixing via subtyping | No subtyping | `in out` variance annotations (TS 4.7+) make `N` invariant; `never` and `unknown` are rejected. |
| Names escaping their scope | Rank-2 type error | Compile error at the callback (TS 5.6+): the result would have to be `Named<unknown, _>`, which invariance forbids, and the escaped value is typed `unknown`. TS 5.4/5.5 catch a returned `Named` or proof too, but let a name wrapped in an object leak as an unbound type parameter; it stays distinct, so a mixup is still an error, just a later and less readable one. gdp-ts requires TS 5.4 or newer. |
| Existential types | `forall` in a data constructor | A callback (`withOrg(k)`). |
| Runtime | Erased | A frozen `{ kind }` per proof kind, a frozen `{ value }` per named value. |
| Stale proofs | Same | A proof says the fact held when it was checked. Keep proofs request-scoped (the `name` callback enforces this) and use transactions or constraints where a race matters. |
| The checks themselves | Still code you wrote | Still code you wrote. Test the trusted modules; they are small. |

It also does not decide policy for you. Whether Viewers should see that a
project is password protected is a product question; gdp-ts only guarantees
that whatever you decided is checked on every path that needs it, about the
right values.
