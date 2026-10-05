/**
 * The data layer. Every function here that reads or writes protected data
 * demands proofs about its exact arguments. That is what makes it safe to
 * export: handler.ts, a job or a CLI can all call it, and none of them can
 * skip the check. Compare the "before":
 *
 *   function setPasswordProtection(projectId: ProjectId, password: string): Promise<void>
 *
 * which anyone could call from anywhere, having checked anything or nothing.
 */
import type { Named } from "@gdp-ts/core";
import { db, hashPassword, type DeploymentType } from "./db.ts";
import type { Host, ProjectId, UserId } from "./lib/ids.ts";
import type { PasswordAccepted } from "./proofs/password-accepted.ts";
import type { PlanIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import type { CanManageProtection, CanViewProtection } from "./proofs/protection-policy.ts";
import type { CanVisitUrl } from "./proofs/visit-policy.ts";

// --- team side ---------------------------------------------------------------

/** What the team sees. Never the password. */
export interface ProtectionView {
  projectId: ProjectId;
  passwordProtection: { deploymentType: DeploymentType; updatedBy: UserId } | null;
}

export async function readProtection<U, P>(
  project: Named<P, ProjectId>,
  _proof: CanViewProtection<U, P>,
): Promise<ProtectionView> {
  const row = await db.getProject(project.value);
  if (!row) throw new Error(`readProtection: unknown project ${project.value}`);
  const setting = row.passwordProtection;
  return {
    projectId: row.id,
    passwordProtection: setting && { deploymentType: setting.deploymentType, updatedBy: setting.updatedBy },
  };
}

/**
 * Two facts, two proofs; missing either is a compile error. `actor` is
 * recorded as `updatedBy`, and the manage proof must be about that actor, so
 * the audit trail cannot name someone other than who was authorized.
 */
export function setPasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  actor: Named<U, UserId>,
  setting: { deploymentType: DeploymentType; password: string },
  _proofs: { manage: CanManageProtection<U, P>; plan: PlanIncludesPasswordProtection<P> },
): Promise<void> {
  return db.writePasswordProtection(project.value, {
    deploymentType: setting.deploymentType,
    passwordHash: hashPassword(setting.password),
    updatedBy: actor.value,
  });
}

/** Turning protection off needs no plan check, only the right to manage it. */
export function disablePasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  _actor: Named<U, UserId>,
  _proof: CanManageProtection<U, P>,
): Promise<void> {
  return db.writePasswordProtection(project.value, null);
}

// --- visitor side ------------------------------------------------------------

/** Serve the deployment behind URL `H`. Impossible without a visit proof for `H`. */
export async function servePage<H>(url: Named<H, Host>, _proof: CanVisitUrl<H>): Promise<string> {
  const row = await db.getUrl(url.value);
  if (!row) throw new Error(`servePage: unknown URL ${url.value}`);
  return `<h1>${row.projectId}</h1>`;
}

/** Issue a token for URL `H` only. Impossible without the password check for `H`. */
export async function issueToken<H>(url: Named<H, Host>, proof: PasswordAccepted<H>): Promise<string> {
  // Bind the token to the version checked, even if the password changed meanwhile.
  return db.insertToken(url.value, proof.passwordVersion);
}
