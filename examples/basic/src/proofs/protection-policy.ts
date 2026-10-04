/**
 * Who may see and change a project's Password Protection setting, as types.
 *
 * Policies are unions of primitive proofs. They assert nothing on their own,
 * so this file needs no `defineProof` and nothing in it is trusted. Anyone may
 * build one from a primitive proof, and anyone may `switch` on `.kind` to
 * learn *why* access was granted.
 *
 * CanManageProtection is a subset of CanViewProtection, so every manage proof
 * is also a view proof: no conversion function, no second lookup.
 */
import type { Named } from "gdp-ts";
import type { ProjectId, UserId } from "../lib/ids.ts";
import { userHasProjectAccess, type UserHasProjectAccess } from "./user-has-project-access.ts";
import { userIsProjectAdmin, type UserIsProjectAdmin } from "./user-is-project-admin.ts";

/** Owners and Members change Password Protection; Viewers cannot. */
export type CanManageProtection<U, P> = UserIsProjectAdmin<U, P>;

/** Anyone on the project's team may see whether it is on, and what it covers. */
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
  // Order only decides *which* proof you get (useful for audit logs), never
  // *whether* you get one.
  return (await canManageProtection(user, project)) ?? (await userHasProjectAccess(user, project));
}
