/**
 * A trusted module. The recipe, which every file in proofs/ follows:
 *
 *   1. `defineProof` once, and do NOT export the prover.
 *   2. Export an interface with the same name, listing which names it is
 *      about. (`interface ... extends`, not `type ... =`: a distinct interface
 *      per proof keeps type inference from mixing proof kinds up.)
 *   3. Export one function that performs the check and either returns a proof
 *      about its named arguments, or `null`.
 *
 * That is the whole trusted computing base for this fact. Test this function;
 * everything downstream is checked by the compiler.
 */
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
