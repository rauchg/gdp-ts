/**
 * Authentication: who is asking? This is the only thing middleware needs to
 * establish. Authorization (may they touch *this*?) happens in each route
 * body, right where data.ts demands it; see app.ts.
 *
 * The scheme here is a stand-in: `Authorization: Bearer <userId>`. Swap in
 * sessions, JWTs or whatever you use; nothing downstream changes.
 */
import type { Request, RequestHandler, Response } from "express";
import { db, type User } from "./db.ts";
import { HttpError } from "./http-error.ts";
import { UserId } from "./lib/ids.ts";

type AuthenticatedHandler = (viewer: User, req: Request, res: Response) => Promise<void>;

export function authenticated(handler: AuthenticatedHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
      const viewer = token ? await db.getUser(UserId(token)) : undefined;
      if (!viewer) throw new HttpError(401, "Unauthenticated");
      await handler(viewer, req, res);
    } catch (error) {
      next(error);
    }
  };
}
