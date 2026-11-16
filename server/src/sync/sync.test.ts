import { createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Running } from "../http/app.js";
import { FakeGmailServer } from "../providers/gmail-fake-server.js";
import type { Clock } from "./clock.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const CRON = "cron-secret-DO-NOT-LOG-77";
const WRONG_CRON = "wrong-cron-DO-NOT-LOG-88";
const REFRESH = "refresh-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const AUDIENCE = "https://mail.example/push";
const SERVICE_ACCOUNT = "push@example.iam.gserviceaccount.com";
const BODY_SECRET = "BODY-SECRET-DO-NOT-LOG";

type Json = Record<string, unknown>;
type Closer = { close(): Promise<void> };

function pauseAfterOneUnit(): Clock {
  let armed = 0;
  return {
    now() {
      armed += 1;
      return armed % 2 === 1 ? 0 : 100_000;
    },
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function requestTls(
  method: string,
  url: string,
  ca: string,
  headers: Record<string, string>,
  body = "",
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(body);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: { ...headers, "content-length": String(payload.length) },
      ca,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(payload);
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
  const hello = await requestTls("POST", `${app.url}/mcp`, app.cert, {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }, JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane1c", version: "0" } },
  }));
  expect(hello.status).toBe(200);
  await requestTls("POST", `${app.url}/mcp`, app.cert, {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
}

async function call(app: Running, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Json; text: string }> {
  const res = await requestTls("POST", `${app.url}/mcp`, app.cert, {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }));
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {}, text: res.text };
}

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    OWNER_TOKEN: TOKEN,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "gmail",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    OWNER_TIMEZONE: "UTC",
    ...extra,
  };
}

function manualClock(start: number): Clock & { set(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    set(ms: number) {
      current = ms;
    },
  };
}

function postJobs(app: Running): Promise<{ status: number; text: string }> {
  return requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
    authorization: `Bearer ${CRON}`,
    "content-type": "application/json",
  }, "{}");
}

function isLabelOrSearch(path: string): boolean {
  return path.startsWith("/gmail/v1/users/me/labels") || path.startsWith("/gmail/v1/users/me/threads?");
}

async function bootGmail(
  gmail: FakeGmailServer,
  extra: Record<string, string> = {},
  options?: { clock?: Clock },
): Promise<Running> {
  const app = await createServer({
    ...baseEnv(extra),
    GMAIL_API_BASE: gmail.apiBase,
    GOOGLE_TOKEN_URL: gmail.tokenUrl,
  }, options);
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
  return app;
}

function pushKeys(): { privateKey: KeyObject; jwks: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    privateKey,
    jwks: JSON.stringify({ keys: [{ ...jwk, kid: "test-kid", alg: "RS256", use: "sig" }] }),
  };
}

function signJwt(privateKey: KeyObject, payload: Record<string, unknown>, alg = "RS256"): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT", kid: "test-kid" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const signature = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${signature}`;
}

function pushJwt(privateKey: KeyObject, expSeconds = Math.floor(Date.now() / 1000) + 600): string {
  return signJwt(privateKey, {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    email: SERVICE_ACCOUNT,
    email_verified: true,
    exp: expSeconds,
  });
}

function pushBody(email: string, historyId: string, secret = ""): string {
  const data = Buffer.from(JSON.stringify({
    emailAddress: email,
    historyId,
    text: secret,
  })).toString("base64url");
  return JSON.stringify({ message: { data, messageId: "m1" }, subscription: "projects/p/subscriptions/s" });
}

describe("sync and jobs", () => {
  const live: Closer[] = [];

  afterEach(async () => {
    while (live.length > 0) {
      const item = live.pop();
      if (item) await item.close();
    }
  });

  it("finishes a backfill larger than one time budget without misses or duplicates", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const when = daysAgo(2);
    gmail.addThread({ id: "a", messageId: "ma", from: "Ada <ada@example.com>", to: "alex@riveralabs.example", subject: "A", date: when, body: "alpha" });
    gmail.addThread({ id: "b", messageId: "mb", from: "Bea <bea@example.com>", to: "alex@riveralabs.example", subject: "B", date: when, body: "beta" });
    gmail.addThread({ id: "c", messageId: "mc", from: "Cal <cal@example.com>", to: "alex@riveralabs.example", subject: "C", date: when, body: "gamma" });
    const app = await bootGmail(gmail, { SYNC_PAGE_SIZE: "1" }, { clock: pauseAfterOneUnit() });
    live.push(app);

    const first = await call(app, "sync_now");
    expect(first.isError).toBe(false);
    expect(first.data).toEqual({ accounts: [{ account: "gmail_work", synced: false, partial: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["ma"]);

    const second = await call(app, "sync_now");
    expect(second.data).toEqual({ accounts: [{ account: "gmail_work", synced: false, partial: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["ma", "mb"]);

    const third = await call(app, "sync_now");
    expect(third.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["ma", "mb", "mc"]);
    expect(new Set(await app.store.listMessageIds("gmail_work")).size).toBe(3);

    const fourth = await call(app, "sync_now");
    expect(fourth.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["ma", "mb", "mc"]);
  });

  it("follows a scripted mailbox through backfill, a new message, a label change, a delete, and an expired historyId", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const when = daysAgo(3);
    gmail.addThread({ id: "keep", messageId: "m-keep", from: "Ada <ada@example.com>", to: "alex@riveralabs.example", subject: "Keep", date: when, body: "stay" });
    gmail.addThread({ id: "drop", messageId: "m-drop", from: "Bea <bea@example.com>", to: "alex@riveralabs.example", subject: "Drop", date: when, body: "go" });
    const app = await bootGmail(gmail, { SYNC_BUDGET_MS: "60000" });
    live.push(app);

    const backfill = await call(app, "sync_now");
    expect(backfill.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["m-drop", "m-keep"]);

    gmail.addThread({ id: "fresh", messageId: "m-fresh", from: "Cal <cal@example.com>", to: "alex@riveralabs.example", subject: "Fresh", date: daysAgo(1), body: "new" });
    const added = await call(app, "sync_now");
    expect(added.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["m-drop", "m-fresh", "m-keep"]);

    gmail.relabel("keep", ["STARRED"], []);
    const labeled = await call(app, "sync_now");
    expect(labeled.isError).toBe(false);
    const kept = await app.store.getThread("gmail_work", "keep");
    expect(kept?.messages[0]?.labelIds).toContain("STARRED");

    gmail.deleteThread("drop");
    const removed = await call(app, "sync_now");
    expect(removed.isError).toBe(false);
    expect(await app.store.getThread("gmail_work", "drop")).toBeNull();
    expect(await app.store.listMessageIds("gmail_work")).toEqual(["m-fresh", "m-keep"]);

    await app.store.replaceSyncedThread("gmail_work", ghost("ghost-empty", ""));
    await app.store.replaceSyncedThread("gmail_work", ghost("ghost-old", "2000-01-01T00:00:00.000Z"));
    await app.store.replaceSyncedThread("gmail_work", ghost("ghost-recent", daysAgo(1)));
    gmail.expireHistory();
    gmail.addThread({ id: "after", messageId: "m-after", from: "Dee <dee@example.com>", to: "alex@riveralabs.example", subject: "After", date: daysAgo(1), body: "back" });
    const resynced = await call(app, "sync_now");
    expect(resynced.isError).toBe(false);
    expect(resynced.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    const ids = await app.store.listMessageIds("gmail_work");
    expect(ids.filter((id) => id === "m-after")).toHaveLength(1);
    expect(ids.filter((id) => id === "m-keep")).toHaveLength(1);
    expect(ids.filter((id) => id === "m-fresh")).toHaveLength(1);
    expect(ids.filter((id) => id === "m-drop")).toHaveLength(0);
    expect(ids.filter((id) => id === "ghost-empty-m")).toHaveLength(1);
    expect(ids.filter((id) => id === "ghost-old-m")).toHaveLength(1);
    expect(ids.filter((id) => id === "ghost-recent-m")).toHaveLength(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not call Gmail while booting", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const app = await bootGmail(gmail);
    live.push(app);
    expect(gmail.recorded()).toEqual([]);
  });

  it("does not sync in direct mode and still wakes a snooze exactly once", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addLabel("S1", "CB/Snooze/2020-01-01");
    gmail.addThread({
      id: "snooze",
      messageId: "m-snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S1"],
    });
    const app = await bootGmail(gmail, { MAIL_MODE: "direct", CRON_SECRET: CRON });
    live.push(app);
    const before = gmail.recorded().length;
    const synced = await call(app, "sync_now");
    expect(synced.data).toEqual({
      accounts: [{ account: "gmail_work", synced: false, note: "direct mode does not sync" }],
    });
    expect(gmail.recorded().length).toBe(before);
    expect(await app.store.countMessages()).toBe(0);

    const first = await requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
      authorization: `Bearer ${CRON}`,
      "content-type": "application/json",
    }, "{}");
    expect(first.status).toBe(200);
    expect(JSON.parse(first.text)).toEqual({ ok: true, woke: 1 });
    const second = await requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
      authorization: `Bearer ${CRON}`,
      "content-type": "application/json",
    }, "{}");
    expect(JSON.parse(second.text)).toEqual({ ok: true, woke: 0 });
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(1);
    expect(gmail.threadLabelIds("snooze")).toEqual(expect.arrayContaining(["INBOX", "UNREAD"]));
    expect(gmail.threadLabelIds("snooze")).not.toContain("S1");
    expect(await app.store.countMessages()).toBe(0);
    expect(await app.store.countThreads()).toBe(0);
    expect(await app.store.listLabels("gmail_work")).toEqual([]);
  });

  it("wakes a due snooze once across a read, a cron call, and a push, and ignores a future label", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const keys = pushKeys();
    gmail.addLabel("S-due", "CB/Snooze/2020-01-01");
    gmail.addLabel("S-later", "CB/Snooze/2999-01-01");
    gmail.addThread({
      id: "snooze",
      messageId: "m-snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S-due", "S-later"],
    });
    const app = await bootGmail(gmail, {
      CRON_SECRET: CRON,
      GMAIL_PUSH_AUDIENCE: AUDIENCE,
      GMAIL_PUSH_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
      GMAIL_PUSH_JWKS: keys.jwks,
    });
    live.push(app);
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));

    const before = gmail.recorded().length;
    const badCron = await requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
      authorization: `Bearer ${WRONG_CRON}`,
      "content-type": "application/json",
    }, "{}");
    const badPush = await requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
      authorization: "Bearer not-a-jwt",
      "content-type": "application/json",
    }, pushBody("alex@riveralabs.example", "1", BODY_SECRET));
    const malformed = await requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
      authorization: `Bearer ${pushJwt(keys.privateKey)}`,
      "content-type": "application/json",
    }, "{not json");
    const unknown = await requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
      authorization: `Bearer ${pushJwt(keys.privateKey)}`,
      "content-type": "application/json",
    }, pushBody("nobody@example.com", "1"));
    expect(badCron.status).toBe(401);
    expect(badPush.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(200);
    expect(JSON.parse(unknown.text)).toEqual({ ok: true, matched: false });
    expect(gmail.recorded().length).toBe(before);
    expect(gmail.threadLabelIds("snooze")).toEqual(expect.arrayContaining(["S-due", "S-later"]));

    const jwt = pushJwt(keys.privateKey);
    const [read, cron, pushed] = await Promise.all([
      call(app, "list_labels"),
      requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
        authorization: `Bearer ${CRON}`,
        "content-type": "application/json",
      }, "{}"),
      requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      }, pushBody("alex@riveralabs.example", gmail.historyId(), BODY_SECRET)),
    ]);
    expect(read.isError).toBe(false);
    expect(cron.status).toBe(200);
    expect(pushed.status).toBe(200);
    const modifies = gmail.recorded().filter((item) => item.method === "POST" && item.path.includes("/modify"));
    expect(modifies).toHaveLength(1);
    expect(gmail.threadLabelIds("snooze")).toEqual(expect.arrayContaining(["INBOX", "UNREAD", "S-later"]));
    expect(gmail.threadLabelIds("snooze")).not.toContain("S-due");
    const blob = `${lines.join("\n")}\n${badCron.text}\n${badPush.text}\n${malformed.text}\n${pushed.text}\n${read.text}`;
    for (const secret of [CRON, WRONG_CRON, jwt, REFRESH, ACCESS, BODY_SECRET, "not-a-jwt"]) {
      expect(blob).not.toContain(secret);
    }
  });

  it("wakes a remind-me when the newest message is the user's and only removes the label otherwise", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addLabel("R1", "CB/Remind/2020-01-01");
    gmail.addThread({
      id: "other",
      messageId: "m-other",
      from: "Lee <lee@makerspace.example>",
      to: "alex@riveralabs.example",
      subject: "Ping",
      date: daysAgo(1),
      body: "hello",
      labelIds: ["R1"],
    });
    gmail.addThread({
      id: "mine",
      messageId: "m-mine",
      from: "Alex <alex@riveralabs.example>",
      to: "lee@makerspace.example",
      subject: "Nudge",
      date: daysAgo(1),
      body: "checking in",
      labelIds: ["R1", "SENT"],
    });
    const app = await bootGmail(gmail, { CRON_SECRET: CRON });
    live.push(app);
    const result = await requestTls("POST", `${app.url}/api/cron/jobs`, app.cert, {
      authorization: `Bearer ${CRON}`,
      "content-type": "application/json",
    }, "{}");
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({ ok: true, woke: 2 });
    expect(gmail.threadLabelIds("other")).toEqual([]);
    expect(gmail.threadLabelIds("mine")).toEqual(expect.arrayContaining(["INBOX", "UNREAD", "SENT"]));
    expect(gmail.threadLabelIds("mine")).not.toContain("R1");
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(2);
  });

  it("refuses cron and push when the guard is missing or wrong and runs nothing", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addLabel("S1", "CB/Snooze/2020-01-01");
    gmail.addThread({
      id: "snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S1"],
    });
    const open = await bootGmail(gmail);
    live.push(open);
    const before = gmail.recorded().length;
    const noSecret = await requestTls("GET", `${open.url}/api/cron/sync`, open.cert, {});
    const noAudience = await requestTls("POST", `${open.url}/api/gmail/push`, open.cert, {
      authorization: "Bearer not-a-jwt",
      "content-type": "application/json",
    }, pushBody("alex@riveralabs.example", "1"));
    expect(noSecret.status).toBe(401);
    expect(noAudience.status).toBe(401);
    expect(gmail.recorded().length).toBe(before);
    expect(gmail.threadLabelIds("snooze")).toContain("S1");
    expect(noSecret.text).not.toContain("not-a-jwt");
  });

  it("keeps a planted body, the cron secret, and the push token out of logs", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const keys = pushKeys();
    gmail.addThread({
      id: "secret",
      messageId: "m-secret",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Quiet",
      date: daysAgo(1),
      body: BODY_SECRET,
    });
    const captured: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return original(chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    try {
      const app = await bootGmail(gmail, {
        CRON_SECRET: CRON,
        GMAIL_PUSH_AUDIENCE: AUDIENCE,
        GMAIL_PUSH_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
        GMAIL_PUSH_JWKS: keys.jwks,
      });
      live.push(app);
      const lines: string[] = [];
      app.logger.setSink((line) => lines.push(line));
      const synced = await call(app, "sync_now");
      expect(synced.isError).toBe(false);
      const jwt = pushJwt(keys.privateKey);
      const badCron = await requestTls("POST", `${app.url}/api/cron/sync`, app.cert, {
        authorization: `Bearer ${WRONG_CRON}`,
      });
      const badPush = await requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      }, "not-json");
      expect(badCron.status).toBe(401);
      expect(badPush.status).toBe(400);
      const blob = `${captured.join("")}\n${lines.join("\n")}\n${synced.text}\n${badCron.text}\n${badPush.text}`;
      for (const secret of [CRON, WRONG_CRON, jwt, REFRESH, ACCESS, BODY_SECRET, CLIENT_SECRET]) {
        expect(blob).not.toContain(secret);
      }
    } finally {
      process.stdout.write = original;
    }
  });

  it("continues a sync when watch fails and posts watch once when it succeeds", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addThread({
      id: "a",
      messageId: "ma",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "A",
      date: daysAgo(1),
      body: "alpha",
    });
    const failing = await bootGmail(gmail, { GMAIL_PUBSUB_TOPIC: "projects/p/topics/mail" });
    live.push(failing);
    const lines: string[] = [];
    failing.logger.setSink((line) => lines.push(line));
    gmail.failNextWrite({ kind: "status", status: 500 });
    const failed = await call(failing, "sync_now");
    expect(failed.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(lines.join("\n")).toContain("watch failed");
    expect(await failing.store.listMessageIds("gmail_work")).toEqual(["ma"]);

    const again = await FakeGmailServer.scripted();
    live.push(again);
    again.addThread({
      id: "a",
      messageId: "ma",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "A",
      date: daysAgo(1),
      body: "alpha",
    });
    const ok = await bootGmail(again, { GMAIL_PUBSUB_TOPIC: "projects/p/topics/mail" });
    live.push(ok);
    const synced = await call(ok, "sync_now");
    expect(synced.isError).toBe(false);
    expect(again.recorded().filter((item) => item.path === "/gmail/v1/users/me/watch")).toHaveLength(1);
    const second = await call(ok, "sync_now");
    expect(second.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    expect(again.recorded().filter((item) => item.path === "/gmail/v1/users/me/watch")).toHaveLength(1);
  });

  it("serves a label change from the store after an incremental sync on read", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addThread({
      id: "keep",
      messageId: "m-keep",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Keep",
      date: daysAgo(1),
      body: "stay",
      labelIds: ["INBOX"],
    });
    const app = await bootGmail(gmail, { SYNC_STALE_MS: "0" });
    live.push(app);
    const synced = await call(app, "sync_now");
    expect(synced.data).toEqual({ accounts: [{ account: "gmail_work", synced: true }] });
    gmail.relabel("keep", ["STARRED"], []);
    const mark = gmail.recorded().length;
    const loaded = await call(app, "get_thread", { threadId: "keep" });
    expect(loaded.isError).toBe(false);
    const messages = loaded.data.messages as Array<{ labelIds: string[] }>;
    expect(messages[0]?.labelIds).toContain("STARRED");
    const added = gmail.recorded().slice(mark);
    expect(added.filter((item) => item.path.includes("/history"))).toHaveLength(1);
    expect(added.filter((item) => item.method === "GET" && item.path.includes("/threads/keep"))).toHaveLength(1);
    expect(added.filter((item) => item.path.includes("/profile"))).toHaveLength(0);
  });

  it("reclaims an unfinished snooze after the lease and wakes that thread once", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const start = Date.parse("2026-11-06T15:00:00.000Z");
    const clock = manualClock(start);
    gmail.addLabel("S1", "CB/Snooze/2020-01-01");
    gmail.addThread({
      id: "snooze",
      messageId: "m-snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S1"],
    });
    const app = await bootGmail(gmail, { CRON_SECRET: CRON }, { clock });
    live.push(app);
    const claimed = await app.store.claimJob(
      "wake:gmail_work:S1:snooze",
      "gmail_work",
      "wake",
      new Date(start).toISOString(),
      { threadId: "snooze", labelId: "S1", kind: "Snooze" },
      new Date(start - 60_000).toISOString(),
    );
    expect(claimed).toBe(true);

    clock.set(start + 9 * 60 * 1000);
    const held = await postJobs(app);
    expect(held.status).toBe(200);
    expect(JSON.parse(held.text)).toEqual({ ok: true, woke: 0 });
    expect(gmail.threadLabelIds("snooze")).toContain("S1");
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(0);

    clock.set(start + 11 * 60 * 1000);
    const woke = await postJobs(app);
    expect(woke.status).toBe(200);
    expect(JSON.parse(woke.text)).toEqual({ ok: true, woke: 1 });
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(1);
    expect(gmail.threadLabelIds("snooze")).toEqual(expect.arrayContaining(["INBOX", "UNREAD"]));
    expect(gmail.threadLabelIds("snooze")).not.toContain("S1");

    clock.set(start + 30 * 60 * 1000);
    const again = await postJobs(app);
    expect(JSON.parse(again.text)).toEqual({ ok: true, woke: 0 });
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(1);
  });

  it("wakes a snooze at 06:00 in OWNER_TIMEZONE and not on the UTC date", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const early = Date.parse("2026-11-06T01:00:00.000Z");
    const beforeMorning = Date.parse("2026-11-06T10:00:00.000Z");
    const morning = Date.parse("2026-11-06T11:00:00.000Z");
    const clock = manualClock(early);
    gmail.addLabel("S6", "CB/Snooze/2026-11-06");
    gmail.addThread({
      id: "tomorrow",
      messageId: "m-tomorrow",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Tomorrow",
      date: "2026-11-05T15:00:00.000Z",
      body: "wake me in the morning",
      labelIds: ["S6"],
    });
    const app = await bootGmail(gmail, {
      CRON_SECRET: CRON,
      OWNER_TIMEZONE: "America/New_York",
    }, { clock });
    live.push(app);

    const evening = await postJobs(app);
    expect(evening.status).toBe(200);
    expect(JSON.parse(evening.text)).toEqual({ ok: true, woke: 0 });
    expect(gmail.threadLabelIds("tomorrow")).toContain("S6");
    expect(gmail.recorded().filter((item) => item.path.includes("/modify"))).toHaveLength(0);

    clock.set(beforeMorning);
    const predawn = await postJobs(app);
    expect(JSON.parse(predawn.text)).toEqual({ ok: true, woke: 0 });
    expect(gmail.threadLabelIds("tomorrow")).toContain("S6");

    clock.set(morning);
    const due = await postJobs(app);
    expect(due.status).toBe(200);
    expect(JSON.parse(due.text)).toEqual({ ok: true, woke: 1 });
    expect(gmail.threadLabelIds("tomorrow")).toEqual(expect.arrayContaining(["INBOX", "UNREAD"]));
    expect(gmail.threadLabelIds("tomorrow")).not.toContain("S6");
  });

  it("runs jobs from a read at most once per five minutes", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addLabel("S1", "CB/Snooze/2020-01-01");
    gmail.addThread({
      id: "snooze",
      messageId: "m-snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S1"],
    });
    const app = await bootGmail(gmail);
    live.push(app);
    const before = gmail.recorded().length;
    const first = await call(app, "list_filters");
    expect(first.isError).toBe(false);
    const firstAdded = gmail.recorded().slice(before);
    expect(firstAdded.some((item) => item.path.startsWith("/gmail/v1/users/me/labels"))).toBe(true);
    expect(firstAdded.some((item) => item.path.startsWith("/gmail/v1/users/me/threads?"))).toBe(true);
    expect(gmail.threadLabelIds("snooze")).toEqual(expect.arrayContaining(["INBOX", "UNREAD"]));
    expect(gmail.threadLabelIds("snooze")).not.toContain("S1");

    const mark = gmail.recorded().length;
    const second = await call(app, "list_filters");
    expect(second.isError).toBe(false);
    const secondAdded = gmail.recorded().slice(mark);
    expect(secondAdded.filter((item) => isLabelOrSearch(item.path))).toEqual([]);
  });

  it("skips a past wake label after a search finds it empty", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    gmail.addLabel("S1", "CB/Snooze/2020-01-01");
    gmail.addThread({
      id: "snooze",
      messageId: "m-snooze",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "Later",
      date: daysAgo(1),
      body: "wake me",
      labelIds: ["S1"],
    });
    const app = await bootGmail(gmail, { CRON_SECRET: CRON });
    live.push(app);
    const searches = () => gmail.recorded().filter((item) => item.method === "GET" && item.path.startsWith("/gmail/v1/users/me/threads?")).length;

    const first = await postJobs(app);
    expect(JSON.parse(first.text)).toEqual({ ok: true, woke: 1 });
    expect(searches()).toBe(1);

    const second = await postJobs(app);
    expect(JSON.parse(second.text)).toEqual({ ok: true, woke: 0 });
    expect(searches()).toBe(2);

    const mark = gmail.recorded().length;
    const third = await postJobs(app);
    expect(JSON.parse(third.text)).toEqual({ ok: true, woke: 0 });
    expect(searches()).toBe(2);
    const added = gmail.recorded().slice(mark);
    expect(added.some((item) => item.path.startsWith("/gmail/v1/users/me/labels"))).toBe(true);
    expect(added.some((item) => item.path.startsWith("/gmail/v1/users/me/threads?"))).toBe(false);
  });

  it("acks a verified push when the sync after it fails", async () => {
    const gmail = await FakeGmailServer.scripted();
    live.push(gmail);
    const keys = pushKeys();
    gmail.addThread({
      id: "a",
      messageId: "ma",
      from: "Ada <ada@example.com>",
      to: "alex@riveralabs.example",
      subject: "A",
      date: daysAgo(1),
      body: "alpha",
    });
    const app = await bootGmail(gmail, {
      GMAIL_PUSH_AUDIENCE: AUDIENCE,
      GMAIL_PUSH_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
      GMAIL_PUSH_JWKS: keys.jwks,
    });
    live.push(app);
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    gmail.failNextRead({ kind: "status", status: 500 }, "/profile");
    const jwt = pushJwt(keys.privateKey);
    const pushed = await requestTls("POST", `${app.url}/api/gmail/push`, app.cert, {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    }, pushBody("alex@riveralabs.example", "1000"));
    expect(pushed.status).toBe(204);
    expect(lines.join("\n")).toContain("push failed");
    expect(pushed.text).not.toContain(jwt);
    expect(pushed.text).not.toContain(BODY_SECRET);
  });

  it("logs the UTC default when the fake provider omits OWNER_TIMEZONE", async () => {
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      lines.push(String(chunk));
      return original.call(process.stdout, chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    try {
      const app = await createServer({
        OWNER_TOKEN: TOKEN,
        ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        MAIL_MODE: "direct",
        MAIL_STORE: "pglite",
        MAIL_PROVIDER: "fake",
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "0",
      });
      live.push(app);
      expect(app.config.ownerTimezone).toBe("UTC");
      expect(app.config.ownerTimezoneDefaulted).toBe(true);
      expect(lines.join("")).toContain("OWNER_TIMEZONE defaulting to UTC");
    } finally {
      process.stdout.write = original;
    }
  });

  it("reports needs_reauth when an IMAP account has no mailbox", async () => {
    const app = await createServer({
      OWNER_TOKEN: TOKEN,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      MAIL_MODE: "mirror",
      MAIL_STORE: "pglite",
      MAIL_PROVIDER: "imap",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "0",
      OWNER_TIMEZONE: "UTC",
    });
    live.push(app);
    await app.store.upsertAccount({
      id: "imap_work",
      email: "alex@riveralabs.example",
      label: "IMAP",
      kind: "imap",
    }, 0);
    await initialize(app);
    const result = await call(app, "sync_now");
    expect(result.data).toEqual({
      accounts: [{ account: "imap_work", synced: false, note: "sync failed", code: "needs_reauth" }],
    });
  });
});

function ghost(id: string, date: string): {
  id: string;
  snippet: string;
  messageCount: number;
  viewUrl: string;
  historyId: null;
  messages: Array<{
    id: string;
    threadId: string;
    position: number;
    sender: string;
    toRecipients: string[];
    ccRecipients: string[];
    bccRecipients: string[];
    replyTo: string[];
    inReplyTo: string;
    references: string;
    subject: string;
    date: string;
    labelIds: string[];
    snippet: string;
    plaintextBody: string;
    htmlBody: null;
    attachments: [];
    raw: null;
    viewUrl: string;
    bodyFetched: boolean;
  }>;
} {
  return {
    id,
    snippet: "",
    messageCount: 1,
    viewUrl: "",
    historyId: null,
    messages: [{
      id: `${id}-m`,
      threadId: id,
      position: 0,
      sender: "ghost@example.com",
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      replyTo: [],
      inReplyTo: "",
      references: "",
      subject: "ghost",
      date,
      labelIds: [],
      snippet: "",
      plaintextBody: "ghost",
      htmlBody: null,
      attachments: [],
      raw: null,
      viewUrl: "",
      bodyFetched: true,
    }],
  };
}
