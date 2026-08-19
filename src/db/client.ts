/**
 * Database client.
 *
 * The connection is created once per process and reused. In Next.js dev the
 * module graph is re-evaluated on every hot reload, which would otherwise open a
 * new pool each time until Postgres refuses connections — so the client is
 * cached on `globalThis` in development.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, then run `npm run db:up`.",
    );
  }
  return url;
}

const globalForDb = globalThis as unknown as {
  __survivorSql?: ReturnType<typeof postgres>;
};

const sql = globalForDb.__survivorSql ?? postgres(connectionString(), { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__survivorSql = sql;
}

export const db = drizzle(sql, { schema });
export { schema, sql };
