import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt = "", hash = ""] = stored.split(":");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}
