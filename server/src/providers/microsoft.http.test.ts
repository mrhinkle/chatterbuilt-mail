import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError } from "../errors.js";
import { createServer, type Running } from "../http/app.js";
import { ProviderRouter } from "./router.js";
import { FakeGmailServer } from "./gmail-fake-server.js";
import { GRAPH_INLINE_MAX, GRAPH_UPLOAD_CHUNK, MicrosoftProvider, OUTLOOK_UPLOAD_HOST } from "./microsoft.js";
import { FakeMicrosoftServer, type MsFault } from "./microsoft-fake-server.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const REFRESH = "refresh-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";
const ACCESS_B = "access-b-DO-NOT-LOG-zz";
const BODY = "BODY-DO-NOT-LOG-zz";

type Json = Record<string, unknown>;
const live: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (live.length > 0) {
    const item = live.pop();
    if (item) await item.close();
  }
});

function postTls(url: string, ca: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "content-length": String(Buffer.byteLength(body)),
        authorization: `Bearer ${TOKEN}`,
      },
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
    const last = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).at(-1);
    return last ? JSON.parse(last) as Json : null;
  }
  return JSON.parse(text) as Json;
}

async function initialize(app: Running): Promise<void> {
  const hello = await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane5c", version: "0" } },
  }));
  expect(hello.status).toBe(200);
  await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
}

async function call(app: Running, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Json }> {
  const res = await postTls(`${app.url}/mcp`, app.cert, JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  }));
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {} };
}

async function boot(
  mode: "mirror" | "direct",
  microsoft: FakeMicrosoftServer,
  extra: Record<string, string> = {},
  logs?: string[],
): Promise<Running> {
  const app = await createServer({
    OWNER_TOKEN: TOKEN,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: mode,
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "live",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    OWNER_TIMEZONE: "UTC",
    MICROSOFT_CLIENT_ID: "ms-client",
    MICROSOFT_GRAPH_BASE: microsoft.graphBase,
    MICROSOFT_TOKEN_URL: microsoft.tokenUrl,
    MICROSOFT_AUTH_URL: microsoft.authUrl,
    MICROSOFT_DEVICE_URL: microsoft.deviceUrl,
    ...extra,
  }, { logSink: logs ? (line) => logs.push(line) : undefined });
  live.push(app);
  await app.store.upsertAccount({
    id: "ms_box",
    email: "owner@outlook.example",
    label: "Outlook",
    kind: "microsoft",
  }, 0);
  await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
    refreshToken: REFRESH,
    accessToken: ACCESS,
    expiresAt: Date.now() + 3_600_000,
  }));
  await initialize(app);
  return app;
}

function mapOutlookUpload(microsoft: FakeMicrosoftServer): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    if (parsed.hostname === OUTLOOK_UPLOAD_HOST) {
      const id = /Messages\('([^']+)'\)/.exec(parsed.pathname)?.[1];
      if (!id) throw new Error("blocked");
      return fetch(`${microsoft.origin}/upload/${encodeURIComponent(id)}${parsed.search}`, init);
    }
    if (parsed.hostname !== "127.0.0.1") throw new Error("blocked");
    return fetch(input, init);
  };
}

function uploadingProvider(
  app: Running,
  microsoft: FakeMicrosoftServer,
  options: { uploadChunkBytes?: number; inlineBytes?: number; fetchImpl?: typeof fetch } = {},
): MicrosoftProvider {
  return new MicrosoftProvider({
    store: app.store,
    key: app.config.encryptionKey,
    clientId: "ms-client",
    graphBase: microsoft.graphBase,
    tokenUrl: microsoft.tokenUrl,
    timeoutMs: 20_000,
    logger: app.logger,
    mailMode: "direct",
    syncDays: 30,
    pageSize: 50,
    fetchImpl: options.fetchImpl ?? mapOutlookUpload(microsoft),
    uploadChunkBytes: options.uploadChunkBytes,
    inlineBytes: options.inlineBytes,
  });
}

function watchFetch(microsoft: FakeMicrosoftServer): { fetchImpl: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const inner = mapOutlookUpload(microsoft);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    return inner(input, init);
  };
  return { fetchImpl, seen };
}

function putRows(microsoft: FakeMicrosoftServer): Array<{ path: string; headers: Record<string, string> }> {
  return microsoft.recorded().filter((row) => row.method === "PUT" && row.path.startsWith("/upload/"));
}

function fileDraft(content: Buffer, filename = "notes.bin") {
  return {
    to: ["lee@example.com"],
    cc: [] as string[],
    bcc: [] as string[],
    subject: "file",
    body: "file",
    attachments: [{ filename, mimeType: "application/octet-stream", content: content.toString("base64") }],
  };
}

function graphWrites(microsoft: FakeMicrosoftServer): number {
  return microsoft.recorded().filter((row) => row.method !== "GET" && row.method !== "HEAD" && (row.path.startsWith("/v1.0/") || row.path.startsWith("/upload/"))).length;
}

function savedDraft(id: string, conversationId: string) {
  return {
    id,
    parentFolderId: "drafts",
    conversationId,
    subject: "Old subject",
    isDraft: true,
    body: { contentType: "Text", content: "Old body" },
    from: { emailAddress: { address: "owner@outlook.example" } },
    toRecipients: [{ emailAddress: { address: "keep-to@example.test" } }],
    ccRecipients: [{ emailAddress: { address: "removed@example.test" } }],
    bccRecipients: [{ emailAddress: { address: "removed-secret@example.test" } }],
    hasAttachments: true,
    attachments: [{ id: "att-keep", name: "notes.txt", contentType: "text/plain", contentBytes: Buffer.from("saved-bytes").toString("base64") }],
  };
}

function patchJson(microsoft: FakeMicrosoftServer, id: string): unknown {
  const row = microsoft.recorded().find((item) => item.method === "PATCH" && item.path.includes(`/${id}`));
  return JSON.parse(row?.body || "{}");
}

describe("microsoft graph over the fake server", () => {
  it("calls a failed write once and puts ImmutableId on every Graph request", async () => {
    const faults: Array<{ fault: MsFault; code: string }> = [
      { fault: { kind: "status", status: 500 }, code: "upstream_error" },
      { fault: { kind: "status", status: 429, retryAfter: "30" }, code: "rate_limited" },
      { fault: { kind: "drop" }, code: "upstream_error" },
    ];
    for (const item of faults) {
      const microsoft = await FakeMicrosoftServer.scripted();
      live.push(microsoft);
      const app = await boot("direct", microsoft);
      const before = graphWrites(microsoft);
      microsoft.failNextWrite(item.fault);
      const write = await call(app, "create_draft", { account: "ms_box", to: "lee@example.com", subject: "once", body: "hello" });
      expect(write.isError, item.code).toBe(true);
      expect(write.data.code).toBe(item.code);
      expect(graphWrites(microsoft) - before).toBe(1);
    }

    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({ id: "m1", parentFolderId: "inbox", subject: "Hello", conversationId: "c1", importance: "high" });
    const logs: string[] = [];
    const app = await boot("direct", microsoft, {}, logs);
    await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: 0,
    }));
    const read = await call(app, "get_thread", { account: "ms_box", threadId: "c1" });
    expect(read.isError, JSON.stringify(read.data)).toBe(false);
    const graph = microsoft.recorded().filter((row) => row.path.includes("/v1.0/"));
    expect(graph.length).toBeGreaterThan(0);
    for (const row of graph) expect(row.headers.prefer).toContain('IdType="ImmutableId"');
    const token = microsoft.recorded().filter((row) => row.path.startsWith("/common/oauth2/v2.0/token"));
    expect(token.length).toBeGreaterThan(0);
    for (const row of token) {
      expect(row.headers.prefer).toBeUndefined();
      expect(row.body).not.toContain("client_secret");
    }
    expect(logs.join("\n")).not.toContain(REFRESH);
    expect(logs.join("\n")).not.toContain(ACCESS);
    expect(logs.join("\n")).not.toContain(BODY);
  });

  it("maps search, keeps reply headers, and uploads past the inline cap", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "m-unread",
      parentFolderId: "inbox",
      conversationId: "c-unread",
      subject: "Unread",
      isRead: false,
      from: { emailAddress: { address: "alex@example.com", name: "Alex" } },
      internetMessageId: "<m-unread@mail.example>",
    });
    microsoft.addMessage({
      id: "m-read",
      parentFolderId: "inbox",
      conversationId: "c-read",
      subject: "Read",
      isRead: true,
      from: { emailAddress: { address: "alex@example.com", name: "Alex" } },
    });
    const app = await boot("direct", microsoft);
    const onlyCategory = await call(app, "search_threads", { account: "ms_box", query: "category:primary" });
    expect(onlyCategory.isError).toBe(false);
    expect(onlyCategory.data.threads).toEqual([]);
    const inboxCategory = await call(app, "search_threads", { account: "ms_box", query: "in:inbox category:primary" });
    expect(inboxCategory.data.threads).toEqual([]);
    expect(microsoft.recorded().some((row) => row.path.includes("/messages"))).toBe(false);

    const unread = await call(app, "search_threads", { account: "ms_box", query: "from:alex is:unread" });
    expect(unread.isError, JSON.stringify(unread.data)).toBe(false);
    const threads = unread.data.threads as Array<{ id: string }>;
    expect(threads.map((item) => item.id)).toEqual(["c-unread"]);
    const search = microsoft.recorded().find((row) => row.path.includes("$search=") || row.path.includes("%24search="));
    expect(search).toBeTruthy();
    const decoded = decodeURIComponent(search?.path ?? "");
    expect(decoded).toContain("$search=");
    expect(decoded).toContain("from");
    expect(decoded).not.toContain("$filter");

    const draft = await call(app, "create_draft", {
      account: "ms_box",
      replyToMessageId: "m-unread",
      body: "Thanks",
    });
    expect(draft.isError, JSON.stringify(draft.data)).toBe(false);
    const reply = microsoft.recorded().find((row) => row.path.includes("/createReply"));
    expect(reply?.body).toContain("In-Reply-To");
    expect(reply?.body).toContain("<m-unread@mail.example>");
    expect(reply?.body).toContain("References");

    const provider = uploadingProvider(app, microsoft);
    const draftInput = {
      to: ["lee@example.com"],
      cc: [] as string[],
      bcc: [] as string[],
      body: "file",
    };
    await provider.createDraft("ms_box", {
      ...draftInput,
      subject: "inline",
      attachments: [{ filename: "a.bin", mimeType: "application/octet-stream", content: Buffer.alloc(GRAPH_INLINE_MAX, 1).toString("base64") }],
    });
    const inlinePost = microsoft.recorded().filter((row) => row.method === "POST" && row.path.startsWith("/v1.0/me/messages")).at(-1);
    expect(inlinePost?.body).toContain("contentBytes");
    await provider.createDraft("ms_box", {
      ...draftInput,
      subject: "upload",
      attachments: [{ filename: "b.bin", mimeType: "application/octet-stream", content: Buffer.alloc(GRAPH_INLINE_MAX + 1, 1).toString("base64") }],
    });
    expect(microsoft.recorded().some((row) => row.path.includes("/createUploadSession"))).toBe(true);
    const total = GRAPH_INLINE_MAX + 1;
    const puts = putRows(microsoft);
    expect(puts.map((row) => row.headers["content-range"])).toEqual([
      `bytes 0-${GRAPH_UPLOAD_CHUNK - 1}/${total}`,
      `bytes ${GRAPH_UPLOAD_CHUNK}-${total - 1}/${total}`,
    ]);
    for (const row of puts) {
      expect(row.headers.authorization).toBeUndefined();
      expect(row.headers["content-type"]).toBe("application/octet-stream");
      expect(row.path).toContain("authtoken=synthetic");
    }
  });

  it("turns invalid_grant into needs_reauth and re-syncs only the folder whose delta expired", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.refreshError = "invalid_grant";
    microsoft.addMessage({ id: "m1", parentFolderId: "inbox", conversationId: "c1", subject: "Kept" });
    const app = await boot("mirror", microsoft);
    await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: 0,
    }));
    const denied = await call(app, "get_thread", { account: "ms_box", threadId: "c1" });
    expect(denied.isError).toBe(true);
    expect(denied.data.code).toBe("needs_reauth");
    expect(microsoft.recorded().some((row) => row.path.includes("/v1.0/me/messages"))).toBe(false);

    microsoft.refreshError = null;
    await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: Date.now() + 3_600_000,
    }));
    const synced = await call(app, "sync_now", {});
    expect(synced.isError, JSON.stringify(synced.data)).toBe(false);
    const row = (synced.data.accounts as Array<{ account: string; synced: boolean }>).find((item) => item.account === "ms_box");
    expect(row).toMatchObject({ synced: true });
    const state = await app.store.getSyncState("ms_box");
    expect(state.historyId).toBe("delta");
    const sentBefore = await app.store.getDelta("ms_box", "sentitems");
    expect(sentBefore).toBeTruthy();
    expect((await app.store.listMessages("ms_box")).some((item) => item.id === "m1")).toBe(true);

    microsoft.failDelta("inbox", 1);
    const healed = await call(app, "sync_now", {});
    expect(healed.isError, JSON.stringify(healed.data)).toBe(false);
    expect(await app.store.getDelta("ms_box", "sentitems")).toBe(sentBefore);
    expect((await app.store.listMessages("ms_box")).some((item) => item.id === "m1")).toBe(true);

    microsoft.failDelta("inbox", 2);
    const failed = await call(app, "sync_now", {});
    const broken = (failed.data.accounts as Array<{ account: string; synced: boolean; code?: string }>).find((item) => item.account === "ms_box");
    expect(broken).toMatchObject({ synced: false, code: "upstream_error" });
    expect(await app.store.getDelta("ms_box", "sentitems")).toBe(sentBefore);
    expect((await app.store.listMessages("ms_box")).some((item) => item.id === "m1")).toBe(true);

    const slot = (app.provider as ProviderRouter).providerFor({ kind: "microsoft" });
    expect(slot).toBeInstanceOf(MicrosoftProvider);
    await expect(slot?.listThreadMeta("ms_box")).rejects.toThrow(/Full mailbox listing is not used/);
  });

  it("serves Gmail and Microsoft together, and direct mode stores no mail row", async () => {
    const gmail = await FakeGmailServer.demo();
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(gmail, microsoft);
    microsoft.addMessage({ id: "m1", parentFolderId: "inbox", conversationId: "c1", subject: "Outlook note" });
    const app = await createServer({
      OWNER_TOKEN: TOKEN,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      MAIL_MODE: "direct",
      MAIL_STORE: "pglite",
      MAIL_PROVIDER: "live",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "0",
      OWNER_TIMEZONE: "UTC",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GMAIL_API_BASE: gmail.apiBase,
      GOOGLE_TOKEN_URL: gmail.tokenUrl,
      MICROSOFT_CLIENT_ID: "ms-client",
      MICROSOFT_GRAPH_BASE: microsoft.graphBase,
      MICROSOFT_TOKEN_URL: microsoft.tokenUrl,
      MICROSOFT_AUTH_URL: microsoft.authUrl,
      MICROSOFT_DEVICE_URL: microsoft.deviceUrl,
    });
    live.push(app);
    await app.store.upsertAccount({ id: "gmail_work", email: "alex@riveralabs.example", label: "Work", kind: "gmail" }, 0);
    await app.store.upsertToken("gmail_work", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: Date.now() + 3_600_000,
    }));
    await app.store.upsertAccount({ id: "ms_box", email: "owner@outlook.example", label: "Outlook", kind: "microsoft" }, 1);
    await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: Date.now() + 3_600_000,
    }));
    await app.store.upsertAccount({ id: "imap_a", email: "ada@example.com", label: "IMAP", kind: "imap" }, 2);
    await initialize(app);
    const gmailThread = await call(app, "get_thread", { account: "gmail_work", threadId: "t1" });
    expect(gmailThread.isError, JSON.stringify(gmailThread.data)).toBe(false);
    expect(gmailThread.data.id).toBe("t1");
    const outlook = await call(app, "get_thread", { account: "ms_box", threadId: "c1" });
    expect(outlook.isError, JSON.stringify(outlook.data)).toBe(false);
    const imap = await call(app, "get_thread", { account: "imap_a", threadId: "t1" });
    expect(imap.isError).toBe(true);
    expect(String(imap.data.message)).toContain("Connect this account again.");
    const draft = await call(app, "create_draft", { account: "ms_box", to: "lee@example.com", subject: "direct-only", body: BODY });
    expect(draft.isError, JSON.stringify(draft.data)).toBe(false);
    expect(await app.store.listDrafts("ms_box")).toEqual([]);
    expect(await app.store.listMessages("ms_box")).toEqual([]);
    const audit = await app.store.listAudit();
    expect(JSON.stringify(audit)).not.toContain(BODY);
    expect(JSON.stringify(audit)).not.toContain(REFRESH);

    const mirrorMs = await FakeMicrosoftServer.scripted();
    live.push(mirrorMs);
    const mirror = await boot("mirror", mirrorMs);
    const stored = await call(mirror, "create_draft", { account: "ms_box", to: "lee@example.com", subject: "stored", body: "kept" });
    expect(stored.isError, JSON.stringify(stored.data)).toBe(false);
    expect(await mirror.store.listDrafts("ms_box")).toHaveLength(1);
  });

  it("keeps the message id across a move, refuses a rule Outlook cannot express, and sends only as this mailbox", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({ id: "m-move", parentFolderId: "inbox", conversationId: "c-move", subject: "Stay" });
    const app = await boot("direct", microsoft);
    const moved = await call(app, "unlabel_thread", { account: "ms_box", threadId: "c-move", labelIds: ["INBOX"] });
    expect(moved.isError, JSON.stringify(moved.data)).toBe(false);
    const move = microsoft.recorded().find((row) => row.path.includes("/m-move/move"));
    expect(move?.body).toContain("archive");
    const again = await call(app, "get_thread", { account: "ms_box", threadId: "c-move" });
    const ids = (again.data.messages as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toEqual(["m-move"]);

    const rule = await call(app, "create_filter", {
      account: "ms_box",
      criteria: { query: "from:alex" },
      action: { skipInbox: true },
    });
    expect(rule.isError).toBe(true);
    expect(rule.data.message).toBe("This rule can't be expressed in Outlook.");
    expect(microsoft.recorded().some((row) => row.method === "POST" && row.path.includes("/messageRules"))).toBe(false);

    const sendAs = await call(app, "list_send_as", { account: "ms_box" });
    expect(sendAs.data.sendAs).toEqual([{
      email: "owner@outlook.example",
      signature: "",
      isDefault: true,
      isPrimary: true,
      verified: true,
    }]);
    const other = await call(app, "send_message", {
      account: "ms_box",
      to: ["lee@example.com"],
      subject: "nope",
      body: "nope",
      fromEmail: "other@example.com",
    });
    expect(other.isError).toBe(true);
    expect(other.data.message).toBe("Sending as another mailbox is not available for this account.");

    const capped = (app.provider as ProviderRouter).providerFor({ kind: "microsoft" });
    expect(capped).toBeInstanceOf(MicrosoftProvider);
    const tight = new MicrosoftProvider({
      store: app.store,
      key: app.config.encryptionKey,
      clientId: "ms-client",
      graphBase: microsoft.graphBase,
      tokenUrl: microsoft.tokenUrl,
      timeoutMs: 20_000,
      logger: app.logger,
      mailMode: "direct",
      syncDays: 30,
      pageSize: 50,
      inlineBytes: 1,
      maxBytes: 4,
    });
    await expect(tight.createDraft("ms_box", {
      to: ["lee@example.com"],
      cc: [],
      bcc: [],
      subject: "huge",
      body: "file",
      attachments: [{ filename: "c.bin", mimeType: "application/octet-stream", content: Buffer.alloc(8).toString("base64") }],
    })).rejects.toThrow("This attachment is over the 150 MB limit.");
  });

  it("retries a throttled read once and sends the client secret only in own-app mode", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.requireSecret = true;
    microsoft.addMessage({ id: "m1", parentFolderId: "inbox", conversationId: "c1", subject: "Retry" });
    const app = await boot("direct", microsoft, { MICROSOFT_CLIENT_SECRET: CLIENT_SECRET });
    await app.store.upsertToken("ms_box", app.config.encryptionKey, JSON.stringify({
      refreshToken: REFRESH,
      accessToken: ACCESS,
      expiresAt: 0,
    }));
    microsoft.failNextRead({ kind: "status", status: 429, retryAfter: "0" });
    const read = await call(app, "get_thread", { account: "ms_box", threadId: "c1" });
    expect(read.isError, JSON.stringify(read.data)).toBe(false);
    const messageGets = microsoft.recorded().filter((row) => row.method === "GET" && row.path.includes("/v1.0/me/messages"));
    expect(messageGets).toHaveLength(2);
    const token = microsoft.recorded().filter((row) => row.path.startsWith("/common/oauth2/v2.0/token"));
    expect(token.length).toBeGreaterThan(0);
    for (const row of token) expect(row.body).toContain("client_secret=");

    const stored = await FakeMicrosoftServer.scripted();
    live.push(stored);
    stored.addMessage({
      id: "m-unread",
      parentFolderId: "inbox",
      conversationId: "c-unread",
      subject: "Unread",
      isRead: false,
      from: { emailAddress: { address: "alex@example.com", name: "Alex" } },
    });
    stored.addMessage({
      id: "m-read",
      parentFolderId: "inbox",
      conversationId: "c-read",
      subject: "Read",
      isRead: true,
      from: { emailAddress: { address: "alex@example.com", name: "Alex" } },
    });
    const mirror = await boot("mirror", stored);
    const synced = await call(mirror, "sync_now", {});
    expect(synced.isError, JSON.stringify(synced.data)).toBe(false);
    const before = stored.recorded().filter((row) => row.path.includes("%24search=") || row.path.includes("$search=")).length;
    const found = await call(mirror, "search_threads", { account: "ms_box", query: "from:alex is:unread" });
    expect(found.isError, JSON.stringify(found.data)).toBe(false);
    expect((found.data.threads as Array<{ id: string }>).map((item) => item.id)).toEqual(["c-unread"]);
    const after = stored.recorded().filter((row) => row.path.includes("%24search=") || row.path.includes("$search=")).length;
    expect(after).toBe(before);
  });

  it("accepted send with delayed Sent Items visibility does not fail or return another message", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.hideAfterSend = true;
    microsoft.addMessage({
      id: "old-sent",
      parentFolderId: "sentitems",
      conversationId: "old-conv",
      subject: "Already there",
      isDraft: false,
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "pat@example.com" } }],
    });
    const app = await boot("direct", microsoft);
    const before = graphWrites(microsoft);
    const sent = await call(app, "send_message", {
      account: "ms_box",
      to: ["lee@example.com"],
      subject: "New note",
      body: "hello",
    });
    expect(sent.isError, JSON.stringify(sent.data)).toBe(false);
    expect(sent.data.id).not.toBe("old-sent");
    expect(sent.data.threadId).not.toBe("old-conv");
    expect(sent.data.labelIds).toEqual(["SENT"]);
    expect(microsoft.recorded().some((row) => row.path.startsWith("/v1.0/me/sendMail"))).toBe(false);
    const recorded = microsoft.recorded();
    const sendPosts = recorded.filter((row) => row.method === "POST" && /\/messages\/[^/]+\/send(?:\?|$)/.test(row.path));
    expect(sendPosts).toHaveLength(1);
    expect(decodeURIComponent(sendPosts[0]?.path ?? "")).toContain(`/messages/${String(sent.data.id)}/send`);
    expect(graphWrites(microsoft) - before).toBe(2);
    const sendAt = recorded.findIndex((row) => row.method === "POST" && /\/messages\/[^/]+\/send(?:\?|$)/.test(row.path));
    const afterSend = recorded.slice(sendAt + 1);
    expect(afterSend.some((row) => row.method !== "GET" && row.path.includes("/send"))).toBe(false);
    expect(afterSend.some((row) => row.path.includes("sentitems"))).toBe(false);
    expect(microsoft.snapshot().find((item) => item.id === sent.data.id)).toMatchObject({
      parentFolderId: "sentitems",
      isDraft: false,
      conversationId: sent.data.threadId,
    });
    expect(microsoft.snapshot().some((item) => item.id === "old-sent" && item.conversationId === "old-conv")).toBe(true);
  });

  it("sends the saved draft once and keeps its attachment", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "existing-draft",
      parentFolderId: "drafts",
      conversationId: "conv-draft",
      subject: "Saved",
      isDraft: true,
      body: { contentType: "Text", content: "Keep me" },
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
      hasAttachments: true,
      attachments: [{ id: "attId", name: "notes.txt", contentType: "text/plain", contentBytes: Buffer.from("saved-bytes").toString("base64") }],
    });
    const app = await boot("mirror", microsoft);
    const sent = await call(app, "send_message", {
      account: "ms_box",
      draftId: "existing-draft",
      subject: "Edited title",
      attachments: [{ filename: "notes.txt", mimeType: "text/plain", attId: "attId" }],
    });
    expect(sent.isError, JSON.stringify(sent.data)).toBe(false);
    expect(sent.data).toMatchObject({ id: "existing-draft", threadId: "conv-draft", labelIds: ["SENT"] });
    const recorded = microsoft.recorded();
    expect(recorded.some((row) => row.path.startsWith("/v1.0/me/sendMail"))).toBe(false);
    expect(recorded.filter((row) => row.method === "POST" && row.path.includes("/existing-draft/send"))).toHaveLength(1);
    expect(recorded.some((row) => row.method === "POST" && row.path === "/v1.0/me/messages")).toBe(false);
    const patch = recorded.find((row) => row.method === "PATCH" && row.path.includes("/existing-draft"));
    expect(patch?.body).toContain("Edited title");
    expect(patch?.body ?? "").not.toContain("attId");
    expect(patch?.body ?? "").not.toContain("contentBytes");
    expect(microsoft.snapshot().filter((item) => item.conversationId === "conv-draft")).toEqual([
      expect.objectContaining({
        id: "existing-draft",
        parentFolderId: "sentitems",
        isDraft: false,
        subject: "Edited title",
        attachmentIds: ["attId"],
        to: ["lee@example.com"],
      }),
    ]);
    const stored = (await app.store.listMessages("ms_box")).find((item) => item.id === "existing-draft");
    expect(stored?.attachments.map((item) => item.id)).toEqual(["attId"]);
    expect(stored?.subject).toBe("Edited title");
    expect(stored?.threadId).toBe("conv-draft");

    microsoft.addMessage({
      id: "saved-only",
      parentFolderId: "drafts",
      conversationId: "conv-saved",
      subject: "Saved",
      isDraft: true,
      body: { contentType: "Text", content: "Keep me" },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
    });
    const plain = await call(app, "send_message", { account: "ms_box", draftId: "saved-only" });
    expect(plain.isError, JSON.stringify(plain.data)).toBe(false);
    expect(plain.data).toMatchObject({ id: "saved-only", threadId: "conv-saved" });
    expect(microsoft.recorded().filter((row) => row.method === "PATCH" && row.path.includes("/saved-only"))).toHaveLength(0);
    expect(microsoft.recorded().filter((row) => row.method === "POST" && row.path.includes("/saved-only/send"))).toHaveLength(1);
    expect(microsoft.snapshot().find((item) => item.id === "saved-only")).toMatchObject({
      subject: "Saved",
      parentFolderId: "sentitems",
      isDraft: false,
    });
  });

  it("clears an explicit empty cc, bcc, subject, or body on a saved draft and keeps omitted fields", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    const kept = {
      id: "sibling",
      parentFolderId: "inbox",
      conversationId: "conv-clear",
      subject: "Sibling stays",
      body: { contentType: "Text", content: "Leave this message" },
      isDraft: false,
      from: { emailAddress: { address: "lee@example.test" } },
    };
    const other = {
      id: "other-conv",
      parentFolderId: "inbox",
      conversationId: "conv-other",
      subject: "Other thread",
      body: { contentType: "Text", content: "Unrelated" },
      isDraft: false,
    };
    microsoft.addMessage(kept);
    microsoft.addMessage(other);
    for (const id of ["clear-all", "clear-cc", "clear-bcc", "clear-content", "change-to", "send-stored"]) {
      microsoft.addMessage(savedDraft(id, id === "clear-all" || id === "send-stored" ? "conv-clear" : `conv-${id}`));
    }
    const app = await boot("mirror", microsoft);
    const attachment = { filename: "notes.txt", mimeType: "text/plain", attId: "att-keep" };

    const cleared = await call(app, "send_message", {
      account: "ms_box",
      draftId: "clear-all",
      to: ["desired@example.test"],
      cc: [],
      bcc: [],
      subject: "",
      body: "",
      attachments: [attachment],
    });
    expect(cleared.isError, JSON.stringify(cleared.data)).toBe(false);
    expect(cleared.data).toMatchObject({ id: "clear-all", threadId: "conv-clear", labelIds: ["SENT"] });
    expect(patchJson(microsoft, "clear-all")).toEqual({
      subject: "",
      body: { contentType: "Text", content: "" },
      toRecipients: [{ emailAddress: { address: "desired@example.test" } }],
      ccRecipients: [],
      bccRecipients: [],
    });
    expect(microsoft.snapshot().find((item) => item.id === "clear-all")).toMatchObject({
      parentFolderId: "sentitems",
      isDraft: false,
      conversationId: "conv-clear",
      subject: "",
      body: "",
      to: ["desired@example.test"],
      cc: [],
      bcc: [],
      attachmentIds: ["att-keep"],
    });
    const stored = (await app.store.listMessages("ms_box")).find((item) => item.id === "clear-all");
    expect(stored).toMatchObject({
      threadId: "conv-clear",
      subject: "",
      plaintextBody: "",
      toRecipients: ["desired@example.test"],
      ccRecipients: [],
      bccRecipients: [],
    });
    expect(stored?.attachments.map((item) => item.id)).toEqual(["att-keep"]);

    const onlyCc = await call(app, "send_message", { account: "ms_box", draftId: "clear-cc", cc: [] });
    expect(onlyCc.isError, JSON.stringify(onlyCc.data)).toBe(false);
    expect(patchJson(microsoft, "clear-cc")).toEqual({ ccRecipients: [] });
    expect(microsoft.snapshot().find((item) => item.id === "clear-cc")).toMatchObject({
      subject: "Old subject",
      body: "Old body",
      to: ["keep-to@example.test"],
      cc: [],
      bcc: ["removed-secret@example.test"],
      conversationId: "conv-clear-cc",
      attachmentIds: ["att-keep"],
    });

    const onlyBcc = await call(app, "send_message", { account: "ms_box", draftId: "clear-bcc", bcc: [] });
    expect(onlyBcc.isError, JSON.stringify(onlyBcc.data)).toBe(false);
    expect(patchJson(microsoft, "clear-bcc")).toEqual({ bccRecipients: [] });
    expect(microsoft.snapshot().find((item) => item.id === "clear-bcc")).toMatchObject({
      subject: "Old subject",
      body: "Old body",
      cc: ["removed@example.test"],
      bcc: [],
    });

    const content = await call(app, "send_message", {
      account: "ms_box",
      draftId: "clear-content",
      subject: "",
      body: "",
    });
    expect(content.isError, JSON.stringify(content.data)).toBe(false);
    expect(patchJson(microsoft, "clear-content")).toEqual({
      subject: "",
      body: { contentType: "Text", content: "" },
    });
    expect(microsoft.snapshot().find((item) => item.id === "clear-content")).toMatchObject({
      subject: "",
      body: "",
      to: ["keep-to@example.test"],
      cc: ["removed@example.test"],
      bcc: ["removed-secret@example.test"],
    });

    const retarget = await call(app, "send_message", {
      account: "ms_box",
      draftId: "change-to",
      to: ["desired@example.test"],
    });
    expect(retarget.isError, JSON.stringify(retarget.data)).toBe(false);
    expect(patchJson(microsoft, "change-to")).toEqual({
      toRecipients: [{ emailAddress: { address: "desired@example.test" } }],
    });
    expect(microsoft.snapshot().find((item) => item.id === "change-to")).toMatchObject({
      subject: "Old subject",
      body: "Old body",
      to: ["desired@example.test"],
      cc: ["removed@example.test"],
      bcc: ["removed-secret@example.test"],
    });

    const untouched = await call(app, "send_message", { account: "ms_box", draftId: "send-stored" });
    expect(untouched.isError, JSON.stringify(untouched.data)).toBe(false);
    expect(microsoft.recorded().filter((row) => row.method === "PATCH" && row.path.includes("/send-stored"))).toHaveLength(0);
    expect(microsoft.snapshot().find((item) => item.id === "send-stored")).toMatchObject({
      parentFolderId: "sentitems",
      isDraft: false,
      conversationId: "conv-clear",
      subject: "Old subject",
      body: "Old body",
      cc: ["removed@example.test"],
      bcc: ["removed-secret@example.test"],
      attachmentIds: ["att-keep"],
    });
    expect(microsoft.snapshot().find((item) => item.id === "sibling")).toMatchObject({
      conversationId: "conv-clear",
      subject: "Sibling stays",
      body: "Leave this message",
      parentFolderId: "inbox",
    });
    expect(microsoft.snapshot().find((item) => item.id === "other-conv")).toMatchObject({
      conversationId: "conv-other",
      subject: "Other thread",
      body: "Unrelated",
    });
  });

  it("keeps a conversation that spans folders and list pages", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "received",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Hello",
      bodyPreview: "Hello",
      receivedDateTime: "2026-11-01T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "received-2",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Hello again",
      bodyPreview: "Hello again",
      receivedDateTime: "2026-11-03T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "reply",
      parentFolderId: "sentitems",
      conversationId: "conv",
      subject: "Re: Hello",
      bodyPreview: "Re: Hello",
      receivedDateTime: "2026-11-02T00:00:00.000Z",
      isDraft: false,
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
    });
    microsoft.addMessage({
      id: "other",
      parentFolderId: "inbox",
      conversationId: "other-conv",
      subject: "Unrelated",
      bodyPreview: "Unrelated",
      receivedDateTime: "2026-11-01T12:00:00.000Z",
    });
    const app = await boot("mirror", microsoft, { SYNC_PAGE_SIZE: "1" });
    const synced = await call(app, "sync_now", {});
    expect(synced.isError, JSON.stringify(synced.data)).toBe(false);
    const ids = (await app.store.listMessages("ms_box")).map((item) => item.id).sort();
    expect(ids).toEqual(["other", "received", "received-2", "reply"]);
    const thread = await app.store.getThread("ms_box", "conv");
    expect(thread?.messageCount).toBe(3);
    expect(thread?.snippet).toBe("Hello again");
    expect(thread?.messages.map((item) => item.id)).toEqual(["received", "reply", "received-2"]);
  });

  it("applies a partial delta to one message, deletes by message id, and keeps a move", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "received",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Hello",
      bodyPreview: "Hello",
      receivedDateTime: "2026-11-01T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "reply",
      parentFolderId: "sentitems",
      conversationId: "conv",
      subject: "Re: Hello",
      bodyPreview: "Re: Hello",
      receivedDateTime: "2026-11-02T00:00:00.000Z",
      isDraft: false,
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
    });
    microsoft.addMessage({
      id: "note",
      parentFolderId: "archive",
      conversationId: "conv",
      subject: "Filed",
      bodyPreview: "Filed",
      receivedDateTime: "2026-10-20T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "other",
      parentFolderId: "inbox",
      conversationId: "other-conv",
      subject: "Unrelated",
      bodyPreview: "Unrelated",
      receivedDateTime: "2026-11-01T12:00:00.000Z",
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect(first.data.accounts).toMatchObject([{ account: "ms_box", synced: true }]);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["note", "other", "received", "reply"]);

    microsoft.editSubject("received", "Updated");
    const edited = await call(app, "sync_now", {});
    expect(edited.isError, JSON.stringify(edited.data)).toBe(false);
    const afterEdit = await app.store.listMessages("ms_box");
    expect(afterEdit.map((item) => item.id).sort()).toEqual(["note", "other", "received", "reply"]);
    expect(afterEdit.find((item) => item.id === "received")?.subject).toBe("Updated");

    microsoft.removeMessage("received");
    const deleted = await call(app, "sync_now", {});
    expect(deleted.isError, JSON.stringify(deleted.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["note", "other", "reply"]);
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(2);
    expect(await app.store.getThread("ms_box", "other-conv")).toBeTruthy();

    microsoft.moveMessage("note", "inbox");
    const moved = await call(app, "sync_now", {});
    expect(moved.isError, JSON.stringify(moved.data)).toBe(false);
    const afterMove = await app.store.listMessages("ms_box");
    expect(afterMove.map((item) => item.id).sort()).toEqual(["note", "other", "reply"]);
    expect(afterMove.find((item) => item.id === "note")?.labelIds).toContain("INBOX");
    expect(afterMove.find((item) => item.id === "reply")?.labelIds).toContain("SENT");

    microsoft.removeMessage("reply");
    microsoft.removeMessage("note");
    const emptied = await call(app, "sync_now", {});
    expect(emptied.isError, JSON.stringify(emptied.data)).toBe(false);
    expect(await app.store.getThread("ms_box", "conv")).toBeNull();
    expect((await app.store.listMessages("ms_box")).map((item) => item.id)).toEqual(["other"]);
  });

  it("keeps a message moved either way when the folder it left reports @removed deleted", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "sibling",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Stay",
      bodyPreview: "Stay",
      receivedDateTime: "2026-11-01T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "reply",
      parentFolderId: "sentitems",
      conversationId: "conv",
      subject: "Re: Stay",
      bodyPreview: "Re: Stay",
      receivedDateTime: "2026-11-02T00:00:00.000Z",
      isDraft: false,
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
    });
    microsoft.addMessage({
      id: "moved",
      parentFolderId: "archive",
      conversationId: "conv",
      subject: "Filed",
      bodyPreview: "Filed",
      receivedDateTime: "2026-10-20T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "other",
      parentFolderId: "inbox",
      conversationId: "other-conv",
      subject: "Unrelated",
      bodyPreview: "Unrelated",
      receivedDateTime: "2026-11-01T12:00:00.000Z",
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["moved", "other", "reply", "sibling"]);

    microsoft.deltaPageSize = 1;
    const beforeInbox = microsoft.recorded().length;
    microsoft.editSubject("sibling", "Sibling updated");
    microsoft.moveMessage("moved", "inbox");
    const toInbox = await call(app, "sync_now", {});
    expect(toInbox.isError, JSON.stringify(toInbox.data)).toBe(false);
    expect(toInbox.data.accounts).toMatchObject([{ account: "ms_box", synced: true }]);
    const inboxPages = microsoft.recorded().slice(beforeInbox).filter((row) => row.path.includes("/mailFolders/inbox/messages/delta"));
    expect(inboxPages.length).toBeGreaterThan(1);
    const afterInbox = await app.store.listMessages("ms_box");
    expect(afterInbox.map((item) => item.id).sort()).toEqual(["moved", "other", "reply", "sibling"]);
    expect(afterInbox.find((item) => item.id === "moved")?.labelIds).toContain("INBOX");
    expect(afterInbox.find((item) => item.id === "sibling")?.subject).toBe("Sibling updated");
    expect(afterInbox.find((item) => item.id === "reply")?.labelIds).toContain("SENT");
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(3);
    expect(await app.store.getThread("ms_box", "other-conv")).toBeTruthy();

    const quietInbox = await call(app, "sync_now", {});
    expect(quietInbox.isError, JSON.stringify(quietInbox.data)).toBe(false);
    expect(quietInbox.data.accounts).toMatchObject([{ account: "ms_box", synced: true }]);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["moved", "other", "reply", "sibling"]);

    microsoft.moveMessage("moved", "archive");
    const toArchive = await call(app, "sync_now", {});
    expect(toArchive.isError, JSON.stringify(toArchive.data)).toBe(false);
    const afterArchive = await app.store.listMessages("ms_box");
    expect(afterArchive.map((item) => item.id).sort()).toEqual(["moved", "other", "reply", "sibling"]);
    expect(afterArchive.find((item) => item.id === "moved")?.labelIds).not.toContain("INBOX");
    expect(afterArchive.find((item) => item.id === "sibling")?.labelIds).toContain("INBOX");
    expect(afterArchive.find((item) => item.id === "reply")?.labelIds).toContain("SENT");
    expect((await app.store.getThread("ms_box", "other-conv"))?.messageCount).toBe(1);

    const quietArchive = await call(app, "sync_now", {});
    expect(quietArchive.isError, JSON.stringify(quietArchive.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["moved", "other", "reply", "sibling"]);

    microsoft.removeMessage("moved");
    const deleted = await call(app, "sync_now", {});
    expect(deleted.isError, JSON.stringify(deleted.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["other", "reply", "sibling"]);
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(2);
    expect(await app.store.getThread("ms_box", "other-conv")).toBeTruthy();

    const quietDeleted = await call(app, "sync_now", {});
    expect(quietDeleted.isError, JSON.stringify(quietDeleted.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["other", "reply", "sibling"]);

    const direct = await boot("direct", microsoft);
    const skipped = await call(direct, "sync_now", {});
    expect(skipped.isError, JSON.stringify(skipped.data)).toBe(false);
    expect(skipped.data.accounts).toMatchObject([{ account: "ms_box", synced: false, note: "direct mode does not sync" }]);
    expect(await direct.store.listMessages("ms_box")).toEqual([]);
  });

  it("drops Deleted Items rows when emptying the folder reports @removed changed", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "trashed",
      parentFolderId: "deleteditems",
      conversationId: "mixed",
      subject: "Gone",
      bodyPreview: "Gone body",
      receivedDateTime: "2026-11-01T00:00:00.000Z",
    });
    microsoft.addMessage({
      id: "kept",
      parentFolderId: "inbox",
      conversationId: "mixed",
      subject: "Stay",
      bodyPreview: "Stay body",
      isRead: false,
      receivedDateTime: "2026-11-02T00:00:00.000Z",
    });
    microsoft.addMessage({
      id: "trashed-2",
      parentFolderId: "deleteditems",
      conversationId: "only-trash",
      subject: "Also gone",
      bodyPreview: "Also gone",
      receivedDateTime: "2026-11-01T01:00:00.000Z",
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect((await app.store.listMessages("ms_box")).map((item) => item.id).sort()).toEqual(["kept", "trashed", "trashed-2"]);

    microsoft.removeMessage("trashed");
    microsoft.removeMessage("trashed-2");
    const emptied = await call(app, "sync_now", {});
    expect(emptied.isError, JSON.stringify(emptied.data)).toBe(false);
    expect(microsoft.removals.filter((item) => item.folder === "deleteditems").map((item) => item.reason)).toEqual(["changed", "changed"]);
    const reads = microsoft.recorded().filter((row) => row.path.includes("$select=id,parentFolderId,conversationId"));
    expect(reads.map((row) => row.path).sort()).toEqual([
      "/v1.0/me/messages/trashed-2?$select=id,parentFolderId,conversationId",
      "/v1.0/me/messages/trashed?$select=id,parentFolderId,conversationId",
    ]);
    expect(reads.every((row) => row.headers.prefer?.includes("ImmutableId"))).toBe(true);
    const left = await app.store.listMessages("ms_box");
    expect(left.map((item) => item.id)).toEqual(["kept"]);
    expect(left[0]?.subject).toBe("Stay");
    expect(left[0]?.plaintextBody).toBe("Stay body");
    expect(left[0]?.labelIds).toContain("INBOX");
    expect(left[0]?.labelIds).toContain("UNREAD");
    expect((await app.store.getThread("ms_box", "mixed"))?.messageCount).toBe(1);
    expect(await app.store.getThread("ms_box", "only-trash")).toBeNull();
  });

  it("drops an inbox message moved into a user folder and leaves the rest of the conversation", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "stay",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Stay",
      bodyPreview: "Stay body",
      isRead: false,
      receivedDateTime: "2026-11-01T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    microsoft.addMessage({
      id: "filed",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "File me",
      bodyPreview: "File body",
      receivedDateTime: "2026-11-02T00:00:00.000Z",
      from: { emailAddress: { address: "lee@example.com", name: "Lee" } },
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(2);

    microsoft.moveMessage("filed", "AAMkUserRules");
    const moved = await call(app, "sync_now", {});
    expect(moved.isError, JSON.stringify(moved.data)).toBe(false);
    expect(microsoft.removals.filter((item) => item.id === "filed")).toEqual([
      { folder: "inbox", id: "filed", reason: "changed" },
    ]);
    const read = microsoft.recorded().find((row) => row.path === "/v1.0/me/messages/filed?$select=id,parentFolderId,conversationId");
    expect(read?.headers.prefer).toContain("ImmutableId");
    const left = await app.store.listMessages("ms_box");
    expect(left.map((item) => item.id)).toEqual(["stay"]);
    expect(left[0]?.subject).toBe("Stay");
    expect(left[0]?.plaintextBody).toBe("Stay body");
    expect(left[0]?.labelIds).toContain("INBOX");
    expect(left[0]?.labelIds).toContain("UNREAD");
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(1);
  });

  it("keeps an inbox message moved to archive and clears the inbox label", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "stay",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Stay",
      bodyPreview: "Stay body",
      receivedDateTime: "2026-11-01T00:00:00.000Z",
    });
    microsoft.addMessage({
      id: "moved",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Archive me",
      bodyPreview: "Archive body",
      isRead: false,
      receivedDateTime: "2026-11-02T00:00:00.000Z",
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);

    microsoft.expectChanged("moved");
    microsoft.moveMessage("moved", "archive");
    const archived = await call(app, "sync_now", {});
    expect(archived.isError, JSON.stringify(archived.data)).toBe(false);
    expect(microsoft.removals.filter((item) => item.id === "moved")).toEqual([
      { folder: "inbox", id: "moved", reason: "changed" },
    ]);
    const rows = await app.store.listMessages("ms_box");
    expect(rows.map((item) => item.id).sort()).toEqual(["moved", "stay"]);
    const movedRow = rows.find((item) => item.id === "moved");
    expect(movedRow?.labelIds).not.toContain("INBOX");
    expect(movedRow?.labelIds).not.toContain("TRASH");
    expect(movedRow?.labelIds).not.toContain("SENT");
    expect(movedRow?.labelIds).toContain("UNREAD");
    expect(movedRow?.subject).toBe("Archive me");
    expect(movedRow?.plaintextBody).toBe("Archive body");
    const stay = rows.find((item) => item.id === "stay");
    expect(stay?.labelIds).toContain("INBOX");
    expect(stay?.subject).toBe("Stay");
    expect(stay?.plaintextBody).toBe("Stay body");
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(2);
  });

  it("drops one message from a two-message conversation and leaves the other with count 1", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "keep",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Keep",
      bodyPreview: "Keep body",
      isRead: false,
      receivedDateTime: "2026-11-01T00:00:00.000Z",
    });
    microsoft.addMessage({
      id: "drop",
      parentFolderId: "inbox",
      conversationId: "conv",
      subject: "Drop",
      bodyPreview: "Drop body",
      receivedDateTime: "2026-11-02T00:00:00.000Z",
    });
    const app = await boot("mirror", microsoft);
    const first = await call(app, "sync_now", {});
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(2);

    microsoft.removeMessage("drop");
    const removed = await call(app, "sync_now", {});
    expect(removed.isError, JSON.stringify(removed.data)).toBe(false);
    expect(microsoft.removals.filter((item) => item.id === "drop")).toEqual([
      { folder: "inbox", id: "drop", reason: "deleted" },
    ]);
    const left = await app.store.listMessages("ms_box");
    expect(left.map((item) => item.id)).toEqual(["keep"]);
    expect(left[0]?.subject).toBe("Keep");
    expect(left[0]?.plaintextBody).toBe("Keep body");
    expect(left[0]?.labelIds).toContain("INBOX");
    expect(left[0]?.labelIds).toContain("UNREAD");
    expect((await app.store.getThread("ms_box", "conv"))?.messageCount).toBe(1);
  });

  it("resolves well-known folders separately for each account", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.setFolderId(ACCESS, "archive", "archive-for-account-a");
    microsoft.setFolderId(ACCESS_B, "archive", "archive-for-account-b");
    microsoft.addMessage({ id: "msg-a", parentFolderId: "inbox", conversationId: "conv-a", subject: "A" });
    microsoft.addMessage({ id: "msg-b", parentFolderId: "inbox", conversationId: "conv-b", subject: "B" });
    const app = await boot("direct", microsoft);
    await app.store.upsertAccount({
      id: "ms_b",
      email: "other@outlook.example",
      label: "Other",
      kind: "microsoft",
    }, 1);
    await app.store.upsertToken("ms_b", app.config.encryptionKey, JSON.stringify({
      refreshToken: "refresh-b-DO-NOT-LOG",
      accessToken: ACCESS_B,
      expiresAt: Date.now() + 3_600_000,
    }));
    const first = await call(app, "unlabel_thread", { account: "ms_box", threadId: "conv-a", labelIds: ["INBOX"] });
    const second = await call(app, "unlabel_thread", { account: "ms_b", threadId: "conv-b", labelIds: ["INBOX"] });
    expect(first.isError, JSON.stringify(first.data)).toBe(false);
    expect(second.isError, JSON.stringify(second.data)).toBe(false);
    const moves = microsoft.recorded().filter((row) => row.path.endsWith("/move"));
    expect(moves.map((row) => JSON.parse(row.body) as { destinationId: string })).toEqual([
      { destinationId: "archive-for-account-a" },
      { destinationId: "archive-for-account-b" },
    ]);
    const lookups = microsoft.recorded().filter((row) => row.path === "/v1.0/me/mailFolders/archive");
    expect(lookups).toHaveLength(2);
    expect(lookups[0]?.headers.authorization).toBe(`Bearer ${ACCESS}`);
    expect(lookups[1]?.headers.authorization).toBe(`Bearer ${ACCESS_B}`);
  });

  it("follows every page of a thread and of drafts, and refuses a foreign next link", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.listPageSize = 1;
    microsoft.addMessage({ id: "p1", conversationId: "conv", parentFolderId: "inbox", subject: "One", receivedDateTime: "2026-11-01T00:00:00.000Z" });
    microsoft.addMessage({ id: "p2", conversationId: "conv", parentFolderId: "sentitems", subject: "Two", receivedDateTime: "2026-11-02T00:00:00.000Z" });
    microsoft.addMessage({ id: "p3", conversationId: "conv", parentFolderId: "archive", subject: "Three", receivedDateTime: "2026-11-03T00:00:00.000Z" });
    microsoft.addMessage({ id: "d1", conversationId: "d1", parentFolderId: "drafts", subject: "Draft one", isDraft: true });
    microsoft.addMessage({ id: "d2", conversationId: "d2", parentFolderId: "drafts", subject: "Draft two", isDraft: true });
    const app = await boot("direct", microsoft);
    const thread = await call(app, "get_thread", { account: "ms_box", threadId: "conv" });
    expect(thread.isError, JSON.stringify(thread.data)).toBe(false);
    expect((thread.data.messages as Array<{ id: string }>).map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
    expect(microsoft.recorded().filter((row) => row.path.includes("conversationId"))).toHaveLength(3);

    const drafts = await call(app, "list_drafts", { account: "ms_box" });
    expect(drafts.isError, JSON.stringify(drafts.data)).toBe(false);
    expect((drafts.data.drafts as Array<{ id: string }>).map((item) => item.id)).toEqual(["d1", "d2"]);

    const beforeMoves = microsoft.recorded().length;
    const unlabeled = await call(app, "unlabel_thread", { account: "ms_box", threadId: "conv", labelIds: ["INBOX"] });
    expect(unlabeled.isError, JSON.stringify(unlabeled.data)).toBe(false);
    const moves = microsoft.recorded().slice(beforeMoves).filter((row) => row.path.endsWith("/move"));
    expect(moves.map((row) => row.path).sort()).toEqual([
      "/v1.0/me/messages/p1/move",
      "/v1.0/me/messages/p2/move",
      "/v1.0/me/messages/p3/move",
    ]);

    microsoft.poisonNextLink = "https://evil.example/steal?authtoken=synthetic-secret";
    const beforeRefusal = microsoft.recorded().length;
    const refused = await call(app, "get_thread", { account: "ms_box", threadId: "conv" });
    expect(refused.isError).toBe(true);
    expect(refused.data.code).toBe("tool_error");
    expect(JSON.stringify(refused.data)).not.toContain("authtoken");
    expect(JSON.stringify(refused.data)).not.toContain("evil.example");
    const duringRefusal = microsoft.recorded().slice(beforeRefusal);
    expect(duringRefusal.some((row) => row.path.includes("evil.example") || row.path.includes("authtoken"))).toBe(false);
    expect(duringRefusal.filter((row) => row.path.includes("conversationId"))).toHaveLength(1);
  });

  it("stops following next links after 50 pages", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({ id: "only", conversationId: "conv", parentFolderId: "inbox", subject: "Only" });
    microsoft.poisonNextLink = `${microsoft.graphBase}/v1.0/me/messages?$top=1`;
    const app = await boot("direct", microsoft);
    const before = microsoft.recorded().length;
    const overflow = await call(app, "get_thread", { account: "ms_box", threadId: "conv" });
    expect(overflow.isError).toBe(true);
    expect(overflow.data.code).toBe("upstream_error");
    const pages = microsoft.recorded().slice(before).filter((row) => row.method === "GET" && row.path.includes("/v1.0/me/messages"));
    expect(pages).toHaveLength(50);
  });

  it("uses createReplyAll and keeps the recipients Outlook calculated", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.addMessage({
      id: "incoming",
      parentFolderId: "inbox",
      conversationId: "conv-in",
      subject: "Hello",
      from: { emailAddress: { address: "alex@example.com" } },
      toRecipients: [
        { emailAddress: { address: "owner@outlook.example" } },
        { emailAddress: { address: "sam@example.com" } },
      ],
      ccRecipients: [{ emailAddress: { address: "pat@example.com" } }],
      internetMessageId: "<incoming@mail.example>",
    });
    microsoft.addMessage({
      id: "mine",
      parentFolderId: "sentitems",
      conversationId: "conv-mine",
      subject: "Ping",
      from: { emailAddress: { address: "owner@outlook.example" } },
      toRecipients: [{ emailAddress: { address: "lee@example.com" } }],
      internetMessageId: "<mine@mail.example>",
    });
    const app = await boot("direct", microsoft);

    const reply = await call(app, "reply", { account: "ms_box", messageId: "incoming", body: "Thanks", replyAll: false });
    expect(reply.isError, JSON.stringify(reply.data)).toBe(false);
    expect(reply.data.threadId).toBe("conv-in");
    const replyRequest = microsoft.recorded().find((row) => row.path.endsWith("/incoming/createReply"));
    const replyMessage = JSON.parse(replyRequest?.body ?? "{}") as { message?: Json };
    expect(replyMessage.message?.toRecipients).toBeUndefined();
    expect(replyMessage.message?.ccRecipients).toBeUndefined();
    expect(replyMessage.message?.subject).toBeUndefined();
    expect(replyMessage.message?.internetMessageHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "In-Reply-To", value: "<incoming@mail.example>" }),
    ]));
    const replyThread = await call(app, "get_thread", { account: "ms_box", threadId: "conv-in" });
    const replySent = (replyThread.data.messages as Array<{ id: string; toRecipients: string[]; ccRecipients: string[]; subject: string }>)
      .find((item) => item.id === reply.data.id);
    expect(replySent?.toRecipients).toEqual(["alex@example.com"]);
    expect(replySent?.ccRecipients).toEqual([]);
    expect(replySent?.subject).toBe("Re: Hello");

    const all = await call(app, "reply", { account: "ms_box", messageId: "incoming", body: "Everyone", replyAll: true });
    expect(all.isError, JSON.stringify(all.data)).toBe(false);
    const allRequest = microsoft.recorded().find((row) => row.path.endsWith("/incoming/createReplyAll"));
    const allMessage = JSON.parse(allRequest?.body ?? "{}") as { message?: Json };
    expect(allMessage.message?.toRecipients).toBeUndefined();
    expect(allMessage.message?.ccRecipients).toBeUndefined();
    const allThread = await call(app, "get_thread", { account: "ms_box", threadId: "conv-in" });
    const allSent = (allThread.data.messages as Array<{ id: string; toRecipients: string[]; ccRecipients: string[] }>)
      .find((item) => item.id === all.data.id);
    expect(allSent?.toRecipients).toEqual(["alex@example.com", "sam@example.com"]);
    expect(allSent?.ccRecipients).toEqual(["pat@example.com"]);

    const edited = await call(app, "reply", {
      account: "ms_box",
      messageId: "incoming",
      body: "Edited",
      replyAll: true,
      cc: ["extra@example.com"],
    });
    expect(edited.isError, JSON.stringify(edited.data)).toBe(false);
    const editedRequest = microsoft.recorded().filter((row) => row.path.endsWith("/incoming/createReplyAll")).at(-1);
    const editedMessage = JSON.parse(editedRequest?.body ?? "{}") as { message?: { ccRecipients?: unknown; toRecipients?: unknown } };
    expect(editedMessage.message?.toRecipients).toBeUndefined();
    expect(editedMessage.message?.ccRecipients).toEqual([{ emailAddress: { address: "extra@example.com" } }]);
    const editedThread = await call(app, "get_thread", { account: "ms_box", threadId: "conv-in" });
    const editedSent = (editedThread.data.messages as Array<{ id: string; toRecipients: string[]; ccRecipients: string[] }>)
      .find((item) => item.id === edited.data.id);
    expect(editedSent?.toRecipients).toEqual(["alex@example.com", "sam@example.com"]);
    expect(editedSent?.ccRecipients).toEqual(["extra@example.com"]);

    const follow = await call(app, "send_message", {
      account: "ms_box",
      to: ["other@example.com"],
      subject: "Re: Ping",
      body: "Again",
      replyToMessageId: "mine",
    });
    expect(follow.isError, JSON.stringify(follow.data)).toBe(false);
    expect(follow.data.threadId).toBe("conv-mine");
    const followRequest = microsoft.recorded().find((row) => row.path.endsWith("/mine/createReply"));
    expect(followRequest?.path.endsWith("/createReplyAll")).toBe(false);
    expect(followRequest?.body).toContain("other@example.com");
    expect(followRequest?.body).toContain("In-Reply-To");
    expect(followRequest?.body).toContain("<mine@mail.example>");
    const followThread = await call(app, "get_thread", { account: "ms_box", threadId: "conv-mine" });
    const followSent = (followThread.data.messages as Array<{ id: string; toRecipients: string[] }>)
      .find((item) => item.id === follow.data.id);
    expect(followSent?.toRecipients).toEqual(["other@example.com"]);

    const own = await call(app, "reply", { account: "ms_box", messageId: "mine", body: "Still on this", replyAll: false });
    expect(own.isError, JSON.stringify(own.data)).toBe(false);
    const ownRequest = microsoft.recorded().filter((row) => row.path.endsWith("/mine/createReply")).at(-1);
    const ownMessage = JSON.parse(ownRequest?.body ?? "{}") as { message?: Json };
    expect(ownMessage.message?.toRecipients).toBeUndefined();
    const ownThread = await call(app, "get_thread", { account: "ms_box", threadId: "conv-mine" });
    const ownSent = (ownThread.data.messages as Array<{ id: string; toRecipients: string[]; ccRecipients: string[] }>)
      .find((item) => item.id === own.data.id);
    expect(ownSent?.toRecipients).toEqual(["lee@example.com"]);
    expect(ownSent?.ccRecipients).toEqual([]);
  });

  it("chunks an Outlook upload on outlook.office.com and keeps the bytes", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    const app = await boot("direct", microsoft);
    const watch = watchFetch(microsoft);
    const provider = uploadingProvider(app, microsoft, { uploadChunkBytes: 8, inlineBytes: 0, fetchImpl: watch.fetchImpl });
    const raw = Buffer.alloc(20, 0x61);
    const draft = await provider.createDraft("ms_box", fileDraft(raw));
    const puts = putRows(microsoft);
    expect(puts.map((row) => row.headers["content-range"])).toEqual([
      "bytes 0-7/20",
      "bytes 8-15/20",
      "bytes 16-19/20",
    ]);
    for (const row of puts) {
      expect(row.headers.authorization).toBeUndefined();
      expect(row.headers["content-type"]).toBe("application/octet-stream");
    }
    const uploads = watch.seen.filter((url) => new URL(url).hostname === OUTLOOK_UPLOAD_HOST);
    expect(uploads).toHaveLength(3);
    for (const url of uploads) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.hostname).toBe(OUTLOOK_UPLOAD_HOST);
      expect(parsed.searchParams.get("authtoken")).toBe("synthetic");
    }
    expect(watch.seen.some((url) => url.includes("evil.example"))).toBe(false);
    expect(microsoft.uploadedBytes(draft.id).equals(raw)).toBe(true);
    expect(draft.attachments.map((item) => item.filename)).toContain("notes.bin");
    expect(puts).toHaveLength(3);
  });

  it("refuses an untrusted upload URL before any PUT", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    const logs: string[] = [];
    const app = await boot("direct", microsoft, {}, logs);
    const watch = watchFetch(microsoft);
    const provider = uploadingProvider(app, microsoft, { inlineBytes: 0, fetchImpl: watch.fetchImpl });
    const urls = [
      "https://evil.example/put?authtoken=secret",
      "https://outlook.office.com.evil.com/put?authtoken=secret",
      "http://outlook.office.com/put?authtoken=secret",
      "https://user:pass@outlook.office.com/put?authtoken=secret",
      "https://127.0.0.1/put?authtoken=secret",
      "https://outlook.office.com:8443/put?authtoken=secret",
    ];
    for (const url of urls) {
      microsoft.nextUploadUrl = url;
      const before = putRows(microsoft).length;
      const seenBefore = watch.seen.length;
      await expect(provider.createDraft("ms_box", fileDraft(Buffer.alloc(20, 0x62))), url).rejects.toMatchObject({
        name: "ToolError",
        code: "tool_error",
        message: "Refusing a Microsoft upload URL.",
        retryable: false,
      });
      expect(putRows(microsoft)).toHaveLength(before);
      const fresh = watch.seen.slice(seenBefore);
      expect(fresh.every((item) => new URL(item).hostname === "127.0.0.1"), url).toBe(true);
      expect(fresh.some((item) => item.includes("authtoken") || item.includes("evil.example")), url).toBe(false);
    }
    const spoken = logs.join("\n");
    expect(spoken).not.toContain("authtoken");
    expect(spoken).not.toContain("secret");
    expect(spoken).not.toContain("user:pass");
    expect(spoken).not.toContain("evil.example");
  });

  it("refuses a Microsoft upload redirect and does not follow it", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.uploadMode = "redirect";
    const app = await boot("direct", microsoft);
    const watch = watchFetch(microsoft);
    const provider = uploadingProvider(app, microsoft, { inlineBytes: 0, fetchImpl: watch.fetchImpl });
    let caught: unknown;
    try {
      await provider.createDraft("ms_box", fileDraft(Buffer.alloc(20, 0x63)));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolError);
    const error = caught as ToolError;
    expect(error.code).toBe("tool_error");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Refusing a Microsoft upload redirect.");
    expect(error.message).not.toContain("evil.example");
    expect(error.message).not.toContain("authtoken");
    expect(putRows(microsoft)).toHaveLength(1);
    expect(watch.seen.some((url) => url.includes("evil.example"))).toBe(false);
    const draft = microsoft.snapshot().find((item) => item.subject === "file");
    expect(draft).toBeTruthy();
    expect(microsoft.uploadedBytes(draft?.id ?? "")).toHaveLength(0);
  });

  it("stops an upload when the next range is wrong and does not retry", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.uploadMode = "bad-range";
    const app = await boot("direct", microsoft);
    const provider = uploadingProvider(app, microsoft, { uploadChunkBytes: 8, inlineBytes: 0 });
    await expect(provider.createDraft("ms_box", fileDraft(Buffer.alloc(20, 0x64)))).rejects.toMatchObject({
      code: "upstream_error",
      message: "The provider failed.",
      retryable: false,
    });
    expect(putRows(microsoft)).toHaveLength(1);
    expect(putRows(microsoft)[0]?.headers["content-range"]).toBe("bytes 0-7/20");
  });

  it("does not retry a rejected upload chunk", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    live.push(microsoft);
    microsoft.uploadMode = "reject";
    const app = await boot("direct", microsoft);
    const provider = uploadingProvider(app, microsoft, { uploadChunkBytes: 8, inlineBytes: 0 });
    await expect(provider.createDraft("ms_box", fileDraft(Buffer.alloc(20, 0x65)))).rejects.toMatchObject({
      code: "upstream_error",
      message: "The provider failed.",
      retryable: false,
    });
    expect(putRows(microsoft)).toHaveLength(1);
    const draft = microsoft.snapshot().find((item) => item.subject === "file");
    expect(microsoft.uploadedBytes(draft?.id ?? "")).toHaveLength(0);
  });
});
