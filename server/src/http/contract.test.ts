import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSeal } from "../crypto/seal.js";
import { ToolError } from "../errors.js";
import { FakeProvider } from "../providers/fake.js";
import { createServer, type Running } from "./app.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const READ_TOOLS = [
  "get_draft",
  "get_message",
  "get_thread",
  "list_accounts",
  "list_drafts",
  "list_filters",
  "list_labels",
  "list_send_as",
  "search_contacts",
  "search_threads",
  "server_info",
];
const WRITE_TOOLS = [
  "create_draft",
  "create_filter",
  "create_label",
  "delete_draft",
  "delete_filter",
  "forward",
  "label_thread",
  "reply",
  "send_message",
  "sync_now",
  "unlabel_thread",
  "update_draft",
];

function env(mode: "mirror" | "direct"): Record<string, string | undefined> {
  return {
    OWNER_TOKEN: TOKEN,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: mode,
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "fake",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
  };
}

let seq = 0;

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function postTls(url: string, ca: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      ca,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function post(app: Running, body: unknown, token?: string): Promise<{ status: number; text: string; json: Json | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await postTls(`${app.url}/mcp`, app.cert, headers, JSON.stringify(body));
  return { status: res.status, text: res.text, json: parseMcp(res.text) };
}

type Json = Record<string, unknown>;

function parseMcp(text: string): Json | null {
  if (!text) return null;
  if (text.startsWith("event:") || text.startsWith("data:") || text.includes("\ndata:")) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]) as Json;
  }
  return JSON.parse(text) as Json;
}

async function initialize(app: Running): Promise<void> {
  const hello = await post(app, {
    jsonrpc: "2.0",
    id: ++seq,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "lane1a", version: "0" },
    },
  }, TOKEN);
  expect(hello.status).toBe(200);
  const result = hello.json?.result as { protocolVersion?: string } | undefined;
  expect(result?.protocolVersion).toBeTruthy();
  const note = await post(app, { jsonrpc: "2.0", method: "notifications/initialized" }, TOKEN);
  expect([200, 202]).toContain(note.status);
}

async function call(app: Running, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Json }> {
  const res = await post(app, {
    jsonrpc: "2.0",
    id: ++seq,
    method: "tools/call",
    params: { name, arguments: args },
  }, TOKEN);
  expect(res.status, res.text).toBe(200);
  const result = res.json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  expect(result, res.text).toBeTruthy();
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {} };
}

async function stop(app: Running): Promise<void> {
  await app.close();
}

function fake(app: Running): FakeProvider {
  if (!(app.provider instanceof FakeProvider)) throw new Error("expected FakeProvider");
  return app.provider;
}

function ids(data: Json): string[] {
  const threads = data.threads as { id: string }[];
  return threads.map((thread) => thread.id);
}

function suite(mode: "mirror" | "direct"): void {
  describe(`MCP ${mode}`, () => {
    let app: Running;

    beforeAll(async () => {
      app = await createServer(env(mode));
      await initialize(app);
    });

    afterAll(async () => {
      await stop(app);
    });

    it("rejects a missing or wrong bearer without echoing it", async () => {
      const missing = await postTls(`${app.url}/mcp`, app.cert, {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      }, "{}");
      expect(missing.status).toBe(401);
      const wrongToken = "wrong-bearer-do-not-echo";
      const wrong = await post(app, { jsonrpc: "2.0", id: 1, method: "tools/list" }, wrongToken);
      expect(wrong.status).toBe(401);
      expect(wrong.text).not.toContain(wrongToken);
      expect(wrong.text).not.toContain(TOKEN);
    });

    it("lists the read tools and the write tools", async () => {
      const listed = await post(app, { jsonrpc: "2.0", id: ++seq, method: "tools/list" }, TOKEN);
      expect(listed.status).toBe(200);
      const tools = ((listed.json?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name).sort();
      const expected = [...READ_TOOLS, ...WRITE_TOOLS].sort();
      expect(tools).toEqual(expected);
    });

    it("syncs the fake mailbox in mirror and refuses to sync in direct", async () => {
      const provider = fake(app);
      const before = provider.counts.searchIds;
      const result = await call(app, "sync_now");
      expect(result.isError).toBe(false);
      expect(provider.counts.searchIds).toBe(before);
      if (mode === "mirror") {
        expect(result.data).toEqual({
          accounts: [
            { account: "gmail_work", synced: true },
            { account: "gmail_personal", synced: true },
          ],
        });
        return;
      }
      expect(result.data).toEqual({
        accounts: [
          { account: "gmail_work", synced: false, note: "direct mode does not sync" },
          { account: "gmail_personal", synced: false, note: "direct mode does not sync" },
        ],
      });
      expect(await app.store.countMessages()).toBe(0);
    });

    it("searches the demo mailbox", async () => {
      const inbox = await call(app, "search_threads", { query: "" });
      expect(inbox.isError).toBe(false);
      expect(ids(inbox.data)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
      expect(inbox.data.resultCountEstimate).toBe(8);
      expect(inbox.data.nextPageToken).toBeNull();
      const first = (inbox.data.threads as Json[])[0];
      expect(first.acct).toBe("gmail_work");
      expect(first.messageCount).toBe(1);
      const message = (first.messages as Json[])[0];
      expect(message.sender).toBe("Dana Ruiz <dana@acmerobotics.example>");
      expect(message.subject).toBe("Sponsorship for the spring summit");
      expect(message).not.toHaveProperty("plaintextBody");
      expect(message).not.toHaveProperty("htmlBody");
      expect(message).not.toHaveProperty("approx");
      expect(String(message.viewUrl)).toContain("#all/t1");
      expect(message.replyTo).toEqual([]);
      expect(message.inReplyTo).toBe("");
      expect(message.attachments).toEqual([]);

      const sent = await call(app, "search_threads", { query: "in:sent newer_than:180d" });
      expect(ids(sent.data)).toEqual(["s1", "s2", "s3", "w1"]);
      const toDana = await call(app, "search_threads", { query: "in:sent to:dana@acmerobotics.example" });
      expect(ids(toDana.data)).toEqual(["s3"]);
      const old = await call(app, "search_threads", { query: "before:2020/01/01" });
      expect(ids(old.data)).toEqual([]);

      const personalSent = await call(app, "search_threads", { query: "in:sent", account: "gmail_personal" });
      expect(ids(personalSent.data)).toEqual([]);
      const personal = await call(app, "search_threads", { query: "", acct: "gmail_personal" });
      expect(ids(personal.data)).toEqual(["p1", "p2", "p3"]);

      const idsOnly = await call(app, "search_threads", { query: "", view: "THREAD_VIEW_IDS_ONLY", pageSize: 2 });
      const row = (idsOnly.data.threads as Json[])[0];
      expect(Object.keys(row).sort()).toEqual(["acct", "id", "snippet"]);
      expect(ids(idsOnly.data)).toEqual(["t1", "t2"]);
      const page2 = await call(app, "search_threads", {
        query: "",
        view: "THREAD_VIEW_IDS_ONLY",
        pageSize: 2,
        pageToken: idsOnly.data.nextPageToken as string,
      });
      expect(ids(page2.data)).toEqual(["t3", "t4"]);
      const badPage = await call(app, "search_threads", { query: "", pageToken: "not-a-token" });
      expect(badPage.isError).toBe(true);
      expect(badPage.data.code).toBe("tool_error");
    });

    it("reads a thread, a raw message, labels, drafts, send-as, accounts, filters, and contacts", async () => {
      const plain = await call(app, "get_thread", { threadId: "t1" });
      expect(plain.isError).toBe(false);
      const plainMessage = (plain.data.messages as Json[])[0];
      expect(plainMessage.plaintextBody).toContain("Can we lock the gold package");
      expect(plainMessage).not.toHaveProperty("htmlBody");
      expect(String(plain.data.viewUrl)).toContain("authuser=alex%40riveralabs.example#all/t1");

      const full = await call(app, "get_thread", { threadId: "t5", messageFormat: "FULL_CONTENT" });
      const news = (full.data.messages as Json[])[0];
      expect(news.plaintextBody).toContain("Five stories you missed");
      expect(news.htmlBody).toContain("The Weekly Byte");
      expect(news.htmlBody).toContain("<script>alert(1)</script>");

      const intro = await call(app, "get_thread", { threadId: "t6" });
      expect((intro.data.messages as Json[])[0].ccRecipients).toEqual(["Jordan Blake <jordan@makerspace.example>"]);

      const waiting = await call(app, "get_thread", { threadId: "w1" });
      expect(waiting.data.messages).toHaveLength(2);
      expect((waiting.data.messages as Json[])[0].id).toBe("mw1a");
      expect((waiting.data.messages as Json[])[1].id).toBe("mw1");

      const missing = await call(app, "get_thread", { threadId: "does-not-exist" });
      expect(missing.isError).toBe(true);
      expect(missing.data.code).toBe("tool_error");
      expect(missing.data.message).toContain("404");
      expect(missing.data.message).toContain("Requested entity was not found.");

      const weekly = await call(app, "get_message", { messageId: "mt5", messageFormat: "RAW" });
      expect(decodeRaw(String(weekly.data.raw))).toContain("List-Unsubscribe");
      const invoice = await call(app, "get_message", { messageId: "mt8" });
      const invoiceText = decodeRaw(String(invoice.data.raw));
      expect(invoiceText).toContain("multipart/mixed");
      expect(invoiceText).toContain("CW-2026-1142.pdf");
      const unknownMessage = await call(app, "get_message", { messageId: "no-such-message" });
      expect(unknownMessage.isError).toBe(true);
      expect(String(unknownMessage.data.message)).toContain("404");

      const labels = await call(app, "list_labels");
      expect(labels.data.labels).toEqual(expect.arrayContaining([
        { labelId: "L1", name: "Finance", labelType: "USER" },
      ]));
      const personalLabels = await call(app, "list_labels", { account: "gmail_personal" });
      expect(personalLabels.data.labels).toEqual(expect.arrayContaining([
        { labelId: "L1", name: "Family", labelType: "USER" },
      ]));

      const drafts = await call(app, "list_drafts", { view: "DRAFT_VIEW_METADATA_ONLY" });
      const draftRows = drafts.data.drafts as Json[];
      expect(draftRows.map((row) => row.id)).toEqual(["d1", "d2", "d3"]);
      for (const row of draftRows) {
        expect(row).not.toHaveProperty("plaintextBody");
        expect(row).not.toHaveProperty("htmlBody");
      }
      const toRiley = await call(app, "list_drafts", { query: "to:riley@keynote.example" });
      expect((toRiley.data.drafts as Json[]).map((row) => row.id)).toEqual(["d2"]);

      const draft = await call(app, "get_draft", { draftId: "d1" });
      expect(draft.data.plaintextBody).toContain("Tuesday at 10 works");
      expect(draft.data.htmlBody).toContain("Tuesday at 10 works");
      expect(draft.data.threadId).toBe("t2");
      const minimal = await call(app, "get_draft", { draftId: "d1", messageFormat: "MINIMAL" });
      expect(minimal.data).not.toHaveProperty("plaintextBody");
      expect(minimal.data).not.toHaveProperty("htmlBody");
      expect(minimal.data.subject).toBe("Re: Venue walkthrough");
      const rawDraft = await call(app, "get_draft", { draftId: "d1", messageFormat: "RAW" });
      expect(decodeRaw(String(rawDraft.data.raw))).toContain("Tuesday at 10 works");
      const missingDraft = await call(app, "get_draft", { draftId: "d9" });
      expect(missingDraft.isError).toBe(true);
      expect(String(missingDraft.data.message)).toContain("404");

      const sendAs = await call(app, "list_send_as");
      const addresses = sendAs.data.sendAs as Json[];
      const alex = addresses.find((row) => row.email === "alex@riveralabs.example");
      const events = addresses.find((row) => row.email === "events@riveralabs.example");
      expect(alex?.isDefault).toBe(true);
      expect(alex?.isPrimary).toBe(true);
      expect(String(alex?.signature).length).toBeGreaterThan(0);
      expect(events?.signature).toBe("");
      expect(events?.verified).toBe(true);

      const info = await call(app, "server_info", { account: "gmail_work" });
      expect(info.isError).toBe(false);
      expect(info.data).toEqual({
        publicUrl: "",
        version: "0.9.0",
        providers: { google: false, microsoft: false, imap: false },
      });
      expect(JSON.stringify(info.data)).not.toMatch(/secret|token|password/i);

      const accounts = await call(app, "list_accounts");
      expect(accounts.data.accounts).toEqual([
        { id: "gmail_work", email: "alex@riveralabs.example", label: "Rivera Labs", kind: "gmail", color: "blue", capabilities: { filters: true, sendAs: true, labels: "labels" } },
        { id: "gmail_personal", email: "alex.rivera@mail.example", label: "Personal", kind: "gmail", color: "red", capabilities: { filters: true, sendAs: true, labels: "labels" } },
      ]);
      const filters = await call(app, "list_filters");
      expect(filters.data.filters).toEqual([]);

      const dana = await call(app, "search_contacts", { query: "dana" });
      expect(dana.data.contacts).toEqual([
        { name: "Dana Ruiz", email: "dana@acmerobotics.example", count: 2 },
      ]);
      const none = await call(app, "search_contacts", { query: "nobody-matches" });
      expect(none.data.contacts).toEqual([]);
    });
  });
}

suite("mirror");
suite("direct");

describe("mirror and direct behaviour", () => {
  it("fetches a missing body once in mirror and never stores mail in direct, including a send, a reply, a label change, and a draft save", async () => {
    const mirror = await createServer(env("mirror"));
    const direct = await createServer(env("direct"));
    try {
      await initialize(mirror);
      await initialize(direct);
      const mirrorProvider = fake(mirror);
      const directProvider = fake(direct);

      expect(mirrorProvider.counts.getThread).toBe(0);
      const first = await call(mirror, "get_thread", { threadId: "t2" });
      expect(first.isError).toBe(false);
      expect(mirrorProvider.counts.getThread).toBe(1);
      await call(mirror, "get_thread", { threadId: "t2" });
      expect(mirrorProvider.counts.getThread).toBe(1);

      const beforeMissing = mirrorProvider.counts.getThread;
      const missing = await call(mirror, "get_thread", { threadId: "not-in-the-box" });
      expect(missing.isError).toBe(true);
      expect(mirrorProvider.counts.getThread).toBe(beforeMissing);

      const before = directProvider.counts.getThread;
      await call(direct, "get_thread", { threadId: "t1" });
      await call(direct, "get_thread", { threadId: "t1" });
      expect(directProvider.counts.getThread).toBe(before + 2);
      expect(await direct.store.countMessages()).toBe(0);
      expect(await direct.store.countThreads()).toBe(0);
      expect((await direct.store.listAccounts()).map((account) => account.id)).toEqual(["gmail_work", "gmail_personal"]);

      const digest = await direct.store.mailDigest();
      const sent = await call(direct, "send_message", {
        to: "lee@makerspace.example",
        subject: "Hello",
        body: "Sent once",
      });
      expect(sent.isError).toBe(false);
      const reply = await call(direct, "reply", { messageId: "mt1", body: "Thanks" });
      expect(reply.isError).toBe(false);
      const labeled = await call(direct, "label_thread", { threadId: "t1", labelIds: ["STARRED"] });
      expect(labeled.isError).toBe(false);
      expect(await direct.store.listLabels("gmail_work")).toEqual([]);
      expect(await direct.store.mailDigest()).toBe(digest);
      expect(await direct.store.countThreads()).toBe(0);
      const draft = await call(direct, "create_draft", {
        to: "lee@makerspace.example",
        subject: "Note",
        body: "Saved",
      });
      expect(draft.isError).toBe(false);
      expect(await direct.store.mailDigest()).toBe(digest);
      expect(await direct.store.countMessages()).toBe(0);
      expect(await direct.store.countThreads()).toBe(0);
      const tools = (await direct.store.listAudit()).map((row) => row.tool);
      expect(tools).toEqual(expect.arrayContaining(["send_message", "reply", "label_thread", "create_draft"]));
    } finally {
      await stop(mirror);
      await stop(direct);
    }
  });

  it("retries one transient provider failure and does not retry the others", async () => {
    const app = await createServer(env("mirror"));
    try {
      await initialize(app);
      const provider = fake(app);

      provider.failNext(new ToolError("upstream_error", "Temporary upstream failure.", true));
      const recovered = await call(app, "get_thread", { threadId: "t3", messageFormat: "PLAIN_TEXT" });
      expect(recovered.isError).toBe(false);
      expect(provider.counts.getThread).toBe(2);

      const beforeLimited = provider.counts.getThread;
      provider.failNext(new ToolError("rate_limited", "Slow down.", false));
      const limited = await call(app, "get_thread", { threadId: "t4" });
      expect(limited.isError).toBe(true);
      expect(limited.data.code).toBe("rate_limited");
      expect(provider.counts.getThread).toBe(beforeLimited + 1);

      const beforeAuth = provider.counts.getThread;
      provider.failNext(new ToolError("needs_reauth", "Connect this account again.", false));
      const reauth = await call(app, "get_thread", { threadId: "t7" });
      expect(reauth.isError).toBe(true);
      expect(reauth.data.code).toBe("needs_reauth");
      expect(provider.counts.getThread).toBe(beforeAuth + 1);

      const beforeTwice = provider.counts.getThread;
      provider.failNext(new ToolError("upstream_error", "Temporary upstream failure.", true));
      provider.failNext(new ToolError("upstream_error", "Temporary upstream failure.", true));
      const failed = await call(app, "get_thread", { threadId: "t8" });
      expect(failed.isError).toBe(true);
      expect(failed.data.code).toBe("upstream_error");
      expect(provider.counts.getThread).toBe(beforeTwice + 2);
    } finally {
      await stop(app);
    }
  });

  it("does not log tokens, the key, or mail bodies during a read", async () => {
    const app = await createServer(env("mirror"));
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    const consoleLines: string[] = [];
    const stdout: string[] = [];
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      write: process.stdout.write,
    };
    const record = (...args: unknown[]) => {
      consoleLines.push(args.map((item) => String(item)).join(" "));
    };
    console.log = record;
    console.info = record;
    console.warn = record;
    console.error = record;
    console.debug = record;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout.push(String(chunk));
      return original.write.call(process.stdout, chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    try {
      await initialize(app);
      const thread = await call(app, "get_thread", { threadId: "t1", messageFormat: "FULL_CONTENT" });
      await call(app, "search_threads", { query: "" });
      expect(JSON.stringify(thread.data)).toContain("Can we lock the gold package");
      const blob = [...lines, ...consoleLines, ...stdout].join("\n");
      expect(blob).not.toContain("seed-token-DO-NOT-LOG-9f3a7c");
      expect(blob).not.toContain(TOKEN);
      expect(blob).not.toContain(app.config.encryptionKey.toString("base64"));
      expect(blob).not.toContain("Can we lock the gold package");
      expect(blob).not.toContain("Five stories you missed");
      const sealed = await app.store.tokenCiphertext("gmail_work");
      expect(sealed).toBeTruthy();
      expect(sealed).not.toContain("seed-token");
      expect(openSeal(app.config.encryptionKey, sealed ?? "")).toBe("seed-token-DO-NOT-LOG-9f3a7c:gmail_work");
    } finally {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
      process.stdout.write = original.write;
      await stop(app);
    }
  });
});

describe("search paging", () => {
  it("asks the provider for one page and does not walk the mailbox by id", async () => {
    const mirror = await createServer(env("mirror"));
    const direct = await createServer(env("direct"));
    try {
      await initialize(mirror);
      await initialize(direct);
      const mirrorProvider = fake(mirror);
      const directProvider = fake(direct);
      const mirrorLists = mirrorProvider.counts.listThreadMeta;
      expect(directProvider.counts.listThreadMeta).toBe(0);
      const page = await call(mirror, "search_threads", { query: "", pageSize: 2 });
      expect(ids(page.data)).toEqual(["t1", "t2"]);
      expect(page.data.resultCountEstimate).toBe(8);
      expect(mirrorProvider.counts.listThreadMeta).toBe(mirrorLists);
      expect(mirrorProvider.counts.searchIds).toBe(1);
      const directPage = await call(direct, "search_threads", { query: "" });
      expect(ids(directPage.data)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
      expect(directProvider.counts.listThreadMeta).toBe(0);
      expect(directProvider.counts.searchIds).toBe(1);
      await mirror.store.forgetThread("gmail_work", "t8");
      const again = await call(mirror, "search_threads", { query: "" });
      expect(ids(again.data)).toContain("t8");
      expect(await mirror.store.getThread("gmail_work", "t8")).toBeTruthy();
    } finally {
      await stop(mirror);
      await stop(direct);
    }
  });
});

describe("writes through the fake provider", () => {
  for (const mode of ["mirror", "direct"] as const) {
    it(`writes once, keeps threading headers, and leaves the store alone after a failure (${mode})`, async () => {
      const app = await createServer(env(mode));
      try {
        await initialize(app);
        const provider = fake(app);
        const before = await app.store.mailDigest();
        provider.failNext(new ToolError("upstream_error", "The provider failed.", false));
        const failed = await call(app, "create_draft", {
          to: "lee@makerspace.example",
          subject: "SUBJECT-DO-NOT-LOG-zz",
          body: "BODY-DO-NOT-LOG-zz",
        });
        expect(failed.isError).toBe(true);
        expect(provider.counts.createDraft).toBe(1);
        expect(await app.store.mailDigest()).toBe(before);
        const draft = await call(app, "create_draft", {
          to: "lee@makerspace.example",
          subject: "Hello",
          body: "Saved note",
          replyToMessageId: "mt1",
        });
        expect(draft.isError).toBe(false);
        expect(draft.data.threadId).toBe("t1");
        const loaded = await call(app, "get_draft", { draftId: String(draft.data.id) });
        expect(loaded.data.inReplyTo).toBe("<mt1@mail.example>");
        expect(loaded.data.references).toBe("<mt1@mail.example>");
        const reply = await call(app, "reply", { messageId: "mt1", body: "Thanks" });
        expect(reply.isError).toBe(false);
        expect(reply.data.labelIds).toEqual(["SENT"]);
        const thread = await call(app, "get_thread", { threadId: "t1" });
        const last = (thread.data.messages as Json[]).at(-1);
        expect(last?.inReplyTo).toBe("<mt1@mail.example>");
        expect(last?.references).toBe("<mt1@mail.example>");
        const audit = JSON.stringify(await app.store.listAudit());
        expect(audit).not.toContain("SUBJECT-DO-NOT-LOG-zz");
        expect(audit).not.toContain("BODY-DO-NOT-LOG-zz");
        expect(audit).not.toContain("Dana Ruiz");
        if (mode === "direct") {
          expect(await app.store.countMessages()).toBe(0);
          expect(await app.store.countThreads()).toBe(0);
        } else {
          expect(await app.store.countMessages()).toBeGreaterThan(0);
        }
      } finally {
        await stop(app);
      }
    });
  }
});
