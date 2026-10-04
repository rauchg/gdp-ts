/** Policy: a visitor may open a URL that is public, or that their token unlocks. */
import type { Named } from "gdp-ts";
import type { Host } from "../lib/ids.ts";
import { tokenUnlocksUrl, type TokenUnlocksUrl } from "./token-unlocks-url.ts";
import { urlIsPublic, type UrlIsPublic } from "./url-is-public.ts";

export type CanVisitUrl<H> = UrlIsPublic<H> | TokenUnlocksUrl<H>;

export async function canVisitUrl<H>(url: Named<H, Host>, token: string | undefined): Promise<CanVisitUrl<H> | null> {
  return (await urlIsPublic(url)) ?? (await tokenUnlocksUrl(url, token));
}
