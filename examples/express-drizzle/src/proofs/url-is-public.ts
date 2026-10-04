/**
 * Each URL is protected by the setting of the project it belongs to (with
 * microfrontends, the default app's domain uses the default app's setting
 * even for paths a child app serves). A URL needs no password when its
 * project has Password Protection off, or when it is a production domain
 * under Standard Protection.
 */
import { eq } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { Host } from "../lib/ids.ts";
import { projects, urls } from "../schema.ts";

const UrlIsPublic = defineProof("UrlIsPublic");
/** URL `H` is outside its project's Password Protection scope. */
export interface UrlIsPublic<H> extends Proof<"UrlIsPublic", [H]> {}

export async function urlIsPublic<H>(url: Named<H, Host>): Promise<UrlIsPublic<H> | null> {
  const [row] = await db
    .select({ kind: urls.kind, deploymentType: projects.protectionDeploymentType })
    .from(urls)
    .innerJoin(projects, eq(projects.id, urls.projectId))
    .where(eq(urls.host, url.value))
    .limit(1);
  if (!row) return null;
  const isPublic =
    row.deploymentType === null ||
    (row.deploymentType === "prod_deployment_urls_and_all_previews" && row.kind === "production-domain");
  return isPublic ? UrlIsPublic.prove(url) : null;
}
