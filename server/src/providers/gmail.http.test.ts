import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Running } from "../http/app.js";
import { FakeGmailServer, type HttpFault } from "./gmail-fake-server.js";
import { messageIdFor } from "./threading.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const PASSPHRASE = "PASSPHRASE-DO-NOT-LOG-zz";
const REFRESH = "refresh-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";
const SUBJECT = "SUBJECT-DO-NOT-LOG-zz";
const BODY = "BODY-DO-NOT-LOG-zz";

type Json = Record<string, unknown>;
type Closer = { close(): Promise<void> };

function requireCount(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`fake Gmail server recorded ${actual} requests, required ${expected}`);
  }
}

/**
 * The first read in a five-minute window may list labels for due jobs.
 * A later read in that window does not. The mail fetch itself stays one list,
 * and one batch only for a summary.
 */
function expectBoundedRead(
  rows: { method: string; path: string }[],
  expected: { labels: number; lists: number; batches: number },
): void {
  const labels = rows.filter((item) => item.method === "GET" && item.path.includes("/users/me/labels"));
  const lists = rows.filter((item) => item.method === "GET" && item.path.includes("/threads?"));
  const batches = rows.filter((item) => item.method === "POST" && item.path === "/batch/gmail/v1");
  const perThread = rows.filter((item) => item.method === "GET" && /\/threads\/[^/?]+/.test(item.path));
  const history = rows.filter((item) => item.path.includes("/history"));
  const profile = rows.filter((item) => item.path.includes("/profile"));
  requireCount(labels.length, expected.labels);
  requireCount(lists.length, expected.lists);
  requireCount(batches.length, expected.batches);
  requireCount(perThread.length, 0);
  requireCount(history.length, 0);
  requireCount(profile.length, 0);
  const list = lists[0];
  expect(list?.path).toContain("maxResults=25");
  expect(list?.path).toContain("q=");
  expect(list?.path).not.toContain("pageToken");
}

function postTls(url: string, ca: string, body: string, token?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "content-length": String(Buffer.byteLength(body)),
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers,
      ca,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function parseMcp(text: string): Json | null {
  if (!text) return null;
  if (text.includes("\ndata:") || text.startsWith("data:")) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    const last = lines.at(-1);
    return last ? JSON.parse(last) as Json : null;
  }
  return JSON.parse(text) as Json;
}

async function initialize(app: Running): Promise<void> {
  const hello = await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane1b", version: "0" } },
  }), TOKEN);
  expect(hello.status).toBe(200);
  await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), TOKEN);
}

async function call(app: Running, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Json }> {
  const res = await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  }), TOKEN);
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {} };
}

async function boot(
  mode: "mirror" | "direct",
  gmail: FakeGmailServer,
  token: { refreshToken: string; accessToken: string; expiresAt: number } = {
    refreshToken: REFRESH,
    accessToken: ACCESS,
    expiresAt: Date.now() + 3_600_000,
  },
  extra: Record<string, string> = {},
): Promise<{ app: Running; key: Buffer }> {
  if (!gmail.listening) throw new Error("fake Gmail server is not listening");
  const key = randomBytes(32);
  const app = await createServer({
    OWNER_TOKEN: TOKEN,
    OWNER_PASSPHRASE: PASSPHRASE,
    ENCRYPTION_KEY: key.toString("base64"),
    MAIL_MODE: mode,
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "gmail",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    OWNER_TIMEZONE: "UTC",
    GMAIL_API_BASE: gmail.apiBase,
    GOOGLE_TOKEN_URL: gmail.tokenUrl,
    ...extra,
  });
  await app.store.upsertAccount({
    id: "gmail_work",
    email: "alex@riveralabs.example",
    label: "Rivera Labs",
    kind: "gmail",
    color: "blue",
  }, 0);
  await app.store.upsertToken("gmail_work", app.config.encryptionKey, JSON.stringify(token));
  await initialize(app);
  return { app, key };
}

function rfc822(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("gmail provider over the fake http server", () => {
  const live: Closer[] = [];

  afterEach(async () => {
    while (live.length > 0) {
      const item = live.pop();
      if (item) await item.close();
    }
  });

  it("does not read a provider token while booting", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../http/app.ts"), "utf8");
    expect(source.includes("accessToken(")).toBe(false);
    expect(source).toContain("stdoutSink");
  });

  it("does not call Gmail while booting", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("mirror", gmail);
    live.push(app);
    expect(gmail.recorded()).toEqual([]);
  });

  it("fails when the fake server is not listening", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    await gmail.close();
    expect(() => gmail.recorded()).toThrow(/not listening/);
  });

  for (const mode of ["mirror", "direct"] as const) {
    it(`calls a failed write exactly once and leaves mail rows unchanged (${mode})`, async () => {
      const faults: HttpFault[] = [
        { kind: "status", status: 500 },
        { kind: "status", status: 429 },
        { kind: "drop" },
      ];
      for (const fault of faults) {
        const gmail = await FakeGmailServer.demo();
        live.push(gmail);
        const { app } = await boot(mode, gmail);
        live.push(app);
        const before = await app.store.mailDigest();
        gmail.failNextWrite(fault);
        const marked = gmail.recordedWrites().length;
        const failed = await call(app, "create_draft", {
          to: "lee@makerspace.example",
          subject: "Hello",
          body: "There",
        });
        expect(failed.isError).toBe(true);
        if (fault.kind === "status" && fault.status === 429) expect(failed.data.code).toBe("rate_limited");
        else expect(failed.data.code).toBe("upstream_error");
        requireCount(gmail.recordedWrites().length - marked, 1);
        expect(await app.store.mailDigest()).toBe(before);
      }
    });

    it(`keeps reply and draft threading headers (${mode})`, async () => {
      const gmail = await FakeGmailServer.demo();
      live.push(gmail);
      const { app } = await boot(mode, gmail);
      live.push(app);
      const expected = messageIdFor("mt1");
      const reply = await call(app, "reply", { messageId: "mt1", body: "Thanks" });
      expect(reply.isError).toBe(false);
      expect(reply.data.labelIds).toEqual(["SENT"]);
      const thread = await call(app, "get_thread", { threadId: "t1" });
      const last = (thread.data.messages as Json[]).at(-1);
      expect(last?.inReplyTo).toBe(expected);
      expect(last?.references).toBe(expected);
      const stored = await app.store.getThread("gmail_work", "t1");
      if (mode === "mirror") {
        const storedLast = stored?.messages.at(-1);
        expect(storedLast?.inReplyTo).toBe(expected);
        expect(storedLast?.references).toBe(expected);
      } else {
        expect(stored).toBeNull();
        expect(await app.store.countMessages()).toBe(0);
      }
      const sent = gmail.recordedWrites().find((item) => item.path.includes("/messages/send"));
      if (!sent) throw new Error("fake Gmail server recorded fewer requests than required");
      const sentRaw = rfc822(String((JSON.parse(sent.body) as { raw?: string }).raw ?? ""));
      expect(sentRaw).toContain(`In-Reply-To: ${expected}`);
      expect(sentRaw).toContain(`References: ${expected}`);
      const draft = await call(app, "create_draft", {
        to: "lee@makerspace.example",
        subject: "Note",
        body: "Saved",
        replyToMessageId: "mt1",
      });
      expect(draft.isError).toBe(false);
      const loaded = await call(app, "get_draft", { draftId: String(draft.data.id) });
      expect(loaded.data.inReplyTo).toBe(expected);
      expect(loaded.data.references).toBe(expected);
      const posted = gmail.recordedWrites().find((item) => item.method === "POST" && item.path.endsWith("/drafts"));
      if (!posted) throw new Error("fake Gmail server recorded fewer requests than required");
      const draftRaw = rfc822(String((JSON.parse(posted.body) as { message?: { raw?: string } }).message?.raw ?? ""));
      expect(draftRaw).toContain(`In-Reply-To: ${expected}`);
      expect(draftRaw).toContain(`References: ${expected}`);
      if (mode === "direct") {
        const digest = JSON.parse(await app.store.mailDigest()) as {
          messages: unknown[];
          drafts: unknown[];
          labels: unknown[];
          filters: unknown[];
        };
        expect(digest.messages).toEqual([]);
        expect(digest.drafts).toEqual([]);
        expect(digest.labels).toEqual([]);
        expect(digest.filters).toEqual([]);
      }
    });

    it(`bounds a 500-thread search to one list and one batch (${mode})`, async () => {
      const gmail = await FakeGmailServer.bulk();
      live.push(gmail);
      const { app } = await boot(mode, gmail);
      live.push(app);
      if (!gmail.listening) throw new Error("fake Gmail server is not listening");
      const start = gmail.recorded().length;
      const page = await call(app, "search_threads", { query: "" });
      expect(page.isError).toBe(false);
      expectBoundedRead(gmail.recorded().slice(start), { labels: 1, lists: 1, batches: 1 });
      expect(page.data.resultCountEstimate).toBe(500);
      expect((page.data.threads as unknown[]).length).toBe(25);
      expect(page.data.nextPageToken).toBeTruthy();
      const idsAt = gmail.recorded().length;
      const idsOnly = await call(app, "search_threads", { query: "", view: "THREAD_VIEW_IDS_ONLY" });
      expect(idsOnly.isError).toBe(false);
      expectBoundedRead(gmail.recorded().slice(idsAt), { labels: 0, lists: 1, batches: 0 });
      expect((idsOnly.data.threads as unknown[]).length).toBe(25);
    });
  }

  it("surfaces a revoked refresh token as needs_reauth", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("direct", gmail, {
      refreshToken: "revoked-DO-NOT-LOG",
      accessToken: ACCESS,
      expiresAt: 0,
    });
    live.push(app);
    const result = await call(app, "search_threads", { query: "" });
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("needs_reauth");
    expect(result.data.threads).toBeUndefined();
    expect(gmail.recordedWrites()).toEqual([]);
  });

  it("retries one read failure and does not retry a write", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("direct", gmail);
    live.push(app);
    gmail.failNextRead({ kind: "status", status: 500 }, "/threads/t1");
    const read = await call(app, "get_thread", { threadId: "t1" });
    expect(read.isError).toBe(false);
    const gets = gmail.recorded().filter((item) => item.method === "GET" && item.path.includes("/threads/t1"));
    requireCount(gets.length, 2);
    gmail.failNextWrite({ kind: "status", status: 500 });
    const marked = gmail.recordedWrites().length;
    const write = await call(app, "send_message", {
      to: "lee@makerspace.example",
      subject: "Hello",
      body: "There",
    });
    expect(write.isError).toBe(true);
    expect(write.data.code).toBe("upstream_error");
    requireCount(gmail.recordedWrites().length - marked, 1);
  });

  it("returns success when Gmail accepted the send and the store then throws", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("mirror", gmail);
    live.push(app);
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    app.store.addMessage = async () => {
      throw new Error("insert failed SUBJECT-DO-NOT-LOG-zz BODY-DO-NOT-LOG-zz");
    };
    const marked = gmail.recordedWrites().length;
    const sent = await call(app, "send_message", {
      to: "lee@makerspace.example",
      subject: "SUBJECT-DO-NOT-LOG-zz",
      body: "BODY-DO-NOT-LOG-zz",
    });
    expect(sent.isError).toBe(false);
    expect(sent.data.code).toBeUndefined();
    expect(sent.data.id).toBeTruthy();
    expect(sent.data.threadId).toBeTruthy();
    const sends = gmail.recordedWrites().filter((item) => item.path.includes("/messages/send"));
    requireCount(sends.length, 1);
    requireCount(gmail.recordedWrites().length - marked, 1);
    const rows = (await app.store.listAudit()).filter((item) => item.tool === "send_message");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ outcome: "ok", store_failed: true });
    const blob = `${lines.join("\n")}\n${JSON.stringify(rows)}`;
    expect(blob).toContain("write store failed");
    expect(blob).not.toContain("SUBJECT-DO-NOT-LOG-zz");
    expect(blob).not.toContain("BODY-DO-NOT-LOG-zz");
    const threadId = String(sent.data.threadId);
    const messageId = String(sent.data.id);
    expect(await app.store.listResync("gmail_work")).toEqual([threadId]);
    const synced = await call(app, "sync_now");
    expect(synced.isError).toBe(false);
    expect(synced.data.accounts).toEqual([{ account: "gmail_work", synced: true }]);
    expect(await app.store.listResync("gmail_work")).toEqual([]);
    const stored = (await app.store.listMessageIds("gmail_work")).filter((id) => id === messageId);
    expect(stored).toEqual([messageId]);
  });

  it("returns success when Gmail accepted the send and the audit log then throws", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("mirror", gmail);
    live.push(app);
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    app.store.appendAudit = async () => {
      throw new Error("audit down BODY-DO-NOT-LOG-zz");
    };
    const marked = gmail.recordedWrites().length;
    const sent = await call(app, "send_message", {
      to: "lee@makerspace.example",
      subject: "Hello",
      body: "BODY-DO-NOT-LOG-zz",
    });
    expect(sent.isError).toBe(false);
    expect(sent.data.code).toBeUndefined();
    expect(sent.data.id).toBeTruthy();
    const sends = gmail.recordedWrites().filter((item) => item.path.includes("/messages/send"));
    requireCount(sends.length, 1);
    requireCount(gmail.recordedWrites().length - marked, 1);
    expect(lines.join("\n")).toContain("write audit failed");
    expect(lines.join("\n")).not.toContain("BODY-DO-NOT-LOG-zz");
  });

  it("keeps the provider error when the failure-path audit throws", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("mirror", gmail);
    live.push(app);
    app.store.appendAudit = async () => {
      throw new Error("audit down");
    };
    gmail.failNextWrite({ kind: "status", status: 500 });
    const marked = gmail.recordedWrites().length;
    const sent = await call(app, "send_message", {
      to: "lee@makerspace.example",
      subject: "Hello",
      body: "There",
    });
    expect(sent.isError).toBe(true);
    expect(sent.data.code).toBe("upstream_error");
    expect(sent.data.message).toBe("The provider failed.");
    requireCount(gmail.recordedWrites().length - marked, 1);
  });

  it("retries a read that times out and does not retry a write that times out", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("direct", gmail, undefined, { GMAIL_TIMEOUT_MS: "400" });
    live.push(app);
    gmail.failNextRead({ kind: "hang" }, "/threads/t1");
    const read = await call(app, "get_thread", { threadId: "t1" });
    expect(read.isError).toBe(false);
    const gets = gmail.recorded().filter((item) => item.method === "GET" && item.path.includes("/threads/t1"));
    requireCount(gets.length, 2);
    gmail.failNextWrite({ kind: "hang" });
    const marked = gmail.recordedWrites().length;
    const write = await call(app, "send_message", {
      to: "lee@makerspace.example",
      subject: "Hello",
      body: "There",
    });
    expect(write.isError).toBe(true);
    expect(write.data.code).toBe("upstream_error");
    requireCount(gmail.recordedWrites().length - marked, 1);
  });

  it("retries a token fetch timeout on a read and does not retry one on a write", async () => {
    const expired = { refreshToken: REFRESH, accessToken: ACCESS, expiresAt: 0 };
    const readBox = await FakeGmailServer.demo();
    live.push(readBox);
    const readApp = await boot("direct", readBox, expired, { GMAIL_TIMEOUT_MS: "400" });
    live.push(readApp.app);
    readBox.failNextToken({ kind: "hang" });
    const read = await call(readApp.app, "get_thread", { threadId: "t1" });
    expect(read.isError).toBe(false);
    requireCount(readBox.recorded().filter((item) => item.path === "/token").length, 2);

    const writeBox = await FakeGmailServer.demo();
    live.push(writeBox);
    const writeApp = await boot("direct", writeBox, expired, { GMAIL_TIMEOUT_MS: "400" });
    live.push(writeApp.app);
    writeBox.failNextToken({ kind: "hang" });
    const marked = writeBox.recordedWrites().length;
    const write = await call(writeApp.app, "send_message", {
      to: "lee@makerspace.example",
      subject: "Hello",
      body: "There",
    });
    expect(write.isError).toBe(true);
    expect(write.data.code).toBe("upstream_error");
    requireCount(writeBox.recorded().filter((item) => item.path === "/token").length, 1);
    requireCount(writeBox.recordedWrites().length - marked, 0);
  });

  it("replies to a message this account sent by using that message's To", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addThread({
      id: "t-sent",
      messageId: "sent1",
      from: "Alex <alex@riveralabs.example>",
      to: "Lee <lee@makerspace.example>",
      cc: "Sam <sam@example.com>",
      subject: "Following up",
      date: "2026-11-05T12:00:00.000Z",
      body: "the note I sent",
      labelIds: ["SENT"],
    });
    const { app } = await boot("direct", gmail);
    live.push(app);
    const reply = await call(app, "reply", { messageId: "sent1", body: "one more thing" });
    expect(reply.isError, JSON.stringify(reply.data)).toBe(false);
    const sends = gmail.recordedWrites().filter((item) => item.path.includes("/messages/send"));
    const first = rfc822(String((JSON.parse(sends[0]?.body ?? "{}") as { raw?: string }).raw ?? ""));
    const to = /^to:\s*(.*)$/im.exec(first)?.[1] ?? "";
    expect(to.toLowerCase()).toContain("lee@makerspace.example");
    expect(to.toLowerCase()).not.toContain("alex@riveralabs.example");
    const all = await call(app, "reply", { messageId: "sent1", body: "and sam", replyAll: true });
    expect(all.isError, JSON.stringify(all.data)).toBe(false);
    const secondRaw = gmail.recordedWrites().filter((item) => item.path.includes("/messages/send"))[1];
    const second = rfc822(String((JSON.parse(secondRaw?.body ?? "{}") as { raw?: string }).raw ?? ""));
    const cc = /^cc:\s*(.*)$/im.exec(second)?.[1] ?? "";
    expect(cc.toLowerCase()).toContain("sam@example.com");
    expect(cc.toLowerCase()).not.toContain("alex@riveralabs.example");
  });

  it("keeps secrets out of the stdout sink and the audit log", async () => {
    const captured: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return original(chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    try {
      const { app, key } = await boot("mirror", gmail);
      live.push(app);
      const draft = await call(app, "create_draft", {
        to: "Dana Ruiz <dana@acmerobotics.example>",
        subject: SUBJECT,
        body: BODY,
      });
      expect(draft.isError).toBe(false);
      await call(app, "update_draft", { draftId: String(draft.data.id), to: "Dana Ruiz <dana@acmerobotics.example>", subject: SUBJECT, body: BODY });
      const label = await call(app, "create_label", { displayName: "Launch" });
      expect(label.isError).toBe(false);
      await call(app, "label_thread", { threadId: "t1", labelIds: [String(label.data.labelId)] });
      await call(app, "unlabel_thread", { threadId: "t1", labelIds: [String(label.data.labelId)] });
      await call(app, "reply", { messageId: "mt1", body: BODY });
      await call(app, "forward", { messageId: "mt1", to: ["lee@makerspace.example"] });
      await call(app, "send_message", { to: "lee@makerspace.example", subject: SUBJECT, body: BODY });
      const filter = await call(app, "create_filter", {
        criteria: { from: "news@example.com" },
        action: { skipInbox: true },
      });
      expect(filter.isError).toBe(false);
      await call(app, "delete_filter", { filterId: String(filter.data.id) });
      await call(app, "delete_draft", { draftId: String(draft.data.id) });
      const audit = JSON.stringify(await app.store.listAudit());
      const blob = `${captured.join("")}\n${audit}`;
      const poisons = [TOKEN, CLIENT_SECRET, PASSPHRASE, REFRESH, ACCESS, SUBJECT, BODY, "Dana Ruiz", key.toString("base64")];
      for (const poison of poisons) {
        if (blob.includes(poison)) throw new Error(`leaked ${poison.slice(0, 18)}`);
      }
      expect(audit).toContain("\"outcome\":\"ok\"");
    } finally {
      process.stdout.write = original;
    }
  });

  it("keeps Bcc in the raw Gmail sends and stores", async () => {
    const gmail = await FakeGmailServer.demo();
    live.push(gmail);
    const { app } = await boot("mirror", gmail);
    live.push(app);
    const secret = "secret@example.test";
    const sent = await call(app, "send_message", {
      to: "lee@makerspace.example",
      bcc: secret,
      subject: "Hello",
      body: "There",
    });
    expect(sent.isError).toBe(false);
    expect(rawOf(gmail, (row) => row.path.includes("/messages/send"))).toMatch(/^bcc:\s*secret@example\.test/im);

    const reply = await call(app, "reply", { messageId: "mt1", body: "Thanks", bcc: secret });
    expect(reply.isError).toBe(false);
    const replyRaws = gmail.recordedWrites().filter((row) => row.path.includes("/messages/send"));
    expect(rfc822(String((JSON.parse(replyRaws.at(-1)?.body ?? "{}") as { raw?: string }).raw ?? ""))).toMatch(/^bcc:\s*secret@example\.test/im);

    const draft = await call(app, "create_draft", {
      to: "lee@makerspace.example",
      bcc: secret,
      subject: "Note",
      body: "Saved",
    });
    expect(draft.isError).toBe(false);
    expect(rawOf(gmail, (row) => row.method === "POST" && row.path.endsWith("/drafts"))).toMatch(/^bcc:\s*secret@example\.test/im);

    const updated = await call(app, "update_draft", {
      draftId: String(draft.data.id),
      to: "lee@makerspace.example",
      bcc: secret,
      subject: "Note",
      body: "Saved again",
    });
    expect(updated.isError).toBe(false);
    expect(rawOf(gmail, (row) => row.method === "PUT" && row.path.includes("/drafts/"))).toMatch(/^bcc:\s*secret@example\.test/im);

    const sentDraft = await call(app, "send_message", { draftId: String(draft.data.id) });
    expect(sentDraft.isError).toBe(false);
    expect(rawOf(gmail, (row) => row.path.endsWith("/drafts/send"))).toMatch(/^bcc:\s*secret@example\.test/im);
  });
});

function rawOf(gmail: FakeGmailServer, match: (row: { method: string; path: string; body: string }) => boolean): string {
  const row = [...gmail.recordedWrites()].reverse().find(match);
  if (!row) throw new Error("fake Gmail server recorded no matching write");
  const json = JSON.parse(row.body) as { raw?: string; message?: { raw?: string } };
  return rfc822(String(json.raw || json.message?.raw || ""));
}
