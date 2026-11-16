import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// app/page.html is gitignored. npm test runs before npm run build, and /app reads that file.
const serverDir = dirname(fileURLToPath(import.meta.url));

export function setup(): void {
  const page = join(serverDir, "app", "page.html");
  const template = join(serverDir, "..", "skills", "chatterbuilt-mail-setup", "assets", "chatterbuilt-mail.template.html");
  if (!existsSync(template)) throw new Error(`The page template is missing: ${template}`);
  const missing = !existsSync(page);
  const stale = !missing && statSync(page).mtimeMs < statSync(template).mtimeMs;
  if (!missing && !stale) return;
  const result = spawnSync(process.execPath, ["scripts/build-app.mjs"], {
    cwd: serverDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`scripts/build-app.mjs exited ${String(result.status)}`);
  if (!existsSync(page)) throw new Error("scripts/build-app.mjs did not write app/page.html");
}
