import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "../src/app.ts";
import { db } from "../src/db.ts";
import { seed } from "../src/seed.ts";

let server: Server;
let base: string;

before(async () => {
  await seed();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  server.close();
  await db.$client.close(); // PGlite keeps the process alive otherwise
});

const call = (method: string, path: string, opts: { as?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(opts.as ? { authorization: `Bearer ${opts.as}` } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : null,
  });

const settings = (project: string) => `/projects/${project}/password-protection`;
const enable = (deploymentType: string, password: string) => ({ passwordProtection: { deploymentType, password } });

async function unlock(host: string, password: string): Promise<string> {
  const res = await call("POST", `/sites/${host}/password`, { body: { password } });
  assert.equal(res.status, 204);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "expected a cookie");
  return cookie;
}

// --- team side -----------------------------------------------------------------

test("unauthenticated requests are rejected", async () => {
  assert.equal((await call("GET", settings("acme-dashboard"))).status, 401);
});

test("everyone on the team sees the setting (never the password); grantedBy says why", async () => {
  const asViewer = await (await call("GET", settings("acme-dashboard"), { as: "vic" })).json();
  assert.deepEqual(asViewer, {
    projectId: "acme-dashboard",
    passwordProtection: { deploymentType: "all", updatedBy: "alice" },
    grantedBy: "UserHasProjectAccess",
  });
  const asOwner = await (await call("GET", settings("acme-dashboard"), { as: "alice" })).json();
  assert.equal(asOwner.grantedBy, "UserIsProjectAdmin");
});

test("other teams see nothing; Viewers change nothing; Hobby gets nothing", async () => {
  assert.equal((await call("GET", settings("acme-dashboard"), { as: "dan" })).status, 403);
  assert.equal((await call("PATCH", settings("acme-docs"), { as: "vic", body: enable("all", "x") })).status, 403);
  assert.equal((await call("PATCH", settings("side-blog"), { as: "dan", body: enable("all", "x") })).status, 403);
});

test("Members enable it and are recorded as the author", async () => {
  const res = await call("PATCH", settings("acme-docs"), { as: "bob", body: enable("all", "docs-only") });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).passwordProtection, { deploymentType: "all", updatedBy: "bob" });
});

// --- visitor side --------------------------------------------------------------

test("Standard Protection leaves production domains public and protects everything else", async () => {
  const prod = await call("GET", "/sites/shop.acme.com");
  assert.equal(prod.status, 200);
  assert.equal((await prod.json()).grantedBy, "UrlIsPublic");
  assert.equal((await call("GET", "/sites/acme-shop-git-redesign.vercel.app")).status, 401);
});

test("All Deployments protects production domains too; wrong passwords earn nothing", async () => {
  assert.equal((await call("GET", "/sites/dashboard.acme.com")).status, 401);
  const wrong = await call("POST", "/sites/dashboard.acme.com/password", { body: { password: "open-sesame" } });
  assert.equal(wrong.status, 401); // acme-shop's password, not this URL's project's
});

test("the right password earns a token for that URL only", async () => {
  const cookie = await unlock("dashboard.acme.com", "correct-horse");
  const ok = await call("GET", "/sites/dashboard.acme.com", { cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { host: "dashboard.acme.com", projectId: "acme-dashboard", grantedBy: "TokenUnlocksUrl" });
  // Same project, same deployment, different URL: still locked.
  assert.equal((await call("GET", "/sites/acme-dashboard-k3j9.vercel.app", { cookie })).status, 401);
});

test("changing the password invalidates earlier tokens", async () => {
  const cookie = await unlock("dashboard.acme.com", "correct-horse");
  const changed = await call("PATCH", settings("acme-dashboard"), { as: "alice", body: enable("all", "battery-staple") });
  assert.equal(changed.status, 200);
  assert.equal((await call("GET", "/sites/dashboard.acme.com", { cookie })).status, 401);
  const fresh = await unlock("dashboard.acme.com", "battery-staple");
  assert.equal((await call("GET", "/sites/dashboard.acme.com", { cookie: fresh })).status, 200);
});

test("disabling protection makes every URL public", async () => {
  const res = await call("PATCH", settings("acme-dashboard"), { as: "alice", body: { passwordProtection: null } });
  assert.equal(res.status, 200);
  assert.equal((await call("GET", "/sites/acme-dashboard-k3j9.vercel.app")).status, 200);
});

test("unknown projects and URLs are 404; malformed changes 400", async () => {
  assert.equal((await call("GET", settings("nope"), { as: "alice" })).status, 404);
  assert.equal((await call("GET", "/sites/nope.example")).status, 404);
  assert.equal((await call("PATCH", settings("acme-docs"), { as: "alice", body: enable("all", "") })).status, 400);
});


test("malformed JSON is a client error", async () => {
  const res = await fetch(base + settings("acme-docs"), {
    method: "PATCH",
    headers: { authorization: "Bearer alice", "content-type": "application/json" },
    body: '{"passwordProtection":',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid JSON" });
});

test("a malformed protection cookie is rejected as a client error", async () => {
  const res = await call("GET", "/sites/acme-shop-git-redesign.vercel.app", { cookie: "protection_token=%" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Invalid protection cookie" });
});


test("an oversized JSON body is a client error", async () => {
  const res = await fetch(base + settings("acme-docs"), {
    method: "PATCH",
    headers: { authorization: "Bearer alice", "content-type": "application/json" },
    body: JSON.stringify({ passwordProtection: { deploymentType: "all", password: "x".repeat(110 * 1024) } }),
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "Request body too large" });
});
