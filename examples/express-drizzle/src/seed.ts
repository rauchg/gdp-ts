/** Creates the tables and loads fixtures. A real app would use drizzle-kit migrations. */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { Host, ProjectId, TeamId, UserId } from "./lib/ids.ts";
import { hashPassword } from "./passwords.ts";
import { memberships, projects, teams, urls, users } from "./schema.ts";

export async function seed(): Promise<void> {
  await db.execute(sql`create table if not exists users (id text primary key)`);
  await db.execute(sql`create table if not exists teams (id text primary key, plan text not null)`);
  await db.execute(sql`
    create table if not exists memberships (
      user_id text not null references users(id),
      team_id text not null references teams(id),
      role text not null,
      primary key (user_id, team_id)
    )`);
  await db.execute(sql`
    create table if not exists projects (
      id text primary key,
      team_id text not null references teams(id),
      protection_deployment_type text,
      protection_password_hash text,
      protection_updated_by text references users(id),
      password_version integer not null default 0
    )`);
  await db.execute(sql`
    create table if not exists urls (
      host text primary key,
      project_id text not null references projects(id),
      kind text not null
    )`);
  await db.execute(sql`
    create table if not exists protection_tokens (
      token text primary key,
      host text not null references urls(host),
      password_version integer not null
    )`);

  await db.insert(users).values(["alice", "bob", "vic", "dan"].map((id) => ({ id: UserId(id) })));
  await db.insert(teams).values([
    { id: TeamId("acme"), plan: "pro" },
    { id: TeamId("side"), plan: "hobby" },
  ]);
  await db.insert(memberships).values([
    { userId: UserId("alice"), teamId: TeamId("acme"), role: "owner" },
    { userId: UserId("bob"), teamId: TeamId("acme"), role: "member" },
    { userId: UserId("vic"), teamId: TeamId("acme"), role: "viewer" },
    { userId: UserId("dan"), teamId: TeamId("side"), role: "owner" },
  ]);
  await db.insert(projects).values([
    {
      id: ProjectId("acme-dashboard"),
      teamId: TeamId("acme"),
      protectionDeploymentType: "all",
      protectionPasswordHash: hashPassword("correct-horse"),
      protectionUpdatedBy: UserId("alice"),
      passwordVersion: 1,
    },
    {
      id: ProjectId("acme-shop"),
      teamId: TeamId("acme"),
      protectionDeploymentType: "prod_deployment_urls_and_all_previews",
      protectionPasswordHash: hashPassword("open-sesame"),
      protectionUpdatedBy: UserId("alice"),
      passwordVersion: 1,
    },
    { id: ProjectId("acme-docs"), teamId: TeamId("acme") },
    { id: ProjectId("side-blog"), teamId: TeamId("side") },
  ]);
  await db.insert(urls).values([
    { host: Host("dashboard.acme.com"), projectId: ProjectId("acme-dashboard"), kind: "production-domain" },
    { host: Host("acme-dashboard-k3j9.vercel.app"), projectId: ProjectId("acme-dashboard"), kind: "generated" },
    { host: Host("shop.acme.com"), projectId: ProjectId("acme-shop"), kind: "production-domain" },
    { host: Host("acme-shop-git-redesign.vercel.app"), projectId: ProjectId("acme-shop"), kind: "generated" },
    { host: Host("docs.acme.com"), projectId: ProjectId("acme-docs"), kind: "production-domain" },
    { host: Host("blog.dan.dev"), projectId: ProjectId("side-blog"), kind: "production-domain" },
  ]);
}
