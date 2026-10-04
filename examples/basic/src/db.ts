/**
 * An in-memory stand-in for a database, modelled on Vercel:
 *
 *   team (plan: hobby | pro | enterprise) ── members (owner | member | viewer)
 *    └── projects ── Password Protection setting (or none)
 *         └── URLs: production domains and generated deployment/preview URLs
 *
 * Plus the tokens visitors get after entering a password. Everything is async
 * to keep the shape of the real thing. See examples/express-drizzle for SQL.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Host, ProjectId, TeamId, UserId } from "./lib/ids.ts";

export type Role = "owner" | "member" | "viewer";
export type Plan = "hobby" | "pro" | "enterprise";
/**
 * Vercel's `deploymentType`. Standard Protection protects every URL except
 * production domains; All Deployments protects every URL.
 */
export type DeploymentType = "prod_deployment_urls_and_all_previews" | "all";

export interface User {
  id: UserId;
}

export interface Project {
  id: ProjectId;
  teamId: TeamId;
  passwordProtection: { deploymentType: DeploymentType; passwordHash: string; updatedBy: UserId } | null;
  /** Bumped on every change, so tokens issued for an old password stop working. */
  passwordVersion: number;
}

export interface Url {
  host: Host;
  projectId: ProjectId;
  kind: "production-domain" | "generated";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt = "", hash = ""] = stored.split(":");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}

const teams = new Map<TeamId, Plan>([
  [TeamId("acme"), "pro"],
  [TeamId("side"), "hobby"],
]);

const users: User[] = [{ id: UserId("alice") }, { id: UserId("bob") }, { id: UserId("vic") }, { id: UserId("dan") }];

const memberships: Array<{ userId: UserId; teamId: TeamId; role: Role }> = [
  { userId: UserId("alice"), teamId: TeamId("acme"), role: "owner" },
  { userId: UserId("bob"), teamId: TeamId("acme"), role: "member" },
  { userId: UserId("vic"), teamId: TeamId("acme"), role: "viewer" },
  { userId: UserId("dan"), teamId: TeamId("side"), role: "owner" },
];

const projects: Project[] = [
  {
    id: ProjectId("acme-dashboard"),
    teamId: TeamId("acme"),
    passwordProtection: { deploymentType: "all", passwordHash: hashPassword("correct-horse"), updatedBy: UserId("alice") },
    passwordVersion: 1,
  },
  {
    id: ProjectId("acme-shop"),
    teamId: TeamId("acme"),
    passwordProtection: {
      deploymentType: "prod_deployment_urls_and_all_previews",
      passwordHash: hashPassword("open-sesame"),
      updatedBy: UserId("alice"),
    },
    passwordVersion: 1,
  },
  { id: ProjectId("acme-docs"), teamId: TeamId("acme"), passwordProtection: null, passwordVersion: 0 },
  { id: ProjectId("side-blog"), teamId: TeamId("side"), passwordProtection: null, passwordVersion: 0 },
];

const urls: Url[] = [
  { host: Host("dashboard.acme.com"), projectId: ProjectId("acme-dashboard"), kind: "production-domain" },
  { host: Host("acme-dashboard-k3j9.vercel.app"), projectId: ProjectId("acme-dashboard"), kind: "generated" },
  { host: Host("shop.acme.com"), projectId: ProjectId("acme-shop"), kind: "production-domain" },
  { host: Host("acme-shop-git-redesign.vercel.app"), projectId: ProjectId("acme-shop"), kind: "generated" },
  { host: Host("docs.acme.com"), projectId: ProjectId("acme-docs"), kind: "production-domain" },
  { host: Host("blog.dan.dev"), projectId: ProjectId("side-blog"), kind: "production-domain" },
];

const tokens = new Map<string, { host: Host; passwordVersion: number }>();

export const db = {
  async getUser(id: UserId) {
    return users.find((u) => u.id === id);
  },
  async getProject(id: ProjectId) {
    return projects.find((p) => p.id === id);
  },
  async getUrl(host: Host) {
    return urls.find((u) => u.host === host);
  },
  async getToken(token: string) {
    return tokens.get(token);
  },
  /** The user's role in the team that owns the project, if any. */
  async roleInProjectTeam(userId: UserId, projectId: ProjectId): Promise<Role | undefined> {
    const project = projects.find((p) => p.id === projectId);
    return memberships.find((m) => m.userId === userId && m.teamId === project?.teamId)?.role;
  },
  async planOfProject(projectId: ProjectId): Promise<Plan | undefined> {
    const project = projects.find((p) => p.id === projectId);
    return project ? teams.get(project.teamId) : undefined;
  },
  /**
   * Raw writes. Only data.ts calls these, and every function there demands
   * proofs first.
   */
  async writePasswordProtection(projectId: ProjectId, setting: Project["passwordProtection"]): Promise<void> {
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`writePasswordProtection: unknown project ${projectId}`);
    project.passwordProtection = setting;
    project.passwordVersion += 1;
  },
  async insertToken(host: Host, passwordVersion: number): Promise<string> {
    const token = randomUUID();
    tokens.set(token, { host, passwordVersion });
    return token;
  },
};
