import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "../auth/resource.js";
import { loadConfig } from "../config.js";
import { Logger } from "../log.js";
import { capabilitiesFor } from "../providers/capabilities.js";
import { FakeGmailServer } from "../providers/gmail-fake-server.js";
import { GmailProvider } from "../providers/gmail.js";
import { makeProvider } from "../providers/index.js";
import { ImapProvider } from "../providers/imap.js";
import { MicrosoftProvider } from "../providers/microsoft.js";
import { ProviderRouter, type RoutedKind } from "../providers/router.js";
import type {
  AccountRecord,
  DraftRecord,
  FilterAction,
  FilterCriteria,
  FilterRecord,
  ForwardInput,
  LabelRecord,
  MailMessage,
  MailProvider,
  MailThread,
  OutgoingDraft,
  ProviderSearchPage,
  ReplyInput,
  SendAsRecord,
  SentResult,
} from "../providers/types.js";
import { Repo } from "../store/repo.js";
import { openSql } from "../store/sql.js";
import type { Clock } from "../sync/clock.js";
import { createServer, type Running } from "./app.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const PASSPHRASE = "correct-horse-battery-staple";
const CRON = "cron-secret-DO-NOT-LOG-77";
const REFRESH = "refresh-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const JOBS_SECRET = "jobs-leak-DO-NOT-LOG-9f3c";
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

const GMAIL_CAPS = { filters: true, sendAs: true, labels: "labels" };
const IMAP_CAPS = { filters: false, sendAs: true, labels: "folders" };

const TOOLS: Array<{ name: string; input: Record<string, unknown> }> = [
  { name: "search_threads", input: { query: "in:inbox" } },
  { name: "get_thread", input: { threadId: "t1" } },
  { name: "get_message", input: { messageId: "m1" } },
  { name: "list_labels", input: {} },
  { name: "list_drafts", input: {} },
  { name: "get_draft", input: { draftId: "d1" } },
  { name: "list_send_as", input: {} },
  { name: "list_filters", input: {} },
  { name: "search_contacts", input: { query: "alex" } },
  { name: "create_label", input: { displayName: "Later" } },
  { name: "label_thread", input: { threadId: "t1", labelIds: ["STARRED"] } },
  { name: "unlabel_thread", input: { threadId: "t1", labelIds: ["STARRED"] } },
  { name: "create_draft", input: { to: "lee@example.com", subject: "Hi", body: "Hello" } },
  { name: "update_draft", input: { draftId: "d1", body: "Updated" } },
  { name: "delete_draft", input: { draftId: "d1" } },
  { name: "send_message", input: { to: "lee@example.com", subject: "Hi", body: "Hello" } },
  { name: "reply", input: { messageId: "m1", body: "Thanks" } },
  { name: "forward", input: { messageId: "m1", to: "lee@example.com" } },
  { name: "create_filter", input: { criteria: { from: "news@example.com" }, action: { skipInbox: true } } },
  { name: "delete_filter", input: { filterId: "f1" } },
];

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-app.mjs"], { cwd: serverDir, stdio: "pipe" });
});

function message(id: string): MailMessage {
  return {
    id,
    threadId: "t1",
    position: 0,
    sender: "a@example.com",
    toRecipients: ["lee@example.com"],
    ccRecipients: [],
    bccRecipients: [],
    replyTo: [],
    inReplyTo: "",
    references: "",
    subject: "Hi",
    date: "2026-11-05T15:00:00.000Z",
    labelIds: [],
    snippet: "",
    plaintextBody: "Hello",
    htmlBody: null,
    attachments: [],
    raw: "raw",
    viewUrl: "https://example.invalid/t1",
    bodyFetched: true,
  };
}

function draft(): DraftRecord {
  return {
    id: "d1",
    messageId: "m1",
    threadId: "t1",
    subject: "Hi",
    toRecipients: ["lee@example.com"],
    ccRecipients: [],
    bccRecipients: [],
    date: "2026-11-05T15:00:00.000Z",
    snippet: "",
    plaintextBody: "Hello",
    htmlBody: null,
    attachments: [],
    labelIds: [],
    raw: "raw",
    viewUrl: "https://example.invalid/d1",
    bodyFetched: true,
    inReplyTo: "",
    references: "",
  };
}

function sent(): SentResult {
  return { id: "sent1", threadId: "t1", labelIds: ["SENT"], message: message("sent1") };
}

class Probe implements MailProvider {
  hits = 0;
  failListLabels: Error | null = null;

  constructor(readonly kind: "gmail" | "imap" | "microsoft") {}

  private touch(): void {
    this.hits += 1;
  }

  listAccounts(): AccountRecord[] {
    this.touch();
    return [];
  }

  async searchPage(): Promise<ProviderSearchPage> {
    this.touch();
    return { hits: [], nextPageToken: null, resultCountEstimate: 0 };
  }

  async listThreadMeta(): Promise<MailThread[]> {
    this.touch();
    return [];
  }

  async getThread(): Promise<MailThread | null> {
    this.touch();
    return {
      id: "t1",
      snippet: "",
      messageCount: 1,
      viewUrl: "https://example.invalid/t1",
      historyId: null,
      messages: [message("m1")],
    };
  }

  async getMessageRaw(): Promise<{ id: string; raw: string } | null> {
    this.touch();
    return { id: "m1", raw: "raw" };
  }

  async listLabels(): Promise<LabelRecord[]> {
    this.touch();
    if (this.failListLabels) throw this.failListLabels;
    return [];
  }

  async listDraftMeta(): Promise<DraftRecord[]> {
    this.touch();
    return [];
  }

  async getDraft(): Promise<DraftRecord | null> {
    this.touch();
    return draft();
  }

  async listSendAs(): Promise<SendAsRecord[]> {
    this.touch();
    return [];
  }

  async listFilters(): Promise<FilterRecord[]> {
    this.touch();
    return [];
  }

  async createLabel(_accountId: string, displayName: string): Promise<LabelRecord> {
    this.touch();
    return { labelId: "L1", name: displayName, labelType: "USER" };
  }

  async labelThread(): Promise<void> {
    this.touch();
  }

  async unlabelThread(): Promise<void> {
    this.touch();
  }

  async modifyThread(): Promise<void> {
    this.touch();
  }

  async createDraft(): Promise<DraftRecord> {
    this.touch();
    return draft();
  }

  async updateDraft(): Promise<DraftRecord> {
    this.touch();
    return draft();
  }

  async deleteDraft(): Promise<void> {
    this.touch();
  }

  async sendMessage(_accountId: string, _input: OutgoingDraft): Promise<SentResult> {
    this.touch();
    return sent();
  }

  async reply(_accountId: string, _input: ReplyInput): Promise<SentResult> {
    this.touch();
    return sent();
  }

  async forward(_accountId: string, _input: ForwardInput): Promise<SentResult> {
    this.touch();
    return sent();
  }

  async createFilter(_accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord> {
    this.touch();
    return { id: "f1", criteria, action };
  }

  async deleteFilter(): Promise<void> {
    this.touch();
  }
}

function manualClock(): Clock & { advance(ms: number): void } {
  let current = Date.parse("2026-11-05T15:00:00.000Z");
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

function baseEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    OWNER_TOKEN: TOKEN,
    OWNER_PASSPHRASE: PASSPHRASE,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "fake",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    ...extra,
  };
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function https(
  app: Running,
  method: string,
  path: string,
  options: { cookie?: string; body?: string; type?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
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
    }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (options.body !== undefined) req.end(payload);
    else req.end();
  });
}

function parseMcp(text: string): Record<string, unknown> | null {
  if (!text) return null;
  if (text.includes("\ndata:") || text.startsWith("data:") || text.startsWith("event:")) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    const last = lines.at(-1);
    return last ? JSON.parse(last) as Record<string, unknown> : null;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function mcpCall(app: Running, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: Record<string, unknown> }> {
  const res = await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Record<string, unknown> : {} };
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
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane5", version: "0" } },
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
  expect(page.status, page.text.slice(0, 180)).toBe(200);
  return { cookie, csrf: pageCsrf(page.text) };
}

function storeOf(rows: AccountRecord[]): Repo {
  return {
    async listAccounts() { return rows; },
    async getImapMailbox() { return null; },
    async tokenCiphertext() { return null; },
  } as unknown as Repo;
}

function slotsOf(gmail: Probe, imap: Probe, microsoft: Probe): Map<RoutedKind, MailProvider> {
  return new Map<RoutedKind, MailProvider>([
    ["gmail", gmail],
    ["imap", imap],
    ["microsoft", microsoft],
  ]);
}

describe("provider router", () => {
  it("copies the capability row and lets a fake mirror the kind it pretends to be", () => {
    expect(capabilitiesFor("gmail")).toEqual(GMAIL_CAPS);
    expect(capabilitiesFor("imap")).toEqual(IMAP_CAPS);
    expect(capabilitiesFor("microsoft")).toEqual(GMAIL_CAPS);
    expect(capabilitiesFor("fake", "imap")).toEqual(capabilitiesFor("imap"));
    const row = capabilitiesFor("gmail");
    row.filters = false;
    expect(capabilitiesFor("gmail").filters).toBe(true);
  });

  it("keeps Gmail off until its client exists and refuses the other stubs before fetch", async () => {
    let called = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called += 1;
      throw new Error("network");
    }) as typeof fetch;
    try {
      const key = randomBytes(32).toString("base64");
      const rows: AccountRecord[] = [
        { id: "gmail_a", email: "a@example.com", label: "Gmail", kind: "gmail" },
        { id: "imap_a", email: "b@example.com", label: "IMAP", kind: "imap" },
        { id: "ms_a", email: "c@example.com", label: "Microsoft", kind: "microsoft" },
      ];
      const store = storeOf(rows);
      const logger = new Logger();
      const live = loadConfig({
        OWNER_TOKEN: TOKEN,
        ENCRYPTION_KEY: key,
        NODE_ENV: "test",
        MAIL_PROVIDER: "live",
        OWNER_TIMEZONE: "UTC",
      });
      const liveRouter = makeProvider({ config: live, store, logger });
      expect(liveRouter).toBeInstanceOf(ProviderRouter);
      expect((liveRouter as ProviderRouter).providerFor({ kind: "gmail" })).toBeUndefined();
      await expect(liveRouter.getThread("gmail_a", "t1")).rejects.toThrow(/Google sign-in is not set up/);
      const gmail = loadConfig({
        OWNER_TOKEN: TOKEN,
        ENCRYPTION_KEY: key,
        NODE_ENV: "test",
        MAIL_PROVIDER: "gmail",
        OWNER_TIMEZONE: "UTC",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      });
      const gmailRouter = makeProvider({ config: gmail, store, logger });
      expect(gmailRouter).toBeInstanceOf(ProviderRouter);
      const routed = gmailRouter as ProviderRouter;
      expect(routed.providerFor({ kind: "gmail" })).toBeInstanceOf(GmailProvider);
      expect(routed.providerFor({ kind: "imap" })).toBeInstanceOf(ImapProvider);
      expect(routed.providerFor({ kind: "microsoft" })).toBeUndefined();
      await expect(gmailRouter.getThread("imap_a", "t1")).rejects.toThrow(/Connect this account again/);
      await expect(gmailRouter.getThread("ms_a", "t1")).rejects.toThrow(/Microsoft sign-in is not set up/);
      const withMicrosoft = loadConfig({
        OWNER_TOKEN: TOKEN,
        ENCRYPTION_KEY: key,
        NODE_ENV: "test",
        MAIL_PROVIDER: "gmail",
        OWNER_TIMEZONE: "UTC",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        MICROSOFT_CLIENT_ID: "ms-client",
      });
      const msRouter = makeProvider({ config: withMicrosoft, store, logger });
      expect((msRouter as ProviderRouter).providerFor({ kind: "imap" })).toBeInstanceOf(ImapProvider);
      expect((msRouter as ProviderRouter).providerFor({ kind: "microsoft" })).toBeInstanceOf(MicrosoftProvider);
      expect(called).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses an imap or microsoft tool call over MCP before any network", async () => {
    let called = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called += 1;
      throw new Error("network");
    }) as typeof fetch;
    const app = await createServer(baseEnv({
      MAIL_PROVIDER: "gmail",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      OWNER_TIMEZONE: "UTC",
    }));
    try {
      await app.store.upsertAccount({ id: "imap_a", email: "b@example.com", label: "IMAP", kind: "imap" }, 1);
      await app.store.upsertAccount({ id: "ms_a", email: "c@example.com", label: "Microsoft", kind: "microsoft" }, 2);
      await initialize(app);
      const read = await mcpCall(app, "list_labels", { account: "imap_a" });
      expect(read.isError).toBe(true);
      expect(String(read.data.message)).toContain("Connect this account again.");
      const write = await mcpCall(app, "send_message", {
        account: "ms_a",
        to: "lee@example.com",
        subject: "Hi",
        body: "Hello",
      });
      expect(write.isError).toBe(true);
      expect(String(write.data.message)).toContain("Microsoft sign-in is not set up.");
      const missing = await mcpCall(app, "get_thread", { account: "missing", threadId: "t1" });
      expect(missing.isError).toBe(true);
      expect(String(missing.data.message)).toContain("Unknown account.");
      expect(called).toBe(0);
    } finally {
      globalThis.fetch = original;
      await app.close();
    }
  });

  it("syncs the accounts that can sync when one Gmail account has no token", async () => {
    const gmail = await FakeGmailServer.scripted();
    const logs: string[] = [];
    const app = await createServer(baseEnv({
      MAIL_PROVIDER: "gmail",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      OWNER_TIMEZONE: "UTC",
      GMAIL_API_BASE: gmail.apiBase,
      GOOGLE_TOKEN_URL: gmail.tokenUrl,
    }), { logSink: (line) => logs.push(line) });
    try {
      await app.store.upsertAccount({ id: "gmail_broken", email: "broken@example.com", label: "Broken", kind: "gmail" }, 1);
      await app.store.upsertAccount({ id: "imap_a", email: "b@example.com", label: "IMAP", kind: "imap" }, 2);
      await app.store.upsertAccount({ id: "ms_a", email: "c@example.com", label: "Microsoft", kind: "microsoft" }, 3);
      await app.store.upsertAccount({ id: "gmail_ok", email: "ok@example.com", label: "Ok", kind: "gmail" }, 4);
      await app.store.upsertToken("gmail_ok", app.config.encryptionKey, JSON.stringify({
        refreshToken: REFRESH,
        accessToken: ACCESS,
        expiresAt: Date.now() + 3_600_000,
      }));
      await initialize(app);
      const result = await mcpCall(app, "sync_now", {});
      expect(result.isError).toBe(false);
      const rows = result.data.accounts as Array<{ account: string; synced: boolean; note?: string; code?: string }>;
      expect(rows).toEqual([
        { account: "gmail_broken", synced: false, note: "sync failed", code: "needs_reauth" },
        { account: "imap_a", synced: false, note: "sync failed", code: "needs_reauth" },
        { account: "ms_a", synced: false, note: "sync is not available for this provider" },
        { account: "gmail_ok", synced: true },
      ]);
      const log = logs.join("\n");
      expect(log).toContain("sync failed");
      expect(log).toContain("gmail_broken");
      expect(log).toContain("ToolError");
      expect(log).not.toContain(REFRESH);
      expect(log).not.toContain(ACCESS);
      expect(log).not.toContain("Connect this account again.");
      expect(gmail.requests.some((item) => item.path.includes("/profile"))).toBe(true);
    } finally {
      await app.close();
      await gmail.close();
    }
  });

  it("keeps going when one account's jobs throw and does not log the message", async () => {
    const env = baseEnv({ CRON_SECRET: CRON });
    const sql = await openSql(loadConfig(env));
    const shared = new Repo(sql);
    const gmail = new Probe("gmail");
    const imap = new Probe("imap");
    imap.failListLabels = new Error(`leak ${JOBS_SECRET}`);
    const microsoft = new Probe("microsoft");
    const router = new ProviderRouter(shared, slotsOf(gmail, imap, microsoft));
    const logs: string[] = [];
    const app = await createServer(env, {
      sql,
      provider: router,
      logSink: (line) => logs.push(line),
    });
    try {
      await app.store.upsertAccount({ id: "gmail_a", email: "a@example.com", label: "Gmail", kind: "gmail" }, 1);
      await app.store.upsertAccount({ id: "imap_a", email: "b@example.com", label: "IMAP", kind: "imap" }, 2);
      await app.store.upsertAccount({ id: "ms_a", email: "c@example.com", label: "Microsoft", kind: "microsoft" }, 3);
      const res = await https(app, "POST", "/api/cron/jobs", {
        type: "application/json",
        headers: { authorization: `Bearer ${CRON}` },
        body: "{}",
      });
      expect(res.status, res.text).toBe(200);
      expect(res.text).not.toContain(JOBS_SECRET);
      expect(gmail.hits).toBeGreaterThan(0);
      expect(imap.hits).toBeGreaterThan(0);
      expect(microsoft.hits).toBeGreaterThan(0);
      const log = logs.join("\n");
      expect(log).toContain("jobs failed");
      expect(log).toContain("imap_a");
      expect(log).toContain("\"name\":\"Error\"");
      expect(log).not.toContain(JOBS_SECRET);
    } finally {
      await app.close();
      await sql.close();
    }
  });
});

describe.each(["mirror", "direct"] as const)("router isolation %s", (mode) => {
  it("sends every tool to that account's provider on /mcp and /app/api/call", async () => {
    const env = baseEnv({ MAIL_MODE: mode });
    const sql = await openSql(loadConfig(env));
    const shared = new Repo(sql);
    const gmail = new Probe("gmail");
    const imap = new Probe("imap");
    const microsoft = new Probe("microsoft");
    const router = new ProviderRouter(shared, slotsOf(gmail, imap, microsoft));
    const clock = manualClock();
    const app = await createServer(env, { sql, provider: router, clock });
    try {
      await app.store.upsertAccount({ id: "gmail_a", email: "a@example.com", label: "Gmail", kind: "gmail" }, 1);
      await app.store.upsertAccount({ id: "imap_a", email: "b@example.com", label: "IMAP", kind: "imap" }, 2);
      await app.store.upsertAccount({ id: "ms_a", email: "c@example.com", label: "Microsoft", kind: "microsoft" }, 3);
      await initialize(app);
      let owner = await signIn(app);
      // Each call jumps the clock past the jobs interval. That walk is longer
      // than the owner session, so sign in again when the injected clock expires it.
      let sessionUntil = clock.now() + SESSION_TTL_MS;
      const accounts = [
        { id: "gmail_a", probe: gmail },
        { id: "imap_a", probe: imap },
        { id: "ms_a", probe: microsoft },
      ];
      const probes = [gmail, imap, microsoft];

      async function callOne(transport: "mcp" | "app", name: string, args: Record<string, unknown>): Promise<void> {
        clock.advance(6 * 60 * 1000);
        if (clock.now() >= sessionUntil) {
          owner = await signIn(app);
          sessionUntil = clock.now() + SESSION_TTL_MS;
        }
        const before = probes.map((probe) => probe.hits);
        if (transport === "mcp") {
          await mcpCall(app, name, args);
        } else {
          const appRes = await https(app, "POST", "/app/api/call", {
            cookie: owner.cookie,
            type: "application/json",
            headers: { "x-cbm-csrf": owner.csrf },
            body: JSON.stringify({ tool: name, input: args }),
          });
          expect(appRes.status, `${name} ${appRes.text}`).toBeLessThan(500);
        }
        const after = probes.map((probe) => probe.hits);
        const target = accounts.findIndex((item) => item.id === args.account);
        for (let i = 0; i < probes.length; i += 1) {
          if (i === target) {
            expect(after[i], `${transport} ${name} ${String(args.account)}`).toBeGreaterThan(before[i] ?? 0);
          } else {
            expect(after[i], `${transport} ${name} leaked to ${probes[i]?.kind}`).toBe(before[i]);
          }
        }
      }

      for (const tool of TOOLS) {
        for (const account of accounts) {
          const args = { ...tool.input, account: account.id };
          await callOne("mcp", tool.name, args);
          await callOne("app", tool.name, args);
        }
      }

      const beforeMissing = probes.map((probe) => probe.hits);
      const missingRead = await mcpCall(app, "get_thread", { account: "missing", threadId: "t1" });
      expect(missingRead.isError).toBe(true);
      expect(String(missingRead.data.message)).toContain("Unknown account.");
      const missingWrite = await https(app, "POST", "/app/api/call", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body: JSON.stringify({ tool: "create_label", input: { account: "missing", displayName: "Nope" } }),
      });
      expect(missingWrite.status).toBeGreaterThanOrEqual(400);
      expect(missingWrite.text).toContain("Unknown account.");
      expect(probes.map((probe) => probe.hits)).toEqual(beforeMissing);

      const listed = await mcpCall(app, "list_accounts", {});
      const listedRows = listed.data.accounts as Array<{ id: string; kind: string; capabilities: typeof GMAIL_CAPS }>;
      expect(listedRows.map((row) => row.id)).toEqual(["gmail_a", "imap_a", "ms_a"]);
      expect(listedRows.map((row) => row.kind)).toEqual(["gmail", "imap", "microsoft"]);
      expect(listedRows.map((row) => row.capabilities)).toEqual([GMAIL_CAPS, IMAP_CAPS, GMAIL_CAPS]);

      const beforeSync = probes.map((probe) => probe.hits);
      const synced = await mcpCall(app, "sync_now", {});
      expect(probes.map((probe) => probe.hits)).toEqual(beforeSync);
      const notes = synced.data.accounts as Array<{ account: string; note?: string; synced: boolean }>;
      if (mode === "direct") {
        expect(notes.every((row) => row.note === "direct mode does not sync")).toBe(true);
      } else {
        expect(notes).toEqual([
          { account: "gmail_a", synced: false, note: "sync is not available for this provider" },
          { account: "imap_a", synced: false, note: "sync is not available for this provider" },
          { account: "ms_a", synced: false, note: "sync is not available for this provider" },
        ]);
      }
    } finally {
      await app.close();
      await sql.close();
    }
  }, 120_000);
});
