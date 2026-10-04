/**
 * A precondition that has nothing to do with who is asking: Password
 * Protection is not available on Hobby (on Pro it is billed per project).
 * As a proof, "forgot to check the plan" is a compile error rather than a
 * support ticket.
 */
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { ProjectId } from "../lib/ids.ts";

const PlanIncludesPasswordProtection = defineProof("PlanIncludesPasswordProtection");
/** The plan of the team that owns project `P` includes Password Protection. */
export interface PlanIncludesPasswordProtection<P> extends Proof<"PlanIncludesPasswordProtection", [P]> {}

export async function planIncludesPasswordProtection<P>(
  project: Named<P, ProjectId>,
): Promise<PlanIncludesPasswordProtection<P> | null> {
  const plan = await db.planOfProject(project.value);
  return plan === "pro" || plan === "enterprise" ? PlanIncludesPasswordProtection.prove(project) : null;
}
