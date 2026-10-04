import { and, eq } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId, UserId } from "../lib/ids.ts";
import { memberships, projects } from "../schema.ts";

const UserHasProjectAccess = defineProof("UserHasProjectAccess");
/** User `U` is on the team that owns project `P`, in any role (Viewers included). */
export interface UserHasProjectAccess<U, P> extends Proof<"UserHasProjectAccess", [U, P]> {}

export async function userHasProjectAccess<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<UserHasProjectAccess<U, P> | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(projects)
    .innerJoin(memberships, and(eq(memberships.teamId, projects.teamId), eq(memberships.userId, user.value)))
    .where(eq(projects.id, project.value))
    .limit(1);
  return row ? UserHasProjectAccess.prove(user, project) : null;
}
