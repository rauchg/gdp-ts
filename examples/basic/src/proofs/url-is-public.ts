/**
 * The visitor side. Each URL is protected by the setting of the project it
 * belongs to. (With microfrontends, a path on the default app's domain is
 * protected by the *default app's* setting even though a child app serves
 * it: the URL decides, not whoever renders the page.)
 *
 * A URL needs no password when its project has no Password Protection, or
 * when it is a production domain under Standard Protection.
 */
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { Host } from "../lib/ids.ts";

const UrlIsPublic = defineProof("UrlIsPublic");
/** URL `H` is outside its project's Password Protection scope. */
export interface UrlIsPublic<H> extends Proof<"UrlIsPublic", [H]> {}

export async function urlIsPublic<H>(url: Named<H, Host>): Promise<UrlIsPublic<H> | null> {
  const row = await db.getUrl(url.value);
  const project = row ? await db.getProject(row.projectId) : undefined;
  if (!row || !project) return null;
  const setting = project.passwordProtection;
  const isPublic =
    setting === null ||
    (setting.deploymentType === "prod_deployment_urls_and_all_previews" && row.kind === "production-domain");
  return isPublic ? UrlIsPublic.prove(url) : null;
}
