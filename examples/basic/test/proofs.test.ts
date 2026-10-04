/**
 * The trusted modules are the only things that need runtime tests. Everything
 * that *uses* proofs is checked by the compiler (see src/mistakes.ts).
 *
 * Names and proofs cannot leave a `name()` callback (the compiler refuses), so
 * each test returns plain data (`kind`) or asserts inside the callback.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { name } from "gdp-ts";
import { db } from "../src/db.ts";
import { updateProtection } from "../src/handler.ts";
import { Host, ProjectId, UserId } from "../src/lib/ids.ts";
import { passwordAccepted } from "../src/proofs/password-accepted.ts";
import { planIncludesPasswordProtection } from "../src/proofs/plan-includes-password-protection.ts";
import { canManageProtection, canViewProtection } from "../src/proofs/protection-policy.ts";
import { tokenUnlocksUrl } from "../src/proofs/token-unlocks-url.ts";
import { urlIsPublic } from "../src/proofs/url-is-public.ts";
import { issueToken } from "../src/data.ts";

const viewKind = (user: string, project: string) =>
  name(UserId(user), ProjectId(project), async (u, p) => (await canViewProtection(u, p))?.kind ?? null);
const canManage = (user: string, project: string) =>
  name(UserId(user), ProjectId(project), async (u, p) => (await canManageProtection(u, p)) !== null);
const planOk = (project: string) =>
  name(ProjectId(project), async (p) => (await planIncludesPasswordProtection(p)) !== null);
const isPublic = (host: string) => name(Host(host), async (url) => (await urlIsPublic(url)) !== null);
const accepts = (host: string, password: string) =>
  name(Host(host), async (url) => (await passwordAccepted(url, password)) !== null);
const unlocks = (host: string, token: string) =>
  name(Host(host), async (url) => (await tokenUnlocksUrl(url, token)) !== null);
const tokenFor = (host: string, password: string) =>
  name(Host(host), async (url) => {
    const accepted = await passwordAccepted(url, password);
    if (!accepted) throw new Error("expected the password to be accepted");
    return issueToken(url, accepted);
  });

test("everyone on the team can view; admins get the stronger proof", async () => {
  assert.equal(await viewKind("alice", "acme-dashboard"), "UserIsProjectAdmin");
  assert.equal(await viewKind("bob", "acme-dashboard"), "UserIsProjectAdmin");
  assert.equal(await viewKind("vic", "acme-dashboard"), "UserHasProjectAccess");
  assert.equal(await viewKind("dan", "acme-dashboard"), null);
});

test("Owners and Members manage; Viewers and other teams do not", async () => {
  assert.equal(await canManage("alice", "acme-dashboard"), true);
  assert.equal(await canManage("bob", "acme-dashboard"), true);
  assert.equal(await canManage("vic", "acme-dashboard"), false);
  assert.equal(await canManage("dan", "acme-dashboard"), false);
});

test("Password Protection needs Pro or Enterprise", async () => {
  assert.equal(await planOk("acme-docs"), true);
  assert.equal(await planOk("side-blog"), false);
});

test("scope: Standard leaves production domains public, All protects everything", async () => {
  assert.equal(await isPublic("shop.acme.com"), true);
  assert.equal(await isPublic("acme-shop-git-redesign.vercel.app"), false);
  assert.equal(await isPublic("dashboard.acme.com"), false);
  assert.equal(await isPublic("docs.acme.com"), true); // no protection at all
  assert.equal(await isPublic("unknown.example"), false);
});

test("passwords are checked against the URL's own project", async () => {
  assert.equal(await accepts("dashboard.acme.com", "correct-horse"), true);
  assert.equal(await accepts("dashboard.acme.com", "open-sesame"), false); // acme-shop's password
  assert.equal(await accepts("docs.acme.com", "anything"), false); // not protected, nothing to accept
});

test("a token unlocks only the URL it was issued for", async () => {
  const token = await tokenFor("dashboard.acme.com", "correct-horse");
  assert.equal(await unlocks("dashboard.acme.com", token), true);
  assert.equal(await unlocks("acme-dashboard-k3j9.vercel.app", token), false);
  assert.equal(await unlocks("dashboard.acme.com", "made-up"), false);
});

test("changing the password invalidates earlier tokens", async () => {
  const token = await tokenFor("dashboard.acme.com", "correct-horse");
  const alice = await db.getUser(UserId("alice"));
  if (!alice) throw new Error("fixture missing");
  await updateProtection(alice, ProjectId("acme-dashboard"), { deploymentType: "all", password: "new-password" });
  assert.equal(await unlocks("dashboard.acme.com", token), false);
  assert.equal(await accepts("dashboard.acme.com", "new-password"), true);
});
