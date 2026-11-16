import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import type { Config } from "../config.js";

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
  /** One connection for the whole callback. The pool must not switch clients under a session lock. */
  reserve<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

class PgliteSql implements Sql {
  constructor(private readonly db: PGlite) {}

  async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.db.query<T>(text, params);
    return { rows: result.rows };
  }

  async exec(text: string): Promise<void> {
    await this.db.exec(text);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async reserve<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** A pool checkout per query. An idle client that dies is not reused. */
export interface ReservedClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  release(destroy?: boolean): void;
}

export interface QueryablePool {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
  connect?(): Promise<ReservedClient>;
}

export class PgSql implements Sql {
  constructor(private readonly pool: QueryablePool) {}

  async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.pool.query(text, params);
    return { rows: result.rows as T[] };
  }

  async exec(text: string): Promise<void> {
    await this.pool.query(text);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async reserve<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    if (!this.pool.connect) throw new Error("This pool cannot reserve a connection.");
    const client = await this.pool.connect();
    const held = new PgSql({
      query: (text, params) => client.query(text, params),
      async end() {},
    });
    let failed = false;
    try {
      return await fn(held);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      client.release(failed);
    }
  }
}

export async function openSql(config: Config): Promise<Sql> {
  if (config.mailStore === "pglite") {
    if (config.nodeEnv === "production") {
      throw new Error("PGlite cannot run when NODE_ENV is production");
    }
    const db = new PGlite();
    await db.waitReady;
    return new PgliteSql(db);
  }
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", () => {
    // An idle connection can die. The next query checks out a new one.
  });
  return new PgSql(pool);
}
