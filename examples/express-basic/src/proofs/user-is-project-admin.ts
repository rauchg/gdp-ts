import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId, UserId } from "../lib/ids.ts";

const UserIsProjectAdmin = defineProof("UserIsProjectAdmin");
/** User `U` administers project `P`: an Owner or Member of the project's team. */
export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}

export async function userIsProjectAdmin<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<UserIsProjectAdmin<U, P> | null> {
  const role = await db.roleInProjectTeam(user.value, project.value);
  return role === "owner" || role === "member" ? UserIsProjectAdmin.prove(user, project) : null;
}
