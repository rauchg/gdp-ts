# express-drizzle

Vercel-style Password Protection over HTTP, both sides, with proofs backed by
real SQL and a data layer that demands proofs.

Uses Drizzle on [PGlite](https://pglite.dev) (Postgres compiled to WASM,
in-process, in-memory) so there is nothing to install or start. Swap the
driver for `drizzle-orm/node-postgres` and nothing else changes.

```sh
pnpm typecheck   # includes src/mistakes.ts
pnpm test        # seeds the database, starts the app on a random port, exercises it with fetch
pnpm start       # then: curl localhost:3000/sites/dashboard.acme.com
```

Data: team `acme` on Pro (Owner `alice`, Member `bob`, Viewer `vic`) with
projects `acme-dashboard` (All Deployments), `acme-shop` (Standard
Protection) and `acme-docs` (off); team `side` on Hobby (Owner `dan`).

| Method | Path | Needs |
|---|---|---|
| `GET` | `/projects/:id/password-protection` | `CanViewProtection`; returns the setting (never the password) and `grantedBy`, the proof's `kind` |
| `PATCH` | `/projects/:id/password-protection` with `{ "passwordProtection": {...} \| null }` | `CanManageProtection`, plus `PlanIncludesPasswordProtection` when enabling |
| `GET` | `/sites/:host` (stands in for the host header) | `CanVisitUrl`: the URL is public, or the `protection_token` cookie unlocks it |
| `POST` | `/sites/:host/password` with `{ "password": "..." }` | `PasswordAccepted`; sets a cookie scoped to that URL |

## What is different from express-basic

- **Proof modules run queries.** Roles, plans, scope and tokens are each one
  join (`src/proofs/`). The token check enforces both of Vercel's rules in
  SQL: right URL, current password version.
- **The data layer demands proofs.** Every function in `src/repo.ts` that
  reads or writes protected data takes proofs about the exact ids it
  touches, which is why they are safe to export and call from anywhere. A
  route or job added next year cannot serve a protected URL or change a
  setting without authorization: `src/mistakes.ts` shows it does not
  compile.
- **Routes name and prove in their own body.** Middleware only
  authenticates; each route in `src/app.ts` names the ids, gets proofs and
  calls `repo.ts`. There is no separate handlers layer.
- **Reads that decide authorization live in `proofs/`.** They are the trusted
  computing base; everything else goes through `repo.ts` with a proof.

## Reading order

`src/schema.ts` → `src/proofs/*.ts` → `src/repo.ts` → `src/app.ts` →
`src/mistakes.ts` → `test/api.test.ts`.
