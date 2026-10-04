/**
 * The token arrives in a cookie: client-supplied, so it proves nothing until
 * checked. One join enforces both of Vercel's rules: a token is valid only
 * for the URL it was set for, and only until the password changes.
 */
import { and, eq } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { Host } from "../lib/ids.ts";
import { projects, protectionTokens, urls } from "../schema.ts";

const TokenUnlocksUrl = defineProof("TokenUnlocksUrl");
/** The visitor's token was issued for exactly URL `H`, for its current password. */
export interface TokenUnlocksUrl<H> extends Proof<"TokenUnlocksUrl", [H]> {}

export async function tokenUnlocksUrl<H>(
  url: Named<H, Host>,
  token: string | undefined,
): Promise<TokenUnlocksUrl<H> | null> {
  if (!token) return null;
  const [row] = await db
    .select({ token: protectionTokens.token })
    .from(protectionTokens)
    .innerJoin(urls, eq(urls.host, protectionTokens.host))
    .innerJoin(projects, and(eq(projects.id, urls.projectId), eq(projects.passwordVersion, protectionTokens.passwordVersion)))
    .where(and(eq(protectionTokens.token, token), eq(protectionTokens.host, url.value)))
    .limit(1);
  return row ? TokenUnlocksUrl.prove(url) : null;
}
