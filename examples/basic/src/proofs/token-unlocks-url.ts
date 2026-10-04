/**
 * The token comes from the visitor's cookie: client-supplied, so it proves
 * nothing until checked. Vercel's rules, both enforced here:
 *
 *   - a token is valid only for the URL it was set for, "even if those URLs
 *     point to the same deployment";
 *   - changing the password invalidates every token issued before.
 */
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { Host } from "../lib/ids.ts";

const TokenUnlocksUrl = defineProof("TokenUnlocksUrl");
/** The visitor's token was issued for exactly URL `H`, for its current password. */
export interface TokenUnlocksUrl<H> extends Proof<"TokenUnlocksUrl", [H]> {}

export async function tokenUnlocksUrl<H>(
  url: Named<H, Host>,
  token: string | undefined,
): Promise<TokenUnlocksUrl<H> | null> {
  const issued = token ? await db.getToken(token) : undefined;
  const row = await db.getUrl(url.value);
  const project = row ? await db.getProject(row.projectId) : undefined;
  return issued && project && issued.host === url.value && issued.passwordVersion === project.passwordVersion
    ? TokenUnlocksUrl.prove(url)
    : null;
}
