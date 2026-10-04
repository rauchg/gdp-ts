/**
 * Generates a synthetic codebase for measuring the type-check cost of gdp-ts.
 *
 *   node bench/generate.ts --files 5000                 # both variants
 *   node bench/generate.ts --files 1000 --variant gdp   # one variant
 *
 * Writes bench/out/<variant>-<files>/ with its own tsconfig.json. One seeded
 * structure (packages, resource kinds, cross-package links, where the
 * deliberate mistakes go) is computed first and then emitted twice:
 *
 *   baseline  branded ids + boolean checks:
 *               if (!(await canEditProject(viewer.id, projectId))) throw ...;
 *               await updateProject(projectId, viewer.id, patch);
 *   gdp       the gdp-ts idioms: one trusted module per proof, policies as
 *             unions of proof interfaces, sensitive functions that demand a
 *             proof (or an object of proofs) about their named arguments,
 *             handlers that name() 1-3 values, occasionally nested.
 *
 * Same files, same exported functions, same module graph. Only the
 * authorization style differs.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

type Variant = "baseline" | "gdp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const libFile = join(repoRoot, "src", "index.ts");

const { values: args } = parseArgs({
  options: {
    files: { type: "string", default: "1000" },
    variant: { type: "string", default: "both" },
    seed: { type: "string", default: "1" },
    out: { type: "string", default: join(here, "out") },
    "mistakes-every": { type: "string", default: "25" },
  },
});

const targetFiles = Number(args.files);
const seed = Number(args.seed);
const mistakesEvery = Number(args["mistakes-every"]);
if (!Number.isInteger(targetFiles) || targetFiles < 50) throw new Error("--files must be an integer >= 50");
const variants: Variant[] =
  args.variant === "both" ? ["baseline", "gdp"] : args.variant === "gdp" || args.variant === "baseline" ? [args.variant] : [];
if (variants.length === 0) throw new Error("--variant must be baseline, gdp, or both");

// ---------------------------------------------------------------------------
// Domain: resource kinds, modelled on a Vercel-like platform.

interface KindSpec {
  key: string;
  label: string;
  parent: string | null;
  /** A plan-gated feature of this resource: drives the `<Kind>PlanAllows<Feature>` proof. */
  feature: string;
}

const KIND_SPECS: KindSpec[] = [
  { key: "team", label: "team", parent: null, feature: "SamlSso" },
  { key: "project", label: "project", parent: "team", feature: "PasswordProtection" },
  { key: "deployment", label: "deployment", parent: "project", feature: "SkewProtection" },
  { key: "domain", label: "domain", parent: "project", feature: "WildcardDomains" },
  { key: "envVar", label: "environment variable", parent: "project", feature: "SensitiveValues" },
  { key: "alias", label: "alias", parent: "deployment", feature: "CustomAliases" },
  { key: "checkRun", label: "check run", parent: "deployment", feature: "BlockingChecks" },
  { key: "certificate", label: "certificate", parent: "domain", feature: "CustomCertificates" },
  { key: "logDrain", label: "log drain", parent: "project", feature: "LogDrains" },
  { key: "firewallRule", label: "firewall rule", parent: "project", feature: "CustomRules" },
  { key: "cronJob", label: "cron job", parent: "project", feature: "FrequentSchedules" },
  { key: "secret", label: "secret", parent: "project", feature: "SecretRotation" },
  { key: "webhook", label: "webhook", parent: "team", feature: "WebhookRetries" },
  { key: "integration", label: "integration", parent: "team", feature: "MarketplaceBilling" },
  { key: "membership", label: "membership", parent: "team", feature: "CustomRoles" },
  { key: "invitation", label: "invitation", parent: "team", feature: "BulkInvites" },
  { key: "edgeConfig", label: "edge config", parent: "team", feature: "ConfigBackups" },
  { key: "store", label: "store", parent: "team", feature: "ReadReplicas" },
  { key: "accessGroup", label: "access group", parent: "team", feature: "DirectorySync" },
  { key: "billingAccount", label: "billing account", parent: "team", feature: "SpendLimits" },
];

const AREAS = [
  "accounts", "analytics", "billing", "builds", "cdn", "compute", "dashboard", "edge",
  "firewall", "flags", "git", "insights", "integrations", "logs", "marketplace", "monitoring",
  "notifications", "observability", "previews", "registry", "runtime", "security", "speed", "storage",
  "support", "usage", "webhooks", "workflows", "ai", "blob", "queues", "sandbox",
];

const pascal = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^-/, "");

interface Kind {
  spec: KindSpec;
  /** camelCase, used for variables: `envVar` */
  c: string;
  /** PascalCase, used for types: `EnvVar` */
  P: string;
  /** Plural PascalCase: `Aliases` */
  Ps: string;
  kebab: string;
  Id: string;
  label: string;
  F: string;
  fKebab: string;
}

const KINDS = new Map<string, Kind>(
  KIND_SPECS.map((spec) => {
    const P = pascal(spec.key);
    return [
      spec.key,
      {
        spec,
        c: spec.key,
        P,
        Ps: P.endsWith("s") ? P + "es" : P + "s",
        kebab: kebab(spec.key),
        Id: P + "Id",
        label: spec.label,
        F: spec.feature,
        fKebab: kebab(spec.feature),
      },
    ];
  }),
);
const kind = (key: string) => KINDS.get(key)!;

// ---------------------------------------------------------------------------
// Structure (shared by both variants)

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

interface Pkg {
  slug: string;
  P: string;
  units: Unit[];
}

interface Unit {
  pkg: Pkg;
  k: Kind;
  parent: Kind | null;
  mistakes: boolean;
  /** Earlier packages whose policy + service for the same kind this unit's handlers also use. */
  cross: Pkg[];
}

const CORE_FILES = 4; // core/ids.ts, core/db.ts, core/http.ts, core/session.ts
const MAIN_FILES = 1; // main.ts
const unitFiles = (u: { parent: Kind | null }) => 5 /* db model policy service handlers */ + 6 + (u.parent ? 1 : 0);

const packages: Pkg[] = [];
let totalFiles = CORE_FILES + MAIN_FILES;
let unitCounter = 0;

while (totalFiles < targetFiles) {
  const i = packages.length;
  const area = AREAS[i % AREAS.length]!;
  const slug = i < AREAS.length ? area : area + String(Math.floor(i / AREAS.length) + 1);
  const pkg: Pkg = { slug, P: pascal(slug), units: [] };

  // A random subset of 9-16 kinds, closed over parents, in declaration order.
  const shuffled = [...KIND_SPECS].sort(() => rng() - 0.5);
  const chosen = new Set(shuffled.slice(0, 9 + Math.floor(rng() * 8)).map((s) => s.key));
  for (const key of [...chosen]) {
    for (let p = kind(key).spec.parent; p; p = kind(p).spec.parent) chosen.add(p);
  }
  for (const spec of KIND_SPECS) {
    if (!chosen.has(spec.key)) continue;
    const k = kind(spec.key);
    const unit: Unit = {
      pkg,
      k,
      parent: spec.parent ? kind(spec.parent) : null,
      mistakes: unitCounter % mistakesEvery === mistakesEvery - 1,
      cross: [],
    };
    unitCounter += 1;
    pkg.units.push(unit);
    totalFiles += unitFiles(unit);
  }
  totalFiles += 1; // routes.ts

  // Cross-package links: 2 kinds this package shares with an earlier package.
  if (i > 0) {
    for (const j of new Set([i - 1, Math.floor(rng() * i)])) {
      const other = packages[j]!;
      const shared = pkg.units.filter((u) => other.units.some((o) => o.k === u.k));
      const pick = shared[Math.floor(rng() * shared.length)];
      if (pick && !pick.cross.includes(other)) pick.cross.push(other);
    }
  }
  packages.push(pkg);
}

// ---------------------------------------------------------------------------
// Emitters

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const parentIdOf = (u: Unit) => (u.parent ? u.parent.Id : "UserId");
const join_ = (lines: (string | false | null | undefined)[]) => lines.filter((l) => l !== false && l != null).join("\n");

function libImport(fromFile: string): string {
  let rel = relative(dirname(fromFile), libFile);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

// --- core -------------------------------------------------------------------

function emitIds(): string {
  const ids = ["UserId", ...KIND_SPECS.map((s) => kind(s.key).Id)];
  return join_([
    "/** Branded ids. A ProjectId cannot be passed where a DeploymentId is expected. */",
    "declare const brand: unique symbol;",
    "type Brand<T, B extends string> = T & { readonly [brand]: B };",
    "",
    ...ids.flatMap((id) => [
      `export type ${id} = Brand<string, "${id}">;`,
      `export const ${id} = (id: string) => id as ${id};`,
    ]),
    "",
  ]);
}

const CORE_DB = `import type { UserId } from "./ids.ts";

export type Role = "owner" | "admin" | "editor" | "viewer";
export type Plan = "hobby" | "pro" | "enterprise";
export type Tier = "free" | "standard" | "premium";

/** A tiny async in-memory table, standing in for a real database. */
export class Table<K extends string, V extends { id: K }> {
  readonly #rows = new Map<K, V>();
  constructor(readonly name: string) {}

  async get(id: K): Promise<V | undefined> {
    return this.#rows.get(id);
  }

  async where(predicate: (row: V) => boolean): Promise<V[]> {
    return [...this.#rows.values()].filter(predicate);
  }

  async put(row: V): Promise<void> {
    this.#rows.set(row.id, row);
  }

  async patch(id: K, patch: Partial<V>): Promise<void> {
    const row = this.#rows.get(id);
    if (!row) throw new Error(this.name + ": unknown id " + id);
    this.#rows.set(id, { ...row, ...patch });
  }

  async delete(id: K): Promise<boolean> {
    return this.#rows.delete(id);
  }
}

/** Role grants per (user, resource). */
export class Roles<K extends string> {
  readonly #grants = new Map<string, Role>();
  constructor(readonly name: string) {}

  async roleOf(userId: UserId, id: K): Promise<Role | undefined> {
    return this.#grants.get(userId + "/" + id);
  }

  async grant(userId: UserId, id: K, role: Role): Promise<void> {
    this.#grants.set(userId + "/" + id, role);
  }
}

let counter = 0;
export function newId<K extends string>(prefix: string): K {
  counter += 1;
  return (prefix + "_" + counter.toString(36)) as K;
}
`;

const CORE_HTTP = `export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
`;

const CORE_SESSION = `import type { TeamId, UserId } from "./ids.ts";

/** Who is asking. Authentication happens above the handlers; authorization inside them. */
export interface User {
  id: UserId;
  email: string;
  defaultTeamId: TeamId | null;
}
`;

// --- per resource kind: same in both variants ---------------------------------

function emitDb(u: Unit): string {
  const { P, c, Id } = u.k;
  const parentId = parentIdOf(u);
  return `import { Roles, Table, type Plan, type Tier } from "../../core/db.ts";
import type { ${uniqSorted([Id, parentId, "UserId"]).join(", ")} } from "../../core/ids.ts";

export interface ${P}Settings {
  description: string;
  enabled: boolean;
  tier: Tier;
  tags: readonly string[];
  limit: number;
}

export interface ${P}Row {
  id: ${Id};
  parentId: ${parentId};
  name: string;
  plan: Plan;
  locked: boolean;
  settings: ${P}Settings;
  createdBy: UserId;
  updatedBy: UserId;
  updatedAt: number;
}

const rows = new Table<${Id}, ${P}Row>("${u.pkg.slug}.${c}");
const roles = new Roles<${Id}>("${u.pkg.slug}.${c}");

export const ${c}Db = {
  get: (id: ${Id}) => rows.get(id),
  listByParent: (parentId: ${parentId}) => rows.where((row) => row.parentId === parentId),
  roleOf: (userId: UserId, id: ${Id}) => roles.roleOf(userId, id),
  async planOf(id: ${Id}): Promise<Plan | undefined> {
    return (await rows.get(id))?.plan;
  },
  async isLocked(id: ${Id}): Promise<boolean> {
    return (await rows.get(id))?.locked ?? true;
  },
  insert: (row: ${P}Row) => rows.put(row),
  update: (id: ${Id}, patch: Partial<${P}Row>) => rows.patch(id, patch),
  remove: (id: ${Id}) => rows.delete(id),
};
`;
}

function emitModel(u: Unit): string {
  const { P, c, Id } = u.k;
  const parentId = parentIdOf(u);
  const q = u.parent;
  return join_([
    `import type { Tier } from "../../core/db.ts";`,
    `import type { ${uniqSorted([Id, parentId]).join(", ")} } from "../../core/ids.ts";`,
    q && `import type { ${q.P}View } from "../${q.kebab}/model.ts";`,
    `import type { ${P}Row, ${P}Settings } from "./db.ts";`,
    ``,
    `export interface ${P}View {`,
    `  id: ${Id};`,
    `  parentId: ${parentId};`,
    `  name: string;`,
    `  settings: ${P}Settings;`,
    `  locked: boolean;`,
    `  updatedAt: string;`,
    q && `  ${q.c}?: ${q.P}View;`,
    `}`,
    ``,
    `export type ${P}Patch = Partial<Pick<${P}Settings, "description" | "enabled" | "tags" | "limit">>;`,
    ``,
    `export interface ${P}Input {`,
    `  name: string;`,
    `  settings?: Partial<${P}Settings>;`,
    `}`,
    ``,
    `export interface ${P}Status {`,
    `  id: ${Id};`,
    `  locked: boolean;`,
    `  tier: Tier;`,
    `}`,
    ``,
    `export const default${P}Settings: ${P}Settings = { description: "", enabled: false, tier: "free", tags: [], limit: 100 };`,
    ``,
    `export function to${P}View(row: ${P}Row): ${P}View {`,
    `  return {`,
    `    id: row.id,`,
    `    parentId: row.parentId,`,
    `    name: row.name,`,
    `    settings: row.settings,`,
    `    locked: row.locked,`,
    `    updatedAt: new Date(row.updatedAt).toISOString(),`,
    `  };`,
    `}`,
    ``,
    `export function validate${P}Patch(patch: ${P}Patch): string[] {`,
    `  const problems: string[] = [];`,
    `  if (patch.limit !== undefined && (patch.limit < 0 || patch.limit > 10_000)) problems.push("limit out of range");`,
    `  if (patch.tags && patch.tags.length > 32) problems.push("too many tags");`,
    `  if (patch.description !== undefined && patch.description.length > 512) problems.push("description too long");`,
    `  return problems;`,
    `}`,
    ``,
    `export function summarize${P}Rows(rows: readonly ${P}Row[]): Record<Tier, number> {`,
    `  const counts: Record<Tier, number> = { free: 0, standard: 0, premium: 0 };`,
    `  for (const row of rows) counts[row.settings.tier] += 1;`,
    `  return counts;`,
    `}`,
    ``,
  ]);
}

// --- proofs (gdp) / checks (baseline) -----------------------------------------

interface RoleCheck {
  file: string;
  Name: string;
  fn: string;
  cond: string;
  doc: string;
}

function roleChecks(k: Kind): RoleCheck[] {
  return [
    { file: `user-is-${k.kebab}-owner`, Name: `UserIs${k.P}Owner`, fn: `userIs${k.P}Owner`, cond: `role === "owner"`, doc: "an Owner of" },
    { file: `user-is-${k.kebab}-admin`, Name: `UserIs${k.P}Admin`, fn: `userIs${k.P}Admin`, cond: `role === "admin"`, doc: "an Admin of" },
    { file: `user-is-${k.kebab}-editor`, Name: `UserIs${k.P}Editor`, fn: `userIs${k.P}Editor`, cond: `role === "editor"`, doc: "an Editor of" },
    { file: `user-has-${k.kebab}-access`, Name: `UserHas${k.P}Access`, fn: `userHas${k.P}Access`, cond: `role !== undefined`, doc: "any member of" },
  ];
}

const authDir = (v: Variant) => (v === "gdp" ? "proofs" : "checks");
const planFile = (k: Kind) => `${k.kebab}-plan-allows-${k.fKebab}`;
const unlockedFile = (k: Kind) => `${k.kebab}-is-unlocked`;
const belongsFile = (k: Kind, q: Kind) => `${k.kebab}-belongs-to-${q.kebab}`;

function emitAuthModules(u: Unit, v: Variant, dir: string): Record<string, string> {
  const { P, c, Id, label, F } = u.k;
  const kindStr = (name: string) => `${u.pkg.slug}.${name}`;
  const out: Record<string, string> = {};
  const file = (name: string) => join(dir, authDir(v), name + ".ts");

  for (const r of roleChecks(u.k)) {
    const path = file(r.file);
    out[path] =
      v === "gdp"
        ? `/** Trusted module: the only place that can mint ${r.Name} proofs. */
import { defineProof, type Named, type Proof } from "${libImport(path)}";
import type { ${Id}, UserId } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

const ${r.Name} = defineProof("${kindStr(r.Name)}");
/** User U is ${r.doc} ${label} X. */
export interface ${r.Name}<U, X> extends Proof<"${kindStr(r.Name)}", [U, X]> {}

export async function ${r.fn}<U, X>(user: Named<U, UserId>, ${c}: Named<X, ${Id}>): Promise<${r.Name}<U, X> | null> {
  const role = await ${c}Db.roleOf(user.value, ${c}.value);
  return ${r.cond} ? ${r.Name}.prove(user, ${c}) : null;
}
`
        : `/** Is the user ${r.doc} the ${label}? */
import type { ${Id}, UserId } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

export async function ${r.fn}(userId: UserId, ${c}Id: ${Id}): Promise<boolean> {
  const role = await ${c}Db.roleOf(userId, ${c}Id);
  return ${r.cond};
}
`;
  }

  {
    const path = file(planFile(u.k));
    const Name = `${P}PlanAllows${F}`;
    out[path] =
      v === "gdp"
        ? `/** Trusted module: the plan that owns ${label} X includes ${F}. Not about any user. */
import { defineProof, type Named, type Proof } from "${libImport(path)}";
import type { ${Id} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

const ${Name} = defineProof("${kindStr(Name)}");
export interface ${Name}<X> extends Proof<"${kindStr(Name)}", [X]> {}

export async function ${c}PlanAllows${F}<X>(${c}: Named<X, ${Id}>): Promise<${Name}<X> | null> {
  const plan = await ${c}Db.planOf(${c}.value);
  return plan === "pro" || plan === "enterprise" ? ${Name}.prove(${c}) : null;
}
`
        : `/** Does the plan that owns the ${label} include ${F}? */
import type { ${Id} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

export async function ${c}PlanAllows${F}(${c}Id: ${Id}): Promise<boolean> {
  const plan = await ${c}Db.planOf(${c}Id);
  return plan === "pro" || plan === "enterprise";
}
`;
  }

  {
    const path = file(unlockedFile(u.k));
    const Name = `${P}IsUnlocked`;
    out[path] =
      v === "gdp"
        ? `/** Trusted module: ${label} X is not locked (locked resources are read-only). */
import { defineProof, type Named, type Proof } from "${libImport(path)}";
import type { ${Id} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

const ${Name} = defineProof("${kindStr(Name)}");
export interface ${Name}<X> extends Proof<"${kindStr(Name)}", [X]> {}

export async function ${c}IsUnlocked<X>(${c}: Named<X, ${Id}>): Promise<${Name}<X> | null> {
  return (await ${c}Db.isLocked(${c}.value)) ? null : ${Name}.prove(${c});
}
`
        : `/** Is the ${label} unlocked? Locked resources are read-only. */
import type { ${Id} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

export async function ${c}IsUnlocked(${c}Id: ${Id}): Promise<boolean> {
  return !(await ${c}Db.isLocked(${c}Id));
}
`;
  }

  const q = u.parent;
  if (q) {
    const path = file(belongsFile(u.k, q));
    const Name = `${P}BelongsTo${q.P}`;
    out[path] =
      v === "gdp"
        ? `/** Trusted module: ${label} X belongs to ${q.label} P, so a proof about P can authorize work on X. */
import { defineProof, type Named, type Proof } from "${libImport(path)}";
import type { ${uniqSorted([Id, q.Id]).join(", ")} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

const ${Name} = defineProof("${kindStr(Name)}");
export interface ${Name}<X, P> extends Proof<"${kindStr(Name)}", [X, P]> {}

export async function ${c}BelongsTo${q.P}<X, P>(${c}: Named<X, ${Id}>, ${q.c}: Named<P, ${q.Id}>): Promise<${Name}<X, P> | null> {
  const row = await ${c}Db.get(${c}.value);
  return row?.parentId === ${q.c}.value ? ${Name}.prove(${c}, ${q.c}) : null;
}
`
        : `/** Does the ${label} belong to the ${q.label}? */
import type { ${uniqSorted([Id, q.Id]).join(", ")} } from "../../../core/ids.ts";
import { ${c}Db } from "../db.ts";

export async function ${c}BelongsTo${q.P}(${c}Id: ${Id}, ${q.c}Id: ${q.Id}): Promise<boolean> {
  const row = await ${c}Db.get(${c}Id);
  return row?.parentId === ${q.c}Id;
}
`;
  }
  return out;
}

// --- policy -------------------------------------------------------------------

function emitPolicy(u: Unit, v: Variant, path: string): string {
  const { P, c, Id, label } = u.k;
  const [owner, admin, editor, access] = roleChecks(u.k) as [RoleCheck, RoleCheck, RoleCheck, RoleCheck];
  const d = authDir(v);
  if (v === "gdp") {
    return `/**
 * Who may do what with a ${label}. Policies are unions of proofs; nothing here
 * is trusted, and every delete proof is also an edit proof and a view proof.
 */
import type { Named } from "${libImport(path)}";
import type { ${Id}, UserId } from "../../core/ids.ts";
import { ${access.fn}, type ${access.Name} } from "./${d}/${access.file}.ts";
import { ${admin.fn}, type ${admin.Name} } from "./${d}/${admin.file}.ts";
import { ${editor.fn}, type ${editor.Name} } from "./${d}/${editor.file}.ts";
import { ${owner.fn}, type ${owner.Name} } from "./${d}/${owner.file}.ts";

export type CanDelete${P}<U, X> = ${owner.Name}<U, X> | ${admin.Name}<U, X>;
export type CanEdit${P}<U, X> = CanDelete${P}<U, X> | ${editor.Name}<U, X>;
export type CanView${P}<U, X> = CanEdit${P}<U, X> | ${access.Name}<U, X>;

export async function canDelete${P}<U, X>(user: Named<U, UserId>, ${c}: Named<X, ${Id}>): Promise<CanDelete${P}<U, X> | null> {
  return (await ${owner.fn}(user, ${c})) ?? (await ${admin.fn}(user, ${c}));
}

export async function canEdit${P}<U, X>(user: Named<U, UserId>, ${c}: Named<X, ${Id}>): Promise<CanEdit${P}<U, X> | null> {
  return (await canDelete${P}(user, ${c})) ?? (await ${editor.fn}(user, ${c}));
}

export async function canView${P}<U, X>(user: Named<U, UserId>, ${c}: Named<X, ${Id}>): Promise<CanView${P}<U, X> | null> {
  return (await canEdit${P}(user, ${c})) ?? (await ${access.fn}(user, ${c}));
}
`;
  }
  return `/** Who may do what with a ${label}. Owners and Admins delete, Editors edit, everyone on it views. */
import type { ${Id}, UserId } from "../../core/ids.ts";
import { ${access.fn} } from "./${d}/${access.file}.ts";
import { ${admin.fn} } from "./${d}/${admin.file}.ts";
import { ${editor.fn} } from "./${d}/${editor.file}.ts";
import { ${owner.fn} } from "./${d}/${owner.file}.ts";

export async function canDelete${P}(userId: UserId, ${c}Id: ${Id}): Promise<boolean> {
  return (await ${owner.fn}(userId, ${c}Id)) || (await ${admin.fn}(userId, ${c}Id));
}

export async function canEdit${P}(userId: UserId, ${c}Id: ${Id}): Promise<boolean> {
  return (await canDelete${P}(userId, ${c}Id)) || (await ${editor.fn}(userId, ${c}Id));
}

export async function canView${P}(userId: UserId, ${c}Id: ${Id}): Promise<boolean> {
  return (await canEdit${P}(userId, ${c}Id)) || (await ${access.fn}(userId, ${c}Id));
}
`;
}

// --- service (sensitive functions) --------------------------------------------

function emitService(u: Unit, v: Variant, path: string): string {
  const { P, c, Id, label, F } = u.k;
  const q = u.parent;
  const d = authDir(v);
  const ids = uniqSorted([Id, "UserId", ...(q ? [q.Id] : [])]).join(", ");
  const gdp = v === "gdp";
  const head = join_([
    gdp
      ? `/** Sensitive functions for ${label}s. Each demands proofs about its exact (named) arguments. */`
      : `/** Sensitive functions for ${label}s. Callers must have checked authorization first. */`,
    gdp && `import type { Named } from "${libImport(path)}";`,
    q && `import { newId } from "../../core/db.ts";`,
    `import type { ${ids} } from "../../core/ids.ts";`,
    gdp && q && `import type { CanEdit${q.P}, CanView${q.P} } from "../${q.kebab}/policy.ts";`,
    gdp && q && `import type { ${q.P}PlanAllows${q.F} } from "../${q.kebab}/${d}/${planFile(q)}.ts";`,
    `import { ${c}Db } from "./db.ts";`,
    `import { ${uniqSorted([...(q ? [`default${P}Settings`] : []), `to${P}View`]).join(", ")}, type ${P}Input, type ${P}Patch, type ${P}Status, type ${P}View } from "./model.ts";`,
    gdp && `import type { CanDelete${P}, CanEdit${P}, CanView${P} } from "./policy.ts";`,
    gdp && q && `import type { ${P}BelongsTo${q.P} } from "./${d}/${belongsFile(u.k, q)}.ts";`,
    gdp && `import type { ${P}IsUnlocked } from "./${d}/${unlockedFile(u.k)}.ts";`,
    gdp && `import type { ${P}PlanAllows${F} } from "./${d}/${planFile(u.k)}.ts";`,
    ``,
    `async function load(id: ${Id}) {`,
    `  const row = await ${c}Db.get(id);`,
    `  if (!row) throw new Error("unknown ${label} " + id);`,
    `  return row;`,
    `}`,
    ``,
  ]);

  const x = `${c}: Named<X, ${Id}>`;
  const body = gdp
    ? join_([
        `export async function read${P}<U, X>(${x}, _proof: CanView${P}<U, X>): Promise<${P}View> {`,
        `  return to${P}View(await load(${c}.value));`,
        `}`,
        ``,
        `export async function read${P}Status<X>(${x}, _proof: ${P}IsUnlocked<X>): Promise<${P}Status> {`,
        `  const row = await load(${c}.value);`,
        `  return { id: row.id, locked: row.locked, tier: row.settings.tier };`,
        `}`,
        ``,
        `export async function update${P}<U, X>(`,
        `  ${x},`,
        `  actor: Named<U, UserId>,`,
        `  patch: ${P}Patch,`,
        `  _proofs: { edit: CanEdit${P}<U, X>; unlocked: ${P}IsUnlocked<X> },`,
        `): Promise<void> {`,
        `  const row = await load(${c}.value);`,
        `  await ${c}Db.update(${c}.value, { settings: { ...row.settings, ...patch }, updatedBy: actor.value, updatedAt: Date.now() });`,
        `}`,
        ``,
        `/** ${F} is plan-gated: three facts, three proofs. */`,
        `export async function enable${P}${F}<U, X>(`,
        `  ${x},`,
        `  actor: Named<U, UserId>,`,
        `  _proofs: { edit: CanEdit${P}<U, X>; plan: ${P}PlanAllows${F}<X>; unlocked: ${P}IsUnlocked<X> },`,
        `): Promise<void> {`,
        `  const row = await load(${c}.value);`,
        `  await ${c}Db.update(${c}.value, { settings: { ...row.settings, enabled: true, tier: "premium" }, updatedBy: actor.value, updatedAt: Date.now() });`,
        `}`,
        ``,
        `export async function delete${P}<U, X>(${x}, _actor: Named<U, UserId>, _proof: CanDelete${P}<U, X>): Promise<void> {`,
        `  await ${c}Db.remove(${c}.value);`,
        `}`,
        ``,
        `export async function lock${P}<U, X>(${x}, actor: Named<U, UserId>, _proof: CanDelete${P}<U, X>): Promise<void> {`,
        `  await ${c}Db.update(${c}.value, { locked: true, updatedBy: actor.value, updatedAt: Date.now() });`,
        `}`,
        ...(q
          ? [
              ``,
              `/** Creating a ${label} is a right on the ${q.label}, not on the ${label}. */`,
              `export async function create${P}<U, P>(`,
              `  ${q.c}: Named<P, ${q.Id}>,`,
              `  actor: Named<U, UserId>,`,
              `  input: ${P}Input,`,
              `  _proofs: { edit: CanEdit${q.P}<U, P>; plan: ${q.P}PlanAllows${q.F}<P> },`,
              `): Promise<${Id}> {`,
              `  const id = newId<${Id}>("${u.k.kebab}");`,
              `  await ${c}Db.insert({`,
              `    id,`,
              `    parentId: ${q.c}.value,`,
              `    name: input.name,`,
              `    plan: "pro",`,
              `    locked: false,`,
              `    settings: { ...default${P}Settings, ...input.settings },`,
              `    createdBy: actor.value,`,
              `    updatedBy: actor.value,`,
              `    updatedAt: Date.now(),`,
              `  });`,
              `  return id;`,
              `}`,
              ``,
              `export async function read${P}Via${q.P}<U, X, P>(`,
              `  ${x},`,
              `  _${q.c}: Named<P, ${q.Id}>,`,
              `  _proofs: { view: CanView${q.P}<U, P>; belongs: ${P}BelongsTo${q.P}<X, P> },`,
              `): Promise<${P}View> {`,
              `  return to${P}View(await load(${c}.value));`,
              `}`,
              ``,
              `export async function move${P}<U, X, P>(`,
              `  ${x},`,
              `  to: Named<P, ${q.Id}>,`,
              `  actor: Named<U, UserId>,`,
              `  _proofs: { remove: CanDelete${P}<U, X>; target: CanEdit${q.P}<U, P> },`,
              `): Promise<void> {`,
              `  await ${c}Db.update(${c}.value, { parentId: to.value, updatedBy: actor.value, updatedAt: Date.now() });`,
              `}`,
            ]
          : []),
        ``,
      ])
    : join_([
        `export async function read${P}(${c}Id: ${Id}): Promise<${P}View> {`,
        `  return to${P}View(await load(${c}Id));`,
        `}`,
        ``,
        `export async function read${P}Status(${c}Id: ${Id}): Promise<${P}Status> {`,
        `  const row = await load(${c}Id);`,
        `  return { id: row.id, locked: row.locked, tier: row.settings.tier };`,
        `}`,
        ``,
        `export async function update${P}(${c}Id: ${Id}, actorId: UserId, patch: ${P}Patch): Promise<void> {`,
        `  const row = await load(${c}Id);`,
        `  await ${c}Db.update(${c}Id, { settings: { ...row.settings, ...patch }, updatedBy: actorId, updatedAt: Date.now() });`,
        `}`,
        ``,
        `/** ${F} is plan-gated: check the plan before calling this. */`,
        `export async function enable${P}${F}(${c}Id: ${Id}, actorId: UserId): Promise<void> {`,
        `  const row = await load(${c}Id);`,
        `  await ${c}Db.update(${c}Id, { settings: { ...row.settings, enabled: true, tier: "premium" }, updatedBy: actorId, updatedAt: Date.now() });`,
        `}`,
        ``,
        `export async function delete${P}(${c}Id: ${Id}, _actorId: UserId): Promise<void> {`,
        `  await ${c}Db.remove(${c}Id);`,
        `}`,
        ``,
        `export async function lock${P}(${c}Id: ${Id}, actorId: UserId): Promise<void> {`,
        `  await ${c}Db.update(${c}Id, { locked: true, updatedBy: actorId, updatedAt: Date.now() });`,
        `}`,
        ...(q
          ? [
              ``,
              `/** Creating a ${label} is a right on the ${q.label}, not on the ${label}. */`,
              `export async function create${P}(${q.c}Id: ${q.Id}, actorId: UserId, input: ${P}Input): Promise<${Id}> {`,
              `  const id = newId<${Id}>("${u.k.kebab}");`,
              `  await ${c}Db.insert({`,
              `    id,`,
              `    parentId: ${q.c}Id,`,
              `    name: input.name,`,
              `    plan: "pro",`,
              `    locked: false,`,
              `    settings: { ...default${P}Settings, ...input.settings },`,
              `    createdBy: actorId,`,
              `    updatedBy: actorId,`,
              `    updatedAt: Date.now(),`,
              `  });`,
              `  return id;`,
              `}`,
              ``,
              `export async function read${P}Via${q.P}(${c}Id: ${Id}, _${q.c}Id: ${q.Id}): Promise<${P}View> {`,
              `  return to${P}View(await load(${c}Id));`,
              `}`,
              ``,
              `export async function move${P}(${c}Id: ${Id}, toId: ${q.Id}, actorId: UserId): Promise<void> {`,
              `  await ${c}Db.update(${c}Id, { parentId: toId, updatedBy: actorId, updatedAt: Date.now() });`,
              `}`,
            ]
          : []),
        ``,
      ]);
  return head + "\n" + body;
}

// --- handlers -------------------------------------------------------------------

function emitHandlers(u: Unit, v: Variant, path: string): string {
  const { P, Ps, c, Id, label, F } = u.k;
  const q = u.parent;
  const d = authDir(v);
  const gdp = v === "gdp";
  const serviceFns = [`delete${P}`, `enable${P}${F}`, `lock${P}`, `read${P}`, `read${P}Status`, `update${P}`];
  if (q) serviceFns.push(`create${P}`, `read${P}Via${q.P}`, `move${P}`);

  const head = join_([
    `/** ${pascal(label)} handlers: authentication happened above; authorization happens here. */`,
    gdp && `import { name } from "${libImport(path)}";`,
    `import { HttpError } from "../../core/http.ts";`,
    `import type { ${uniqSorted([Id, ...(q ? [q.Id] : [])]).join(", ")} } from "../../core/ids.ts";`,
    `import type { User } from "../../core/session.ts";`,
    ...u.cross.flatMap((o) => [
      `import { canView${P} as canView${P}In${o.P} } from "../../${o.slug}/${u.k.kebab}/policy.ts";`,
      `import { read${P} as read${P}In${o.P} } from "../../${o.slug}/${u.k.kebab}/service.ts";`,
    ]),
    q && `import { canEdit${q.P}, canView${q.P} } from "../${q.kebab}/policy.ts";`,
    q && `import { ${q.c}PlanAllows${q.F} } from "../${q.kebab}/${d}/${planFile(q)}.ts";`,
    `import { validate${P}Patch, type ${P}Input, type ${P}Patch, type ${P}Status, type ${P}View } from "./model.ts";`,
    `import { canDelete${P}, canEdit${P}, canView${P} } from "./policy.ts";`,
    q && `import { ${c}BelongsTo${q.P} } from "./${d}/${belongsFile(u.k, q)}.ts";`,
    `import { ${c}IsUnlocked } from "./${d}/${unlockedFile(u.k)}.ts";`,
    `import { ${c}PlanAllows${F} } from "./${d}/${planFile(u.k)}.ts";`,
    `import { ${uniqSorted(serviceFns).join(", ")} } from "./service.ts";`,
    ``,
  ]);

  const parts: string[] = [];
  if (gdp) {
    parts.push(`export function get${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const view = await canView${P}(user, ${c});
    if (!view) throw new HttpError(404, "${label} not found");
    return read${P}(${c}, view);
  });
}

/** Public, but only for unlocked ${label}s. */
export function get${P}Status(${c}Id: ${Id}): Promise<${P}Status> {
  return name(${c}Id, async (${c}) => {
    const unlocked = await ${c}IsUnlocked(${c});
    if (!unlocked) throw new HttpError(423, "${label} is locked");
    return read${P}Status(${c}, unlocked);
  });
}

export function patch${P}(viewer: User, ${c}Id: ${Id}, patch: ${P}Patch): Promise<${P}View> {
  const problems = validate${P}Patch(patch);
  if (problems.length > 0) return Promise.reject(new HttpError(400, problems.join(", ")));
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const edit = await canEdit${P}(user, ${c});
    if (!edit) throw new HttpError(403, "cannot edit this ${label}");
    const unlocked = await ${c}IsUnlocked(${c});
    if (!unlocked) throw new HttpError(423, "${label} is locked");
    await update${P}(${c}, user, patch, { edit, unlocked });
    return read${P}(${c}, edit);
  });
}

export function enable${F}For${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const edit = await canEdit${P}(user, ${c});
    if (!edit) throw new HttpError(403, "cannot edit this ${label}");
    const [plan, unlocked] = await Promise.all([${c}PlanAllows${F}(${c}), ${c}IsUnlocked(${c})]);
    if (!plan) throw new HttpError(402, "${F} is not included in this plan");
    if (!unlocked) throw new HttpError(423, "${label} is locked");
    await enable${P}${F}(${c}, user, { edit, plan, unlocked });
    return read${P}(${c}, edit);
  });
}

export function remove${P}(viewer: User, ${c}Id: ${Id}): Promise<void> {
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const del = await canDelete${P}(user, ${c});
    if (!del) throw new HttpError(403, "only owners and admins can delete this ${label}");
    await delete${P}(${c}, user, del);
  });
}

export function freeze${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const del = await canDelete${P}(user, ${c});
    if (!del) throw new HttpError(403, "only owners and admins can lock this ${label}");
    await lock${P}(${c}, user, del);
    return read${P}(${c}, del);
  });
}

/** One user, many ${label}s: the inner name() gives each id its own name. */
export function removeMany${Ps}(viewer: User, ${c}Ids: readonly ${Id}[]): Promise<number> {
  return name(viewer.id, async (user) => {
    let removed = 0;
    for (const ${c}Id of ${c}Ids) {
      removed += await name(${c}Id, async (${c}) => {
        const del = await canDelete${P}(user, ${c});
        if (!del) return 0;
        await delete${P}(${c}, user, del);
        return 1;
      });
    }
    return removed;
  });
}`);
    if (q) {
      parts.push(`export function add${P}(viewer: User, ${q.c}Id: ${q.Id}, input: ${P}Input): Promise<${Id}> {
  return name(viewer.id, ${q.c}Id, async (user, ${q.c}) => {
    const edit = await canEdit${q.P}(user, ${q.c});
    if (!edit) throw new HttpError(403, "cannot add a ${label} to this ${q.label}");
    const plan = await ${q.c}PlanAllows${q.F}(${q.c});
    if (!plan) throw new HttpError(402, "${q.F} is not included in this plan");
    return create${P}(${q.c}, user, input, { edit, plan });
  });
}

export function get${P}In${q.P}(viewer: User, ${c}Id: ${Id}, ${q.c}Id: ${q.Id}): Promise<${P}View> {
  return name(viewer.id, ${c}Id, ${q.c}Id, async (user, ${c}, ${q.c}) => {
    const [view, belongs] = await Promise.all([canView${q.P}(user, ${q.c}), ${c}BelongsTo${q.P}(${c}, ${q.c})]);
    if (!view || !belongs) throw new HttpError(404, "${label} not found");
    return read${P}Via${q.P}(${c}, ${q.c}, { view, belongs });
  });
}

export function move${P}To(viewer: User, ${c}Id: ${Id}, to${q.P}Id: ${q.Id}): Promise<void> {
  return name(viewer.id, ${c}Id, to${q.P}Id, async (user, ${c}, target) => {
    const remove = await canDelete${P}(user, ${c});
    const edit = await canEdit${q.P}(user, target);
    if (!remove || !edit) throw new HttpError(403, "cannot move this ${label} there");
    await move${P}(${c}, target, user, { remove, target: edit });
  });
}`);
    }
    for (const o of u.cross) {
      parts.push(`/** Composes this package's view check with the ${o.slug} package's, about the same named ${label}. */
export function get${P}With${o.P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View & { ${o.slug}: ${P}View }> {
  return name(viewer.id, ${c}Id, async (user, ${c}) => {
    const [here, there] = await Promise.all([canView${P}(user, ${c}), canView${P}In${o.P}(user, ${c})]);
    if (!here || !there) throw new HttpError(404, "${label} not found");
    const [local, remote] = await Promise.all([read${P}(${c}, here), read${P}In${o.P}(${c}, there)]);
    return { ...local, ${o.slug}: remote };
  });
}`);
    }
    if (u.mistakes) {
      parts.push(`/**
 * Never called. Each marked line must stay a compile error: tsc fails on an
 * unused @ts-expect-error, so this proves the checks are live at this scale.
 */
export function ${c}Mistakes(viewer: User, a: ${Id}, b: ${Id}, patch: ${P}Patch): Promise<void> {
  return name(viewer.id, a, b, async (user, first, second) => {
    const view = await canView${P}(user, first);
    const edit = await canEdit${P}(user, first);
    const unlocked = await ${c}IsUnlocked(first);
    if (!view || !edit || !unlocked) return;
    // @ts-expect-error the proof is about the first ${label}, not the second
    await read${P}(second, view);
    // @ts-expect-error a raw id is not a named value
    await read${P}(a, view);
    // @ts-expect-error no proof at all
    await delete${P}(first, user);
    // @ts-expect-error the proofs object is missing the unlocked check
    await update${P}(first, user, patch, { edit });
  });
}`);
    }
  } else {
    parts.push(`export async function get${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  if (!(await canView${P}(viewer.id, ${c}Id))) throw new HttpError(404, "${label} not found");
  return read${P}(${c}Id);
}

/** Public, but only for unlocked ${label}s. */
export async function get${P}Status(${c}Id: ${Id}): Promise<${P}Status> {
  if (!(await ${c}IsUnlocked(${c}Id))) throw new HttpError(423, "${label} is locked");
  return read${P}Status(${c}Id);
}

export async function patch${P}(viewer: User, ${c}Id: ${Id}, patch: ${P}Patch): Promise<${P}View> {
  const problems = validate${P}Patch(patch);
  if (problems.length > 0) throw new HttpError(400, problems.join(", "));
  if (!(await canEdit${P}(viewer.id, ${c}Id))) throw new HttpError(403, "cannot edit this ${label}");
  if (!(await ${c}IsUnlocked(${c}Id))) throw new HttpError(423, "${label} is locked");
  await update${P}(${c}Id, viewer.id, patch);
  return read${P}(${c}Id);
}

export async function enable${F}For${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  if (!(await canEdit${P}(viewer.id, ${c}Id))) throw new HttpError(403, "cannot edit this ${label}");
  const [plan, unlocked] = await Promise.all([${c}PlanAllows${F}(${c}Id), ${c}IsUnlocked(${c}Id)]);
  if (!plan) throw new HttpError(402, "${F} is not included in this plan");
  if (!unlocked) throw new HttpError(423, "${label} is locked");
  await enable${P}${F}(${c}Id, viewer.id);
  return read${P}(${c}Id);
}

export async function remove${P}(viewer: User, ${c}Id: ${Id}): Promise<void> {
  if (!(await canDelete${P}(viewer.id, ${c}Id))) throw new HttpError(403, "only owners and admins can delete this ${label}");
  await delete${P}(${c}Id, viewer.id);
}

export async function freeze${P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View> {
  if (!(await canDelete${P}(viewer.id, ${c}Id))) throw new HttpError(403, "only owners and admins can lock this ${label}");
  await lock${P}(${c}Id, viewer.id);
  return read${P}(${c}Id);
}

/** One user, many ${label}s. */
export async function removeMany${Ps}(viewer: User, ${c}Ids: readonly ${Id}[]): Promise<number> {
  let removed = 0;
  for (const ${c}Id of ${c}Ids) {
    if (!(await canDelete${P}(viewer.id, ${c}Id))) continue;
    await delete${P}(${c}Id, viewer.id);
    removed += 1;
  }
  return removed;
}`);
    if (q) {
      parts.push(`export async function add${P}(viewer: User, ${q.c}Id: ${q.Id}, input: ${P}Input): Promise<${Id}> {
  if (!(await canEdit${q.P}(viewer.id, ${q.c}Id))) throw new HttpError(403, "cannot add a ${label} to this ${q.label}");
  if (!(await ${q.c}PlanAllows${q.F}(${q.c}Id))) throw new HttpError(402, "${q.F} is not included in this plan");
  return create${P}(${q.c}Id, viewer.id, input);
}

export async function get${P}In${q.P}(viewer: User, ${c}Id: ${Id}, ${q.c}Id: ${q.Id}): Promise<${P}View> {
  const [view, belongs] = await Promise.all([canView${q.P}(viewer.id, ${q.c}Id), ${c}BelongsTo${q.P}(${c}Id, ${q.c}Id)]);
  if (!view || !belongs) throw new HttpError(404, "${label} not found");
  return read${P}Via${q.P}(${c}Id, ${q.c}Id);
}

export async function move${P}To(viewer: User, ${c}Id: ${Id}, to${q.P}Id: ${q.Id}): Promise<void> {
  const remove = await canDelete${P}(viewer.id, ${c}Id);
  const edit = await canEdit${q.P}(viewer.id, to${q.P}Id);
  if (!remove || !edit) throw new HttpError(403, "cannot move this ${label} there");
  await move${P}(${c}Id, to${q.P}Id, viewer.id);
}`);
    }
    for (const o of u.cross) {
      parts.push(`/** Composes this package's view check with the ${o.slug} package's. */
export async function get${P}With${o.P}(viewer: User, ${c}Id: ${Id}): Promise<${P}View & { ${o.slug}: ${P}View }> {
  const [here, there] = await Promise.all([canView${P}(viewer.id, ${c}Id), canView${P}In${o.P}(viewer.id, ${c}Id)]);
  if (!here || !there) throw new HttpError(404, "${label} not found");
  const [local, remote] = await Promise.all([read${P}(${c}Id), read${P}In${o.P}(${c}Id)]);
  return { ...local, ${o.slug}: remote };
}`);
    }
    if (u.mistakes) {
      parts.push(`/** Never called. The same mistakes as in the gdp variant; here they all compile. */
export async function ${c}Mistakes(viewer: User, a: ${Id}, b: ${Id}, patch: ${P}Patch): Promise<void> {
  const view = await canView${P}(viewer.id, a);
  const edit = await canEdit${P}(viewer.id, a);
  const unlocked = await ${c}IsUnlocked(a);
  if (!view || !edit || !unlocked) return;
  await read${P}(b);
  await read${P}(a);
  await delete${P}(a, viewer.id);
  await update${P}(a, viewer.id, patch);
}`);
    }
  }
  return head + "\n" + parts.join("\n\n") + "\n";
}

// --- package routes and main ----------------------------------------------------

function emitRoutes(pkg: Pkg): string {
  return join_([
    `/** Every handler module of the ${pkg.slug} package, for the router. */`,
    ...pkg.units.map((u) => `import * as ${u.k.c} from "./${u.k.kebab}/handlers.ts";`),
    ``,
    `export const routes = { ${pkg.units.map((u) => u.k.c).join(", ")} };`,
    ``,
  ]);
}

function emitMain(): string {
  return join_([
    `/** The application: every package's routes. */`,
    ...packages.map((p) => `import { routes as ${p.slug} } from "./${p.slug}/routes.ts";`),
    ``,
    `export const app = { ${packages.map((p) => p.slug).join(", ")} };`,
    ``,
  ]);
}

// ---------------------------------------------------------------------------
// Write

const TSCONFIG = `{
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
`;

for (const variant of variants) {
  const outDir = join(resolve(args.out), `${variant}-${targetFiles}`);
  rmSync(outDir, { recursive: true, force: true });
  const files = new Map<string, string>();
  const add = (path: string, content: string) => {
    if (files.has(path)) throw new Error("duplicate file " + path);
    files.set(path, content);
  };
  const src = join(outDir, "src");

  add(join(src, "core", "ids.ts"), emitIds());
  add(join(src, "core", "db.ts"), CORE_DB);
  add(join(src, "core", "http.ts"), CORE_HTTP);
  add(join(src, "core", "session.ts"), CORE_SESSION);
  add(join(src, "main.ts"), emitMain());

  for (const pkg of packages) {
    add(join(src, pkg.slug, "routes.ts"), emitRoutes(pkg));
    for (const u of pkg.units) {
      const dir = join(src, pkg.slug, u.k.kebab);
      add(join(dir, "db.ts"), emitDb(u));
      add(join(dir, "model.ts"), emitModel(u));
      for (const [path, content] of Object.entries(emitAuthModules(u, variant, dir))) add(path, content);
      const policy = join(dir, "policy.ts");
      add(policy, emitPolicy(u, variant, policy));
      const service = join(dir, "service.ts");
      add(service, emitService(u, variant, service));
      const handlers = join(dir, "handlers.ts");
      add(handlers, emitHandlers(u, variant, handlers));
    }
  }

  let lines = 0;
  let nonBlank = 0;
  let nameCalls = 0;
  let proofKinds = 0;
  let expectErrors = 0;
  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    const ls = content.split("\n");
    if (ls.at(-1) === "") ls.pop();
    lines += ls.length;
    nonBlank += ls.filter((l) => l.trim() !== "").length;
    nameCalls += content.match(/\bname\(/g)?.length ?? 0;
    proofKinds += content.match(/= defineProof\(/g)?.length ?? 0;
    expectErrors += content.match(/\/\/ @ts-expect-error/g)?.length ?? 0;
  }
  writeFileSync(join(outDir, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(outDir, "package.json"), `{ "private": true, "type": "module" }\n`);
  // Diagnostic configs for "where does the time go": each layer adds root
  // files on top of the previous one (imports pull in everything below them).
  // layer6-all is the same program as tsconfig.json.
  const layers: [string, string[]][] = [
    ["layer1-core", ["src/core/*.ts"]],
    ["layer2-data", ["src/**/db.ts", "src/**/model.ts"]],
    ["layer3-auth", [`src/**/${authDir(variant)}/*.ts`]],
    ["layer4-policy", ["src/**/policy.ts"]],
    ["layer5-service", ["src/**/service.ts"]],
    ["layer6-all", ["src"]],
  ];
  layers.forEach(([layer], i) => {
    const include = layers.slice(0, i + 1).flatMap(([, globs]) => globs);
    writeFileSync(join(outDir, `tsconfig.${layer}.json`), JSON.stringify({ extends: "./tsconfig.json", include }, null, 2) + "\n");
  });

  const units = packages.reduce((n, p) => n + p.units.length, 0);
  const manifest = {
    variant,
    targetFiles,
    seed,
    files: files.size,
    lines,
    nonBlankLines: nonBlank,
    packages: packages.length,
    resourceModules: units,
    crossPackageLinks: packages.reduce((n, p) => n + p.units.reduce((m, u) => m + u.cross.length, 0), 0),
    mistakeModules: packages.reduce((n, p) => n + p.units.filter((u) => u.mistakes).length, 0),
    proofKinds,
    nameCallSites: nameCalls,
    tsExpectErrorLines: expectErrors,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${relative(process.cwd(), outDir)}: ${JSON.stringify(manifest)}`);
}
