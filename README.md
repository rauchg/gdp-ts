<img width="115" height="86" style="margin-bottom: -10px" alt="A pixel-art ghost carrying a TypeScript document with a green checkmark" src=".github/assets/logo.png" />

# gdp-ts

A tiny [library + linter](#the-package) and [AI skill](https://skills.sh/rauchg/gdp-ts/gdp-ts) implementation of [Ghosts of Departed Proofs](#credits) for TypeScript, a verification system to make API contracts more secure at compile (type check) time.

`gdp-ts` makes an entire category of authorization (_"can this user read this resource"_) or entitlement (_"does this user pay for this resource"_) bugs very difficult for humans and coding agents to introduce, by catching them at compile time with negligible runtime overhead.

## Features

- **Incrementally adoptable**: works with any TS codebase and any runtime, and doesn't change how you do I/O or effects.
- **Ease-to-rigor slider**: how much is exhaustively proven is up to the discretion / risk tolerance of each codebase, and [the skill](#the-skill) bundles [advice](skills/gdp-ts/references/where-to-stop.md).
- **~Zero runtime overhead**: no extra queries or dependencies. The only runtime cost is a tiny
    wrapper around the ids you check. The safety comes from type checker.
- **Cheap to typecheck**: about 0.3 ms per authorized call site on a cold TypeScript 7 check. The cost grows with how often you use it, not with codebase size ([benchmark](bench/README.md)).

## Installation
```bash
$ npx skills add rauchg/gdp-ts
$ pnpm add gdp-ts
```

Requires TypeScript 5.4 or newer.

## The problem

A lot of codebases feature code like this:

```js
async function handler(req, res) {
  await assertProjectAdmin(req.user.id, req.params.projectId); // throws 403
  await setPasswordProtection(req.params.projectId, req.body.password); // nothing connects this to the line above
  res.sendStatus(204);
}
```

Looks great, except: all it takes is
- a developer to slip and miss the first `await`
- the business rules on who gets to "change password protection" to change (say, Owners only), and one call site to keep running the old check

... for a security / business disaster to occur.

## The solution

We change the signature above from something **anyone can call from anywhere**:

```ts
function setPasswordProtection(projectId: ProjectId, password: string): Promise<void>;
```

...to forcing the caller to **present evidence (proof)** that they can do (are admin) and can get (have the plan) the thing:

```ts
function setPasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  password: string,
  _proofs: { admin: UserIsProjectAdmin<U, P>; plan: PlanIncludesPasswordProtection<P> },
): Promise<void>;
```


The skill takes care of guiding agents and humans towards this safer pattern, and away from the *[boolean blindness](https://existentialtype.wordpress.com/2011/03/15/boolean-blindness/)* problem.

## How it works

**1️⃣ Name values.** `name(x, k)` gives a runtime value a compile-time-only name `N`. Every call to `name` creates a different `N`, and `N` exists only inside the callback. For our example, wwo project ids named separately are now distinguishable to the compiler even though both are `string`:

```ts
// app.ts
import { name } from "gdp-ts";
import { disablePasswordProtection } from "@/data/projects";
import { ProjectId } from "@/lib/ids";
import { userIsProjectAdmin } from "@/proofs/user-is-project-admin";
import { app, authenticated, HttpError } from "@/lib/server"; // your Express app, auth middleware, error type

app.delete(
  "/projects/:id/password-protection",
  authenticated((viewer, req, res) => // authenticated() resolves the logged-in user
    name(viewer.id, ProjectId(req.params.id), async (user, project) => {
      const admin = await userIsProjectAdmin(user, project);
      if (!admin) throw new HttpError(403, "Only Owners and Members can change this");
      await disablePasswordProtection(project, admin);
      res.sendStatus(204);
    }),
  ),
);
```

**2️⃣ Prove facts about names.** A small *trusted module* performs a check and returns a `Proof<"UserIsProjectAdmin", [U, P]>`, or `null`. Only that module can mint that proof. At runtime a proof is a frozen `{ kind }` object.
```ts
// proofs/user-is-project-admin.ts  (trusted: the only place that can mint this proof)
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "@/lib/db";
import type { ProjectId, UserId } from "@/lib/ids";

const UserIsProjectAdmin = defineProof("UserIsProjectAdmin"); // not exported
export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}

export async function userIsProjectAdmin<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<UserIsProjectAdmin<U, P> | null> {
  const role = await db.roleInProjectTeam(user.value, project.value);
  return role === "owner" || role === "member" ? UserIsProjectAdmin.prove(user, project) : null;
}
```

**3️⃣ Demand proofs.** Sensitive functions take a proof about their exact arguments. Calling them with the wrong proof, a proof about a different value, a raw id, or no proof is a compile error 🎉

```ts
// data/projects.ts  (sensitive: demands exact proofs)
import type { Named } from "gdp-ts";
import { db } from "@/lib/db";
import type { ProjectId } from "@/lib/ids";
import type { UserIsProjectAdmin } from "@/proofs/user-is-project-admin";

export function disablePasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  _proof: UserIsProjectAdmin<U, P>,
): Promise<void> {
  return db.writePasswordProtection(project.value, null);
}
```

TL;DR:
- Middleware only authenticates. The check happens in the route body, right where its result is needed, and `disablePasswordProtection` does not compile without it.
- Because the data layer *demands* a proof instead of performing the check, it is safe to export: a route, a Server Action or a job can call it, and none of them can skip the check.
- **The proofs are *ghosts***: they do nothing at runtime, and everything at compile
time. [We rely on linting](skills/gdp-ts/references/recipe.md#6-turn-on-the-lint-preset) to prevent "cheating" (e.g: `{} as UserIsProjectAdmin<U, P>`).

## The package

[`gdp-ts`](https://www.npmjs.com/package/gdp-ts) on npm ships two things:

- **The library** (`gdp-ts`): `name()`, `defineProof()`, `Named` and `Proof`, with no dependencies.
- **The linter** (`gdp-ts/lint/eslint`, `gdp-ts/lint/oxlint`): presets for ESLint and Oxlint that catch what the type checker can't, such as forging a proof with `as` or minting one outside `proofs/` ([setup](skills/gdp-ts/references/recipe.md#6-turn-on-the-lint-preset)).

## The skill

`npx skills add rauchg/gdp-ts` installs a skill that guides coding agents
through applying the pattern in your codebase. It is plain Markdown, so it
doubles as the reference manual for humans:

- [**Workflow**](skills/gdp-ts/SKILL.md#workflow): the checklist to follow when adding or changing authorization.
- [**The recipe**](skills/gdp-ts/references/recipe.md): from branded ids to lint rules, in six steps.
  1. [Brand your ids](skills/gdp-ts/references/recipe.md#1-brand-your-ids)
  2. [One trusted module per fact, in `proofs/`](skills/gdp-ts/references/recipe.md#2-one-trusted-module-per-fact-in-proofs)
  3. [Policies are unions](skills/gdp-ts/references/recipe.md#3-policies-are-unions)
  4. [Sensitive functions demand proofs](skills/gdp-ts/references/recipe.md#4-sensitive-functions-demand-proofs)
  5. [Name and prove in the handler](skills/gdp-ts/references/recipe.md#5-name-and-prove-in-the-handler-turn-null-into-a-response)
  6. [Turn on the lint preset](skills/gdp-ts/references/recipe.md#6-turn-on-the-lint-preset)
- [**Patterns**](skills/gdp-ts/references/patterns.md): weakening for free, proofs that carry evidence, reusing proofs, facts that are not about authorization.
- [**Reading the errors**](skills/gdp-ts/references/errors.md): what the compiler catches, and what each message means.
- [**What this does not guarantee**](skills/gdp-ts/references/limits.md): forged proofs, stale proofs, and other limits of TypeScript.
- [**Where to stop**](skills/gdp-ts/references/where-to-stop.md): the ease-to-rigor slider.
- [**API**](skills/gdp-ts/SKILL.md#api): everything `gdp-ts` exports.

## Examples

All three use the same domain, loosely modeled after Vercel's
[Password Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection): team admins set a password on a project, and visitors must enter it to open the project's protected URLs.

- [**`basic`**](examples/basic): start here. No framework and in-memory data, covering both the team side (who may see and change the setting) and the visitor side (passwords and tokens), printed as scenarios. Includes `mistakes.ts`, a file of compile errors the test suite keeps honest.
- [**`express-basic`**](examples/express-basic): the team side over HTTP with Express 5. Middleware that only authenticates, routes that name and prove, and the gdp-ts ESLint preset that stops proofs from being forged.
- [**`express-drizzle`**](examples/express-drizzle): both sides with Drizzle on an in-process Postgres (PGlite). Proofs backed by SQL joins, a data layer that demands proofs, cookies scoped to one URL, HTTP tests, and the Oxlint preset on TypeScript 7.

## Relationship to other solutions

- **Policy engines** (CASL, Oso, Cerbos, Permit, OpenFGA, Zanzibar-style services): they *decide* whether a subject may act on a resource. `gdp-ts` does not: it makes sure a decision reaches the function that depends on it, about the right values. You can use both: call your engine inside a proof function and return a proof. See [`examples/express-drizzle`](examples/express-drizzle) for what "inside a proof function" looks like with plain SQL.
- **Branded / nominal types** (`ts-brand`, Effect `Brand`, hand-rolled `string & { __brand }`): a brand says what *kind* of value something is. A `name()` helps us state *which* value it is. Use brands for ids ([recipe step 1](skills/gdp-ts/references/recipe.md#1-brand-your-ids)) and names on top of them.
- **Validation libraries** (zod, valibot, ArkType): they prove facts about the *shape* of data at the edge. `gdp-ts` proves facts about *relationships* between specific values (this token, this URL), which no schema can know.
- **Haskell `gdp`**, **Rust `departed` / `mononym` / `gdp_rs`**: the same idea in languages with stronger type guarantees. `gdp-ts` is the pragmatic implementation of these ideas.

<a id="credits"></a>
## Prior art & Credits

- Matt Noonan, [`justified-containers`](https://hackage.haskell.org/package/justified-containers) (2017)
- Matt Noonan, [Ghosts of Departed Proofs](https://kataskeue.com/gdp.pdf) and [`gdp`](https://hackage.haskell.org/package/gdp) (2018)
- Ollie Charles, [Who Authorized These Ghosts!?](https://blog.ocharles.org.uk/posts/2019-08-09-who-authorized-these-ghosts.html) (2019) was a big inspiration for this project.
- Conversations with Malte Ubl about scaling security in our large TypeScript monorepo, with hundreds of active engineers + their agents.

## License

MIT
