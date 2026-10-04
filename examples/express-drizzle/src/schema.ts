/**
 * Vercel's topology, reduced to what Password Protection needs:
 *
 *   teams (plan) ── memberships (owner | member | viewer) ── users
 *     └── projects (Password Protection setting)
 *           └── urls (production domains and generated deployment URLs)
 *
 * plus the tokens visitors receive after entering a password.
 */
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { Host, ProjectId, TeamId, UserId } from "./lib/ids.ts";

export const users = pgTable("users", {
  id: text("id").primaryKey().$type<UserId>(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey().$type<TeamId>(),
  plan: text("plan", { enum: ["hobby", "pro", "enterprise"] }).notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id").notNull().references(() => users.id).$type<UserId>(),
    teamId: text("team_id").notNull().references(() => teams.id).$type<TeamId>(),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
);

export const projects = pgTable("projects", {
  id: text("id").primaryKey().$type<ProjectId>(),
  teamId: text("team_id").notNull().references(() => teams.id).$type<TeamId>(),
  /** Vercel's `deploymentType`; null when Password Protection is off. */
  protectionDeploymentType: text("protection_deployment_type", {
    enum: ["prod_deployment_urls_and_all_previews", "all"],
  }),
  protectionPasswordHash: text("protection_password_hash"),
  protectionUpdatedBy: text("protection_updated_by").references(() => users.id).$type<UserId>(),
  /** Bumped on every change, so tokens issued for an old password stop working. */
  passwordVersion: integer("password_version").notNull().default(0),
});

export const urls = pgTable("urls", {
  host: text("host").primaryKey().$type<Host>(),
  projectId: text("project_id").notNull().references(() => projects.id).$type<ProjectId>(),
  kind: text("kind", { enum: ["production-domain", "generated"] }).notNull(),
});

export const protectionTokens = pgTable("protection_tokens", {
  token: text("token").primaryKey(),
  host: text("host").notNull().references(() => urls.host).$type<Host>(),
  passwordVersion: integer("password_version").notNull(),
});

export type User = typeof users.$inferSelect;
export type DeploymentType = NonNullable<typeof projects.$inferSelect.protectionDeploymentType>;
