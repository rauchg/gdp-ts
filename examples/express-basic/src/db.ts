/**
 * In-memory data: teams on a plan, members with roles, and projects with a
 * Password Protection setting. See examples/express-drizzle for SQL, and
 * examples/basic for the visitor side (entering the password).
 */
import { randomBytes, scryptSync } from "node:crypto";
import { ProjectId, TeamId, UserId } from "./lib/ids.ts";

export type Role = "owner" | "member" | "viewer";
export type Plan = "hobby" | "pro" | "enterprise";
/** Standard Protection (everything except production domains) or All Deployments. */
export type DeploymentType = "prod_deployment_urls_and_all_previews" | "all";

export interface User {
  id: UserId;
}

export interface Project {
  id: ProjectId;
  teamId: TeamId;
  passwordProtection: { deploymentType: DeploymentType; passwordHash: string; updatedBy: UserId } | null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

const plans = new Map<TeamId, Plan>([
  [TeamId("acme"), "pro"],
  [TeamId("side"), "hobby"],
]);

const seedUsers: User[] = [{ id: UserId("alice") }, { id: UserId("bob") }, { id: UserId("vic") }, { id: UserId("dan") }];

const memberships: Array<{ userId: UserId; teamId: TeamId; role: Role }> = [
  { userId: UserId("alice"), teamId: TeamId("acme"), role: "owner" },
  { userId: UserId("bob"), teamId: TeamId("acme"), role: "member" },
  { userId: UserId("vic"), teamId: TeamId("acme"), role: "viewer" },
  { userId: UserId("dan"), teamId: TeamId("side"), role: "owner" },
];

const seedProjects: Project[] = [
  {
    id: ProjectId("acme-dashboard"),
    teamId: TeamId("acme"),
    passwordProtection: { deploymentType: "all", passwordHash: hashPassword("correct-horse"), updatedBy: UserId("alice") },
  },
  { id: ProjectId("acme-docs"), teamId: TeamId("acme"), passwordProtection: null },
  { id: ProjectId("side-blog"), teamId: TeamId("side"), passwordProtection: null },
];

const users = new Map(seedUsers.map((u) => [u.id, u]));
const projects = new Map(seedProjects.map((p) => [p.id, p]));

export const db = {
  async getUser(id: UserId) {
    return users.get(id);
  },
  async getProject(id: ProjectId) {
    return projects.get(id);
  },
  async roleInProjectTeam(userId: UserId, projectId: ProjectId): Promise<Role | undefined> {
    const teamId = projects.get(projectId)?.teamId;
    return memberships.find((m) => m.userId === userId && m.teamId === teamId)?.role;
  },
  async planOfProject(projectId: ProjectId): Promise<Plan | undefined> {
    const teamId = projects.get(projectId)?.teamId;
    return teamId ? plans.get(teamId) : undefined;
  },
  async writePasswordProtection(id: ProjectId, setting: Project["passwordProtection"]): Promise<void> {
    const project = projects.get(id);
    if (!project) throw new Error(`writePasswordProtection: unknown project ${id}`);
    projects.set(id, { ...project, passwordProtection: setting });
  },
};
