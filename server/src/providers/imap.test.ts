import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { loadConfig } from "../config.js";
import { openSeal } from "../crypto/seal.js";
import { createServer, type Running } from "../http/app.js";
import { Logger } from "../log.js";
import { FakeGmailServer } from "./gmail-fake-server.js";
import { JobService } from "../sync/jobs.js";
import { migrate } from "../store/migrate.js";
import { Repo } from "../store/repo.js";
import { openSql, type Sql } from "../store/sql.js";
import { buildMime, parseMime } from "./mime.js";
import { ImapProvider } from "./imap.js";
import { FLAVORS, MemoryMailbox, type MemoryFlavor } from "./imap-memory.js";
import { mapFolders } from "./imap-folders.js";
import { compileQuery } from "./imap-search.js";
import { imapMessageId, imapThreadId, interpretParsed, isHashMessageId, isHashThreadId, rfcFromMessageId, rfcFromThreadId } from "./imap-identity.js";
import { HASH_WALK_UIDS } from "./imap.js";
import { ImapAuthError, type ImapSession } from "./imap-session.js";
import { pinHost } from "./imap-ssrf.js";
import { sendSmtp, verifySmtp, type SmtpEnvelope, type SmtpTarget } from "./imap-smtp.js";

const PASSWORD = "app-password-secret";
const EMAIL = "ada@example.com";
const TOKEN = "test-owner-token-do-not-log-0123456789";
const PASSPHRASE = "correct-horse-battery-staple";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const REFRESH = "refresh-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";

const closers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const item = closers.pop();
    if (item) await item.close();
  }
});

interface Harness {
  provider: ImapProvider;
  store: Repo;
  sql: Sql;
  box: MemoryMailbox;
  id: string;
  lines: string[];
  sent: Buffer[];
  opened: string[];
  key: Buffer;
  close: () => Promise<void>;
  /** A new provider on the same mailbox. It has not listed or cached anything. */
  fresh: () => ImapProvider;
}

/** FlowSession returns nothing for an empty UID list. The memory model used to treat that as every message. */
function emptyUidFetch(inner: ImapSession): ImapSession {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== "fetch") {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (path: string, uids: number[], what: { source?: boolean; structure?: boolean; flags?: boolean }, changedSince?: string | null) => {
        if (uids.length === 0) return Promise.resolve([]);
        return target.fetch(path, uids, what, changedSince);
      };
    },
  });
}

async function harness(
  flavor: MemoryFlavor | keyof typeof FLAVORS = "full",
  mode: "mirror" | "direct" = "mirror",
  options?: { flowFetch?: boolean; sendRaw?: (target: SmtpTarget, raw: Buffer, envelope: SmtpEnvelope) => Promise<void> },
): Promise<Harness> {
  const picked = typeof flavor === "string" ? FLAVORS[flavor] : flavor;
  const key = randomBytes(32);
  const lines: string[] = [];
  const sent: Buffer[] = [];
  const opened: string[] = [];
  const logger = new Logger((line) => lines.push(line));
  const config = loadConfig({
    OWNER_TOKEN: TOKEN,
    ENCRYPTION_KEY: key.toString("base64"),
    MAIL_MODE: mode,
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "imap",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    OWNER_TIMEZONE: "UTC",
    IMAP_ALLOW_PRIVATE_HOSTS: "1",
  });
  const sql = await openSql(config);
  await migrate(sql);
  const store = new Repo(sql);
  const box = new MemoryMailbox(picked);
  const runtime = {
    store,
    key,
    logger,
    mailMode: mode,
    allowPrivateHosts: true,
    timeoutMs: 1_000,
    syncDays: 30,
    hooks: {
      open: async (target: { host: string; password: string }) => {
        opened.push(target.host);
        if (target.password !== PASSWORD) throw new ImapAuthError();
        const session = box.open();
        return options?.flowFetch ? emptyUidFetch(session) : session;
      },
      resolve: async () => ["203.0.113.10"],
      verifySmtp: async () => {},
      sendRaw: options?.sendRaw ?? (async (_target: SmtpTarget, raw: Buffer) => {
        sent.push(raw);
      }),
    },
  };
  const provider = new ImapProvider(runtime);
  const id = await store.connectImap({
    email: EMAIL,
    host: "mail.example.test",
    port: 993,
    security: "tls",
    username: EMAIL,
    password: PASSWORD,
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecurity: "starttls",
    saveSent: true,
    aliases: ["ada.alias@example.com"],
    key,
    at: "2026-11-05T12:00:00.000Z",
  });
  const close = async () => {
    await sql.close();
  };
  closers.push({ close });
  return { provider, store, sql, box, id, lines, sent, opened, key, close, fresh: () => new ImapProvider(runtime) };
}

async function letter(input: {
  from?: string;
  to?: string[];
  cc?: string[];
  subject: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
  html?: string;
  filename?: string;
}): Promise<Buffer> {
  const built = await buildMime({
    from: input.from ?? "Lee <lee@example.com>",
    to: input.to ?? [EMAIL],
    cc: input.cc ?? [],
    bcc: [],
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    headers: input.headers,
    attachments: input.filename
      ? [{ filename: input.filename, mimeType: "text/plain", content: Buffer.from("file-bytes") }]
      : undefined,
  });
  return built.rfc822;
}

async function count(sql: Sql, table: string): Promise<number> {
  const result = await sql.query<{ n: number | string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}

async function uids(box: MemoryMailbox, path: string): Promise<number[]> {
  try {
    const session = box.open();
    const found = await session.search(path, { all: true });
    await session.logout();
    return found;
  } catch {
    return [];
  }
}

describe("imap identity", () => {
  it("keeps one id for one Message-ID and ignores subject when threading", () => {
    const account = "imap_ada";
    const header = "<Root@Example.com>";
    const first = imapMessageId(account, header, "fallback");
    const second = imapMessageId("other-account", "root@example.com", "other fallback");
    expect(first).toBe(second);
    expect(first.startsWith("m")).toBe(true);
    expect(rfcFromMessageId(first)).toBe("root@example.com");
    const missing = imapMessageId(account, "", "date\nfrom\nsubject\n12");
    const changed = imapMessageId(account, "", "date\nfrom\nother\n12");
    expect(isHashMessageId(missing)).toBe(true);
    expect(missing).not.toBe(changed);
    expect(imapMessageId(account, "", "same")).not.toBe(imapMessageId("other-account", "", "same"));
    const thread = imapThreadId(account, "<root@example.com> <other@example.com>", "<ignored@example.com>", "<own@example.com>", "fb");
    const later = imapThreadId("other-account", "", "<root@example.com>", "<reply@example.com>", "fb");
    const own = imapThreadId(account, "", "", "<own@example.com>", "fb");
    expect(thread).toBe(imapThreadId(account, "<root@example.com>", "", "<reply@example.com>", "different subject"));
    expect(later).toBe(thread);
    expect(rfcFromThreadId(thread)).toBe("root@example.com");
    expect(own).not.toBe(thread);
    const hashed = imapThreadId(account, "", "", "", "fb");
    expect(isHashThreadId(hashed)).toBe(true);
    expect(rfcFromMessageId(missing)).toBeNull();
    expect(rfcFromThreadId(hashed)).toBeNull();
  });

  it("treats the same header in two folders as one message and a later reply as the same thread", async () => {
    const { provider, box, id } = await harness();
    const raw = await letter({ subject: "Alpha", text: "one", messageId: "<root@example.com>" });
    box.appendExternal("INBOX", raw, []);
    box.appendExternal("Archive", raw, []);
    const other = await letter({ subject: "Alpha", text: "unrelated", messageId: "<other@example.com>" });
    box.appendExternal("INBOX", other, []);
    const reply = await letter({
      subject: "Not the same subject",
      text: "reply",
      messageId: "<reply@example.com>",
      inReplyTo: "<root@example.com>",
      references: "<root@example.com>",
    });
    box.appendExternal("INBOX", reply, []);
    const threadId = imapThreadId(id, "", "", "root@example.com", "");
    const thread = await provider.getThread(id, threadId);
    expect(thread?.messages.map((message) => message.id)).toEqual([
      imapMessageId(id, "root@example.com", ""),
      imapMessageId(id, "reply@example.com", ""),
    ]);
    expect(thread?.messages[0]?.labelIds).toEqual(expect.arrayContaining(["INBOX", "ARCHIVE"]));
    const elsewhere = await provider.getThread(id, imapThreadId(id, "", "", "other@example.com", ""));
    expect(elsewhere?.messages).toHaveLength(1);
  });

  it("falls back to Date, From, Subject, and size when Message-ID is missing", async () => {
    const { provider, box, id } = await harness();
    const raw = Buffer.from(
      "From: Lee <lee@example.com>\r\nTo: ada@example.com\r\nSubject: Plain\r\nDate: Tue, 04 Nov 2026 12:00:00 +0000\r\n\r\nHello\r\n",
    );
    box.appendExternal("INBOX", raw, []);
    box.appendExternal("Sent", raw, []);
    const parsed = await parseMime(raw);
    const expected = interpretParsed(id, parsed, raw, [], "2026-11-04T12:00:00.000Z").message;
    const page = await provider.searchPage(id, "in:anywhere", 25, undefined, "summary");
    expect(page.hits).toHaveLength(1);
    expect(page.hits[0]?.id).toBe(expected.threadId);
    expect(page.hits[0]?.newest?.id).toBe(expected.id);
    expect(page.hits[0]?.messageCount).toBe(1);
  });
});

describe("imap folders", () => {
  it("maps iCloud, Yahoo, Outlook, and INBOX. names, and special-use wins", async () => {
    const roles = async (name: keyof typeof FLAVORS) => {
      const { provider, id } = await harness(name);
      const labels = await provider.listLabels(id);
      return labels.map((label) => label.labelId);
    };
    expect(await roles("icloud")).toEqual(expect.arrayContaining(["SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE"]));
    expect(await roles("yahoo")).toEqual(expect.arrayContaining(["SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE"]));
    expect(await roles("outlook")).toEqual(expect.arrayContaining(["SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE"]));
    const dotted = await harness("dotted");
    const created = await dotted.provider.createLabel(dotted.id, "CB/Snooze/2026-11-07");
    expect(created.labelId).toBe("CB/Snooze/2026-11-07");
    expect(dotted.box.list().some((folder) => folder.path === "INBOX.CB.Snooze.2026-11-07")).toBe(true);
    expect(dotted.box.list().some((folder) => folder.path === "INBOX.CB")).toBe(true);
    const raw = await letter({ subject: "Snoozed", text: "later" });
    dotted.box.appendExternal("INBOX.CB.Snooze.2026-11-07", raw, []);
    const found = await dotted.provider.searchPage(dotted.id, "label:cb-snooze-2026-11-07", 25, undefined, "ids");
    expect(found.hits).toHaveLength(1);

    const misleading = new MemoryMailbox({
      move: true, uidplus: true, condstore: true, qresync: false, specialUse: true, prefix: "", delimiter: "/",
      folders: [{ name: "Trash", specialUse: "\\Sent" }],
    });
    const mapped = mapFolders(misleading.list(), misleading.namespace);
    expect(mapped.find((folder) => folder.path === "Trash")?.role).toBe("SENT");
    expect(mapped.some((folder) => folder.role === "TRASH")).toBe(false);
  });

  it("leaves IMPORTANT and categories as nothing", async () => {
    const { provider, box, id } = await harness();
    const raw = await letter({ subject: "Hi", text: "there" });
    box.appendExternal("INBOX", raw, []);
    const before = box.list().length;
    const threadId = imapThreadId(id, "", "", (await parseMime(raw)).messageId ?? "", "");
    await provider.modifyThread(id, threadId, ["IMPORTANT"], []);
    expect(box.list()).toHaveLength(before);
    const important = await provider.searchPage(id, "is:important", 25, undefined, "ids");
    const category = await provider.searchPage(id, "category:primary", 25, undefined, "ids");
    expect(important.hits).toHaveLength(0);
    expect(category.hits).toHaveLength(0);
    const kept = await provider.searchPage(id, "in:inbox -category:promotions", 25, undefined, "ids");
    expect(kept.hits).toHaveLength(1);
  });
});

describe("imap search", () => {
  it("lists one page of a 2000-message inbox without downloading every source", async () => {
    const { provider, box, id, sent } = await harness("minimal");
    const pad = "snippet-body ".padEnd(8000, "x");
    for (let i = 0; i < 2000; i += 1) {
      const raw = Buffer.from([
        "From: Lee <lee@example.com>",
        "To: ada@example.com",
        `Subject: Bulk ${i}`,
        `Message-ID: <bulk-${i}@example.test>`,
        "Date: Thu, 05 Nov 2026 12:00:00 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        pad,
        "",
      ].join("\r\n"));
      const when = new Date(Date.parse("2026-11-05T12:00:00.000Z") - i * 5 * 60 * 60 * 1000).toISOString();
      box.appendExternal("INBOX", raw, [], when);
    }
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    const page = await provider.searchPage(id, "", 25, undefined, "summary");
    expect(page.hits).toHaveLength(25);
    expect(page.hits[0]?.snippet.length).toBeGreaterThan(0);
    expect(page.hits[0]?.snippet).toContain("snippet-body");
    expect(box.fetchStats.sourceMessages).toBeLessThanOrEqual(25);
    expect(box.fetchStats.bytes).toBeLessThan(2_000_000);
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    const found = await provider.searchPage(id, "subject:\"Bulk 1999\"", 25, undefined, "ids");
    expect(found.hits).toHaveLength(1);
    const opened = await provider.getThread(id, found.hits[0]?.id ?? "");
    expect(opened?.messages.map((message) => message.subject)).toEqual(["Bulk 1999"]);
    const replied = await provider.reply(id, {
      messageId: opened?.messages[0]?.id ?? "",
      body: "late reply",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
    });
    expect(replied.id).toBeTruthy();
    expect(sent.at(-1)?.toString("utf8")).toContain("late reply");
    expect(box.fetchStats.sourceMessages).toBeLessThanOrEqual(4);
    expect(box.fetchStats.items).toBeLessThanOrEqual(40);
  });

  it("opens and replies to a message older than the recent UID window", async () => {
    const { provider, box, id, sent } = await harness("minimal");
    const old = await letter({
      from: "Lee <lee@example.com>",
      to: ["Ada <ada@example.com>"],
      subject: "Bulk 1999",
      text: "ancient note",
      messageId: "<bulk-1999@example.test>",
    });
    box.appendExternal("INBOX", old, [], "2024-01-01T00:00:00.000Z");
    for (let i = 0; i < 200; i += 1) {
      const raw = await letter({ subject: `Newer ${i}`, text: "x", messageId: `<newer-${i}@example.test>` });
      box.appendExternal("INBOX", raw, []);
    }
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    const page = await provider.searchPage(id, "subject:\"Bulk 1999\"", 25, undefined, "ids");
    expect(page.hits).toHaveLength(1);
    const thread = await provider.getThread(id, page.hits[0]?.id ?? "");
    expect(thread?.messages.map((message) => message.subject)).toEqual(["Bulk 1999"]);
    const messageId = thread?.messages[0]?.id ?? "";
    const replied = await provider.reply(id, {
      messageId,
      body: "late reply",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
    });
    expect(replied.id).toBeTruthy();
    expect(sent.at(-1)?.toString("utf8")).toContain("late reply");
    expect(box.fetchStats.sourceMessages).toBeLessThanOrEqual(4);
    expect(box.fetchStats.items).toBeLessThanOrEqual(30);
  });

  it("opens and replies to the oldest of 2000 messages from a fresh direct provider", async () => {
    const { box, id, sent, fresh } = await harness("minimal", "direct");
    let target: Buffer | null = null;
    for (let i = 1999; i >= 0; i -= 1) {
      const raw = Buffer.from([
        "From: Lee <lee@example.com>",
        "To: ada@example.com",
        `Subject: Bulk ${i}`,
        `Message-ID: <bulk-${i}@example.test>`,
        "Date: Thu, 05 Nov 2026 12:00:00 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `body ${i}`,
        "",
      ].join("\r\n"));
      if (i === 1999) target = raw;
      const when = new Date(Date.parse("2026-11-05T12:00:00.000Z") - i * 60 * 60 * 1000).toISOString();
      box.appendExternal("INBOX", raw, [], when);
    }
    if (!target) throw new Error("missing oldest message");
    const provider = fresh();
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    box.fetchStats.headerMessages = 0;
    const threadId = imapThreadId(id, "", "", "bulk-1999@example.test", "");
    const messageId = imapMessageId(id, "bulk-1999@example.test", "");
    const thread = await provider.getThread(id, threadId);
    expect(thread?.messages.map((message) => message.subject)).toEqual(["Bulk 1999"]);
    expect(thread?.messages[0]?.id).toBe(messageId);
    const replied = await provider.reply(id, {
      messageId,
      body: "late reply",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
    });
    expect(replied.id).toBeTruthy();
    expect(sent.at(-1)?.toString("utf8")).toContain("late reply");
    expect(box.fetchStats.headerMessages).toBe(0);
    expect(box.fetchStats.sourceMessages).toBeGreaterThan(0);
    expect(box.fetchStats.bytes).toBe(box.fetchStats.sourceMessages * target.length);
  });

  it("returns not found for a message deleted after sync without a header walk", async () => {
    const { provider, box, id, store } = await harness("minimal", "mirror");
    const target = await letter({
      subject: "Gone soon",
      text: "delete me after sync",
      messageId: "<gone-soon@example.test>",
    });
    const uid = box.appendExternal("INBOX", target, [], "2026-11-04T12:00:00.000Z");
    for (let i = 0; i < 40; i += 1) {
      const raw = await letter({ subject: `Stay ${i}`, text: "still here", messageId: `<stay-${i}@example.test>` });
      box.appendExternal("INBOX", raw, [], "2026-11-04T12:00:00.000Z");
    }
    const clock = { now: () => Date.parse("2026-11-05T12:00:00.000Z") };
    const synced = await provider.syncSlice(id, 10_000, clock);
    expect(synced.synced).toBe(true);
    const messageId = imapMessageId(id, "gone-soon@example.test", "");
    expect(await store.getMessage(id, messageId)).not.toBeNull();
    const session = box.open();
    await session.markDeleted("INBOX", [uid]);
    expect(await session.expunge("INBOX", [uid])).toBe("expunged");
    await session.logout();
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    box.fetchStats.headerMessages = 0;
    await expect(provider.reply(id, {
      messageId,
      body: "too late",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
    })).rejects.toThrow(/not found/);
    expect(box.fetchStats.headerMessages).toBe(0);
    expect(box.fetchStats.sourceMessages).toBe(0);
    expect(box.fetchStats.items).toBe(0);
  });

  it("opens a message with no Message-ID by its hash id without fetching source to find it", async () => {
    const { id, box, fresh } = await harness("minimal", "direct");
    const raw = Buffer.from(
      "From: Lee <lee@example.com>\r\nTo: ada@example.com\r\nSubject: Plain\r\nDate: Tue, 04 Nov 2026 12:00:00 +0000\r\n\r\nHello\r\n",
    );
    box.appendExternal("INBOX", raw, []);
    const parsed = await parseMime(raw);
    const expected = interpretParsed(id, parsed, raw, [], "2026-11-04T12:00:00.000Z").message;
    expect(isHashMessageId(expected.id)).toBe(true);
    expect(isHashThreadId(expected.threadId)).toBe(true);
    const provider = fresh();
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    box.fetchStats.headerMessages = 0;
    const thread = await provider.getThread(id, expected.threadId);
    expect(thread?.messages.map((message) => message.id)).toEqual([expected.id]);
    expect(box.fetchStats.headerMessages).toBeGreaterThan(0);
    expect(box.fetchStats.headerMessages).toBeLessThanOrEqual(HASH_WALK_UIDS);
    expect(box.fetchStats.sourceMessages).toBe(1);
  });

  it("does not walk past the newest 200 UIDs when a hash id is older than that", async () => {
    const { id, box, fresh } = await harness("minimal", "direct");
    const raw = Buffer.from(
      "From: Lee <lee@example.com>\r\nTo: ada@example.com\r\nSubject: Buried\r\nDate: Tue, 04 Nov 2026 12:00:00 +0000\r\n\r\nHello\r\n",
    );
    box.appendExternal("INBOX", raw, [], "2026-11-01T00:00:00.000Z");
    for (let i = 0; i < HASH_WALK_UIDS; i += 1) {
      const newer = Buffer.from([
        "From: Lee <lee@example.com>",
        "To: ada@example.com",
        `Subject: Newer ${i}`,
        `Message-ID: <newer-${i}@example.test>`,
        "Date: Thu, 05 Nov 2026 12:00:00 +0000",
        "",
        "x",
        "",
      ].join("\r\n"));
      box.appendExternal("INBOX", newer, []);
    }
    const parsed = await parseMime(raw);
    const expected = interpretParsed(id, parsed, raw, [], "2026-11-01T00:00:00.000Z").message;
    const provider = fresh();
    box.fetchStats.bytes = 0;
    box.fetchStats.items = 0;
    box.fetchStats.sourceMessages = 0;
    box.fetchStats.headerMessages = 0;
    expect(await provider.getThread(id, expected.threadId)).toBeNull();
    expect(box.fetchStats.headerMessages).toBe(HASH_WALK_UIDS);
    expect(box.fetchStats.sourceMessages).toBe(0);
  });

  it("answers every operator the page sends", async () => {
    const now = new Date("2026-11-05T15:00:00.000Z");
    const inbox = { role: "INBOX", display: "INBOX" };
    expect(compileQuery("", inbox, now).query).toBe("all");
    expect(compileQuery("is:important", inbox, now).query).toBe("none");
    expect(compileQuery("category:primary", inbox, now).query).toBe("none");
    expect(compileQuery("bogus:nope", inbox, now).query).toBe("none");
    const morning = compileQuery("in:inbox newer_than:3d -category:promotions", inbox, now);
    expect(morning.query).toMatchObject({ since: "2026-11-02" });
    expect(compileQuery('subject:"two words"', inbox, now).query).toMatchObject({ subject: "two words" });
    expect(compileQuery('from:"A B"', inbox, now).query).toMatchObject({ from: "A B" });
    expect(compileQuery('-subject:"x y"', inbox, now).query).toMatchObject({ not: { subject: "x y" } });
    const snooze = { role: null, display: "CB/Snooze/2026-11-07" };
    expect(compileQuery('label:"CB/Snooze/2026-11-07"', snooze, now).query).toBe("all");
    expect(compileQuery("label:cb-snooze-2026-11-07", snooze, now).query).toBe("all");

    const { provider, box, id } = await harness();
    const recent = await letter({
      from: "Lee <lee@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["Sam <sam@example.com>"],
      subject: "Quarterly plan",
      text: "alpha beta",
      messageId: "<plan@example.com>",
      headers: { "List-Id": "<plan.example.com>" },
      filename: "notes.pdf",
    });
    const old = await letter({
      from: "Sam <sam@example.com>",
      to: ["Sam <sam@example.com>"],
      subject: "Old note",
      text: "stale",
      messageId: "<old@example.com>",
    });
    box.appendExternal("INBOX", recent, []);
    box.appendExternal("INBOX", old, ["\\Seen", "\\Flagged"], "2026-10-01T00:00:00.000Z");
    box.appendExternal("Archive", old, ["\\Seen"], "2026-10-01T00:00:00.000Z");

    const query = async (text: string) => (await provider.searchPage(id, text, 25, undefined, "ids")).hits.length;
    expect(await query("")).toBe(2);
    expect(await query("from:lee@example.com")).toBe(1);
    expect(await query("to:ada@example.com")).toBe(1);
    expect(await query("cc:sam@example.com")).toBe(1);
    expect(await query("subject:Quarterly")).toBe(1);
    expect(await query("\"alpha beta\"")).toBe(1);
    expect(await query("in:inbox")).toBe(2);
    expect(await query("in:archive")).toBe(1);
    expect(await query("in:anywhere")).toBe(2);
    expect(await query("is:unread")).toBe(1);
    expect(await query("is:read")).toBe(1);
    expect(await query("is:starred")).toBe(1);
    expect(await query("newer_than:3d")).toBe(1);
    expect(await query("older_than:3d")).toBe(1);
    expect(await query("before:2026/10/15")).toBe(1);
    expect(await query("list:plan.example.com")).toBe(1);
    expect(await query("filename:notes.pdf")).toBe(1);
    expect(await query("filename:missing.bin")).toBe(0);
    expect(await query("has:attachment")).toBe(1);
    expect(await query("from:lee OR from:nobody@example.com")).toBe(1);
    expect(await query("(from:sam OR from:lee) subject:plan")).toBe(1);
    expect(await query("-from:lee")).toBe(1);
    expect(await query("is:important")).toBe(0);
    expect(await query("category:promotions")).toBe(0);
    expect(await query("in:inbox -category:promotions")).toBe(2);
  });
});

describe("imap modify", () => {
  it("copies, moves, falls back without MOVE or UIDPLUS, and restores a label", async () => {
    const full = await harness("full");
    const raw = await letter({ subject: "Move me", text: "body", messageId: "<move@example.com>" });
    full.box.appendExternal("INBOX", raw, ["\\Seen"]);
    const threadId = imapThreadId(full.id, "", "", "move@example.com", "");
    await full.provider.labelThread(full.id, threadId, ["Notes"]);
    expect(await uids(full.box, "INBOX")).toHaveLength(1);
    expect(await uids(full.box, "Notes")).toHaveLength(1);
    await full.provider.unlabelThread(full.id, threadId, ["Notes"]);
    expect(await uids(full.box, "Notes")).toHaveLength(0);
    expect(await uids(full.box, "INBOX")).toHaveLength(1);

    await full.provider.modifyThread(full.id, threadId, ["ARCHIVE"], ["INBOX"]);
    expect(await uids(full.box, "INBOX")).toHaveLength(0);
    expect(await uids(full.box, "Archive")).toHaveLength(1);
    await full.provider.modifyThread(full.id, threadId, ["INBOX"], ["ARCHIVE"]);
    expect(await uids(full.box, "INBOX")).toHaveLength(1);

    const minimal = await harness("minimal");
    minimal.box.appendExternal("INBOX", raw, []);
    const other = await letter({ subject: "Gone", text: "x", messageId: "<gone@example.com>" });
    const goneUid = minimal.box.appendExternal("INBOX", other, ["\\Deleted"]);
    expect(goneUid).toBeGreaterThan(0);
    const minimalThread = imapThreadId(minimal.id, "", "", "move@example.com", "");
    await minimal.provider.modifyThread(minimal.id, minimalThread, ["ARCHIVE"], ["INBOX"]);
    expect(await uids(minimal.box, "Archive")).toHaveLength(1);
    const inbox = minimal.box.open();
    const hidden = await inbox.fetch("INBOX", [1], { flags: true });
    await inbox.logout();
    expect(hidden.some((row) => row.flags.includes("\\Deleted"))).toBe(true);
    const visible = await minimal.provider.searchPage(minimal.id, "in:anywhere subject:Move", 25, undefined, "ids");
    expect(visible.hits).toHaveLength(1);

    const clean = await harness("minimal");
    clean.box.appendExternal("INBOX", raw, []);
    const cleanThread = imapThreadId(clean.id, "", "", "move@example.com", "");
    await clean.provider.unlabelThread(clean.id, cleanThread, ["INBOX"]);
    expect(await uids(clean.box, "INBOX")).toHaveLength(0);
    expect(await uids(clean.box, "Archive")).toHaveLength(1);
  });
});

describe("imap drafts and send", () => {
  it("keeps the draft id, lists another client's draft, and survives a failed delete", async () => {
    const { provider, box, id, store } = await harness();
    const created = await provider.createDraft(id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft one",
      body: "first",
      replyToMessageId: undefined,
    });
    const updated = await provider.updateDraft(id, created.id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft two",
      body: "second",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.plaintextBody).toContain("second");
    const again = await provider.updateDraft(id, created.id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft three",
      body: "third",
    });
    expect(again.id).toBe(created.id);
    expect(await uids(box, "Drafts")).toHaveLength(1);

    const foreign = await letter({ subject: "Theirs", text: "from another client", messageId: "<foreign@example.com>" });
    box.appendExternal("Drafts", foreign, ["\\Draft", "\\Seen"]);
    const listed = await provider.listDraftMeta(id);
    expect(listed.map((draft) => draft.subject).sort()).toEqual(["Draft three", "Theirs"]);
    const foreignId = listed.find((draft) => draft.subject === "Theirs")?.id ?? "";
    const adopted = await provider.updateDraft(id, foreignId, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Theirs",
      body: "adopted",
    });
    expect(adopted.id).toBe(foreignId);
    const adoptedRaw = Buffer.from(adopted.raw ?? "", "base64url").toString("utf8");
    expect(adoptedRaw.toLowerCase()).toContain("x-cbm-draft-id");

    box.queueWrites([null, new Error("delete failed")]);
    const kept = await provider.updateDraft(id, created.id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft four",
      body: "fourth",
    });
    expect(kept.plaintextBody).toContain("fourth");
    const audit = await store.listAudit();
    expect(audit.some((row) => row.tool === "update_draft" && row.detail.store_failed === true)).toBe(true);
    const shown = await provider.getDraft(id, created.id);
    expect(shown?.plaintextBody).toContain("fourth");
    await provider.updateDraft(id, created.id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft five",
      body: "fifth",
    });
    expect(await uids(box, "Drafts")).toHaveLength(2);
    await provider.deleteDraft(id, created.id);
    const left = await provider.listDraftMeta(id);
    expect(left.some((draft) => draft.id === created.id)).toBe(false);
  });

  it("sends once, keeps threading headers, and still succeeds when the sent copy fails", async () => {
    const { provider, box, id, sent, store } = await harness();
    const raw = await letter({
      subject: "Question",
      text: "original",
      messageId: "<ask@example.com>",
      html: "<p>original</p>",
    });
    box.appendExternal("INBOX", raw, []);
    const messageId = imapMessageId(id, "ask@example.com", "");
    const reply = await provider.reply(id, {
      messageId,
      body: "answer",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
      attachments: [{ filename: "note.txt", mimeType: "text/plain", content: Buffer.from("abc").toString("base64") }],
    });
    expect(sent).toHaveLength(1);
    const sentText = sent[0]?.toString("utf8") ?? "";
    expect(sentText).toContain("ask@example.com");
    expect(sentText.toLowerCase()).toContain("in-reply-to");
    expect(sentText.toLowerCase()).toContain("references");
    expect(sentText).toContain("note.txt");
    expect(await uids(box, "Sent")).toHaveLength(1);
    const draft = await provider.createDraft(id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "Re: Question",
      body: "saved",
      replyToMessageId: messageId,
    });
    expect(draft.inReplyTo.toLowerCase()).toContain("ask@example.com");
    expect(draft.references.toLowerCase()).toContain("ask@example.com");

    box.failNextWrite(new Error("append failed"));
    const forwarded = await provider.forward(id, {
      messageId,
      to: ["sam@example.com"],
      includeSignature: false,
    });
    expect(forwarded.id).toBeTruthy();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.toString("utf8")).toContain("Forwarded message");

    const mine = await letter({
      from: "Ada <ada@example.com>",
      to: ["Lee <lee@example.com>"],
      cc: ["Sam <sam@example.com>"],
      subject: "Following up",
      text: "the note I sent",
      messageId: "<mine@example.com>",
    });
    box.appendExternal("Sent", mine, ["\\Seen"]);
    const mineId = imapMessageId(id, "mine@example.com", "");
    const followed = await provider.reply(id, {
      messageId: mineId,
      body: "one more thing",
      replyAll: false,
      cc: [],
      bcc: [],
      includeSignature: false,
      attachments: [],
    });
    expect(followed.id).toBeTruthy();
    const followedText = sent.at(-1)?.toString("utf8") ?? "";
    const followedTo = /^to:\s*(.*)$/im.exec(followedText)?.[1] ?? "";
    expect(followedTo.toLowerCase()).toContain("lee@example.com");
    expect(followedTo.toLowerCase()).not.toContain("ada@example.com");
    await provider.reply(id, {
      messageId: mineId,
      body: "and sam",
      replyAll: true,
      cc: [],
      bcc: [],
      includeSignature: false,
      attachments: [],
    });
    const allText = sent.at(-1)?.toString("utf8") ?? "";
    const allCc = /^cc:\s*(.*)$/im.exec(allText)?.[1] ?? "";
    expect(allCc.toLowerCase()).toContain("sam@example.com");
    expect(allCc.toLowerCase()).not.toContain("ada@example.com");
    const failed = (await store.listAudit()).filter((row) => row.detail.store_failed === true);
    expect(failed.some((row) => row.tool === "send_message")).toBe(true);

    const withDraft = await provider.sendMessage(id, {
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      body: "",
      draftId: draft.id,
    });
    expect(withDraft.threadId).toBe(reply.threadId);
    expect((await provider.listDraftMeta(id)).some((item) => item.id === draft.id)).toBe(false);

    const attached = await provider.searchPage(id, "filename:note.txt", 25, undefined, "summary");
    expect(attached.hits[0]?.newest?.attachments.some((item) => item.filename === "note.txt")).toBe(true);
    await expect(provider.createFilter(id, { from: "", to: "", subject: "", query: "", hasAttachment: false }, { addLabelIds: [], removeLabelIds: [], skipInbox: false })).rejects.toThrow(/Filters aren't available/);
    expect(await provider.listFilters()).toEqual([]);
  });

  it("keeps Bcc on a draft and the sent copy, and leaves it out of SMTP DATA", async () => {
    const rcpt: string[] = [];
    const dataParts: string[] = [];
    const server = new SMTPServer({
      secure: false,
      authOptional: false,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, callback) {
        if (auth.username === EMAIL && auth.password === PASSWORD) callback(null, { user: EMAIL });
        else callback(new Error("535 invalid"));
      },
      onRcptTo(address, _session, callback) {
        rcpt.push(address.address);
        callback();
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          dataParts.push(Buffer.concat(chunks).toString("utf8"));
          callback();
        });
      },
    });
    const port = await listenSmtp(server);
    closers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
    const { provider, box, id } = await harness("full", "mirror", {
      sendRaw: async (_target, raw, envelope) => {
        await sendSmtp({ ...smtpTarget(port), user: EMAIL, password: PASSWORD, timeoutMs: 2_000 }, raw, envelope);
      },
    });

    const draft = await provider.createDraft(id, {
      to: ["lee@example.com"],
      cc: [],
      bcc: ["secret@example.test"],
      subject: "Hold",
      body: "later",
    });
    expect(draft.bccRecipients.join(" ")).toContain("secret@example.test");
    const reading = box.open();
    const draftRows = await reading.fetch("Drafts", await reading.search("Drafts", { all: true }), { source: true });
    const draftText = draftRows.map((row) => row.source?.toString("utf8") ?? "").join("\n");
    expect(draftText).toMatch(/^bcc:\s*secret@example\.test/im);

    rcpt.length = 0;
    dataParts.length = 0;
    await provider.sendMessage(id, {
      to: ["lee@example.com"],
      cc: ["sam@example.com"],
      bcc: ["secret@example.test"],
      subject: "Out",
      body: "going",
    });
    expect(rcpt).toContain("secret@example.test");
    expect(dataParts.join("\n")).not.toMatch(/^bcc:/im);
    const sentRows = await reading.fetch("Sent", await reading.search("Sent", { all: true }), { source: true });
    const sentText = sentRows.map((row) => row.source?.toString("utf8") ?? "").join("\n");
    expect(sentText).toMatch(/^bcc:\s*secret@example\.test/im);

    const old = Buffer.from([
      "From: Ada <ada@example.com>",
      "To: lee@example.com",
      "Cc: sam@example.com",
      "Bcc: secret@example.test",
      "Subject: Old draft",
      "Message-ID: <old-draft@example.com>",
      "Date: Thu, 01 Jan 2020 00:00:00 +0000",
      "X-CBM-Draft-Id: draft-old",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "hidden copy",
      "",
    ].join("\r\n"));
    box.appendExternal("Drafts", old, ["\\Draft", "\\Seen"]);
    rcpt.length = 0;
    dataParts.length = 0;
    const sent = await provider.sendMessage(id, {
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      body: "",
      draftId: "draft-old",
    });
    const wire = dataParts.join("\n");
    expect(rcpt).toContain("secret@example.test");
    expect(rcpt).toContain("lee@example.com");
    expect(wire).not.toMatch(/^bcc:/im);
    expect(wire).not.toMatch(/x-cbm-draft-id/i);
    expect(wire).not.toContain("2020");
    expect(sent.message.bccRecipients.join(" ")).toContain("secret@example.test");
    const returned = Buffer.from(sent.message.raw ?? "", "base64url").toString("utf8");
    expect(returned).not.toMatch(/x-cbm-draft-id/i);
    expect(returned).toMatch(/^bcc:\s*secret@example\.test/im);
    const after = await reading.fetch("Sent", await reading.search("Sent", { all: true }), { source: true });
    const copy = after.map((row) => row.source?.toString("utf8") ?? "").join("\n");
    expect(copy).toMatch(/^bcc:\s*secret@example\.test/im);
    expect(copy).not.toMatch(/x-cbm-draft-id/i);
  });
});

describe("imap attempts", () => {
  it("tries a write once and a read twice", async () => {
    const { provider, box, id } = await harness();
    const raw = await letter({ subject: "Once", text: "body", messageId: "<once@example.com>" });
    box.appendExternal("INBOX", raw, []);
    const threadId = imapThreadId(id, "", "", "once@example.com", "");
    for (const message of ["timeout", "535 rejected", "connection reset"]) {
      box.failNextWrite(new Error(message));
      const before = box.writeAttempts;
      await expect(provider.modifyThread(id, threadId, ["STARRED"], [])).rejects.toThrow(/did not answer|Connect this account/);
      expect(box.writeAttempts - before).toBe(1);
    }
    box.failNextRead(new Error("connection reset"));
    const labels = await provider.listLabels(id);
    expect(labels.some((label) => label.labelId === "INBOX")).toBe(true);
    box.failNextRead(Object.assign(new Error("Unexpected close"), { code: "ClosedAfterConnectTLS" }));
    const closed = await provider.listLabels(id);
    expect(closed.some((label) => label.labelId === "INBOX")).toBe(true);
    box.failReads(2, new Error("connection reset"));
    await expect(provider.listLabels(id)).rejects.toThrow(/did not answer/);
    box.failNextWrite(new Error("connection reset"));
    const before = box.writeAttempts;
    await expect(provider.modifyThread(id, threadId, ["STARRED"], [])).rejects.toThrow(/did not answer/);
    expect(box.writeAttempts - before).toBe(1);
  });

  it("opens one SMTP connection for a timeout, a rejection, and a dropped DATA", async () => {
    const source = readFileSync(new URL("./imap-smtp.ts", import.meta.url), "utf8");
    const flow = readFileSync(new URL("./imap-flow.ts", import.meta.url), "utf8");
    expect(source).toContain("pool: false");
    expect(source).toContain("rejectUnauthorized: true");
    expect(source).not.toContain("rejectUnauthorized: false");
    expect(flow).not.toContain("rejectUnauthorized: false");

    const hangers: import("node:net").Socket[] = [];
    const hang = createNetServer((socket) => {
      hangers.push(socket);
    });
    await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", () => resolve()));
    const hangPort = (hang.address() as { port: number }).port;
    closers.push({
      close: () => new Promise((resolve) => {
        for (const socket of hangers) socket.destroy();
        hang.close(() => resolve());
      }),
    });
    await expect(sendSmtp(smtpTarget(hangPort), Buffer.from("From: a@example.com\r\n\r\nHi\r\n"), {
      from: "a@example.com",
      to: ["b@example.com"],
    })).rejects.toThrow();
    expect(hangers).toHaveLength(1);

    let dataCalls = 0;
    let authCalls = 0;
    const rejected = new SMTPServer({
      secure: false,
      authOptional: false,
      disabledCommands: ["STARTTLS"],
      onAuth(_auth, _session, callback) {
        authCalls += 1;
        callback(new Error("535 invalid"));
      },
      onData(stream, _session, callback) {
        dataCalls += 1;
        stream.resume();
        stream.on("end", () => callback());
      },
    });
    const rejectedPort = await listenSmtp(rejected);
    await expect(verifySmtp({ ...smtpTarget(rejectedPort), user: "ada", password: "nope" })).rejects.toThrow();
    expect(authCalls).toBe(1);
    expect(dataCalls).toBe(0);

    let dropped = 0;
    const server = new SMTPServer({
      secure: false,
      authOptional: false,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, callback) {
        if (auth.username === "ada" && auth.password === "secret") callback(null, { user: "ada" });
        else callback(new Error("535 invalid"));
      },
      onData(stream, _session, callback) {
        dropped += 1;
        stream.resume();
        stream.on("end", () => callback(new Error("421 dropped")));
      },
    });
    const port = await listenSmtp(server);
    await expect(sendSmtp({ ...smtpTarget(port), user: "ada", password: "secret" }, Buffer.from("Subject: Hi\r\n\r\nBody\r\n"), {
      from: "ada@example.com",
      to: ["lee@example.com"],
    })).rejects.toThrow();
    expect(dropped).toBe(1);
  });
});

describe("imap sync and jobs", () => {
  it("resumes a backfill, then sees a new uid, a flag, a delete, and a UIDVALIDITY change", async () => {
    const { provider, box, id, store } = await harness();
    const first = await letter({ subject: "One", text: "one", messageId: "<one@example.com>" });
    const second = await letter({ subject: "Two", text: "two", messageId: "<two@example.com>" });
    box.appendExternal("INBOX", first, []);
    box.appendExternal("INBOX", second, []);
    let phase: "stop" | "go" = "stop";
    let samples = 0;
    const clock = {
      now() {
        samples += 1;
        const start = Date.parse("2026-11-05T12:00:00.000Z");
        if (phase === "go") return start;
        return samples === 1 ? start : start + 100_000;
      },
    };
    const partial = await provider.syncSlice(id, 10, clock);
    expect(partial.partial).toBe(true);
    expect(await count(storeSql(store), "messages")).toBe(1);
    phase = "go";
    samples = 0;
    const done = await provider.syncSlice(id, 10_000, clock);
    expect(done.synced).toBe(true);
    expect(await count(storeSql(store), "messages")).toBe(2);

    box.setFlagsExternal("INBOX", 1, ["\\Flagged"]);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    const flagged = await store.getMessage(id, imapMessageId(id, "one@example.com", ""));
    expect(flagged?.labelIds).toContain("STARRED");

    box.deleteExternal("INBOX", 2);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    expect(await store.getMessage(id, imapMessageId(id, "two@example.com", ""))).toBeNull();

    box.recreateFolder("INBOX");
    box.appendExternal("INBOX", first, []);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    const kept = await store.getMessage(id, imapMessageId(id, "one@example.com", ""));
    expect(kept).toBeTruthy();
    const copies = await store.listImapCopies(id, kept?.id);
    expect(copies.some((copy) => copy.folder === "INBOX")).toBe(true);

    const deleted = await letter({ subject: "Hidden", text: "x", messageId: "<hidden@example.com>" });
    box.appendExternal("INBOX", deleted, ["\\Deleted"]);
    const hidden = await provider.searchPage(id, "subject:Hidden", 25, undefined, "ids");
    expect(hidden.hits).toHaveLength(0);
  });

  it("syncs a flag another client set when an empty UID fetch returns nothing", async () => {
    const { provider, box, id, store } = await harness("full", "mirror", { flowFetch: true });
    const raw = await letter({ subject: "Flag me", text: "please star this", messageId: "<flag-me@example.com>" });
    box.appendExternal("INBOX", raw, ["\\Seen"]);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    box.setFlagsExternal("INBOX", 1, ["\\Seen", "\\Flagged"]);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    const message = await store.getMessage(id, imapMessageId(id, "flag-me@example.com", ""));
    expect(message?.labelIds).toContain("STARRED");

    for (const copy of await store.listImapCopies(id, message?.id)) {
      await store.deleteImapCopy(id, copy.folder, copy.uidValidity, copy.uid);
    }
    if (message) await store.deleteMessage(id, message.id);
    box.setFlagsExternal("INBOX", 1, ["\\Seen", "\\Flagged"]);
    await provider.syncSlice(id, 10_000, { now: () => Date.parse("2026-11-05T12:00:00.000Z") });
    const restored = await store.getMessage(id, imapMessageId(id, "flag-me@example.com", ""));
    expect(restored?.labelIds).toContain("STARRED");
    expect(restored?.snippet).toContain("please star this");
  });

  it("returns nothing for an empty UID list, the same as FlowSession", async () => {
    const { box } = await harness("full");
    const raw = await letter({ subject: "Present", text: "already here", messageId: "<present@example.com>" });
    box.appendExternal("INBOX", raw, []);
    const session = box.open();
    await expect(session.fetch("INBOX", [], { flags: true, source: true }, "0")).resolves.toEqual([]);
  });

  it("wakes a snooze and a remind-me once", async () => {
    const { provider, box, id, store, sql } = await harness();
    const raw = await letter({ subject: "Nap", text: "zzz", messageId: "<nap@example.com>" });
    box.appendExternal("INBOX", raw, ["\\Seen"]);
    const threadId = imapThreadId(id, "", "", "nap@example.com", "");
    await provider.labelThread(id, threadId, ["CB/Snooze/2020-01-01"]);
    await provider.unlabelThread(id, threadId, ["INBOX"]);
    expect(await uids(box, "INBOX")).toHaveLength(0);
    expect(await uids(box, "CB/Snooze/2020-01-01")).toHaveLength(1);
    const jobs = new JobService(loadConfig(jobEnv()), store, provider, new Logger(), {
      now: () => Date.parse("2026-11-05T12:00:00.000Z"),
    });
    expect(await jobs.runDue(id, () => false)).toBe(1);
    expect(await jobs.runDue(id, () => false)).toBe(0);
    expect(await uids(box, "INBOX")).toHaveLength(1);
    expect(await uids(box, "CB/Snooze/2020-01-01")).toHaveLength(0);
    const session = box.open();
    const flags = await session.fetch("INBOX", await session.search("INBOX", { all: true }), { flags: true });
    await session.logout();
    expect(flags[0]?.flags.includes("\\Seen")).toBe(false);
    const claims = await sql.query<{ id: string; done_at: string | null }>("SELECT id, done_at FROM jobs");
    expect(claims.rows).toHaveLength(1);
    expect(claims.rows[0]?.id).toBe(`wake:${id}:CB/Snooze/2020-01-01:${threadId}`);
    expect(claims.rows[0]?.done_at).toBeTruthy();

    const remind = await letter({ subject: "Ping", text: "yo", messageId: "<ping@example.com>" });
    box.appendExternal("INBOX", remind, []);
    const remindThread = imapThreadId(id, "", "", "ping@example.com", "");
    await provider.labelThread(id, remindThread, ["CB/Remind/2020-01-01"]);
    expect(await uids(box, "INBOX")).toHaveLength(2);
    expect(await jobs.runDue(id, () => false)).toBe(1);
    expect(await uids(box, "CB/Remind/2020-01-01")).toHaveLength(0);
    expect(await uids(box, "INBOX")).toHaveLength(2);
  });

  it("does not store mail in direct mode and reports the error code without the message", async () => {
    const { provider, box, id, sql, lines } = await harness("full", "direct");
    const raw = await letter({ subject: "Live", text: PASSWORD, messageId: "<live@example.com>" });
    box.appendExternal("INBOX", raw, []);
    const note = await provider.syncSlice(id, 1_000, { now: () => Date.now() });
    expect(note).toEqual({ account: id, synced: false, note: "direct mode does not sync" });
    const thread = await provider.getThread(id, imapThreadId(id, "", "", "live@example.com", ""));
    expect(thread?.messages).toHaveLength(1);
    expect(await count(sql, "messages")).toBe(0);
    expect(await count(sql, "threads")).toBe(0);
    expect(lines.join("\n")).not.toContain(PASSWORD);
  });
});

describe("imap security", () => {
  it("refuses loopback, private, link-local, CGNAT, unique-local, and metadata addresses", async () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.4.4",
      "192.168.1.9",
      "169.254.1.1",
      "169.254.169.254",
      "100.64.1.1",
      "::1",
      "fc00::1",
      "fd12::1",
      "fd00:ec2::254",
      "::ffff:127.0.0.1",
    ];
    for (const address of blocked) {
      await expect(pinHost("mail.example", async () => [address], false)).rejects.toThrow(/not allowed/);
    }
    await expect(pinHost("mail.example", async () => ["fd00:ec2::254"], true)).rejects.toThrow(/not allowed/);
    await expect(pinHost("10.1.2.3", async () => ["10.1.2.3"], true)).resolves.toBe("10.1.2.3");
    let lookups = 0;
    const resolve = async () => {
      lookups += 1;
      return lookups === 1 ? ["203.0.113.9"] : ["127.0.0.1"];
    };
    await expect(pinHost("mail.example", resolve, false)).resolves.toBe("203.0.113.9");
    expect(lookups).toBe(1);
    const { opened, provider, id } = await harness();
    await provider.listLabels(id);
    expect(opened).toEqual(["203.0.113.10"]);

    const production = {
      NODE_ENV: "production",
      OWNER_TOKEN: TOKEN,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "imap",
      MAIL_STORE: "pg",
      OWNER_TIMEZONE: "UTC",
      PUBLIC_URL: "https://mail.example.com",
    };
    expect(() => loadConfig({ ...production, IMAP_ALLOW_PRIVATE_HOSTS: "1" })).toThrow(/IMAP_ALLOW_PRIVATE_HOSTS/);
    expect(() => loadConfig({ ...production, CBM_SMOKE_IMAP: "1" })).toThrow(/CBM_SMOKE_IMAP/);
    expect(loadConfig(production).imapAllowPrivateHosts).toBe(false);
  });
});

describe("imap over HTTP", () => {
  it("saves a connect only after IMAP and SMTP both pass", async () => {
    const lines: string[] = [];
    let opens = 0;
    let smtpFails = false;
    const box = new MemoryMailbox(FLAVORS.full);
    const app = await createServer(serverEnv(), {
      logSink: (line) => lines.push(line),
      imap: {
        open: async (target) => {
          opens += 1;
          if (target.host !== "203.0.113.40") throw new Error("unpinned host");
          if (target.password !== PASSWORD) throw new ImapAuthError();
          return box.open();
        },
        resolve: async () => ["203.0.113.40"],
        verifySmtp: async () => {
          if (smtpFails) throw new Error("smtp auth failed");
        },
        sendRaw: async () => {},
      },
    });
    closers.push(app);
    const owner = await signIn(app);
    const body = JSON.stringify(connectBody());
    const denied = await https(app, "POST", "/connect/imap", { type: "application/json", body });
    expect(denied.status).toBe(401);
    const csrf = await https(app, "POST", "/connect/imap", {
      cookie: owner.cookie,
      type: "application/json",
      body,
    });
    expect(csrf.status).toBe(403);
    expect(opens).toBe(0);

    smtpFails = true;
    const smtp = await https(app, "POST", "/connect/imap", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body,
    });
    expect(smtp.status).toBe(400);
    expect((await app.store.listAccounts())).toHaveLength(0);

    smtpFails = false;
    const wrong = await https(app, "POST", "/connect/imap", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ ...connectBody(), password: "not-the-password" }),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.text).toContain("app password");
    expect((await app.store.listAccounts())).toHaveLength(0);

    const ok = await https(app, "POST", "/connect/imap", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body,
    });
    expect(ok.status, ok.text).toBe(200);
    const accounts = await app.store.listAccounts();
    expect(accounts).toHaveLength(1);
    const sealed = await app.store.tokenCiphertext(accounts[0]?.id ?? "");
    expect(sealed).toBeTruthy();
    expect(openSeal(app.config.encryptionKey, sealed ?? "")).toBe(PASSWORD);
    expect(lines.join("\n")).not.toContain(PASSWORD);

    // smtp failure, wrong password, and the first success already counted. Ten is the cap.
    for (let i = 0; i < 7; i += 1) {
      const extra = await https(app, "POST", "/connect/imap", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body,
      });
      expect(extra.status, extra.text).toBe(200);
    }
    const limited = await https(app, "POST", "/connect/imap", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body,
    });
    expect(limited.status).toBe(429);
  });

  it("serves IMAP and the Gmail demo through one router in both modes", async () => {
    for (const mode of ["mirror", "direct"] as const) {
      const gmail = await FakeGmailServer.demo();
      closers.push(gmail);
      const box = new MemoryMailbox(FLAVORS.full);
      const raw = await letter({ subject: "From IMAP", text: "hello from imap", messageId: "<imap-demo@example.com>" });
      box.appendExternal("INBOX", raw, []);
      const lines: string[] = [];
      const app = await createServer({
        ...serverEnv(),
        MAIL_MODE: mode,
        MAIL_PROVIDER: "gmail",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        GMAIL_API_BASE: gmail.apiBase,
        GOOGLE_TOKEN_URL: gmail.tokenUrl,
        SYNC_STALE_MS: "0",
      }, {
        logSink: (line) => lines.push(line),
        imap: {
          open: async (target) => {
            if (target.password !== PASSWORD) throw new ImapAuthError();
            return box.open();
          },
          resolve: async () => ["203.0.113.10"],
          verifySmtp: async () => {},
          sendRaw: async () => {},
        },
      });
      closers.push(app);
      const imapId = await app.store.connectImap({
        email: EMAIL,
        host: "mail.example.test",
        port: 993,
        security: "tls",
        username: EMAIL,
        password: PASSWORD,
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        smtpSecurity: "starttls",
        saveSent: true,
        aliases: [],
        key: app.config.encryptionKey,
        at: "2026-11-05T12:00:00.000Z",
      });
      await app.store.upsertAccount({
        id: "gmail_work",
        email: "alex@riveralabs.example",
        label: "Rivera Labs",
        kind: "gmail",
      }, 0);
      await app.store.upsertToken("gmail_work", app.config.encryptionKey, JSON.stringify({
        refreshToken: REFRESH,
        accessToken: ACCESS,
        expiresAt: Date.now() + 3_600_000,
      }));
      await initialize(app);
      const accounts = await call(app, "list_accounts");
      const rows = accounts.data.accounts as Array<{ id: string; kind: string; capabilities: { filters: boolean; labels: string } }>;
      const imapRow = rows.find((row) => row.id === imapId);
      expect(imapRow?.kind).toBe("imap");
      expect(imapRow?.capabilities).toMatchObject({ filters: false, sendAs: true, labels: "folders" });
      const gmailSearch = await call(app, "search_threads", { account: "gmail_work", query: "in:inbox" });
      expect(gmailSearch.isError).toBe(false);
      expect((gmailSearch.data.threads as unknown[]).length).toBeGreaterThan(0);
      const imapSearch = await call(app, "search_threads", { account: imapId, query: "subject:IMAP" });
      expect(imapSearch.isError, JSON.stringify(imapSearch.data)).toBe(false);
      expect((imapSearch.data.threads as unknown[])).toHaveLength(1);
      const filters = await call(app, "create_filter", {
        account: imapId,
        criteria: { from: "lee@example.com" },
        action: { addLabelIds: ["INBOX"] },
      });
      expect(filters.isError).toBe(true);
      expect(String(filters.data.message)).toContain("Filters aren't available");
      const mail = await app.store.listAccounts();
      expect(mail.map((account) => account.kind).sort()).toEqual(["gmail", "imap"]);
      if (mode === "direct") {
        const messages = await countMessages(app, imapId);
        expect(messages).toBe(0);
      }
      expect(lines.join("\n")).not.toContain(PASSWORD);
      expect(JSON.stringify(await app.store.listAudit())).not.toContain(PASSWORD);
    }
  });

  it("opens and replies to Bulk 1999 from an ids search", async () => {
    const box = new MemoryMailbox(FLAVORS.minimal);
    const sent: Buffer[] = [];
    const old = await letter({
      from: "Lee <lee@example.com>",
      to: ["Ada <ada@example.com>"],
      subject: "Bulk 1999",
      text: "ancient note",
      messageId: "<bulk-1999@example.test>",
    });
    box.appendExternal("INBOX", old, [], "2024-01-01T00:00:00.000Z");
    for (let i = 0; i < 210; i += 1) {
      const raw = await letter({ subject: `Newer ${i}`, text: "x", messageId: `<newer-${i}@example.test>` });
      box.appendExternal("INBOX", raw, []);
    }
    const app = await createServer({
      ...serverEnv(),
      MAIL_MODE: "mirror",
      MAIL_PROVIDER: "imap",
      IMAP_ALLOW_PRIVATE_HOSTS: "1",
      SYNC_STALE_MS: "86400000",
    }, {
      imap: {
        open: async (target) => {
          if (target.password !== PASSWORD) throw new ImapAuthError();
          return box.open();
        },
        resolve: async () => ["203.0.113.10"],
        verifySmtp: async () => {},
        sendRaw: async (_target, raw) => {
          sent.push(raw);
        },
      },
    });
    closers.push(app);
    const account = await app.store.connectImap({
      email: EMAIL,
      host: "mail.example.test",
      port: 993,
      security: "tls",
      username: EMAIL,
      password: PASSWORD,
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecurity: "starttls",
      saveSent: true,
      aliases: [],
      key: app.config.encryptionKey,
      at: "2026-11-05T12:00:00.000Z",
    });
    await initialize(app);
    const listed = await call(app, "search_threads", {
      account,
      query: "subject:\"Bulk 1999\"",
      view: "THREAD_VIEW_IDS_ONLY",
    });
    expect(listed.isError, JSON.stringify(listed.data)).toBe(false);
    const threads = listed.data.threads as Array<{ id?: string }>;
    expect(threads).toHaveLength(1);
    const opened = await call(app, "get_thread", {
      account,
      threadId: threads[0]?.id ?? "",
      messageFormat: "FULL_CONTENT",
    });
    expect(opened.isError, JSON.stringify(opened.data)).toBe(false);
    const messages = opened.data.messages as Array<{ id?: string; subject?: string }>;
    expect(messages.map((message) => message.subject)).toEqual(["Bulk 1999"]);
    const replied = await call(app, "reply", {
      account,
      messageId: messages[0]?.id ?? "",
      body: "late reply",
    });
    expect(replied.isError, JSON.stringify(replied.data)).toBe(false);
    expect(sent.at(-1)?.toString("utf8")).toContain("late reply");
  });
});

function storeSql(store: Repo): Sql {
  return (store as unknown as { sql: Sql }).sql;
}

function jobEnv(): Record<string, string> {
  return {
    OWNER_TOKEN: TOKEN,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "imap",
    NODE_ENV: "test",
    OWNER_TIMEZONE: "UTC",
  };
}

function serverEnv(): Record<string, string> {
  return {
    OWNER_TOKEN: TOKEN,
    OWNER_PASSPHRASE: PASSPHRASE,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "imap",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    OWNER_TIMEZONE: "UTC",
  };
}

function connectBody(): Record<string, unknown> {
  return {
    email: EMAIL,
    host: "mail.example.test",
    port: 993,
    security: "tls",
    user: EMAIL,
    password: PASSWORD,
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    aliases: ["ada.alias@example.com"],
  };
}

function smtpTarget(port: number): SmtpTarget {
  return {
    host: "127.0.0.1",
    servername: "localhost",
    port,
    secure: false,
    requireTLS: false,
    user: "ada",
    password: "secret",
    timeoutMs: 300,
  };
}

function listenSmtp(server: SMTPServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function https(app: Running, method: string, path: string, options: { cookie?: string; body?: string; type?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.type) headers["content-type"] = options.type;
  return new Promise((resolve, reject) => {
    const target = new URL(`${app.url}${path}`);
    const payload = Buffer.from(options.body ?? "");
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: options.body === undefined ? headers : { ...headers, "content-length": String(payload.length) },
      ca: app.cert,
      servername: "localhost",
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (options.body !== undefined) req.end(payload);
    else req.end();
  });
}

function cookieOf(res: Answer): string {
  const value = res.headers["set-cookie"];
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  const line = lines.find((item) => item.startsWith("cbm_owner="));
  const match = /cbm_owner=([^;]+)/.exec(line ?? "");
  return match?.[1] ? `cbm_owner=${match[1]}` : "";
}

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error("csrf missing");
  return match[1];
}

function pageCsrf(html: string): string {
  const match = /window\.__cbm=(\{.*?\});/.exec(html);
  if (!match?.[1]) throw new Error("boot missing");
  const boot = JSON.parse(match[1]) as { csrf?: string };
  if (!boot.csrf) throw new Error("page csrf missing");
  return boot.csrf;
}

async function signIn(app: Running): Promise<{ cookie: string; csrf: string }> {
  const start = await https(app, "GET", "/signin?next=/app");
  expect(start.status, start.text).toBe(200);
  const first = cookieOf(start);
  const posted = await https(app, "POST", "/signin", {
    cookie: first,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE, next: "/app" }).toString(),
  });
  expect(posted.status, posted.text).toBe(302);
  const cookie = cookieOf(posted) || first;
  const page = await https(app, "GET", "/app", { cookie });
  expect(page.status, page.text.slice(0, 200)).toBe(200);
  return { cookie, csrf: pageCsrf(page.text) };
}

type Json = Record<string, unknown>;

function parseMcp(text: string): Json | null {
  if (!text) return null;
  if (text.includes("data:")) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1] ?? "") as Json;
  }
  return JSON.parse(text) as Json;
}

async function initialize(app: Running): Promise<void> {
  const hello = await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane5a", version: "0" } },
    }),
  });
  expect(hello.status, hello.text).toBe(200);
  await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}

async function call(app: Running, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Json }> {
  const res = await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {} };
}

async function countMessages(app: Running, accountId: string): Promise<number> {
  const sql = (app.store as unknown as { sql: Sql }).sql;
  const result = await sql.query<{ n: number | string }>("SELECT count(*) AS n FROM messages WHERE account_id = $1", [accountId]);
  return Number(result.rows[0]?.n ?? 0);
}
