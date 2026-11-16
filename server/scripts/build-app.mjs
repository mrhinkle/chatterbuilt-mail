import { cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(serverDir, "..");
const template = join(repo, "skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html");
const config = join(serverDir, "app/hosted.config.js");
const outDir = join(serverDir, "app");
const out = join(outDir, "page.html");
const iconSrc = join(repo, "docs/images/chatterbuilt-mail-mark.svg");
const iconOut = join(outDir, "icon.svg");

mkdirSync(outDir, { recursive: true });
execFileSync("python3", [join(repo, "scripts/build.py"), template, config, out], { stdio: "inherit" });
cpSync(iconSrc, iconOut);
