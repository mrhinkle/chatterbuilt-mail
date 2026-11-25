import type { LabelRecord } from "./types.js";
import type { ImapListed, ImapNamespace } from "./imap-session.js";

export const SYSTEM_LABELS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE", "UNREAD", "STARRED"] as const;
export type SystemLabel = (typeof SYSTEM_LABELS)[number];
export type FolderRole = "INBOX" | "SENT" | "DRAFT" | "TRASH" | "SPAM" | "ARCHIVE";

const FLAG_ROLE: Record<string, FolderRole> = {
  "\\Sent": "SENT",
  "\\Drafts": "DRAFT",
  "\\Trash": "TRASH",
  "\\Junk": "SPAM",
  "\\Archive": "ARCHIVE",
};

const NAME_ROLE: Array<{ role: FolderRole; names: string[] }> = [
  { role: "SENT", names: ["sent", "sent messages", "sent items", "sent mail"] },
  { role: "TRASH", names: ["deleted messages", "deleted items", "trash"] },
  { role: "SPAM", names: ["junk", "junk e-mail", "spam", "bulk mail"] },
  { role: "ARCHIVE", names: ["archive", "archives"] },
  { role: "DRAFT", names: ["draft", "drafts"] },
];

export interface MappedFolder {
  path: string;
  delimiter: string;
  display: string;
  role: FolderRole | null;
  noSelect: boolean;
}

export function slugLabel(name: string): string {
  return name.replace(/[/ ]/g, "-").toLowerCase();
}

export function toDisplay(path: string, prefix: string, delimiter: string): string {
  if (path.toUpperCase() === "INBOX") return "INBOX";
  let rest = path;
  if (prefix && rest.startsWith(prefix)) rest = rest.slice(prefix.length);
  const sep = delimiter || "/";
  if (sep !== "/") rest = rest.split(sep).join("/");
  return rest;
}

export function toServer(display: string, prefix: string, delimiter: string): string {
  if (display.toUpperCase() === "INBOX") return "INBOX";
  const sep = delimiter || "/";
  const parts = display.split("/").filter((part) => part.length > 0 && part !== "." && part !== "..");
  return `${prefix}${parts.join(sep)}`;
}

export function parentPaths(path: string, prefix: string, delimiter: string): string[] {
  const sep = delimiter || "/";
  const rest = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const parts = rest.split(sep).filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    out.push(`${prefix}${parts.slice(0, i).join(sep)}`);
  }
  return out;
}

export function mapFolders(listed: ImapListed[], namespace: ImapNamespace): MappedFolder[] {
  const prefix = namespace.prefix;
  const rows: MappedFolder[] = listed.map((folder) => ({
    path: folder.path,
    delimiter: folder.delimiter || namespace.delimiter || "/",
    display: toDisplay(folder.path, prefix, folder.delimiter || namespace.delimiter || "/"),
    role: roleOf(folder),
    noSelect: folder.noSelect,
  }));
  const taken = new Set(rows.map((row) => row.role).filter((role): role is FolderRole => role !== null));
  for (const row of rows) {
    if (row.role || row.noSelect) continue;
    const name = row.path.toUpperCase() === "INBOX" ? "inbox" : row.display.split("/").at(-1)?.toLowerCase() ?? "";
    if (name === "inbox" && !taken.has("INBOX")) {
      row.role = "INBOX";
      taken.add("INBOX");
      continue;
    }
    for (const candidate of NAME_ROLE) {
      if (taken.has(candidate.role)) continue;
      if (candidate.names.includes(name)) {
        row.role = candidate.role;
        taken.add(candidate.role);
        break;
      }
    }
  }
  return rows;
}

function roleOf(folder: ImapListed): FolderRole | null {
  if (folder.path.toUpperCase() === "INBOX") return "INBOX";
  if (!folder.specialUse) return null;
  return FLAG_ROLE[folder.specialUse] ?? null;
}

export function systemLabels(): LabelRecord[] {
  return SYSTEM_LABELS.map((labelId) => ({ labelId, name: labelId, labelType: "SYSTEM" as const }));
}

export function userLabel(display: string): LabelRecord {
  return { labelId: display, name: display, labelType: "USER" };
}

export function labelsFrom(folders: MappedFolder[]): LabelRecord[] {
  const users = folders
    .filter((folder) => !folder.noSelect && !folder.role && folder.display && folder.display !== "INBOX")
    .map((folder) => userLabel(folder.display))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...systemLabels(), ...users];
}

export function rolePath(folders: MappedFolder[], role: FolderRole): string | null {
  return folders.find((folder) => folder.role === role)?.path ?? null;
}

export function folderByLabel(folders: MappedFolder[], labelId: string): MappedFolder | null {
  if (SYSTEM_LABELS.includes(labelId as SystemLabel) && labelId !== "UNREAD" && labelId !== "STARRED") {
    return folders.find((folder) => folder.role === labelId) ?? null;
  }
  return folders.find((folder) => folder.display === labelId) ?? null;
}

export function labelIdsFor(folder: MappedFolder, flags: string[]): string[] {
  const ids: string[] = [];
  if (folder.role) ids.push(folder.role);
  else if (folder.display) ids.push(folder.display);
  const set = new Set(flags.map((flag) => flag.toLowerCase()));
  if (!set.has("\\seen")) ids.push("UNREAD");
  if (set.has("\\flagged")) ids.push("STARRED");
  return ids;
}

export function isFlagLabel(labelId: string): boolean {
  return labelId === "UNREAD" || labelId === "STARRED" || labelId === "IMPORTANT";
}
