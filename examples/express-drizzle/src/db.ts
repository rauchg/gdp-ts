/**
 * PGlite is Postgres compiled to WASM, running in-process and in-memory here,
 * so this example has no native dependencies and nothing to start. Swap the
 * driver for `drizzle-orm/node-postgres` (or any other) and nothing else in
 * this example changes.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.ts";

export const db = drizzle({ client: new PGlite(), schema });
