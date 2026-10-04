/**
 * Trusted modules are the only place that reads authorization-relevant
 * columns without a proof. Keep these queries small and test them; they are
 * the whole trusted computing base for this fact.
 */
import { and, eq, inArray } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId, UserId } from "../lib/ids.ts";
import { memberships, projects } from "../schema.ts";

const UserIsProjectAdmin = defineProof("UserIsProjectAdmin");
/** User `U` administers project `P`: an Owner or Member of the project's team. */
export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}

export async function userIsProjectAdmin<U, P>(
  user: Named<U, UserId>,
  project: Named<P, ProjectId>,
): Promise<UserIsProjectAdmin<U, P> | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(projects)
    .innerJoin(memberships, and(eq(memberships.teamId, projects.teamId), eq(memberships.userId, user.value)))
    .where(and(eq(projects.id, project.value), inArray(memberships.role, ["owner", "member"])))
    .limit(1);
  return row ? UserIsProjectAdmin.prove(user, project) : null;
}
