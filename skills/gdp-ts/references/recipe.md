# The recipe

This is the structure the [examples](https://github.com/rauchg/gdp-ts/tree/main/examples) follow. It is deliberately
boring, so that the next person (or agent) can add a proof or a sensitive
function without rediscovering anything. The running domain is Vercel's
[Password Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection):
team admins set a password on a project, and visitors must enter it to open
the project's protected URLs.

The snippets use `@/` import aliases and a `data/` folder for the sensitive
functions. The examples use relative imports and keep that layer in
`src/data.ts` (or `src/repo.ts` with Drizzle); the structure is the same.

## 1. Brand your ids

Not part of this library, but do it first. `type ProjectId = string` lets a
host be passed as a project id; a branded type does not.

Put them in one small file, `lib/ids.ts`, that imports nothing. Every layer
imports it, and it is the one place outside `proofs/` where `as` is allowed:

```ts
// lib/ids.ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type ProjectId = Brand<string, "ProjectId">;
export type Host = Brand<string, "Host">;

export const UserId = (id: string) => id as UserId;
export const ProjectId = (id: string) => id as ProjectId; // ProjectId(req.params.id)
export const Host = (host: string) => host as Host;
```

## 2. One trusted module per fact, in `proofs/`

Each file exports an interface (the proof type) and one checking function,
and does **not** export the prover:

```ts
// proofs/token-unlocks-url.ts
import { defineProof, type Named, type Proof } from "@gdp-ts/core";
import { db } from "@/lib/db";
import type { Host } from "@/lib/ids";

const TokenUnlocksUrl = defineProof("TokenUnlocksUrl");
/** The visitor's token was issued for exactly URL `H`, for its current password. */
export interface TokenUnlocksUrl<H> extends Proof<"TokenUnlocksUrl", [H]> {}

export async function tokenUnlocksUrl<H>(
  url: Named<H, Host>,
  token: string | undefined,
): Promise<TokenUnlocksUrl<H> | null> {
  const issued = token ? await db.getToken(token) : undefined;
  const project = await db.projectOfUrl(url.value);
  return issued && project && issued.host === url.value && issued.passwordVersion === project.passwordVersion
    ? TokenUnlocksUrl.prove(url)
    : null;
}
```

Rules of thumb:

- The interface and the prover share a name. TypeScript keeps values and types
  in separate namespaces, so `TokenUnlocksUrl.prove(...)` and
  `TokenUnlocksUrl<H>` coexist (the same trick as `const Schema = z.object(); type Schema = ...`).
- Use `interface X<P> extends Proof<"X", [P]> {}`, not `type X<P> = Proof<...>`.
  A distinct interface per proof gives TypeScript a distinct symbol per proof,
  which keeps inference from confusing one kind's names with another's when a
  function accepts a union of proofs. (If you must use a type alias, wrap proof
  parameters in `NoInfer<...>`.)
- `prove(...)` takes the named values the fact is about, in the order the
  interface lists them. The proof's type says what it is about; you cannot
  accidentally mint a proof about the wrong value.
- Return `null` on failure. The caller decides what that means (401, 403,
  404, fall through to another check).
- Proofs are not only about users. `PlanIncludesPasswordProtection<P>` is
  about a project's plan, `UrlIsPublic<H>` about a URL's scope. Any
  precondition someone could forget is a candidate.
- Client-supplied values (cookies, tokens, ids in a body) prove nothing until
  a trusted module checks them against the resource, as above.
- These functions are the trusted computing base. Keep them small, and test
  them. Everything downstream is checked by the compiler.

## 3. Policies are unions

"May see the setting" is usually several facts, any of which suffices.
Express that as a union of primitive proofs, with a function that tries them
in order:

```ts
// proofs/protection-policy.ts
import type { Named } from "@gdp-ts/core";
import type { ProjectId, UserId } from "@/lib/ids";
import { userHasProjectAccess, type UserHasProjectAccess } from "./user-has-project-access";
import { userIsProjectAdmin, type UserIsProjectAdmin } from "./user-is-project-admin";

export type CanManageProtection<U, P> = UserIsProjectAdmin<U, P>;
export type CanViewProtection<U, P> = CanManageProtection<U, P> | UserHasProjectAccess<U, P>;

export const canManageProtection = userIsProjectAdmin;

export async function canViewProtection<U, P>(user: Named<U, UserId>, project: Named<P, ProjectId>) {
  return (await canManageProtection(user, project)) ?? (await userHasProjectAccess(user, project));
}

// proofs/visit-policy.ts
import type { Named } from "@gdp-ts/core";
import type { Host } from "@/lib/ids";
import { tokenUnlocksUrl, type TokenUnlocksUrl } from "./token-unlocks-url";
import { urlIsPublic, type UrlIsPublic } from "./url-is-public";

export type CanVisitUrl<H> = UrlIsPublic<H> | TokenUnlocksUrl<H>;

export async function canVisitUrl<H>(url: Named<H, Host>, token: string | undefined) {
  return (await urlIsPublic(url)) ?? (await tokenUnlocksUrl(url, token));
}
```

These files assert nothing on their own, so they need no `defineProof` and
nothing in them is trusted. `kind` is a real field, so these are discriminated unions:
`switch (proof.kind)` tells you *why* access was granted, which is exactly
what an audit log wants.

## 4. Sensitive functions demand proofs

```ts
export function readProtection<U, P>(
  project: Named<P, ProjectId>,
  _proof: CanViewProtection<U, P>,
): Promise<ProtectionView>;

export function servePage<H>(url: Named<H, Host>, _proof: CanVisitUrl<H>): Promise<string>;
```

When a function needs several facts, take them as an object; each missing or
mismatched proof is a separate, named compile error:

```ts
_proofs: { manage: CanManageProtection<U, P>; plan: PlanIncludesPasswordProtection<P> }
```

If the function records *who* acted (an `updatedBy` column, an audit log),
take the actor as a named argument too, so a proof about someone else cannot
be passed for them:

```ts
export function setPasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  actor: Named<U, UserId>, // recorded as updatedBy; the proofs must be about this user
  setting: { deploymentType: DeploymentType; password: string },
  _proofs: { manage: CanManageProtection<U, P>; plan: PlanIncludesPasswordProtection<P> },
): Promise<void>;
```

The examples take the actor in `disablePasswordProtection` too; the snippets
here leave it out to stay short.

The proof is usually unused at runtime; `_proof` says so. Put the demand as
low as is practical: if your data layer demands proofs, a route or job written
next year cannot touch protected rows without authorization, because it will
not compile. See [`examples/express-drizzle/src/repo.ts`](https://github.com/rauchg/gdp-ts/blob/main/examples/express-drizzle/src/repo.ts).

## 5. Name and prove in the handler, turn `null` into a response

The code that calls the sensitive function (a route body, a Server Action, a
job) names the values it is about to act on, obtains proofs, and reuses them
for every sensitive call in the request. Do this in the handler body, not in
middleware: middleware can only pass a boolean along.

```ts
// app.ts
import { name } from "@gdp-ts/core";
import { disablePasswordProtection, readProtection, setPasswordProtection } from "@/data/projects";
import { servePage } from "@/data/sites";
import { Host, ProjectId } from "@/lib/ids";
import { parseChange } from "@/lib/request"; // body validation (zod, valibot, by hand)
import { app, authenticated, HttpError } from "@/lib/server";
import { planIncludesPasswordProtection } from "@/proofs/plan-includes-password-protection";
import { canManageProtection } from "@/proofs/protection-policy";
import { canVisitUrl } from "@/proofs/visit-policy";

app.patch(
  "/projects/:id/password-protection",
  authenticated((viewer, req, res) =>
    name(viewer.id, ProjectId(req.params.id), async (user, project) => {
      const manage = await canManageProtection(user, project);
      if (!manage) throw new HttpError(403, "Only Owners and Members can change this");

      const change = parseChange(req.body);
      if (change === null) {
        await disablePasswordProtection(project, manage);
      } else {
        const plan = await planIncludesPasswordProtection(project);
        if (!plan) throw new HttpError(403, "Not available on the Hobby plan");
        await setPasswordProtection(project, user, change, { manage, plan });
      }

      res.json(await readProtection(project, manage)); // a manage proof is a view proof
    }),
  ),
);

app.get("/", (req, res) =>
  name(Host(req.hostname), async (url) => {
    const proof = await canVisitUrl(url, req.cookies.protection_token);
    if (!proof) throw new HttpError(401, "Password required");
    res.send(await servePage(url, proof));
  }),
);
```

`setPasswordProtection` here is the actor-recording version from step 4:
`user` is passed so the setting records who changed it, and the manage proof
must be about that same user.

Names and proofs cannot leave the callback (returning one is a compile
error), so do the work inside it, including sending the response.

If the same check-and-act is likely to be needed from many places (a route, a
Server Action, a job), consider moving the `name(...)` block into a function
they all call, taking plain inputs such as the user and the raw ids and
returning plain data. If it has one caller, keeping it in the handler is fine.
Use your judgment; either way the guarantees are the same.

## 6. Turn on the lint preset

TypeScript cannot stop `{} as UserIsProjectAdmin<U, P>`. It can make the
honest path never need an assertion, so the ways of forging or minting a
proof stand out, and gdp-ts ships lint rules that make them errors. They run
under ESLint and under Oxlint (which needs no TypeScript compiler API, so it
works on TypeScript 7).

ESLint, after your typescript-eslint setup. `tseslint.configs.recommended`
alone flags the recipe's own proof code: `no-empty-object-type` on
`interface X<P> extends Proof<...> {}` (step 2) and `no-unused-vars` on a
`_proof` parameter nothing else uses (step 4). Add the two overrides below
to keep those quiet; `examples/express-basic/eslint.config.js` runs the
exact same two.

```js
// eslint.config.js
import gdp from "@gdp-ts/core/lint/eslint";
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // `interface X<P> extends Proof<"X", [P]> {}` is the proof recipe.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
      // Proof parameters are frequently unused at runtime; name them `_proof`.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  ...gdp(),
];
```

Oxlint:

```ts
// oxlint.config.ts
import gdp from "@gdp-ts/core/lint/oxlint";

export default gdp();
```

The rules, all syntactic (no type information, so they are fast):

| Rule | Applies | Catches |
|---|---|---|
| `gdp-ts/no-define-proof` | outside `proofs/` | Importing or calling `defineProof`: minting proofs anywhere but a trusted module. |
| `gdp-ts/no-exported-prover` | inside `proofs/` | Exporting a prover (directly, via `export { X }`, or as a default export). |
| `gdp-ts/no-proof-assertion` | outside `proofs/` | Type assertions to `Named`, `Proof`, or any type imported from a `proofs` path: `{} as UserIsProjectAdmin<U, P>`. |
| `gdp-ts/no-type-assertion` | strict mode | Every other `as` / `<T>x` (except `as const`). |
| `gdp-ts/no-any` | strict mode | Every `any`, which silently satisfies any proof parameter. |

The default mode is safe to turn on in an existing codebase: it only objects
to code that touches proofs. It cannot see `null as any` handed straight to a
proof parameter; strict mode can, by banning `as` and `any` outside the
trusted modules altogether. Use it for new code, or once a codebase is clean:

```js
gdp({
  strict: true,
  proofs: ["src/proofs/**"],          // trusted modules (default: **/proofs/**)
  allowAssertions: ["src/lib/ids.ts"], // strict mode: files that may still use `as` (default: **/lib/ids.ts)
});
```

The examples run both presets in strict mode:
[`express-basic`](https://github.com/rauchg/gdp-ts/blob/main/examples/express-basic/eslint.config.js)
with ESLint, [`express-drizzle`](https://github.com/rauchg/gdp-ts/blob/main/examples/express-drizzle/oxlint.config.ts)
with Oxlint. (Oxlint's JS plugin support, which the rules use there, is still
marked alpha by Oxlint.)
