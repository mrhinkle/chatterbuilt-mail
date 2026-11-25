import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PgSql, type QueryablePool } from "./sql.js";

describe("postgres pool", () => {
  it("uses a pool and does not keep a single client", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sql.ts"), "utf8");
    expect(source).toContain("new Pool");
    expect(source).not.toContain("new Client");
  });

  it("lets the next query run after a dropped connection", async () => {
    let calls = 0;
    const pool: QueryablePool = {
      async query() {
        calls += 1;
        if (calls === 1) {
          const error = new Error("Connection terminated unexpectedly") as Error & { code?: string };
          error.code = "ECONNRESET";
          throw error;
        }
        return { rows: [{ ok: 1 }] };
      },
      async end() {},
    };
    const sql = new PgSql(pool);
    await expect(sql.query("select 1")).rejects.toThrow(/Connection terminated unexpectedly/);
    const second = await sql.query<{ ok: number }>("select 1");
    expect(second.rows).toEqual([{ ok: 1 }]);
    expect(calls).toBe(2);
  });
});
