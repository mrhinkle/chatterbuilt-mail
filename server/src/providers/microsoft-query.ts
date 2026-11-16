/**
 * Gmail query strings the page and the morning skill send, translated for Graph.
 * Mail cannot combine `$search` and `$filter`. A query that needs both is `both`.
 * Gmail tab words (`category:primary` and the rest) have no Graph meaning.
 */

export interface QueryMessage {
  labelIds: string[];
  sender: string;
  toRecipients: string[];
  subject: string;
  date: string;
  attachments: readonly unknown[];
}

export interface BuiltQuery {
  empty: boolean;
  folder: string | null;
  filter: string | null;
  search: string | null;
  both: boolean;
  droppedCategories: boolean;
  local: LocalCheck;
}

interface LocalCheck {
  unread: boolean | null;
  starred: boolean | null;
  important: boolean | null;
  attachment: boolean | null;
  from: string[];
  to: string[];
  subject: string[];
  phrases: string[];
  words: string[];
  labelTokens: string[];
  receivedGe: string | null;
  receivedLt: string | null;
}

const FOLDERS: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  sentitems: "sentitems",
  draft: "drafts",
  drafts: "drafts",
  trash: "deleteditems",
  spam: "junkemail",
  junk: "junkemail",
  junkemail: "junkemail",
  archive: "archive",
};

const TAB = /^(primary|promotions|social|updates|forums)$/i;

const EMPTY_LOCAL: LocalCheck = {
  unread: null,
  starred: null,
  important: null,
  attachment: null,
  from: [],
  to: [],
  subject: [],
  phrases: [],
  words: [],
  labelTokens: [],
  receivedGe: null,
  receivedLt: null,
};

export function normalizeLabel(name: string): string {
  return name.replace(/[/ ]/g, "-").toLowerCase();
}

export function buildGraphQuery(query: string, nowMs: number): BuiltQuery {
  const tokens = tokenize(query);
  const dropped = tokens.some(isTab);
  const kept = tokens.filter((token) => !isTab(token));
  const onlyFolder = kept.length > 0 && kept.every((token) => folderOf(token) !== undefined);
  if (dropped && (kept.length === 0 || onlyFolder)) {
    return { empty: true, folder: null, filter: null, search: null, both: false, droppedCategories: true, local: EMPTY_LOCAL };
  }
  const local: LocalCheck = {
    unread: null,
    starred: null,
    important: null,
    attachment: null,
    from: [],
    to: [],
    subject: [],
    phrases: [],
    words: [],
    labelTokens: [],
    receivedGe: null,
    receivedLt: null,
  };
  let folder: string | null = null;
  const searchBits: string[] = [];
  let orNext = false;
  for (const token of kept) {
    if (/^or$/i.test(token)) {
      orNext = true;
      continue;
    }
    const folderName = folderOf(token);
    if (folderName) {
      folder = folder ?? folderName;
      continue;
    }
    const unread = flagOf(token, "unread");
    if (unread !== null) {
      local.unread = unread;
      continue;
    }
    const starred = flagOf(token, "starred");
    if (starred !== null) {
      local.starred = starred;
      continue;
    }
    const important = flagOf(token, "important");
    if (important !== null) {
      local.important = important;
      continue;
    }
    if (/^has:attachment$/i.test(token)) {
      local.attachment = true;
      continue;
    }
    const newer = /^newer_than:(\d+)d$/i.exec(token);
    if (newer?.[1]) {
      local.receivedGe = new Date(nowMs - Number(newer[1]) * 86_400_000).toISOString();
      continue;
    }
    const older = /^older_than:(\d+)d$/i.exec(token);
    if (older?.[1]) {
      local.receivedLt = new Date(nowMs - Number(older[1]) * 86_400_000).toISOString();
      continue;
    }
    const before = /^before:(\d{4})\/(\d{2})\/(\d{2})$/i.exec(token);
    if (before) {
      local.receivedLt = `${before[1]}-${before[2]}-${before[3]}T00:00:00.000Z`;
      continue;
    }
    const label = /^label:(.+)$/i.exec(token);
    if (label?.[1]) {
      local.labelTokens.push(label[1].toLowerCase());
      continue;
    }
    const from = /^from:(.+)$/i.exec(token);
    if (from?.[1]) {
      local.from.push(unquote(from[1]));
      pushSearch(searchBits, `from:${quoteKql(unquote(from[1]))}`, orNext);
      orNext = false;
      continue;
    }
    const to = /^to:(.+)$/i.exec(token);
    if (to?.[1]) {
      local.to.push(unquote(to[1]));
      pushSearch(searchBits, `to:${quoteKql(unquote(to[1]))}`, orNext);
      orNext = false;
      continue;
    }
    const subject = /^subject:(.+)$/i.exec(token);
    if (subject?.[1]) {
      local.subject.push(unquote(subject[1]));
      pushSearch(searchBits, `subject:${quoteKql(unquote(subject[1]))}`, orNext);
      orNext = false;
      continue;
    }
    if (token.startsWith("\"") && token.endsWith("\"")) {
      const phrase = unquote(token);
      local.phrases.push(phrase);
      pushSearch(searchBits, `"${phrase.replace(/"/g, "")}"`, orNext);
      orNext = false;
      continue;
    }
    local.words.push(token);
    pushSearch(searchBits, quoteKql(token), orNext);
    orNext = false;
  }
  const filterParts: string[] = [];
  if (local.unread === true) filterParts.push("isRead eq false");
  if (local.unread === false) filterParts.push("isRead eq true");
  if (local.starred === true) filterParts.push("flag/flagStatus eq 'flagged'");
  if (local.starred === false) filterParts.push("flag/flagStatus ne 'flagged'");
  if (local.important === true) filterParts.push("importance eq 'high'");
  if (local.important === false) filterParts.push("importance ne 'high'");
  if (local.attachment === true) filterParts.push("hasAttachments eq true");
  if (local.receivedGe) filterParts.push(`receivedDateTime ge ${local.receivedGe}`);
  if (local.receivedLt) filterParts.push(`receivedDateTime lt ${local.receivedLt}`);
  const hasSearch = searchBits.length > 0;
  const hasFilter = filterParts.length > 0 || local.labelTokens.length > 0;
  const both = hasSearch && hasFilter;
  let search = hasSearch ? searchBits.join(" ") : null;
  const filter = hasFilter && !both ? filterParts.join(" and ") : null;
  if (both && search) {
    if (local.receivedGe) search = `${search} received>=${local.receivedGe.slice(0, 10)}`;
    if (local.receivedLt) search = `${search} received<${local.receivedLt.slice(0, 10)}`;
    if (local.attachment) search = `${search} hasAttachments:true`;
  }
  if (!both && hasSearch && local.attachment && filterParts.length === 0) {
    search = `${search} hasAttachments:true`;
  }
  return {
    empty: false,
    folder,
    filter: filter && filter.length > 0 ? filter : null,
    search,
    both,
    droppedCategories: dropped,
    local,
  };
}

export function messageMatches(message: QueryMessage, built: BuiltQuery, nowMs: number, labelNames: readonly string[]): boolean {
  if (built.folder === "inbox" && !message.labelIds.includes("INBOX")) return false;
  if (built.folder === "sentitems" && !message.labelIds.includes("SENT")) return false;
  if (built.folder === "drafts" && !message.labelIds.includes("DRAFT")) return false;
  if (built.folder === "deleteditems" && !message.labelIds.includes("TRASH")) return false;
  if (built.folder === "junkemail" && !message.labelIds.includes("SPAM")) return false;
  if (built.folder === "archive" && message.labelIds.includes("INBOX")) return false;
  if (built.local.unread === true && !message.labelIds.includes("UNREAD")) return false;
  if (built.local.unread === false && message.labelIds.includes("UNREAD")) return false;
  if (built.local.starred === true && !message.labelIds.includes("STARRED")) return false;
  if (built.local.important === true && !message.labelIds.includes("IMPORTANT")) return false;
  if (built.local.attachment === true && message.attachments.length === 0) return false;
  if (built.local.receivedGe && message.date < built.local.receivedGe) return false;
  if (built.local.receivedLt && message.date >= built.local.receivedLt) return false;
  const fromHay = message.sender.toLowerCase();
  if (built.local.from.some((item) => !fromHay.includes(item.toLowerCase()))) return false;
  const toHay = message.toRecipients.join(" ").toLowerCase();
  if (built.local.to.some((item) => !toHay.includes(item.toLowerCase()))) return false;
  const subject = message.subject.toLowerCase();
  if (built.local.subject.some((item) => !subject.includes(item.toLowerCase()))) return false;
  const blob = `${subject} ${fromHay}`;
  if (built.local.phrases.some((item) => !blob.includes(item.toLowerCase()))) return false;
  if (built.local.words.some((item) => !blob.includes(item.toLowerCase()))) return false;
  if (built.local.labelTokens.length > 0) {
    const names = labelNames.map(normalizeLabel);
    if (built.local.labelTokens.some((token) => !names.includes(token) || !message.labelIds.some((id) => normalizeLabel(id) === token))) {
      return false;
    }
  }
  void nowMs;
  return true;
}

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const source = query.replace(/[()]/g, " ");
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    if (source[index] === "\"") {
      const end = source.indexOf("\"", index + 1);
      if (end === -1) {
        tokens.push(source.slice(index));
        break;
      }
      tokens.push(source.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < source.length && !/\s/.test(source[end] ?? "")) end += 1;
    tokens.push(source.slice(index, end));
    index = end;
  }
  return tokens.filter((token) => token.length > 0);
}

function isTab(token: string): boolean {
  const match = /^-?category:(.+)$/i.exec(token);
  return Boolean(match?.[1] && TAB.test(match[1]));
}

function folderOf(token: string): string | undefined {
  const match = /^in:(.+)$/i.exec(token);
  if (!match?.[1]) return undefined;
  return FOLDERS[match[1].toLowerCase()];
}

function flagOf(token: string, name: string): boolean | null {
  if (new RegExp(`^is:${name}$`, "i").test(token)) return true;
  if (new RegExp(`^-is:${name}$`, "i").test(token)) return false;
  return null;
}

function unquote(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) return value.slice(1, -1);
  return value;
}

function quoteKql(value: string): string {
  if (/[\s@:]/.test(value)) return `"${value.replace(/"/g, "")}"`;
  return value;
}

function pushSearch(bits: string[], term: string, orNext: boolean): void {
  if (orNext && bits.length > 0) bits.push("OR");
  bits.push(term);
}
