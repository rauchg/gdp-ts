/**
 * Each route authenticates (`authenticated`), then, in its own body:
 *
 *   1. names the ids it is about to act on,
 *   2. asks proofs/ for proofs,
 *   3. turns a missing proof into a 403,
 *   4. calls data.ts, which would not compile without 2.
 *
 * Compare a `requireProjectAdmin("id")` middleware: its result evaporates
 * before the handler runs, and it knows nothing about the plan check. Here the
 * check happens where its result is needed, and step 4 cannot forget it.
 */
import express, { type ErrorRequestHandler, type Request } from "express";
import { name } from "@gdp-ts/core";
import { authenticated } from "./auth.ts";
import { disablePasswordProtection, readProtection, setPasswordProtection } from "./data.ts";
import { db, type DeploymentType } from "./db.ts";
import { HttpError } from "./http-error.ts";
import { ProjectId } from "./lib/ids.ts";
import { planIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "./proofs/protection-policy.ts";

export const app = express();
app.use(express.json());

app.get(
  "/projects/:id/password-protection",
  authenticated(async (viewer, req, res) => {
    const projectId = await existingProject(req);
    await name(viewer.id, projectId, async (user, project) => {
      const view = await canViewProtection(user, project);
      if (!view) throw new HttpError(403, "No access to this project");
      res.json(await readProtection(project, view));
    });
  }),
);

app.patch(
  "/projects/:id/password-protection",
  authenticated(async (viewer, req, res) => {
    const change = parseChange(req.body);
    const projectId = await existingProject(req);
    await name(viewer.id, projectId, async (user, project) => {
      const manage = await canManageProtection(user, project);
      if (!manage) throw new HttpError(403, "Only Owners and Members can change Password Protection");

      if (change === null) {
        await disablePasswordProtection(project, user, manage);
      } else {
        const plan = await planIncludesPasswordProtection(project);
        if (!plan) throw new HttpError(403, "Password Protection is not available on the Hobby plan");
        await setPasswordProtection(project, user, change, { manage, plan });
      }

      // A manage proof is also a view proof, so the response needs no second check.
      res.json(await readProtection(project, manage));
    });
  }),
);

// --- request helpers: HTTP only, no authorization -------------------------------

/**
 * 404 before 403 tells authenticated users which ids exist. If that matters
 * to you, drop the existence check and return 403 (or 404) for both.
 */
async function existingProject(req: Request): Promise<ProjectId> {
  const id = ProjectId(param(req, "id"));
  if (!(await db.getProject(id))) throw new HttpError(404, "Project not found");
  return id;
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== "string") throw new HttpError(400, `Missing route parameter ${key}`);
  return value;
}

/** Mirrors Vercel's API: an object to enable or update, `null` to disable. */
type ProtectionChange = { deploymentType: DeploymentType; password: string } | null;

/**
 * Same shape as Vercel's API:
 * `{ "passwordProtection": { "deploymentType": "all", "password": "..." } }` or
 * `{ "passwordProtection": null }`.
 */
function parseChange(body: unknown): ProtectionChange {
  if (typeof body !== "object" || body === null || !("passwordProtection" in body)) {
    throw new HttpError(400, "Expected { passwordProtection }");
  }
  const value = body.passwordProtection;
  if (value === null) return null;
  if (
    typeof value === "object" &&
    "deploymentType" in value &&
    (value.deploymentType === "all" || value.deploymentType === "prod_deployment_urls_and_all_previews") &&
    "password" in value &&
    typeof value.password === "string" &&
    value.password.length > 0
  ) {
    return { deploymentType: value.deploymentType, password: value.password };
  }
  throw new HttpError(400, "passwordProtection needs a deploymentType and a password");
}

const onError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
    const tooLarge = error.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "Request body too large" : "Invalid JSON" });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Internal error" });
};
app.use(onError);
