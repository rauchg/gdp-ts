# Type-check cost benchmark

How much does gdp-ts cost the TypeScript type checker in a large codebase?
This directory generates two synthetic codebases with the same files, the same
exported functions, and the same module graph. They differ only in how they
authorize: one uses plain boolean checks, the other uses gdp-ts names and
proofs. It then compares `tsc --extendedDiagnostics` for both from 1,000 to
20,000 files on TypeScript 7.0.2, 6.0.3, and 5.9.3.

## Conclusion

In a synthetic 20,000-file codebase where every handler authorizes with gdp-ts,
TypeScript 7.0.2 checks the gdp version in 6.8 s versus 1.2 s for the same code
using boolean checks (8.2 s vs 4.0 s total, 4.7 GB vs 1.2 GB memory). That is
about 0.3 ms of check time and 0.18 MB of checker memory per `name()` call
site: linear and cheap per use, but not free. TypeScript 5.9/6.0 cannot check
the 20,000-file gdp variant within Node's default 4 GB heap.

The extra cost scales with how much code uses names and proofs (the per-site
cost is flat from 1k to 20k files), not with total codebase size. Here nearly
every line is authorization code. In a real application, where authorization
is a small part of the code, the whole-program ratio should be proportionally
smaller than the 5-6x measured here, though this benchmark does not measure
that. To estimate your own cost, multiply your number of `name()` call sites
by the [per-site figures](#marginal-cost-per-name-call-site).

## What gets generated

`node bench/generate.ts --files N` computes one seeded structure and writes it
twice: to `bench/out/baseline-N/` and `bench/out/gdp-N/`. Each output dir is a
standalone project with its own `tsconfig.json` and `package.json`. The gdp
variant imports the library from this repository's `src/index.ts` through a
relative path.

- `src/core/`: branded ids for 20 resource kinds, a small async in-memory
  table, `HttpError`, `User`.
- Packages (feature areas such as `billing`, `builds`, `edge`, ...; 6 at 1k
  files, 124 at 20k). Each package holds a random 9-20 of the 20 resource
  kinds, with parents always included: team, project, deployment, domain, env
  var, alias, check run, certificate, log drain, firewall rule, cron job,
  secret, webhook, integration, membership, invitation, edge config, store,
  access group, billing account.
- Each resource kind in each package gets 11-12 files:

| File | baseline | gdp |
| --- | --- | --- |
| `db.ts`, `model.ts` | identical | identical |
| 6-7 auth modules | `checks/*.ts`: `async (userId, id) => boolean` | `proofs/*.ts`: one trusted module per proof (`const X = defineProof(...)`, `export interface X<U, P> extends Proof<...> {}`, a check returning `X<U, P> \| null`). Kinds: owner, admin, editor, access, plan allows feature, unlocked, and belongs-to-parent (`[X, P]`) for child kinds |
| `policy.ts` | `canDelete`/`canEdit`/`canView` returning `boolean` | `CanDelete = Owner \| Admin`, `CanEdit = CanDelete \| Editor`, `CanView = CanEdit \| Access` (unions of 2, 3, and 4 proof interfaces), with `??` chains as in `examples/basic` |
| `service.ts` | 6-9 sensitive functions taking branded ids | the same functions taking `Named<X, Id>` plus a proof or a proofs object, e.g. `{ edit: CanEditX<U, X>; plan: XPlanAllowsF<X>; unlocked: XIsUnlocked<X> }`. Child kinds add `create` (parent proofs), `readVia<Parent>` and `move` (3 names) |
| `handlers.ts` | 7-10 handlers: `if (!(await canEditX(viewer.id, id))) throw ...` | the same handlers with `name()` over 1-3 values; `removeMany<Kind>s` nests `name()` inside a loop |

- `routes.ts` in each package imports every `handlers.ts` in that package, and
  `main.ts` imports every package's routes.
- Cross-package links: about 2 per package. A handler composes the policy and
  service of the same kind from an earlier package, about the same named id.
- Deliberate mistakes: every 25th resource module gets a `<kind>Mistakes`
  function. In gdp, it has 4 `// @ts-expect-error` lines: a proof about another
  resource, a raw id instead of a named value, a missing proof, and a proofs
  object missing a field. tsc fails on an unused `@ts-expect-error`, so a
  passing run shows the checks are live at every size. (Stripping the
  directives from the 1k project produces exactly those 12 errors.) Baseline
  has the same calls, and they all compile.

Same handler, both variants:

```ts
// gdp
export function patchDeployment(viewer: User, deploymentId: DeploymentId, patch: DeploymentPatch): Promise<DeploymentView> {
  const problems = validateDeploymentPatch(patch);
  if (problems.length > 0) return Promise.reject(new HttpError(400, problems.join(", ")));
  return name(viewer.id, deploymentId, async (user, deployment) => {
    const edit = await canEditDeployment(user, deployment);
    if (!edit) throw new HttpError(403, "cannot edit this deployment");
    const unlocked = await deploymentIsUnlocked(deployment);
    if (!unlocked) throw new HttpError(423, "deployment is locked");
    await updateDeployment(deployment, user, patch, { edit, unlocked });
    return readDeployment(deployment, edit);
  });
}

// baseline
export async function patchDeployment(viewer: User, deploymentId: DeploymentId, patch: DeploymentPatch): Promise<DeploymentView> {
  const problems = validateDeploymentPatch(patch);
  if (problems.length > 0) throw new HttpError(400, problems.join(", "));
  if (!(await canEditDeployment(viewer.id, deploymentId))) throw new HttpError(403, "cannot edit this deployment");
  if (!(await deploymentIsUnlocked(deploymentId))) throw new HttpError(423, "deployment is locked");
  await updateDeployment(deploymentId, viewer.id, patch);
  return readDeployment(deploymentId);
}
```

Sizes (from each project's `manifest.json`; LOC = non-blank generated lines):

| Size | Files (each variant) | LOC baseline | LOC gdp | Packages | Resource modules | Proof kinds (`defineProof`) | `name()` call sites | `@ts-expect-error` lines |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,001 | 22,497 | 30,257 | 6 | 83 | 575 | 989 | 12 |
| 5,000 | 5,105 | 114,886 | 154,636 | 32 | 425 | 2,943 | 5,080 | 68 |
| 10,000 | 10,001 | 225,129 | 303,061 | 62 | 833 | 5,769 | 9,961 | 132 |
| 20,000 | 20,069 | 451,813 | 608,253 | 124 | 1,672 | 11,580 | 19,997 | 264 |

The gdp variant is about 35% more lines. That overhead is real: it comes from
type parameters, proof variables, and proof arguments.

## Method

- Command: `tsc -p bench/out/<variant>-<size>/tsconfig.json --extendedDiagnostics`.
  `bench/run.ts` runs it and parses Files, Lines, Types, Instantiations, Memory
  used, Check time, and Total time.
- Every configuration gets 1 discarded warm-up run, then 5 recorded runs.
  Runs are interleaved across all projects in one invocation
  (A B C ... A B C ...), so background drift hits every project alike. Each
  metric's median is taken independently. Raw runs are kept in
  [`results.json`](./results.json).
- TypeScript 7.0.2 (primary) is the workspace's `node_modules/.bin/tsc`, the
  native Go compiler. By default it checks with 4 checkers in parallel. The
  `--singleThreaded` rows use one checker. With several checkers, TS 7's
  Types/Instantiations are summed across checkers, so they are higher than the
  single-threaded counts for the same program.
- TypeScript 5.9.3 and 6.0.3 run via `pnpm dlx --package=typescript@<v> tsc` on
  Node 24.15.0. Node's default heap limit on this machine is 4,288 MB. The
  20k gdp project runs out of memory there, so 20k was also run with
  `NODE_OPTIONS=--max-old-space-size=16384` (the "16 GB heap" label).
- "Memory used" is what tsc reports: the Go heap for TS 7, the V8 heap for
  5.x/6.x. It is not RSS, and is not strictly comparable across major versions.
- "tsc Lines" is tsc's own count, which includes the `lib.es2022*.d.ts` files
  and, for gdp, `src/index.ts`.
- Generated `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"]
}
```

`lib` and `types` are pinned so that all three TypeScript versions load the
same files. (TS 6 changed the default for `types`, and the generated code needs
neither DOM nor Node types.)

## Reproduce

From the repository root (brace expansion needs bash or zsh):

```sh
for n in 1000 5000 10000 20000; do node bench/generate.ts --files $n; done

node bench/run.ts --ts local bench/out/{baseline,gdp}-{1000,5000,10000,20000}
node bench/run.ts --ts local --label '7.0.2 --singleThreaded' bench/out/{baseline,gdp}-{1000,5000,10000,20000} -- --singleThreaded
node bench/run.ts --ts 5.9.3 bench/out/{baseline,gdp}-{1000,5000,10000,20000}
node bench/run.ts --ts 6.0.3 bench/out/{baseline,gdp}-{1000,5000,10000,20000}
node bench/run.ts --ts 5.9.3 --label '5.9.3, 16 GB heap' --node-options=--max-old-space-size=16384 bench/out/{baseline,gdp}-20000
node bench/run.ts --ts 6.0.3 --label '6.0.3, 16 GB heap' --node-options=--max-old-space-size=16384 bench/out/{baseline,gdp}-20000

# where the time goes (cumulative root sets, see "Where the time goes");
# the recorded run used --label '7.0.2 --singleThreaded, loaded machine'
node bench/run.ts --ts local --label '7.0.2 --singleThreaded' \
  --config tsconfig.layer1-core.json --config tsconfig.layer2-data.json --config tsconfig.layer3-auth.json \
  --config tsconfig.layer4-policy.json --config tsconfig.layer5-service.json --config tsconfig.layer6-all.json \
  bench/out/{baseline,gdp}-10000 -- --singleThreaded

node bench/report.ts   # prints the tables below from bench/results.json
```

A single check is just `node_modules/.bin/tsc -p bench/out/gdp-5000/tsconfig.json --extendedDiagnostics`.

## Machine

- Apple M5, 10 cores (4 performance + 6 efficiency), 32 GB RAM
  (`sysctl -n machdep.cpu.brand_string hw.ncpu hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu hw.memsize`)
- macOS 27.0.1 (26A434), on AC power, Low Power Mode off
- Node 24.15.0, pnpm 12.1.0
- Not an idle machine: see [caveats](#caveats).

## Results

All values are medians of 5 runs. In the per-version tables, gdp cells show the
change versus baseline at the same size.

### Summary: baseline vs gdp

Check-time cells show the median with the min–max of the 5 runs in parentheses.

| TS | Size | Check baseline | Check gdp | Check delta | Total baseline | Total gdp | Total delta | Memory baseline | Memory gdp | Memory delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7.0.2 | 1,000 | 0.06 s (0.05–0.06) | 0.34 s (0.32–0.36) | +500% (6.0x) | 0.14 s | 0.42 s | +211% | 67 MB | 247 MB | +268% |
| 7.0.2 | 5,000 | 0.31 s (0.30–0.34) | 1.69 s (1.62–1.89) | +452% (5.5x) | 0.67 s | 2.29 s | +241% | 314 MB | 1,213 MB | +287% |
| 7.0.2 | 10,000 | 0.55 s (0.53–0.57) | 3.32 s (3.25–3.85) | +499% (6.0x) | 1.92 s | 4.68 s | +144% | 605 MB | 2,367 MB | +291% |
| 7.0.2 | 20,000 | 1.17 s (1.15–1.27) | 6.78 s (6.72–7.22) | +480% (5.8x) | 4.04 s | 8.20 s | +103% | 1,207 MB | 4,743 MB | +293% |
| 7.0.2 --singleThreaded | 1,000 | 0.06 s (0.06–0.06) | 0.32 s (0.31–0.34) | +413% (5.1x) | 0.22 s | 0.47 s | +120% | 58 MB | 207 MB | +258% |
| 7.0.2 --singleThreaded | 5,000 | 0.33 s (0.32–0.35) | 1.82 s (1.74–1.95) | +447% (5.5x) | 1.05 s | 2.60 s | +148% | 271 MB | 1,030 MB | +280% |
| 7.0.2 --singleThreaded | 10,000 | 0.67 s (0.66–0.98) | 3.63 s (3.53–4.03) | +446% (5.5x) | 2.04 s | 5.13 s | +151% | 522 MB | 2,012 MB | +285% |
| 7.0.2 --singleThreaded | 20,000 | 1.41 s (1.39–2.10) | 7.43 s (7.41–8.13) | +427% (5.3x) | 4.26 s | 10.1 s | +137% | 1,044 MB | 4,032 MB | +286% |
| 5.9.3 | 1,000 | 0.34 s (0.27–0.91) | 1.28 s (0.92–1.36) | +276% (3.8x) | 0.54 s | 1.61 s | +198% | 127 MB | 384 MB | +203% |
| 5.9.3 | 5,000 | 1.06 s (1.06–1.88) | 4.38 s (3.85–5.32) | +313% (4.1x) | 1.94 s | 5.49 s | +183% | 443 MB | 1,673 MB | +278% |
| 5.9.3 | 10,000 | 2.09 s (1.76–3.56) | 8.53 s (7.75–9.50) | +308% (4.1x) | 4.06 s | 10.7 s | +165% | 776 MB | 3,046 MB | +292% |
| 5.9.3 | 20,000 | 3.68 s (3.34–4.34) | out of memory | | 7.91 s | out of memory | | 1,484 MB | out of memory | |
| 6.0.3 | 1,000 | 0.35 s (0.33–0.48) | 1.25 s (1.17–1.40) | +257% (3.6x) | 0.59 s | 1.57 s | +166% | 121 MB | 389 MB | +222% |
| 6.0.3 | 5,000 | 1.29 s (1.25–1.41) | 4.63 s (4.52–5.46) | +259% (3.6x) | 2.41 s | 5.86 s | +143% | 443 MB | 1,686 MB | +280% |
| 6.0.3 | 10,000 | 2.33 s (2.25–2.47) | 9.11 s (8.69–67.6) | +291% (3.9x) | 4.41 s | 11.4 s | +159% | 796 MB | 3,073 MB | +286% |
| 6.0.3 | 20,000 | 4.01 s (3.76–4.70) | out of memory | | 7.91 s | out of memory | | 1,466 MB | out of memory | |
| 5.9.3, 16 GB heap | 20,000 | 4.07 s (3.72–4.71) | 19.7 s (19.6–25.1) | +383% (4.8x) | 9.07 s | 27.7 s | +205% | 1,499 MB | 6,401 MB | +327% |

- "Out of memory" is `FATAL ERROR: Ineffective mark-compacts near heap limit
  Allocation failed - JavaScript heap out of memory`, reproduced twice per
  version at the default 4,288 MB heap. It took about 20 s.
- There is no median for 6.0.3 with a 16 GB heap at 20k. Both attempts were
  ruined by background load: one run stalled for 9 minutes, and later runs
  were 4-5x slower for both variants. The batch's unloaded runs (warm-up and
  run 1) gave 4.3-4.7 s (baseline) vs 18.9 s (gdp) check time, and about
  6.4 GB for gdp, in line with 5.9.3. Types and Instantiations match 5.9.3
  exactly.
- One 6.0.3 gdp-10000 run took 67.6 s (the others took 8.7-9.8 s). The median
  is unaffected.

### Marginal cost per `name()` call site

Computed as (gdp − baseline) / number of `name()` call sites. The proofs,
policies, and sensitive functions that those sites use are amortized in. The
figure stays flat from 1k to 20k files, so the cost is linear in use.

| TS | Size | `name()` sites | Check time per site | Memory per site |
| --- | ---: | ---: | ---: | ---: |
| 7.0.2 | 1,000 | 989 | 288 µs | 186 KB |
| 7.0.2 | 5,000 | 5,080 | 273 µs | 181 KB |
| 7.0.2 | 10,000 | 9,961 | 278 µs | 181 KB |
| 7.0.2 | 20,000 | 19,997 | 280 µs | 181 KB |
| 7.0.2 --singleThreaded | 1,000 | 989 | 259 µs | 154 KB |
| 7.0.2 --singleThreaded | 5,000 | 5,080 | 293 µs | 153 KB |
| 7.0.2 --singleThreaded | 10,000 | 9,961 | 298 µs | 153 KB |
| 7.0.2 --singleThreaded | 20,000 | 19,997 | 301 µs | 153 KB |
| 5.9.3 | 1,000 | 989 | 950 µs | 267 KB |
| 5.9.3 | 5,000 | 5,080 | 654 µs | 248 KB |
| 5.9.3 | 10,000 | 9,961 | 647 µs | 233 KB |
| 6.0.3 | 1,000 | 989 | 910 µs | 277 KB |
| 6.0.3 | 5,000 | 5,080 | 657 µs | 250 KB |
| 6.0.3 | 10,000 | 9,961 | 681 µs | 234 KB |
| 5.9.3, 16 GB heap | 20,000 | 19,997 | 780 µs | 251 KB |

As a rule of thumb, 1,000 `name()` sites add about 0.3 s of check time and
180 MB on TS 7, or about 0.65 s and 240 MB on TS 5.9/6.0. That holds when
those sites are written in the style generated here: each site checks 1-3
proofs, built from 6-7 proof modules and 3 policies per resource.

### Where the time goes

`generate.ts` also writes `tsconfig.layer1-core.json` through
`tsconfig.layer6-all.json` (layer 6 is the same program as `tsconfig.json`).
Each one adds root files to the previous one, and imports pull in everything
below. All 12 (project, layer) targets ran interleaved: 10k files, TS 7
`--singleThreaded`, 5 runs.

These runs happened while macOS background jobs were slowing the machine about
4.5x: the full-program check took 15.1 s here vs 3.63 s in the clean run
above. Treat the absolute seconds as inflated. The share column holds up under
a uniform slowdown, and the instantiation and memory columns are deterministic
(identical in every run).

| Layer | Check baseline | Check gdp | Check added, baseline | Check added, gdp | Share of the extra gdp check time | Instantiations added, baseline | Instantiations added, gdp | Memory baseline | Memory gdp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| core (ids, db helpers, http, session) | 0.00 s | 0.00 s | +0.00 s | +0.00 s | 0% | +138 | +138 | 6 MB | 6 MB |
| + db.ts, model.ts (identical in both) | 0.68 s | 0.65 s | +0.68 s | +0.65 s | 0% | +62,609 | +62,609 | 142 MB | 142 MB |
| + checks/ (baseline) or proofs/ (gdp) | 0.99 s | 3.67 s | +0.31 s | +3.02 s | 22% | +0 | +672,150 | 230 MB | 627 MB |
| + policy.ts | 1.15 s | 5.82 s | +0.16 s | +2.14 s | 16% | +0 | +614,757 | 257 MB | 942 MB |
| + service.ts (sensitive functions) | 1.78 s | 7.21 s | +0.64 s | +1.39 s | 6% | +52,277 | +113,477 | 364 MB | 1,117 MB |
| + handlers.ts, routes.ts, main.ts (full program) | 3.05 s | 15.1 s | +1.26 s | +7.92 s | 55% | +59,416 | +2,424,533 | 522 MB | 2,012 MB |

- Handlers, where the `name()` calls live and where proofs flow into sensitive
  calls, account for most of it: 55% of the extra check time and 2.4M of the
  3.9M instantiations, about 240 per `name()` site.
- Proof modules: about 115 instantiations each (5,769 modules). Policy
  modules: about 740 each (833 modules, 3 functions with `??` chains each).
  Sensitive functions barely register.
- One single-run diagnostic, not scripted: copy `gdp-5000`, then rewrite every
  proof interface with explicit variance (`interface X<in out U, in out P>`).
  That cut symbols by 18%, types by 10%, instantiations by 7%, and memory by
  11% (1,054 → 936 MB), but check time did not improve (1.85 s → 1.91 s). It
  might be worth a look for memory, but it does not change the conclusion.

### Per TypeScript version

gdp cells show the change versus baseline at the same size. "tsc Lines"
includes the lib files.

#### TypeScript 7.0.2 (default: 4 checkers)

| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | baseline | 1,001 | 22,497 | 37,587 | 18,794 | 24,499 | 67 MB | 0.06 s | 0.14 s |
| 1,000 | gdp | 1,001 | 30,257 | 46,174 | 183,032 (+874%) | 419,383 (+1612%) | 247 MB (+268%) | 0.34 s (+500%) | 0.42 s (+211%) |
| 5,000 | baseline | 5,105 | 114,886 | 148,353 | 88,225 | 124,973 | 314 MB | 0.31 s | 0.67 s |
| 5,000 | gdp | 5,105 | 154,636 | 191,640 | 928,342 (+952%) | 2,159,827 (+1628%) | 1,213 MB (+287%) | 1.69 s (+452%) | 2.29 s (+241%) |
| 10,000 | baseline | 10,001 | 225,129 | 280,523 | 170,744 | 244,075 | 605 MB | 0.55 s | 1.92 s |
| 10,000 | gdp | 10,001 | 303,061 | 365,226 | 1,816,686 (+964%) | 4,233,783 (+1635%) | 2,367 MB (+291%) | 3.32 s (+499%) | 4.68 s (+144%) |
| 20,000 | baseline | 20,069 | 451,813 | 552,295 | 340,987 | 490,398 | 1,207 MB | 1.17 s | 4.04 s |
| 20,000 | gdp | 20,069 | 608,253 | 722,156 | 3,645,789 (+969%) | 8,501,850 (+1634%) | 4,743 MB (+293%) | 6.78 s (+480%) | 8.20 s (+103%) |

<details>
<summary>TypeScript 7.0.2 --singleThreaded, 5.9.3, 6.0.3, and 5.9.3 with a 16 GB heap</summary>

#### TypeScript 7.0.2 --singleThreaded

| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | baseline | 1,001 | 22,497 | 37,587 | 10,857 | 17,090 | 58 MB | 0.06 s | 0.22 s |
| 1,000 | gdp | 1,001 | 30,257 | 46,174 | 142,836 (+1216%) | 384,246 (+2148%) | 207 MB (+258%) | 0.32 s (+413%) | 0.47 s (+120%) |
| 5,000 | baseline | 5,105 | 114,886 | 148,353 | 52,328 | 89,214 | 271 MB | 0.33 s | 1.05 s |
| 5,000 | gdp | 5,105 | 154,636 | 191,640 | 728,708 (+1293%) | 1,983,046 (+2123%) | 1,030 MB (+280%) | 1.82 s (+447%) | 2.60 s (+148%) |
| 10,000 | baseline | 10,001 | 225,129 | 280,523 | 101,472 | 174,440 | 522 MB | 0.67 s | 2.04 s |
| 10,000 | gdp | 10,001 | 303,061 | 365,226 | 1,426,591 (+1306%) | 3,887,664 (+2129%) | 2,012 MB (+285%) | 3.63 s (+446%) | 5.13 s (+151%) |
| 20,000 | baseline | 20,069 | 451,813 | 552,295 | 203,083 | 351,118 | 1,044 MB | 1.41 s | 4.26 s |
| 20,000 | gdp | 20,069 | 608,253 | 722,156 | 2,864,106 (+1310%) | 7,807,618 (+2124%) | 4,032 MB (+286%) | 7.43 s (+427%) | 10.1 s (+137%) |

#### TypeScript 5.9.3

| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | baseline | 1,001 | 22,497 | 37,683 | 10,660 | 17,062 | 127 MB | 0.34 s | 0.54 s |
| 1,000 | gdp | 1,001 | 30,257 | 46,270 | 136,469 (+1180%) | 384,184 (+2152%) | 384 MB (+203%) | 1.28 s (+276%) | 1.61 s (+198%) |
| 5,000 | baseline | 5,105 | 114,886 | 148,449 | 51,328 | 89,067 | 443 MB | 1.06 s | 1.94 s |
| 5,000 | gdp | 5,105 | 154,636 | 191,736 | 695,824 (+1256%) | 1,982,679 (+2126%) | 1,673 MB (+278%) | 4.38 s (+313%) | 5.49 s (+183%) |
| 10,000 | baseline | 10,001 | 225,129 | 280,619 | 99,526 | 174,163 | 776 MB | 2.09 s | 4.06 s |
| 10,000 | gdp | 10,001 | 303,061 | 365,322 | 1,362,145 (+1269%) | 3,886,953 (+2132%) | 3,046 MB (+292%) | 8.53 s (+308%) | 10.7 s (+165%) |
| 20,000 | baseline | 20,069 | 451,813 | 552,391 | 199,161 | 350,543 | 1,484 MB | 3.68 s | 7.91 s |
| 20,000 | gdp | 20,069 | 608,253 | out of memory | out of memory | out of memory | out of memory | out of memory | out of memory |

#### TypeScript 6.0.3

| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | baseline | 1,001 | 22,497 | 37,574 | 10,660 | 17,062 | 121 MB | 0.35 s | 0.59 s |
| 1,000 | gdp | 1,001 | 30,257 | 46,161 | 136,469 (+1180%) | 384,184 (+2152%) | 389 MB (+222%) | 1.25 s (+257%) | 1.57 s (+166%) |
| 5,000 | baseline | 5,105 | 114,886 | 148,340 | 51,328 | 89,067 | 443 MB | 1.29 s | 2.41 s |
| 5,000 | gdp | 5,105 | 154,636 | 191,627 | 695,824 (+1256%) | 1,982,679 (+2126%) | 1,686 MB (+280%) | 4.63 s (+259%) | 5.86 s (+143%) |
| 10,000 | baseline | 10,001 | 225,129 | 280,510 | 99,526 | 174,163 | 796 MB | 2.33 s | 4.41 s |
| 10,000 | gdp | 10,001 | 303,061 | 365,213 | 1,362,145 (+1269%) | 3,886,953 (+2132%) | 3,073 MB (+286%) | 9.11 s (+291%) | 11.4 s (+159%) |
| 20,000 | baseline | 20,069 | 451,813 | 552,282 | 199,161 | 350,543 | 1,466 MB | 4.01 s | 7.91 s |
| 20,000 | gdp | 20,069 | 608,253 | out of memory | out of memory | out of memory | out of memory | out of memory | out of memory |

#### TypeScript 5.9.3, 16 GB heap

| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20,000 | baseline | 20,069 | 451,813 | 552,391 | 199,161 | 350,543 | 1,499 MB | 4.07 s | 9.07 s |
| 20,000 | gdp | 20,069 | 608,253 | 722,252 | 2,734,600 (+1273%) | 7,806,169 (+2127%) | 6,401 MB (+327%) | 19.7 s (+383%) | 27.7 s (+205%) |

</details>

## Caveats

- The code is synthetic and unusually dense in authorization. Every handler,
  sensitive function, and policy here is authorization code, with about one
  `name()` call per 30 lines. Real applications are mostly UI, data shaping,
  and business logic, none of which gdp-ts touches. The 5-6x check-time and 4x
  memory ratios are an upper bound for "everything uses gdp-ts", not a forecast
  for a real repository. The per-site figures transfer better than the ratios.
- The baseline is very cheap per line: no generics, no unions, just booleans
  and branded strings. Real codebases carry heavy types (ORM schemas, zod,
  tRPC, React props) that cost both variants alike. That would shrink the
  relative delta, but not the absolute per-site cost.
- What is not modeled: `lib.dom` and `@types/node` (pinned off), JSX, real
  database or ORM types, project references and `--build`, incremental
  rebuilds, and editor/tsserver latency. In an editor the cost appears per file
  as you type, not as one batch. The shape is also uniform: every resource kind
  has the same 3 policies and 6-7 proofs.
- 264 of 19,997 `name()` sites (the mistake functions) intentionally produce
  diagnostics that `@ts-expect-error` suppresses. Building those error messages
  costs a little extra, but they are 1.3% of sites.
- TS 7's Total time minus Check time (config, parse, bind) is the same work in
  both variants, but it is noisy. With 4 checkers it came out larger for
  baseline than for gdp at 20k (2.9 s vs 1.4 s); single-threaded it was equal
  (2.9 s vs 2.7 s). Check time is the metric gdp-ts affects.
- The 5.9/6.0 out-of-memory result depends on the machine. Node sizes its
  default heap from RAM (4,288 MB here), and CI runners with less memory get a
  smaller one.
- The machine was not idle. During the runs, load average ranged from about 3
  to over 30 because of macOS background jobs (`mediaanalysisd`,
  `suggestd`/`hybridsearchd`, Mail, Spotlight). The main TS 7 tables ran early,
  in a calmer window, and their run-to-run spread is small (see the min–max
  ranges). The 5.9.3 and 6.0.3 batches are noisier, but interleaving means
  noise hits baseline and gdp alike, and medians absorb outliers. Memory,
  Types, and Instantiations were the same in every run. Later, background work
  slowed every tsc run 4-6x for over an hour. A layer batch from that window
  was discarded, the 6.0.3 16 GB-heap batch is reported only as indicative,
  and the layer table above is labelled as measured under load.
