/**
 * Things the compiler now refuses. This file is type-checked but never run;
 * `pnpm typecheck` fails if any of these `@ts-expect-error` lines stops
 * being an error. Read the error messages: they say what went wrong.
 */
import { name } from "gdp-ts";
import type { DeploymentType, User } from "./db.ts";
import type { Host, ProjectId } from "./lib/ids.ts";
import { passwordAccepted } from "./proofs/password-accepted.ts";
import { planIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "./proofs/protection-policy.ts";
import { canVisitUrl } from "./proofs/visit-policy.ts";
import { issueToken, readProtection, servePage, setPasswordProtection } from "./data.ts";

const setting = { deploymentType: "all" as DeploymentType, password: "hunter2" };

export function teamMistakes(viewer: User, other: User, a: ProjectId, b: ProjectId) {
  return name(viewer.id, a, b, async (user, projectA, projectB) => {
    const viewA = await canViewProtection(user, projectA);
    if (!viewA) return;

    // @ts-expect-error the proof is about project A, not project B
    await readProtection(projectB, viewA);

    // @ts-expect-error a raw id is not a named value; name it first
    await readProtection(a, viewA);

    // @ts-expect-error no proof at all
    await readProtection(projectA);

    // @ts-expect-error `null` is what a failed check returns; you must handle it
    await readProtection(projectA, await canViewProtection(user, projectA));

    // @ts-expect-error you cannot build a proof by hand; only proofs/ can
    const forged: typeof viewA = { kind: "UserIsProjectAdmin" };
    void forged;

    const manageA = await canManageProtection(user, projectA);
    const planA = await planIncludesPasswordProtection(projectA);
    const planB = await planIncludesPasswordProtection(projectB);
    if (!manageA || !planA || !planB) return;

    // @ts-expect-error viewing is not managing: a Viewer's proof cannot change the setting
    await setPasswordProtection(projectA, user, setting, { manage: viewA, plan: planA });

    // @ts-expect-error forgot the plan check (Password Protection is not on Hobby)
    await setPasswordProtection(projectA, user, setting, { manage: manageA });

    // @ts-expect-error the plan check was for project B
    await setPasswordProtection(projectA, user, setting, { manage: manageA, plan: planB });

    await name(other.id, async (otherUser) => {
      const otherManage = await canManageProtection(otherUser, projectA);
      if (!otherManage) return;
      // @ts-expect-error the manage proof is about another user; `updatedBy` would name the wrong person
      await setPasswordProtection(projectA, user, setting, { manage: otherManage, plan: planA });
    });

    // ok: both facts, about project A and this user
    await setPasswordProtection(projectA, user, setting, { manage: manageA, plan: planA });

    // ok: a manage proof is also a view proof; proofs are reusable
    await readProtection(projectA, manageA);
    await readProtection(projectA, viewA);
  });
}

export function visitorMistakes(hostA: Host, hostB: Host, token: string, password: string) {
  return name(hostA, hostB, async (urlA, urlB) => {
    const visitA = await canVisitUrl(urlA, token);
    const acceptedA = await passwordAccepted(urlA, password);
    if (!visitA || !acceptedA) return;

    // @ts-expect-error a token for one URL does not unlock another, even one for the same deployment
    await servePage(urlB, visitA);

    // @ts-expect-error issuing a token needs a password check
    await issueToken(urlA);

    // @ts-expect-error the password was checked for URL A, so the token can only be for URL A
    await issueToken(urlB, acceptedA);

    // ok
    await servePage(urlA, visitA);
    await issueToken(urlA, acceptedA);
  });
}
