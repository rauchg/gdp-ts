/**
 * Type-level tests. `pnpm typecheck` fails if any `@ts-expect-error` line
 * stops erroring (the gap would have reopened) or if any "ok" line errors.
 *
 * Domain: Vercel project Password Protection (see examples/).
 */
import { defineProof, name, type NameOf, type Named, type Proof } from "../src/index.ts";

type UserId = string & { readonly __brand: "UserId" };
type ProjectId = string & { readonly __brand: "ProjectId" };
type Host = string & { readonly __brand: "Host" };

declare const userId: UserId;
declare const projectA: ProjectId;
declare const projectB: ProjectId;
declare const hostA: Host;
declare const hostB: Host;

// Trusted modules: the prover is not exported, the interface and check are.
const UserIsProjectAdmin = defineProof("UserIsProjectAdmin");
interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}
function userIsProjectAdmin<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): UserIsProjectAdmin<U, P> | null {
  return user.value.length > 0 ? UserIsProjectAdmin.prove(user, project) : null;
}

const UserHasProjectAccess = defineProof("UserHasProjectAccess");
interface UserHasProjectAccess<U, P> extends Proof<"UserHasProjectAccess", [U, P]> {}
function userHasProjectAccess<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): UserHasProjectAccess<U, P> | null {
  return user.value.length > 0 ? UserHasProjectAccess.prove(user, project) : null;
}

const PlanIncludesPasswordProtection = defineProof("PlanIncludesPasswordProtection");
interface PlanIncludesPasswordProtection<P> extends Proof<"PlanIncludesPasswordProtection", [P]> {}
function planIncludesPasswordProtection<P>(project: Named<P, ProjectId>): PlanIncludesPasswordProtection<P> | null {
  return project.value.length > 0 ? PlanIncludesPasswordProtection.prove(project) : null;
}

const UrlIsPublic = defineProof("UrlIsPublic");
interface UrlIsPublic<H> extends Proof<"UrlIsPublic", [H]> {}
function urlIsPublic<H>(url: Named<H, Host>): UrlIsPublic<H> | null {
  return url.value.length > 0 ? UrlIsPublic.prove(url) : null;
}

const TokenUnlocksUrl = defineProof("TokenUnlocksUrl");
interface TokenUnlocksUrl<H> extends Proof<"TokenUnlocksUrl", [H]> {}
function tokenUnlocksUrl<H>(token: string, url: Named<H, Host>): TokenUnlocksUrl<H> | null {
  return token.length > 0 ? TokenUnlocksUrl.prove(url) : null;
}

// A proof that carries evidence (existential via callback): the URL belongs
// to some project P, and here is proof that P's setting governs the URL.
const ProjectGovernsUrl = defineProof("ProjectGovernsUrl");
interface ProjectGovernsUrl<P, H> extends Proof<"ProjectGovernsUrl", [P, H]> {}
const UrlHasProject = defineProof("UrlHasProject");
interface UrlHasProject<H> extends Proof<"UrlHasProject", [H]> {
  withProject<R>(k: <P>(project: Named<P, ProjectId>, governs: ProjectGovernsUrl<P, H>) => R): R;
}
function urlHasProject<H>(url: Named<H, Host>): UrlHasProject<H> {
  return name(projectA, (project) => {
    const proof: UrlHasProject<H> = {
      ...UrlHasProject.prove(url),
      withProject: (k) => k(project, ProjectGovernsUrl.prove(project, url)),
    };
    return proof;
  });
}

type CanManageProtection<U, P> = UserIsProjectAdmin<U, P>;
type CanViewProtection<U, P> = CanManageProtection<U, P> | UserHasProjectAccess<U, P>;
type CanVisitUrl<H> = UrlIsPublic<H> | TokenUnlocksUrl<H>;

// Sensitive functions: need proofs about exactly these arguments.
// No `NoInfer` needed because each proof kind is its own interface.
declare function readProtection<U, P>(
  project: Named<P, ProjectId>,
  user: Named<U, UserId>,
  proof: CanViewProtection<U, P>,
): number;

declare function setPasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  password: string,
  proofs: { manage: CanManageProtection<U, P>; plan: PlanIncludesPasswordProtection<P> },
): void;

declare function servePage<H>(url: Named<H, Host>, proof: CanVisitUrl<H>): string;
declare function readGoverningProject<P, H>(project: Named<P, ProjectId>, url: Named<H, Host>, governs: ProjectGovernsUrl<P, H>): string;

// --- name: arities, inference, return value -------------------------------

const n1: number = name(1, (a) => a.value + 1);
const n2: string = name(1, "x", (a, b) => `${a.value}${b.value}`);
const n3: boolean = name(1, "x", true, (a, b, c) => a.value > 0 && b.value === "x" && c.value);
const p1: Promise<number> = name(1, async (a) => a.value);
void n1, n2, n3, p1;

// --- names are fresh and incompatible -------------------------------------

name(projectA, projectB, (a, b) => {
  const sameA: typeof a = a; // ok: same value, same name
  void sameA;

  // @ts-expect-error two values in one call get different names
  const bAsA: typeof a = b;
  void bAsA;

  name(projectA, (aAgain) => {
    // @ts-expect-error the same runtime value named twice gets two different names
    const mixed: typeof a = aAgain;
    void mixed;
  });
});

// --- names and proofs cannot escape their callback ------------------------

// @ts-expect-error a Named cannot be returned: N would have to become `unknown`
const escapedName = name(projectA, (a) => a);
// @ts-expect-error neither can a proof about it
const escapedProof = name(projectA, (a) => planIncludesPasswordProtection(a));
// Nor anything containing them. TS 5.6+ reports this line; TS 5.4/5.5 let the
// names leak as unbound type parameters instead, so the directive here is
// ts-ignore rather than ts-expect-error. Either way the leaked names stay distinct:
// @ts-ignore
const escapedPair = name(projectA, userId, (a, u) => ({ a, u }));
name(projectA, (fresh) => {
  // @ts-expect-error a leaked name never matches a live one, on any supported version
  const mixed: typeof fresh = escapedPair.a;
  void mixed;
});
void escapedName, escapedProof, escapedPair;

// ok: results that do not mention names leave freely
const result: number = name(projectA, userId, (a, u) => {
  const proof = userHasProjectAccess(u, a);
  return proof ? readProtection(a, u, proof) : 0;
});
void result;

// --- variance: never / unknown cannot sneak in ----------------------------

declare const namedNever: Named<never, ProjectId>;
declare const namedUnknown: Named<unknown, ProjectId>;
declare const proofNever: UserHasProjectAccess<never, never>;
declare const proofUnknown: UserHasProjectAccess<unknown, unknown>;

name(projectA, userId, (project, user) => {
  // @ts-expect-error Named<never, _> is not a Named<P, _>
  const a: typeof project = namedNever;
  // @ts-expect-error Named<unknown, _> is not a Named<P, _>
  const b: typeof project = namedUnknown;
  // @ts-expect-error a proof about [never, never] is not a proof about [U, P] (even via a union target)
  readProtection(project, user, proofNever);
  // @ts-expect-error a proof about [unknown, unknown] is not a proof about [U, P]
  readProtection(project, user, proofUnknown);
  void a, b;
});

// --- proofs: inferred About, wrong subject rejected ------------------------

name(userId, projectA, projectB, (user, a, b) => {
  const admin = userIsProjectAdmin(user, a);
  const access = userHasProjectAccess(user, a);
  if (!admin || !access) return;

  // ok: the proof is about (user, a)
  readProtection(a, user, admin);
  readProtection(a, user, access);

  // @ts-expect-error proof is about project a, not b
  readProtection(b, user, admin);
  // @ts-expect-error proof is about project a, not b
  readProtection(b, user, access);
  // @ts-expect-error raw id instead of a named value
  readProtection(projectA, user, admin);
  // @ts-expect-error no proof
  readProtection(a, user);
  // @ts-expect-error swapped arguments
  readProtection(user, a, admin);
  // @ts-expect-error a failed check returns null; handle it first
  readProtection(a, user, userIsProjectAdmin(user, a));

  // About is inferred as a tuple of names, in argument order.
  const about: [NameOf<typeof user>, NameOf<typeof a>] = null! as typeof admin extends Proof<string, infer A> ? A : never;
  void about;
});

// --- proofs about URLs ------------------------------------------------------

name(hostA, hostB, (a, b) => {
  const publicA = urlIsPublic(a);
  const tokenA = tokenUnlocksUrl("t", a);
  if (!publicA || !tokenA) return;

  // ok
  servePage(a, publicA);
  servePage(a, tokenA);

  // @ts-expect-error a token for one URL does not unlock another
  servePage(b, tokenA);
  // @ts-expect-error neither does "public" status
  servePage(b, publicA);
});

// --- evidence-carrying proofs hand out new names and proofs about them ------

name(hostA, hostB, (a, b) => {
  urlHasProject(a).withProject((project, governs) => readGoverningProject(project, a, governs));
  // @ts-expect-error ...about the URL the evidence came from
  urlHasProject(a).withProject((project, governs) => readGoverningProject(project, b, governs));
  name(projectA, (looked) => {
    // @ts-expect-error a project id you looked up yourself is not tied to the URL
    urlHasProject(a).withProject((_project, governs) => readGoverningProject(looked, a, governs));
  });
});

// --- several proofs at once, in an object ----------------------------------

name(userId, projectA, projectB, (user, a, b) => {
  const adminA = userIsProjectAdmin(user, a);
  const accessA = userHasProjectAccess(user, a);
  const planA = planIncludesPasswordProtection(a);
  const planB = planIncludesPasswordProtection(b);
  if (!adminA || !accessA || !planA || !planB) return;

  // ok
  setPasswordProtection(a, "pw", { manage: adminA, plan: planA });

  // @ts-expect-error viewing is not managing
  setPasswordProtection(a, "pw", { manage: accessA, plan: planA });
  // @ts-expect-error the plan check was for project b
  setPasswordProtection(a, "pw", { manage: adminA, plan: planB });
  // @ts-expect-error a missing proof is a missing property
  setPasswordProtection(a, "pw", { manage: adminA });
});

// --- unions of proofs are discriminated unions on `kind` -------------------

function narrow<U, P>(view: CanViewProtection<U, P>) {
  switch (view.kind) {
    case "UserIsProjectAdmin": {
      const o: UserIsProjectAdmin<U, P> = view;
      void o;
      break;
    }
    case "UserHasProjectAccess": {
      const m: UserHasProjectAccess<U, P> = view;
      void m;
      break;
    }
    default: {
      const exhaustive: never = view;
      void exhaustive;
    }
  }
}
void narrow;

// --- nothing is constructible without an assertion -------------------------

name(projectA, userId, (project, user) => {
  // @ts-expect-error missing the private name brand
  const forgedName: typeof project = { value: projectA };
  // @ts-expect-error missing the private about brand
  const forgedProof: UserIsProjectAdmin<NameOf<typeof user>, NameOf<typeof project>> = { kind: "UserIsProjectAdmin" };
  // @ts-expect-error a different kind is a different proof
  const wrongKind: UserIsProjectAdmin<NameOf<typeof user>, NameOf<typeof project>> = UserHasProjectAccess.prove(user, project);
  const access = userHasProjectAccess(user, project);
  if (!access) return;
  // @ts-expect-error spreading a weaker proof and overriding `kind` does not escalate it
  const escalated: UserIsProjectAdmin<NameOf<typeof user>, NameOf<typeof project>> = { ...access, kind: "UserIsProjectAdmin" };
  void forgedName, forgedProof, wrongKind, escalated;
});

// --- alternative: type aliases work too, but then use NoInfer --------------

type PlanAlias<P> = Proof<"PlanIncludesPasswordProtection", [P]>;
type StaffAlias<U> = Proof<"UserIsVercelStaff", [U]>;
declare function readAlias<U, P>(
  project: Named<P, ProjectId>,
  user: Named<U, UserId>,
  proof: NoInfer<PlanAlias<P> | StaffAlias<U>>,
): number;

const Staff = defineProof("UserIsVercelStaff");
name(userId, projectA, projectB, (user, a, b) => {
  const staff = Staff.prove(user);
  const plan = planIncludesPasswordProtection(a);
  if (!plan) return;
  readAlias(a, user, staff); // ok thanks to NoInfer (a false positive without it)
  readAlias(a, user, plan);
  // @ts-expect-error still about a, not b
  readAlias(b, user, plan);
});
