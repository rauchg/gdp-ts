/**
 * Entry points: what an HTTP route, a CLI or a queue consumer runs once it
 * knows *who* is asking, if anyone. Each one names the values it acts on,
 * obtains proofs and calls data.ts, which does not compile without them.
 *
 * This example has no HTTP layer, so these are plain functions. In
 * examples/express-basic and examples/express-drizzle the same code sits
 * directly in the route callbacks.
 */
import { name } from "gdp-ts";
import { db, type DeploymentType, type User } from "./db.ts";
import type { Host, ProjectId } from "./lib/ids.ts";
import { passwordAccepted } from "./proofs/password-accepted.ts";
import { planIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "./proofs/protection-policy.ts";
import { canVisitUrl } from "./proofs/visit-policy.ts";
import {
  disablePasswordProtection,
  issueToken,
  readProtection,
  servePage,
  setPasswordProtection,
  type ProtectionView,
} from "./data.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Mirrors Vercel's API: an object to enable or update, `null` to disable. */
export type ProtectionChange = { deploymentType: DeploymentType; password: string } | null;

// --- team side ---------------------------------------------------------------

export function viewProtection(viewer: User, projectId: ProjectId): Promise<ProtectionView> {
  return name(viewer.id, projectId, async (user, project) => {
    const view = await canViewProtection(user, project);
    if (!view) throw new HttpError(403, "No access to this project");
    return readProtection(project, view);
  });
}

export function updateProtection(viewer: User, projectId: ProjectId, change: ProtectionChange): Promise<ProtectionView> {
  return name(viewer.id, projectId, async (user, project) => {
    const manage = await canManageProtection(user, project);
    if (!manage) throw new HttpError(403, "Only Owners and Members can change this");

    if (change === null) {
      await disablePasswordProtection(project, user, manage);
    } else {
      const plan = await planIncludesPasswordProtection(project);
      if (!plan) throw new HttpError(403, "Not available on the Hobby plan");
      await setPasswordProtection(project, user, change, { manage, plan });
    }

    // A manage proof is also a view proof, so no second check is needed.
    return readProtection(project, manage);
  });
}

// --- visitor side ------------------------------------------------------------

async function ensureUrlExists(host: Host): Promise<void> {
  if (!(await db.getUrl(host))) throw new HttpError(404, "Not found");
}

export async function visit(host: Host, token: string | undefined): Promise<string> {
  await ensureUrlExists(host);
  return name(host, async (url) => {
    const proof = await canVisitUrl(url, token);
    if (!proof) throw new HttpError(401, "Password required");
    return servePage(url, proof);
  });
}

export async function submitPassword(host: Host, password: string): Promise<string> {
  await ensureUrlExists(host);
  return name(host, async (url) => {
    const accepted = await passwordAccepted(url, password);
    if (!accepted) throw new HttpError(401, "Incorrect password");
    return issueToken(url, accepted);
  });
}
