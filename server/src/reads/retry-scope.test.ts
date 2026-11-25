import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "dist" || name === "node_modules") continue;
      out.push(...productionFiles(path));
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    out.push(path);
  }
  return out;
}

describe("read retry scope", () => {
  it("keeps the retry helper inside the read service", () => {
    const server = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const roots = [join(server, "src"), join(server, "api")];
    const hits = roots.flatMap((root) => productionFiles(root)).filter((path) => {
      return readFileSync(path, "utf8").includes("readOnce");
    });
    expect(hits.map((path) => path.split("/").pop())).toEqual(["service.ts"]);
    const source = readFileSync(join(server, "src/reads/service.ts"), "utf8");
    expect(source).toContain("async function readOnce");
    expect(source.includes("export async function readOnce")).toBe(false);
    expect(source.includes("export function readOnce")).toBe(false);
    expect(/export\s*\{[^}]*readOnce/.test(source)).toBe(false);
  });
});
