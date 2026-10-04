import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId, UserId } from "../lib/ids.ts";

const UserHasProjectAccess = defineProof("UserHasProjectAccess");
/** User `U` is on the team that owns project `P`, in any role (Viewers included). */
export interface UserHasProjectAccess<U, P> extends Proof<"UserHasProjectAccess", [U, P]> {}

export async function userHasProjectAccess<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<UserHasProjectAccess<U, P> | null> {
  const role = await db.roleInProjectTeam(user.value, project.value);
  return role ? UserHasProjectAccess.prove(user, project) : null;
}
