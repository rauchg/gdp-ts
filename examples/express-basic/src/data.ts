/**
 * The data layer. Each function demands proofs about its exact arguments.
 * The proofs are unused at runtime (hence `_proof`); their job is to make
 * these functions impossible to call from a code path that has not been
 * authorized. That is also why they are safe to export: a route, a job or a
 * script can call them, and none of them can skip the check.
 */
import type { Named } from "gdp-ts";
import { db, hashPassword, type DeploymentType } from "./db.ts";
import type { ProjectId, UserId } from "./lib/ids.ts";
import type { PlanIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import type { CanManageProtection, CanViewProtection } from "./proofs/protection-policy.ts";

/** What the API returns. Never the password. */
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

export function disablePasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  _actor: Named<U, UserId>,
  _proof: CanManageProtection<U, P>,
): Promise<void> {
  return db.writePasswordProtection(project.value, null);
}
