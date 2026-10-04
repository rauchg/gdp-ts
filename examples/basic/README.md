# basic

Vercel-style Password Protection with no framework and an in-memory
"database". Start here.

```sh
pnpm typecheck   # includes src/mistakes.ts: every @ts-expect-error there must still be an error
pnpm test        # tests for the trusted modules (the only code that needs runtime tests)
pnpm start       # runs the scenarios below
```

```
vic     view             acme-dashboard                     200 all deployments (set by alice)           # Viewers see the setting, never the password
dan     view             acme-dashboard                     403 No access to this project                # other teams see nothing
vic     enable           acme-docs                          403 Only Owners and Members can change this  # Viewers cannot change it
dan     enable           side-blog                          403 Not available on the Hobby plan          # not on Hobby, even for an Owner
bob     enable           acme-docs                          200 standard (set by bob)                    # Members can
visitor open             shop.acme.com                      200 <h1>acme-shop</h1>                       # Standard Protection leaves production domains public
visitor open             acme-shop-git-redesign.vercel.app  401 Password required                        # ...and protects everything else
visitor open             dashboard.acme.com                 401 Password required                        # All Deployments protects production too
visitor password         dashboard.acme.com                 401 Incorrect password                       # wrong password
visitor password         dashboard.acme.com                 200 token issued                             # right password: a token for this URL
visitor open + token     dashboard.acme.com                 200 <h1>acme-dashboard</h1>                  # the token unlocks the URL
visitor open + token     acme-dashboard-k3j9.vercel.app     401 Password required                        # ...only that URL, though it is the same deployment
alice   change password  acme-dashboard                     200 all deployments (set by alice)           # the Owner rotates the password
visitor open + token     dashboard.acme.com                 401 Password required                        # changing the password invalidates old tokens
```

## The rules

Team side:

1. Anyone on the project's team (Viewers included) can see whether Password
   Protection is on and what it covers. Nobody can read the password back.
2. Only Owners and Members can change it.
3. It is not available on Hobby, so enabling it requires the team's plan to
   include it.

Visitor side:

4. Each URL is protected by its project's setting. Standard Protection
   leaves production domains public; All Deployments protects every URL.
5. The right password earns a token for that URL only, and changing the
   password invalidates it.

## Reading order

| File | What it shows |
|---|---|
| `src/lib/ids.ts` | Branded ids (not part of gdp-ts, but step one). |
| `src/db.ts` | Teams, roles, plans, projects, URLs, tokens. |
| `src/proofs/user-is-project-admin.ts` | The trusted-module recipe: private `defineProof`, exported interface, exported check. |
| `src/proofs/user-has-project-access.ts` | The same recipe, for any role. |
| `src/proofs/plan-includes-password-protection.ts` | A precondition that is not about who is asking (rule 3). |
| `src/proofs/protection-policy.ts` | Rules 1 and 2 as unions of proofs; asserts nothing on its own. |
| `src/proofs/url-is-public.ts`, `password-accepted.ts`, `token-unlocks-url.ts` | The visitor side (rules 4 and 5); the token is client-supplied and checked against the exact URL. |
| `src/proofs/visit-policy.ts` | Public, or unlocked by a token. |
| `src/data.ts` | The data layer: every function demands proofs (two in one call for enabling), so it is safe to export. |
| `src/handler.ts` | Entry points: name, prove, 401/403, call `data.ts`. In the Express examples this code sits in the route callbacks. |
| `src/mistakes.ts` | What no longer compiles. |
| `test/proofs.test.ts` | Runtime tests for the trusted modules. |
