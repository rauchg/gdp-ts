import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "../src/app.ts";

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  base = `http://127.0.0.1:${address.port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const call = (method: string, path: string, as?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: {
      ...(as ? { authorization: `Bearer ${as}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });

const path = (project: string) => `/projects/${project}/password-protection`;
const enable = (deploymentType: string, password: string) => ({ passwordProtection: { deploymentType, password } });

test("unauthenticated requests are rejected before any authorization happens", async () => {
  assert.equal((await call("GET", path("acme-dashboard"))).status, 401);
});

test("Viewers can see the setting, and nobody ever sees the password", async () => {
  const res = await call("GET", path("acme-dashboard"), "vic");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    projectId: "acme-dashboard",
    passwordProtection: { deploymentType: "all", updatedBy: "alice" },
  });
});

test("other teams cannot see it", async () => {
  assert.equal((await call("GET", path("acme-dashboard"), "dan")).status, 403);
});

test("Viewers cannot change it", async () => {
  assert.equal((await call("PATCH", path("acme-docs"), "vic", enable("all", "pw"))).status, 403);
});

test("not available on Hobby, even for the team's Owner", async () => {
  const res = await call("PATCH", path("side-blog"), "dan", enable("all", "pw"));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Hobby/);
});

test("Members can enable it; the response reuses the manage proof as a view proof", async () => {
  const res = await call("PATCH", path("acme-docs"), "bob", enable("prod_deployment_urls_and_all_previews", "docs-only"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    projectId: "acme-docs",
    passwordProtection: { deploymentType: "prod_deployment_urls_and_all_previews", updatedBy: "bob" },
  });
});

test("Owners can disable it", async () => {
  const res = await call("PATCH", path("acme-dashboard"), "alice", { passwordProtection: null });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { projectId: "acme-dashboard", passwordProtection: null });
});

test("malformed changes are 400, unknown projects 404", async () => {
  assert.equal((await call("PATCH", path("acme-docs"), "alice", enable("all", ""))).status, 400);
  assert.equal((await call("PATCH", path("acme-docs"), "alice", { enabled: true })).status, 400);
  assert.equal((await call("GET", path("nope"), "alice")).status, 404);
});
