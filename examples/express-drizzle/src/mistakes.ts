/**
 * What a future route (or job, or script) cannot do. Type-checked, never run; `pnpm typecheck`
 * fails if any of these stops being an error.
 *
 * The point of making repo.ts demand proofs: a new code path that touches
 * protection settings or protected sites has to be authorized, or it does
 * not compile. That holds for code written next year by someone who never
 * read this file.
 */
import { name } from "gdp-ts";
import type { Host, ProjectId } from "./lib/ids.ts";
import { passwordAccepted } from "./proofs/password-accepted.ts";
import { planIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "./proofs/protection-policy.ts";
import { canVisitUrl } from "./proofs/visit-policy.ts";
import * as repo from "./repo.ts";
import type { User } from "./schema.ts";

const setting = { deploymentType: "all", password: "hunter2" } as const;

export function teamMistakes(viewer: User, projectId: ProjectId, otherProjectId: ProjectId) {
  return name(viewer.id, projectId, otherProjectId, async (user, project, other) => {
    // @ts-expect-error reading the setting needs a view proof
    await repo.readProtection(project);

    // @ts-expect-error a raw id cannot even be passed; it has no name to prove things about
    await repo.readProtection(projectId, await canViewProtection(user, project));

    const view = await canViewProtection(user, project);
    if (!view) return;

    // @ts-expect-error the proof is about `project`, not `other`
    await repo.readProtection(other, view);

    const manage = await canManageProtection(user, project);
    const plan = await planIncludesPasswordProtection(project);
    if (!manage || !plan) return;

    // @ts-expect-error a view proof is not a manage proof (CanManageProtection ⊂ CanViewProtection, not the reverse)
    await repo.setPasswordProtection(project, user, setting, { manage: view, plan });

    // @ts-expect-error forgot the plan check
    await repo.setPasswordProtection(project, user, setting, { manage });

    // ok
    await repo.setPasswordProtection(project, user, setting, { manage, plan });
    await repo.readProtection(project, manage);
  });
}

export function visitorMistakes(host: Host, otherHost: Host, token: string, password: string) {
  return name(host, otherHost, async (url, other) => {
    const visit = await canVisitUrl(url, token);
    const accepted = await passwordAccepted(url, password);
    if (!visit || !accepted) return;

    // @ts-expect-error a token for one URL does not unlock another
    await repo.readSite(other, visit);

    // @ts-expect-error a token needs a password check first
    await repo.insertToken(url);

    // ok
    await repo.readSite(url, visit);
    await repo.insertToken(url, accepted);
  });
}
