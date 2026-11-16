import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { migrate } from "./migrate.js";
import { openSql, PgSql, type QueryablePool, type Sql } from "./sql.js";

const TABLES = [
  "accounts",
  "provider_tokens",
  "threads",
  "messages",
  "labels",
  "drafts",
  "filters",
  "sync_state",
  "send_as",
  "jobs",
  "audit_log",
  "schema_migrations",
  "resync_threads",
  "sync_seen",
  "wake_empty",
  "oauth_clients",
  "oauth_codes",
  "oauth_refresh",
  "oauth_access",
  "owner_sessions",
  "passphrase_failures",
  "sample_limits",
  "google_oauth",
  "google_codes",
  "imap_mailboxes",
  "imap_copies",
  "imap_folder_state",
  "imap_connect_attempts",
  "microsoft_device",
  "microsoft_oauth",
  "microsoft_codes",
  "microsoft_delta",
  "owner_setup",
  "provider_clients",
];

describe("migrate", () => {
  it("applies once and keeps rows on a second run", async () => {
    const config = loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "test",
      MAIL_STORE: "pglite",
      MAIL_PROVIDER: "fake",
    });
    const sql = await openSql(config);
    try {
      const started = Date.now();
      expect(await migrate(sql)).toEqual(["001_init.sql", "002_draft_threading.sql", "003_sync_jobs.sql", "004_job_lease.sql", "005_auth.sql", "006_code_family.sql", "007_sample_limits.sql", "008_account_kinds.sql", "009_imap.sql", "010_microsoft.sql", "011_setup.sql"]);
      const finished = Date.now();
      const stamps = await sql.query<{ applied_at: string }>("SELECT applied_at FROM schema_migrations ORDER BY version");
      expect(stamps.rows).toHaveLength(11);
      for (const row of stamps.rows) {
        expect(row.applied_at).not.toBe("2026-11-04T15:00:00.000Z");
        const at = Date.parse(row.applied_at);
        expect(at).toBeGreaterThanOrEqual(started - 2000);
        expect(at).toBeLessThanOrEqual(finished + 2000);
      }
      expect(await migrate(sql)).toEqual([]);
      const tables = await sql.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const names = tables.rows.map((row) => row.table_name);
      for (const name of TABLES) expect(names).toContain(name);
      await sql.query(
        "INSERT INTO accounts (id, email, label, kind, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        ["gmail_work", "alex@riveralabs.example", "Rivera Labs", "gmail", 0, "2026-11-04T15:00:00.000Z"],
      );
      expect(await migrate(sql)).toEqual([]);
      const count = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts");
      expect(Number(count.rows[0]?.n)).toBe(1);
      const versions = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
      expect(Number(versions.rows[0]?.n)).toBe(11);
      await sql.query(
        "INSERT INTO accounts (id, email, label, kind, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        ["ms_work", "a@contoso.example", "Contoso", "microsoft", 1, "2026-11-04T15:00:00.000Z"],
      );
      await expect(sql.query(
        "INSERT INTO accounts (id, email, label, kind, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        ["bad_kind", "a@example.com", "Bad", "exchange", 2, "2026-11-04T15:00:00.000Z"],
      )).rejects.toThrow();
      const kinds = await sql.query<{ kind: string }>("SELECT kind FROM accounts ORDER BY position, id");
      expect(kinds.rows.map((row) => row.kind)).toEqual(["gmail", "microsoft"]);
    } finally {
      await sql.close();
    }
  });

  it("fails when the migrations directory is missing", async () => {
    const config = loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "test",
      MAIL_STORE: "pglite",
    });
    const sql = await openSql(config);
    try {
      await expect(migrate(sql, "/tmp/chatterbuilt-mail-no-such-migrations")).rejects.toThrow(/missing/);
    } finally {
      await sql.close();
    }
  });

  it("holds pg_advisory_lock on the reserved connection", async () => {
    const seen: string[] = [];
    let poolQueries = 0;
    let released = false;
    const client = {
      async query(text: string) {
        seen.push(text);
        if (text.includes("schema_migrations") && text.includes("WHERE")) return { rows: [{ version: "present" }] };
        return { rows: [] };
      },
      release() {
        released = true;
      },
    };
    const pool: QueryablePool = {
      async query() {
        poolQueries += 1;
        throw new Error("migrate must not take the lock on a pooled checkout");
      },
      async end() {},
      async connect() {
        return client;
      },
    };
    expect(await migrate(new PgSql(pool))).toEqual([]);
    expect(poolQueries).toBe(0);
    expect(released).toBe(true);
    expect(seen.some((text) => text.includes("pg_advisory_lock(") && !text.includes("unlock"))).toBe(true);
    expect(seen.some((text) => text.includes("pg_advisory_unlock("))).toBe(true);
  });

  it("skips pg_advisory_lock when the database does not have it and says so", async () => {
    const config = loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      NODE_ENV: "test",
      MAIL_STORE: "pglite",
    });
    const sql = await openSql(config);
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      lines.push(String(chunk));
      return original.call(process.stdout, chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    const wrapped: Sql = {
      async query(text, params) {
        if (text.includes("pg_advisory_lock(") && !text.includes("unlock")) {
          const error = new Error("pg_advisory_lock is unsupported") as Error & { code: string };
          error.code = "42883";
          throw error;
        }
        return sql.query(text, params);
      },
      exec: (text) => sql.exec(text),
      close: () => sql.close(),
      reserve: (fn) => fn(wrapped),
    };
    try {
      const started = Date.now();
      expect(await migrate(wrapped)).toEqual(["001_init.sql", "002_draft_threading.sql", "003_sync_jobs.sql", "004_job_lease.sql", "005_auth.sql", "006_code_family.sql", "007_sample_limits.sql", "008_account_kinds.sql", "009_imap.sql", "010_microsoft.sql", "011_setup.sql"]);
      const finished = Date.now();
      expect(lines.join("")).toContain("migrate: pg_advisory_lock is unsupported on this database; continuing without it");
      const stamps = await sql.query<{ applied_at: string }>("SELECT applied_at FROM schema_migrations");
      expect(stamps.rows.length).toBe(11);
      for (const row of stamps.rows) {
        const at = Date.parse(row.applied_at);
        expect(at).toBeGreaterThanOrEqual(started - 2000);
        expect(at).toBeLessThanOrEqual(finished + 2000);
      }
    } finally {
      process.stdout.write = original;
      await sql.close();
    }
  });
});
