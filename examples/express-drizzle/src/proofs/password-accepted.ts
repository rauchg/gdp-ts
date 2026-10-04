import { eq } from "drizzle-orm";
import { defineProof, type Named, type Proof } from "gdp-ts";
import { db } from "../db.ts";
import type { Host } from "../lib/ids.ts";
import { verifyPassword } from "../passwords.ts";
import { projects, urls } from "../schema.ts";

const PasswordAccepted = defineProof("PasswordAccepted");
/** A visitor supplied the current password of the project URL `H` belongs to. */
export interface PasswordAccepted<H> extends Proof<"PasswordAccepted", [H]> {}

export async function passwordAccepted<H>(url: Named<H, Host>, password: string): Promise<PasswordAccepted<H> | null> {
  const [row] = await db
    .select({ hash: projects.protectionPasswordHash })
    .from(urls)
    .innerJoin(projects, eq(projects.id, urls.projectId))
    .where(eq(urls.host, url.value))
    .limit(1);
  return row?.hash && verifyPassword(password, row.hash) ? PasswordAccepted.prove(url) : null;
}
