/**
 * The visitor typed the current password of the project that URL `H` belongs
 * to. The proof is about the URL, because the token it earns is valid for
 * that URL only.
 */
import { defineProof, type Named, type Proof } from "@gdp-ts/core";
import { db, verifyPassword } from "../db.ts";
import type { Host } from "../lib/ids.ts";

const PasswordAccepted = defineProof("PasswordAccepted");
/** A visitor supplied the current password for URL `H`. */
export interface PasswordAccepted<H> extends Proof<"PasswordAccepted", [H]> {
  readonly passwordVersion: number;
}

export async function passwordAccepted<H>(url: Named<H, Host>, password: string): Promise<PasswordAccepted<H> | null> {
  const row = await db.getUrl(url.value);
  const project = row ? await db.getProject(row.projectId) : undefined;
  const setting = project?.passwordProtection;
  return project && setting && verifyPassword(password, setting.passwordHash)
    ? Object.freeze({ ...PasswordAccepted.prove(url), passwordVersion: project.passwordVersion })
    : null;
}
