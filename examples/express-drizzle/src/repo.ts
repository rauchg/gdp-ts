/**
 * Data access. Every function that reads or writes protected data takes
 * proofs about the exact ids it touches, so "did anyone authorize this?" is
 * answered by the compiler for every call site, including ones that do not
 * exist yet. The proofs are unused at runtime (`_proof`).
 *
 * Reads that *decide* authorization (roles, plans, scope, passwords, tokens)
 * live in proofs/ instead; they are the trusted modules.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Named } from "gdp-ts";
import { db } from "./db.ts";
import type { Host, ProjectId, UserId } from "./lib/ids.ts";
import { hashPassword } from "./passwords.ts";
import type { PasswordAccepted } from "./proofs/password-accepted.ts";
import type { PlanIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import type { CanManageProtection, CanViewProtection } from "./proofs/protection-policy.ts";
import type { CanVisitUrl } from "./proofs/visit-policy.ts";
import { projects, protectionTokens, urls, type DeploymentType } from "./schema.ts";

/** What the team sees. Never the password. */
export interface ProtectionView {
  projectId: ProjectId;
  passwordProtection: { deploymentType: DeploymentType; updatedBy: UserId | null } | null;
}

/** Public metadata; needs no proof. Used for 404s. */
export async function projectExists(id: ProjectId): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  return row !== undefined;
}

export async function urlExists(host: Host): Promise<boolean> {
  const [row] = await db.select({ host: urls.host }).from(urls).where(eq(urls.host, host)).limit(1);
  return row !== undefined;
}

// --- team side -----------------------------------------------------------------

export async function readProtection<U, P>(
  project: Named<P, ProjectId>,
  _proof: CanViewProtection<U, P>,
): Promise<ProtectionView> {
  const [row] = await db
    .select({ deploymentType: projects.protectionDeploymentType, updatedBy: projects.protectionUpdatedBy })
    .from(projects)
    .where(eq(projects.id, project.value))
    .limit(1);
  if (!row) throw new Error(`readProtection: project ${project.value} vanished`);
  return {
    projectId: project.value,
    passwordProtection: row.deploymentType && { deploymentType: row.deploymentType, updatedBy: row.updatedBy },
  };
}

export async function setPasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  actor: Named<U, UserId>,
  setting: { deploymentType: DeploymentType; password: string },
  _proofs: { manage: CanManageProtection<U, P>; plan: PlanIncludesPasswordProtection<P> },
): Promise<void> {
  await db
    .update(projects)
    .set({
      protectionDeploymentType: setting.deploymentType,
      protectionPasswordHash: hashPassword(setting.password),
      protectionUpdatedBy: actor.value,
      passwordVersion: sql`${projects.passwordVersion} + 1`,
    })
    .where(eq(projects.id, project.value));
}

export async function disablePasswordProtection<U, P>(
  project: Named<P, ProjectId>,
  actor: Named<U, UserId>,
  _proof: CanManageProtection<U, P>,
): Promise<void> {
  await db
    .update(projects)
    .set({
      protectionDeploymentType: null,
      protectionPasswordHash: null,
      protectionUpdatedBy: actor.value,
      passwordVersion: sql`${projects.passwordVersion} + 1`,
    })
    .where(eq(projects.id, project.value));
}

// --- visitor side --------------------------------------------------------------

export async function readSite<H>(url: Named<H, Host>, _proof: CanVisitUrl<H>): Promise<{ host: Host; projectId: ProjectId }> {
  const [row] = await db.select({ host: urls.host, projectId: urls.projectId }).from(urls).where(eq(urls.host, url.value)).limit(1);
  if (!row) throw new Error(`readSite: URL ${url.value} vanished`);
  return row;
}

export async function insertToken<H>(url: Named<H, Host>, _proof: PasswordAccepted<H>): Promise<string> {
  const token = randomUUID();
  await db.insert(protectionTokens).select(
    db
      .select({ token: sql<string>`${token}`.as("token"), host: urls.host, passwordVersion: projects.passwordVersion })
      .from(urls)
      .innerJoin(projects, eq(projects.id, urls.projectId))
      .where(eq(urls.host, url.value)),
  );
  return token;
}
