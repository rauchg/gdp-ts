// TypeScript cannot stop `{} as UserIsProjectAdmin<U, P>`. The gdp-ts preset
// makes that, minting proofs outside src/proofs/, and leaking a prover lint
// errors. Oxlint needs no TypeScript compiler API, so it runs on TypeScript 7.
// Strict mode also bans every `as` and `any` outside src/proofs/ and
// src/lib/ids.ts: this example has no other use for them.
import gdp from "gdp-ts/lint/oxlint";

export default gdp({ strict: true });
