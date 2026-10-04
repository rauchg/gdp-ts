/** Authentication only. Stand-in scheme: `Authorization: Bearer <userId>`. */
import { eq } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import { db } from "./db.ts";
import { HttpError } from "./http-error.ts";
import { UserId } from "./lib/ids.ts";
import { users, type User } from "./schema.ts";

type AuthenticatedHandler = (viewer: User, req: Request, res: Response) => Promise<void>;

export function authenticated(handler: AuthenticatedHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) throw new HttpError(401, "Unauthenticated");
      const [viewer] = await db.select().from(users).where(eq(users.id, UserId(token))).limit(1);
      if (!viewer) throw new HttpError(401, "Unauthenticated");
      await handler(viewer, req, res);
    } catch (error) {
      next(error);
    }
  };
}
