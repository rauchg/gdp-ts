/**
 * Each route names the ids it acts on, obtains proofs, and reuses them for
 * every repo.ts call that follows. No route can reach repo.ts without going
 * through proofs/ first; that is a compile error, not a code review finding.
 * Middleware only authenticates (`authenticated`); it decides nothing.
 */
import express, { type ErrorRequestHandler, type Request } from "express";
import { name } from "@gdp-ts/core";
import { authenticated } from "./auth.ts";
import { HttpError } from "./http-error.ts";
import { Host, ProjectId } from "./lib/ids.ts";
import { passwordAccepted } from "./proofs/password-accepted.ts";
import { planIncludesPasswordProtection } from "./proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "./proofs/protection-policy.ts";
import { canVisitUrl } from "./proofs/visit-policy.ts";
import * as repo from "./repo.ts";
import type { DeploymentType } from "./schema.ts";

export const app = express();
app.use(express.json());

// --- team side: authenticated users manage the setting -------------------------
// `grantedBy` is the proof's `kind`, a real runtime value: why access was granted.

app.get(
  "/projects/:id/password-protection",
  authenticated(async (viewer, req, res) => {
    const projectId = await existingProject(req);
    await name(viewer.id, projectId, async (user, project) => {
      const view = await canViewProtection(user, project);
      if (!view) throw new HttpError(403, "No access to this project");
      res.json({ ...(await repo.readProtection(project, view)), grantedBy: view.kind });
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
        await repo.disablePasswordProtection(project, user, manage);
      } else {
        const plan = await planIncludesPasswordProtection(project);
        if (!plan) throw new HttpError(403, "Password Protection is not available on the Hobby plan");
        await repo.setPasswordProtection(project, user, change, { manage, plan });
      }

      // The manage proof is a view proof too: no second authorization query.
      res.json({ ...(await repo.readProtection(project, manage)), grantedBy: manage.kind });
    });
  }),
);

// --- visitor side: anonymous visitors open URLs ----------------------------------
// `/sites/:host` stands in for the host header so tests can hit any URL.
// Express 5 forwards rejected promises to the error handler, so no try/catch.

const COOKIE = "protection_token";

app.get("/sites/:host", async (req, res) => {
  const host = await existingUrl(req);
  await name(host, async (url) => {
    const proof = await canVisitUrl(url, readCookie(req, COOKIE));
    if (!proof) throw new HttpError(401, "Password required");
    res.json({ ...(await repo.readSite(url, proof)), grantedBy: proof.kind });
  });
});

app.post("/sites/:host/password", async (req, res) => {
  const host = await existingUrl(req);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  await name(host, async (url) => {
    const accepted = await passwordAccepted(url, password);
    if (!accepted) throw new HttpError(401, "Incorrect password");
    const token = await repo.insertToken(url, accepted);
    // Scoped to this URL, like Vercel's cookie. The server checks the host anyway.
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: `/sites/${host}` }).status(204).end();
  });
});

// --- request helpers: HTTP only, no authorization -------------------------------

/** 404 before 403 reveals which ids exist. Return 404 for both if that matters to you. */
async function existingProject(req: Request): Promise<ProjectId> {
  const id = ProjectId(param(req, "id"));
  if (!(await repo.projectExists(id))) throw new HttpError(404, "Project not found");
  return id;
}

async function existingUrl(req: Request): Promise<Host> {
  const host = Host(param(req, "host"));
  if (!(await repo.urlExists(host))) throw new HttpError(404, "Not found");
  return host;
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== "string") throw new HttpError(400, `Missing route parameter ${key}`);
  return value;
}

function readCookie(req: Request, key: string): string | undefined {
  for (const part of req.header("cookie")?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === key) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        throw new HttpError(400, "Invalid protection cookie");
      }
    }
  }
  return undefined;
}

/** Mirrors Vercel's API: an object to enable or update, `null` to disable. */
type ProtectionChange = { deploymentType: DeploymentType; password: string } | null;

/** Same shape as Vercel's API: `{ passwordProtection: { deploymentType, password } }` or `{ passwordProtection: null }`. */
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
