/**
 * Policy: Owners and Members change Password Protection; anyone on the team
 * may see it. A union of primitive proofs; this file asserts nothing on its
 * own, so nothing in it is trusted. Every manage proof is also a view proof.
 */
import type { Named } from "gdp-ts";
import type { ProjectId, UserId } from "../lib/ids.ts";
import { userHasProjectAccess, type UserHasProjectAccess } from "./user-has-project-access.ts";
import { userIsProjectAdmin, type UserIsProjectAdmin } from "./user-is-project-admin.ts";

export type CanManageProtection<U, P> = UserIsProjectAdmin<U, P>;
export type CanViewProtection<U, P> = CanManageProtection<U, P> | UserHasProjectAccess<U, P>;

export function canManageProtection<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<CanManageProtection<U, P> | null> {
  return userIsProjectAdmin(user, project);
}

export async function canViewProtection<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<CanViewProtection<U, P> | null> {
  return (await canManageProtection(user, project)) ?? (await userHasProjectAccess(user, project));
}
