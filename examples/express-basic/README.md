# express-basic

Vercel-style Password Protection settings over HTTP with Express 5, plus the
lint rules that close the gaps TypeScript cannot. Middleware does
authentication only. Authorization happens in each route body, right where
the data layer demands a proof; there is no separate handlers layer.

```sh
pnpm typecheck
pnpm lint        # eslint: defineProof and `as` are confined to src/proofs/ (and src/lib/ids.ts for `as`)
pnpm test        # starts the app on a random port and exercises it with fetch
pnpm start       # then: curl -H 'Authorization: Bearer vic' localhost:3000/projects/acme-dashboard/password-protection
```

Authentication is a stand-in: `Authorization: Bearer <userId>`. Team `acme`
is on Pro (Owner `alice`, Member `bob`, Viewer `vic`); team `side` is on
Hobby (Owner `dan`).

| Method | Path | Needs |
|---|---|---|
| `GET` | `/projects/:id/password-protection` | `CanViewProtection` (any role). Returns the scope and who set it, never the password. |
| `PATCH` | `/projects/:id/password-protection` with `{ "passwordProtection": { "deploymentType": "all", "password": "..." } }` or `{ "passwordProtection": null }` (the shape of Vercel's API) | `CanManageProtection` (Owner or Member), plus `PlanIncludesPasswordProtection` when enabling. The response reuses the manage proof as a view proof. |

## Reading order

| File | What it shows |
|---|---|
| `src/auth.ts` | Authentication only. Swap the scheme; nothing downstream changes. |
| `src/proofs/*.ts` | Two role proofs, the plan precondition, and the policy unions. |
| `src/data.ts` | The data layer: sensitive functions with `_proof` parameters, safe to export because of them. |
| `src/app.ts` | Routes: name, prove, 404/403, call `data.ts`. |
| `eslint.config.js` | The gdp-ts ESLint preset in strict mode ([recipe step 6](../../skills/gdp-ts/references/recipe.md#6-turn-on-the-lint-preset)). `test/lint.test.ts` checks it against every lint case. |

For the visitor side (entering the password), see `examples/basic` and
`examples/express-drizzle`.

This example pins TypeScript 6 because typescript-eslint needs the JavaScript
compiler API, which the native TypeScript 7 package does not ship. The code is
identical either way.
