import { and, eq, inArray } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId } from "../lib/ids.ts";
import { projects, teams } from "../schema.ts";

const PlanIncludesPasswordProtection = defineProof("PlanIncludesPasswordProtection");
/** The plan of the team that owns project `P` includes Password Protection (not Hobby). */
export interface PlanIncludesPasswordProtection<P> extends Proof<"PlanIncludesPasswordProtection", [P]> {}

export async function planIncludesPasswordProtection<P>(
  project: Named<P, ProjectId>,
): Promise<PlanIncludesPasswordProtection<P> | null> {
  const [row] = await db
    .select({ plan: teams.plan })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .where(and(eq(projects.id, project.value), inArray(teams.plan, ["pro", "enterprise"])))
    .limit(1);
  return row ? PlanIncludesPasswordProtection.prove(project) : null;
}
