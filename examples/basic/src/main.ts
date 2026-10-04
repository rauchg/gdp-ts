import { db } from "./db.ts";
import { HttpError, submitPassword, updateProtection, viewProtection, visit } from "./handler.ts";
import { Host, ProjectId, UserId } from "./lib/ids.ts";
import type { ProtectionView } from "./data.ts";

const user = async (id: string) => {
  const found = await db.getUser(UserId(id));
  if (!found) throw new Error(`no such user ${id}`);
  return found;
};

const describe = (view: ProtectionView) =>
  view.passwordProtection
    ? `${view.passwordProtection.deploymentType === "all" ? "all deployments" : "standard"} (set by ${view.passwordProtection.updatedBy})`
    : "off";

async function step(who: string, action: string, target: string, why: string, run: () => Promise<string>) {
  let outcome: string;
  try {
    outcome = `200 ${await run()}`;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    outcome = `${error.status} ${error.message}`;
  }
  console.log(`${who.padEnd(8)}${action.padEnd(17)}${target.padEnd(35)}${outcome.padEnd(45)}# ${why}`);
}

// Team side: who may see and change the setting.
await step("vic", "view", "acme-dashboard", "Viewers see the setting, never the password", async () =>
  describe(await viewProtection(await user("vic"), ProjectId("acme-dashboard"))));
await step("dan", "view", "acme-dashboard", "other teams see nothing", async () =>
  describe(await viewProtection(await user("dan"), ProjectId("acme-dashboard"))));
await step("vic", "enable", "acme-docs", "Viewers cannot change it", async () =>
  describe(await updateProtection(await user("vic"), ProjectId("acme-docs"), { deploymentType: "all", password: "x" })));
await step("dan", "enable", "side-blog", "not on Hobby, even for an Owner", async () =>
  describe(await updateProtection(await user("dan"), ProjectId("side-blog"), { deploymentType: "all", password: "x" })));
await step("bob", "enable", "acme-docs", "Members can", async () =>
  describe(await updateProtection(await user("bob"), ProjectId("acme-docs"), {
    deploymentType: "prod_deployment_urls_and_all_previews",
    password: "docs-only",
  })));

// Visitor side: what the setting protects.
await step("visitor", "open", "shop.acme.com", "Standard Protection leaves production domains public", () =>
  visit(Host("shop.acme.com"), undefined));
await step("visitor", "open", "acme-shop-git-redesign.vercel.app", "...and protects everything else", () =>
  visit(Host("acme-shop-git-redesign.vercel.app"), undefined));
await step("visitor", "open", "dashboard.acme.com", "All Deployments protects production too", () =>
  visit(Host("dashboard.acme.com"), undefined));
await step("visitor", "password", "dashboard.acme.com", "wrong password", () =>
  submitPassword(Host("dashboard.acme.com"), "nope"));

let token = "";
await step("visitor", "password", "dashboard.acme.com", "right password: a token for this URL", async () => {
  token = await submitPassword(Host("dashboard.acme.com"), "correct-horse");
  return "token issued";
});
await step("visitor", "open + token", "dashboard.acme.com", "the token unlocks the URL", () =>
  visit(Host("dashboard.acme.com"), token));
await step("visitor", "open + token", "acme-dashboard-k3j9.vercel.app", "...only that URL, though it is the same deployment", () =>
  visit(Host("acme-dashboard-k3j9.vercel.app"), token));
await step("alice", "change password", "acme-dashboard", "the Owner rotates the password", async () =>
  describe(await updateProtection(await user("alice"), ProjectId("acme-dashboard"), { deploymentType: "all", password: "battery-staple" })));
await step("visitor", "open + token", "dashboard.acme.com", "changing the password invalidates old tokens", () =>
  visit(Host("dashboard.acme.com"), token));
