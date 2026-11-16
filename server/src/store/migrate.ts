import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./sql.js";

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../migrations"),
    join(here, "../../../migrations"),
    join(process.cwd(), "migrations"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error("migrations directory is missing");
}

/** Session lock. Held on one reserved connection so a pool cannot move it. */
const MIGRATION_LOCK = "SELECT pg_advisory_lock(748213041)";
const MIGRATION_UNLOCK = "SELECT pg_advisory_unlock(748213041)";

export async function migrate(sql: Sql, dir = migrationsDir()): Promise<string[]> {
  if (!existsSync(dir)) throw new Error(`migrations directory is missing: ${dir}`);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations in ${dir}`);
  return sql.reserve((held) => applyMigrations(held, dir, files));
}

async function applyMigrations(sql: Sql, dir: string, files: string[]): Promise<string[]> {
  const locked = await tryAdvisoryLock(sql);
  try {
    await sql.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at text NOT NULL)",
    );
    const applied: string[] = [];
    for (const file of files) {
      const have = await sql.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (have.rows.length > 0) continue;
      const body = readFileSync(join(dir, file), "utf8");
      if (!body.trim()) throw new Error(`migration ${file} is empty`);
      await sql.exec(body);
      await sql.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [
        file,
        new Date().toISOString(),
      ]);
      applied.push(file);
    }
    return applied;
  } finally {
    if (locked) await sql.query(MIGRATION_UNLOCK);
  }
}

async function tryAdvisoryLock(sql: Sql): Promise<boolean> {
  try {
    await sql.query(MIGRATION_LOCK);
    return true;
  } catch (error) {
    if (!unsupportedAdvisoryLock(error)) throw error;
    process.stdout.write("migrate: pg_advisory_lock is unsupported on this database; continuing without it\n");
    return false;
  }
}

function unsupportedAdvisoryLock(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "42883" || code === "0A000") return true;
  const message = error instanceof Error ? error.message : "";
  return /pg_advisory_lock/i.test(message) && /(does not exist|unsupported|not supported)/i.test(message);
}
