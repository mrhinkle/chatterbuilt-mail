import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { connect as connectNet, createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import { describe, expect, it } from "vitest";
import { createServer, type Running } from "../http/app.js";
import type { Sql } from "../store/sql.js";

const USER = "owner@example.test";
const PASSWORD = "app-password-1";
const TOKEN = "test-owner-token-do-not-log-0123456789";
const PASSPHRASE = "correct-horse-battery-staple";
const BODY = "alpha beta lantern";

const flavor = env("CBM_IMAP_LIVE_FLAVOR");
const liveDir = env("CBM_IMAP_LIVE_DIR");
const livePort = Number(env("CBM_IMAP_LIVE_PORT"));

describe(`imap live ${flavor}`, () => {
  it("checks every step against Dovecot, not only the tool answer", async () => {
    const lines: string[] = [];
    const captured: Buffer[] = [];
    let now = Date.parse("2026-11-05T12:00:00.000Z");
    const clock = { now: () => now };
    const caPem = readFileSync(`${liveDir}/cert.pem`, "utf8");
    const key = readFileSync(`${liveDir}/key.pem`);
    const smtp = new SMTPServer({
      secure: false,
      key,
      cert: caPem,
      authOptional: false,
      authMethods: ["PLAIN", "LOGIN"],
      onAuth(auth, _session, callback) {
        if (auth.username === USER && auth.password === PASSWORD) callback(null, { user: USER });
        else callback(new Error("535 invalid"));
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          captured.push(Buffer.concat(chunks));
          callback();
        });
      },
    });
    const smtpPort = await listen(smtp);
    const gate = await startGate(livePort);
    const app = await createServer({
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
      IMAP_ALLOW_PRIVATE_HOSTS: "1",
      SYNC_BUDGET_MS: "60000",
      SYNC_STALE_MS: "86400000",
      GMAIL_TIMEOUT_MS: "15000",
    }, {
      logSink: (line) => lines.push(line),
      imap: { caPem },
      clock,
    });
    const raw = new Probe(livePort, caPem);
    try {
      const owner = await signIn(app);
      const connected = await https(app, "POST", "/connect/imap", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body: JSON.stringify({
          email: USER,
          host: "localhost",
          port: gate.port,
          security: "tls",
          user: USER,
          password: PASSWORD,
          smtpHost: "localhost",
          smtpPort,
          aliases: ["ada.alias@example.com"],
        }),
      });
      expect(connected.status, connected.text).toBe(200);
      const account = (JSON.parse(connected.text) as { account?: string }).account ?? "";
      expect(account.startsWith("imap_")).toBe(true);
      await initialize(app);

      const layout = await raw.layout();
      await raw.seed(layout);
      await syncUntil(app, account);

      const inbox = await countQuery(app, account, "in:inbox");
      expect(inbox).toBe(7);
      expect(await countQuery(app, account, "")).toBe(inbox);
      expect(await countQuery(app, account, "from:lee@example.com")).toBe(2);
      expect(await countQuery(app, account, "to:ada@example.com")).toBe(1);
      expect(await countQuery(app, account, "cc:sam@example.com")).toBe(1);
      expect(await countQuery(app, account, "subject:quarterly")).toBe(1);
      expect(await countQuery(app, account, "\"alpha beta\"")).toBe(1);
      expect(await countQuery(app, account, "in:sent")).toBe(1);
      expect(await countQuery(app, account, "in:archive")).toBe(0);
      expect(await countQuery(app, account, "in:drafts")).toBe(0);
      expect(await countQuery(app, account, "in:trash")).toBe(0);
      expect(await countQuery(app, account, "in:spam")).toBe(0);
      const anywhere = await countQuery(app, account, "in:anywhere");
      expect(anywhere).toBe(8);
      expect(await countQuery(app, account, "is:unread")).toBeGreaterThan(0);
      expect(await countQuery(app, account, "is:read")).toBeGreaterThan(0);
      expect(await countQuery(app, account, "is:starred")).toBe(1);
      expect(await countQuery(app, account, "newer_than:3d")).toBe(anywhere - 1);
      expect(await countQuery(app, account, "older_than:3d")).toBe(1);
      expect(await countQuery(app, account, `before:${beforeStamp()}`)).toBe(1);
      expect(await countQuery(app, account, "list:plan.example.com")).toBe(1);
      expect(await countQuery(app, account, "filename:notes.pdf")).toBe(1);
      expect(await countQuery(app, account, "filename:missing.bin")).toBe(0);
      expect(await countQuery(app, account, "has:attachment")).toBeGreaterThan(0);
      expect(await countQuery(app, account, "from:lee@example.com OR from:nobody@example.com")).toBe(2);
      expect(await countQuery(app, account, "is:important")).toBe(0);
      expect(await countQuery(app, account, "category:promotions")).toBe(0);
      expect(await countQuery(app, account, "bogus:nope")).toBe(0);
      expect(await countQuery(app, account, "in:inbox -category:promotions")).toBe(inbox);

      const chain = await call(app, "search_threads", {
        account,
        query: "subject:quarterly",
        view: "THREAD_VIEW_SUMMARY",
      });
      expect(chain.isError, JSON.stringify(chain.data)).toBe(false);
      const threads = chain.data.threads as ThreadRow[];
      expect(threads).toHaveLength(1);
      const threadId = threads[0]?.id ?? "";
      const full = await call(app, "get_thread", { account, threadId, messageFormat: "FULL_CONTENT" });
      expect(full.isError, JSON.stringify(full.data)).toBe(false);
      const messages = full.data.messages as MessageRow[];
      expect(messages.length).toBeGreaterThan(1);
      expect(messages.some((message) => message.labelIds.includes("INBOX"))).toBe(true);
      expect(messages.some((message) => message.labelIds.includes("SENT"))).toBe(true);
      expect(messages.some((message) => message.subject.includes("Café"))).toBe(true);
      expect(messages.some((message) => (message.htmlBody ?? "").includes("lantern-html"))).toBe(true);
      const last = messages[messages.length - 1];
      if (!last) throw new Error("thread was empty");
      const rawMessage = await call(app, "get_message", { account, messageId: last.id });
      expect(rawMessage.isError, JSON.stringify(rawMessage.data)).toBe(false);
      const rawText = Buffer.from(String(rawMessage.data.raw ?? ""), "base64url").toString("utf8");
      expect(rawText.toLowerCase()).toContain("message-id");
      const answered = /Message-ID:\s*(<[^>]+>)/i.exec(rawText)?.[1] ?? "";
      expect(answered.length).toBeGreaterThan(2);

      const moveId = await threadIdFor(app, account, "subject:\"Move me\"");
      const started = await raw.copiesOf("<move@example.test>");
      expect(started.map((copy) => copy.path)).toEqual(["INBOX"]);
      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["Notes"] });
      const labeled = await raw.copiesOf("<move@example.test>");
      expect(labeled).toHaveLength(2);
      expect(await countQuery(app, account, "label:notes")).toBe(1);
      await ok(app, "unlabel_thread", { account, threadId: moveId, labelIds: ["Notes"] });
      expect(paths(await raw.copiesOf("<move@example.test>"))).toEqual(paths(started));
      expect(await countQuery(app, account, "label:notes")).toBe(0);

      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["ARCHIVE"] });
      await ok(app, "unlabel_thread", { account, threadId: moveId, labelIds: ["INBOX"] });
      const archived = await raw.copiesOf("<move@example.test>");
      expect(archived.some((copy) => copy.path === "INBOX")).toBe(false);
      expect(archived.some((copy) => /archive/i.test(copy.path))).toBe(true);
      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["INBOX"] });
      expect(paths(await raw.copiesOf("<move@example.test>"))).toEqual(paths(started));

      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["STARRED"] });
      expect((await raw.copiesOf("<move@example.test>")).some((copy) => flagged(copy, "\\Flagged"))).toBe(true);
      await ok(app, "unlabel_thread", { account, threadId: moveId, labelIds: ["STARRED"] });
      expect((await raw.copiesOf("<move@example.test>")).some((copy) => flagged(copy, "\\Flagged"))).toBe(false);
      await ok(app, "unlabel_thread", { account, threadId: moveId, labelIds: ["UNREAD"] });
      expect((await raw.copiesOf("<move@example.test>")).every((copy) => flagged(copy, "\\Seen"))).toBe(true);
      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["UNREAD"] });
      expect((await raw.copiesOf("<move@example.test>")).some((copy) => flagged(copy, "\\Seen"))).toBe(false);

      const trashId = await threadIdFor(app, account, "subject:\"Trash me\"");
      await ok(app, "label_thread", { account, threadId: trashId, labelIds: ["TRASH"] });
      await ok(app, "unlabel_thread", { account, threadId: trashId, labelIds: ["INBOX"] });
      const trashed = await raw.copiesOf("<trash@example.test>");
      expect(trashed.some((copy) => copy.path === "INBOX")).toBe(false);
      expect(trashed.length).toBeGreaterThan(0);

      const beforeSnooze = await raw.copiesOf("<move@example.test>");
      await ok(app, "label_thread", { account, threadId: moveId, labelIds: ["CB/Snooze/2020-01-01"] });
      await ok(app, "unlabel_thread", { account, threadId: moveId, labelIds: ["INBOX"] });
      const snoozed = await raw.copiesOf("<move@example.test>");
      expect(snoozed.some((copy) => /snooze/i.test(copy.path))).toBe(true);
      expect(snoozed.some((copy) => copy.path === "INBOX")).toBe(false);
      now += 10 * 60 * 1000;
      await ok(app, "list_labels", { account });
      expect(paths(await raw.copiesOf("<move@example.test>"))).toEqual(paths(beforeSnooze));
      expect((await raw.copiesOf("<move@example.test>")).some((copy) => flagged(copy, "\\Seen"))).toBe(false);
      await ok(app, "list_labels", { account });
      expect(paths(await raw.copiesOf("<move@example.test>"))).toEqual(paths(beforeSnooze));
      expect(await jobCount(app)).toBe(1);

      const draft = await call(app, "create_draft", {
        account,
        to: ["lee@example.com"],
        subject: "Re: plan quarterly",
        body: "draft one",
        replyToMessageId: last.id,
      });
      expect(draft.isError, JSON.stringify(draft.data)).toBe(false);
      const draftId = String(draft.data.id ?? "");
      await ok(app, "update_draft", {
        account,
        draftId,
        to: ["lee@example.com"],
        subject: "Re: plan quarterly",
        body: "draft two",
      });
      await ok(app, "update_draft", {
        account,
        draftId,
        to: ["lee@example.com"],
        subject: "Re: plan quarterly",
        body: "draft three",
      });
      const shown = await call(app, "get_draft", { account, draftId, messageFormat: "FULL" });
      expect(shown.isError, JSON.stringify(shown.data)).toBe(false);
      expect(String(shown.data.plaintextBody ?? "")).toContain("draft three");
      expect(String(shown.data.inReplyTo ?? "").toLowerCase()).toContain(answered.toLowerCase());
      expect(String(shown.data.references ?? "").toLowerCase()).toContain(answered.toLowerCase());
      const draftBytes = await raw.sourcesIn(layout.drafts);
      expect(draftBytes.filter((bytes) => bytes.includes("draft three"))).toHaveLength(1);
      expect(draftBytes.some((bytes) => bytes.toLowerCase().includes("x-cbm-draft-id"))).toBe(true);
      expect(draftBytes.some((bytes) => bytes.toLowerCase().includes(answered.toLowerCase()))).toBe(true);
      await ok(app, "delete_draft", { account, draftId });
      expect((await raw.sourcesIn(layout.drafts)).some((bytes) => bytes.includes("draft three"))).toBe(false);

      const beforeSend = captured.length;
      await ok(app, "send_message", {
        account,
        to: ["lee@example.com"],
        subject: "A fresh note",
        body: "sent once",
      });
      await ok(app, "reply", { account, messageId: last.id, body: "live reply" });
      await ok(app, "forward", { account, messageId: last.id, to: ["sam@example.com"] });
      expect(captured).toHaveLength(beforeSend + 3);
      const replyMime = captured[beforeSend + 1]?.toString("utf8") ?? "";
      const forwardMime = captured[beforeSend + 2]?.toString("utf8") ?? "";
      expect(replyMime.toLowerCase()).toContain("in-reply-to");
      expect(replyMime.toLowerCase()).toContain("references");
      expect(replyMime.toLowerCase()).toContain(answered.toLowerCase());
      const replyToHeader = /^to:\s*(.*)$/im.exec(replyMime)?.[1] ?? "";
      expect(replyToHeader.toLowerCase()).toContain("lee@example.com");
      expect(replyToHeader.toLowerCase()).not.toContain("owner@example.test");
      expect(forwardMime).toContain("Forwarded message");
      const sentBytes = await raw.sourcesIn(layout.sent);
      expect(sentBytes.some((bytes) => bytes.includes("live reply") && bytes.toLowerCase().includes(answered.toLowerCase()))).toBe(true);

      const sideBefore = await raw.uidValidity(layout.side);
      await raw.mutate(layout);
      const sideAfter = await raw.uidValidity(layout.side);
      expect(sideAfter).not.toBe(sideBefore);
      await syncUntil(app, account);
      expect(await subjects(app, account, "Delete me")).toBe(0);
      const flaggedRow = await labelsFor(app, account, "Flag me");
      expect(flaggedRow.some((labels) => labels.includes("STARRED"))).toBe(true);
      const movedFolders = await foldersFor(app, account, "Move aside");
      expect(movedFolders.some((folder) => folder === "INBOX")).toBe(false);
      expect(movedFolders.some((folder) => /notes/i.test(folder))).toBe(true);
      expect(await subjects(app, account, "Side copy")).toBe(1);
      const storedValidity = await folderValidity(app, account, layout.side);
      expect(storedValidity).toBe(sideAfter);

      gate.arm();
      const read = await call(app, "search_threads", { account, query: "in:inbox", view: "THREAD_VIEW_IDS_ONLY" });
      expect(read.isError, JSON.stringify(read.data)).toBe(false);
      expect(gate.opened).toBe(2);
      const beforeDrop = paths(await raw.copiesOf("<move@example.test>"));
      gate.arm();
      const write = await call(app, "label_thread", { account, threadId: moveId, labelIds: ["Notes"] });
      expect(write.isError).toBe(true);
      expect(String(write.data.message ?? "")).toMatch(/did not answer/);
      expect(gate.opened).toBe(1);
      expect(paths(await raw.copiesOf("<move@example.test>"))).toEqual(beforeDrop);

      const logText = lines.join("\n");
      const auditText = JSON.stringify(await app.store.listAudit());
      const doveLog = readFileSync(`${liveDir}/dovecot.log`, "utf8");
      expect(logText).not.toContain(PASSWORD);
      expect(auditText).not.toContain(PASSWORD);
      expect(auditText).not.toContain(BODY);
      expect(doveLog).not.toContain(PASSWORD);
    } finally {
      await app.close();
      await gate.close();
      await closeSmtp(smtp);
      await raw.close();
    }
  });
});

describe(`imap scale ${flavor}`, () => {
  it("lists a 2,000-message inbox, backfills only SYNC_DAYS, and replies to an old message", async () => {
    const lines: string[] = [];
    const now = Date.parse("2026-11-05T12:00:00.000Z");
    const clock = { now: () => now };
    const caPem = readFileSync(`${liveDir}/cert.pem`, "utf8");
    const key = readFileSync(`${liveDir}/key.pem`);
    const captured: Buffer[] = [];
    const smtp = new SMTPServer({
      secure: false,
      key,
      cert: caPem,
      authOptional: false,
      authMethods: ["PLAIN", "LOGIN"],
      onAuth(auth, _session, callback) {
        if (auth.username === USER && auth.password === PASSWORD) callback(null, { user: USER });
        else callback(new Error("535 invalid"));
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          captured.push(Buffer.concat(chunks));
          callback();
        });
      },
    });
    const smtpPort = await listen(smtp);
    const gate = await startGate(livePort);
    const seeder = new ImapFlow({
      host: "localhost",
      port: livePort,
      secure: true,
      logger: false,
      tls: { ca: [caPem] },
      auth: { user: USER, pass: PASSWORD },
    });
    await seeder.connect();
    const filler = "lorem ipsum dolor sit amet ".repeat(300);
    const count = 2000;
    for (let i = 0; i < count; i += 1) {
      const at = new Date(now - i * 5 * 60 * 60 * 1000);
      await seeder.append("INBOX", letter({
        from: "Bulk <bulk@example.com>",
        to: `Ada <${USER}>`,
        subject: `Bulk ${i}`,
        date: at,
        messageId: `<bulk-${i}@example.test>`,
        text: `${i} ${filler}`,
      }), i % 3 === 0 ? ["\\Seen"] : [], at);
    }
    await seeder.logout();
    const app = await createServer({
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
      IMAP_ALLOW_PRIVATE_HOSTS: "1",
      SYNC_BUDGET_MS: "60000",
      SYNC_STALE_MS: "86400000",
      GMAIL_TIMEOUT_MS: "15000",
    }, { logSink: (line) => lines.push(line), imap: { caPem }, clock });
    try {
      const owner = await signIn(app);
      const connected = await https(app, "POST", "/connect/imap", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body: JSON.stringify({
          email: USER,
          host: "localhost",
          port: gate.port,
          security: "tls",
          user: USER,
          password: PASSWORD,
          smtpHost: "localhost",
          smtpPort,
        }),
      });
      expect(connected.status, connected.text).toBe(200);
      const account = (JSON.parse(connected.text) as { account?: string }).account ?? "";
      await initialize(app);
      gateBytes.n = 0;
      let started = Date.now();
      const listed = await ok(app, "search_threads", { account, query: "", view: "THREAD_VIEW_SUMMARY", pageSize: 25 });
      const listMs = Date.now() - started;
      const listBytes = gateBytes.n;
      console.log(`SCALE list ms=${listMs} imapBytes=${listBytes} threads=${(listed.threads as unknown[]).length}`);
      gateBytes.n = 0;
      started = Date.now();
      await syncUntil(app, account);
      const syncMs = Date.now() - started;
      const syncBytes = gateBytes.n;
      const stored = await sqlOf(app).query<{ n: string }>("SELECT count(*) AS n FROM messages WHERE account_id = $1", [account]);
      console.log(`SCALE sync ms=${syncMs} imapBytes=${syncBytes} storedMessages=${stored.rows[0]?.n}`);
      const oldest = await call(app, "search_threads", {
        account,
        query: "subject:\"Bulk 1999\"",
        view: "THREAD_VIEW_IDS_ONLY",
      });
      const oldThreads = (oldest.data.threads as Array<{ id: string }> | undefined) ?? [];
      expect(oldest.isError, JSON.stringify(oldest.data)).toBe(false);
      expect(oldThreads.length).toBeGreaterThan(0);
      const thread = await call(app, "get_thread", {
        account,
        threadId: oldThreads[0]?.id ?? "",
        messageFormat: "FULL_CONTENT",
      });
      expect(thread.isError, JSON.stringify(thread.data)).toBe(false);
      const msgs = (thread.data.messages as Array<{ id: string; subject?: string }> | undefined) ?? [];
      expect(msgs.some((message) => message.subject === "Bulk 1999")).toBe(true);
      gateBytes.n = 0;
      started = Date.now();
      const replied = await call(app, "reply", { account, messageId: msgs[0]?.id ?? "", body: "late reply" });
      console.log(`SCALE reply-old ms=${Date.now() - started} imapBytes=${gateBytes.n} isError=${replied.isError} ${JSON.stringify(replied.data).slice(0, 160)}`);
      expect(replied.isError, JSON.stringify(replied.data)).toBe(false);
      expect(listMs).toBeLessThan(5000);
      expect(listBytes).toBeLessThan(2_000_000);
      expect(Number(stored.rows[0]?.n ?? 0)).toBeLessThan(400);
      expect(captured.some((bytes) => bytes.toString("utf8").includes("late reply"))).toBe(true);

      const listedRows = listed.threads as Array<{ messages?: Array<{ id?: string; subject?: string }> }>;
      const syncedId = listedRows.find((row) => row.messages?.[0]?.subject === "Bulk 0")?.messages?.[0]?.id ?? "";
      expect(syncedId).not.toBe("");
      const direct = await createServer({
        OWNER_TOKEN: TOKEN,
        OWNER_PASSPHRASE: PASSPHRASE,
        ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        MAIL_MODE: "direct",
        MAIL_STORE: "pglite",
        MAIL_PROVIDER: "imap",
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "0",
        OWNER_TIMEZONE: "UTC",
        IMAP_ALLOW_PRIVATE_HOSTS: "1",
        SYNC_BUDGET_MS: "60000",
        SYNC_STALE_MS: "86400000",
        GMAIL_TIMEOUT_MS: "15000",
      }, { logSink: (line) => lines.push(line), imap: { caPem }, clock });
      try {
        const directOwner = await signIn(direct);
        const directConnected = await https(direct, "POST", "/connect/imap", {
          cookie: directOwner.cookie,
          type: "application/json",
          headers: { "x-cbm-csrf": directOwner.csrf },
          body: JSON.stringify({
            email: USER,
            host: "localhost",
            port: gate.port,
            security: "tls",
            user: USER,
            password: PASSWORD,
            smtpHost: "localhost",
            smtpPort,
          }),
        });
        expect(directConnected.status, directConnected.text).toBe(200);
        const directAccount = (JSON.parse(directConnected.text) as { account?: string }).account ?? "";
        await initialize(direct);
        gateBytes.n = 0;
        started = Date.now();
        const directThread = await call(direct, "get_thread", {
          account: directAccount,
          threadId: oldThreads[0]?.id ?? "",
          messageFormat: "FULL_CONTENT",
        });
        expect(directThread.isError, JSON.stringify(directThread.data)).toBe(false);
        const directMsgs = (directThread.data.messages as Array<{ id?: string; subject?: string }> | undefined) ?? [];
        expect(directMsgs.some((message) => message.subject === "Bulk 1999")).toBe(true);
        const directReply = await call(direct, "reply", {
          account: directAccount,
          messageId: directMsgs[0]?.id ?? "",
          body: "direct late reply",
        });
        const directBytes = gateBytes.n;
        const directMs = Date.now() - started;
        console.log(`SCALE direct-open-reply ms=${directMs} imapBytes=${directBytes} isError=${directReply.isError}`);
        expect(directReply.isError, JSON.stringify(directReply.data)).toBe(false);
        expect(directBytes).toBeLessThan(200_000);
        expect(captured.some((bytes) => bytes.toString("utf8").includes("direct late reply"))).toBe(true);
      } finally {
        await direct.close();
      }

      const cleaner = new ImapFlow({
        host: "localhost",
        port: livePort,
        secure: true,
        logger: false,
        tls: { ca: [caPem] },
        auth: { user: USER, pass: PASSWORD },
      });
      await cleaner.connect();
      const lock = await cleaner.getMailboxLock("INBOX");
      try {
        const found = await cleaner.search({ header: { "message-id": "<bulk-0@example.test>" } }, { uid: true });
        const uids = Array.isArray(found) ? found : [];
        expect(uids.length).toBeGreaterThan(0);
        expect(await cleaner.messageDelete(uids, { uid: true })).toBe(true);
      } finally {
        lock.release();
      }
      await cleaner.logout();
      gateBytes.n = 0;
      started = Date.now();
      const missing = await call(app, "reply", { account, messageId: syncedId, body: "gone reply" });
      const missingMs = Date.now() - started;
      const missingBytes = gateBytes.n;
      console.log(`SCALE deleted-reply ms=${missingMs} imapBytes=${missingBytes} isError=${missing.isError} ${JSON.stringify(missing.data).slice(0, 160)}`);
      expect(missing.isError).toBe(true);
      expect(String(missing.data.message ?? "")).toContain("404");
      expect(missingBytes).toBeLessThan(50_000);
      expect(missingMs).toBeLessThan(1000);
    } finally {
      await app.close();
      await gate.close();
      await closeSmtp(smtp);
    }
  }, 900_000);
});

interface ThreadRow {
  id: string;
  messages?: MessageRow[];
}

interface MessageRow {
  id: string;
  subject: string;
  labelIds: string[];
  htmlBody?: string;
}

interface Copy {
  path: string;
  flags: string[];
}

interface Layout {
  sent: string;
  drafts: string;
  side: string;
  notes: string;
  prefix: string;
}

class Probe {
  private client: ImapFlow | null = null;

  constructor(private readonly port: number, private readonly caPem: string) {}

  async copiesOf(messageId: string): Promise<Copy[]> {
    const client = await this.open();
    const boxes = await client.list();
    const bare = messageId.replace(/[<>]/g, "");
    const found: Copy[] = [];
    for (const box of boxes) {
      if (hasFlag(box.flags, "\\Noselect") || hasFlag(box.flags, "\\NonExistent")) continue;
      const lock = await client.getMailboxLock(box.path, { readOnly: true });
      try {
        const uids = await headerUids(client, bare);
        for (const uid of uids) {
          const row = await client.fetchOne(String(uid), { uid: true, flags: true }, { uid: true });
          if (!row) continue;
          found.push({ path: box.path, flags: [...(row.flags ?? [])] });
        }
      } finally {
        lock.release();
      }
    }
    return found;
  }

  async sourcesIn(path: string): Promise<string[]> {
    const client = await this.open();
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const found = await client.search({ all: true }, { uid: true });
      const uids = Array.isArray(found) ? found : [];
      const out: string[] = [];
      for (const uid of uids) {
        const row = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (row && row.source) out.push(Buffer.from(row.source).toString("utf8"));
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async uidValidity(path: string): Promise<string> {
    const client = await this.open();
    const status = await client.status(path, { uidValidity: true });
    return String(status.uidValidity ?? "");
  }

  async layout(): Promise<Layout> {
    const client = await this.open();
    const personal = client.namespace;
    const prefix = personal?.prefix ?? "";
    const sentName = flavor === "minimal" ? "Sent Messages" : "Sent";
    const sent = `${prefix}${sentName}`;
    const drafts = `${prefix}Drafts`;
    const side = `${prefix}Side`;
    const notes = `${prefix}Notes`;
    await ensureBox(client, sent);
    await ensureBox(client, drafts);
    await ensureBox(client, side);
    return { sent, drafts, side, notes, prefix };
  }

  async seed(layout: Layout): Promise<void> {
    const client = await this.open();
    const now = Date.now();
    const root = letter({
      from: "Lee <lee@example.com>",
      to: "Ada <ada@example.com>",
      cc: "Sam <sam@example.com>",
      subject: "=?UTF-8?Q?Caf=C3=A9?= plan quarterly",
      date: new Date(now - 3 * 60 * 60 * 1000),
      messageId: "<root@example.test>",
      text: BODY,
      html: "<p>lantern-html</p>",
      extra: ["List-Id: <plan.example.com>"],
      filename: "notes.pdf",
    });
    const mid = letter({
      from: "Lee <lee@example.com>",
      to: "Ada <ada@example.com>",
      subject: "Re: =?UTF-8?Q?Caf=C3=A9?= plan quarterly",
      date: new Date(now - 2 * 60 * 60 * 1000),
      messageId: "<mid@example.test>",
      inReplyTo: "<root@example.test>",
      references: "<root@example.test>",
      text: "the middle reply",
    });
    const sent = letter({
      from: "Ada <owner@example.test>",
      to: "Lee <lee@example.com>",
      subject: "Re: plan quarterly",
      date: new Date(now - 60 * 60 * 1000),
      messageId: "<sent@example.test>",
      inReplyTo: "<mid@example.test>",
      references: "<root@example.test> <mid@example.test>",
      text: "the sent reply",
    });
    const old = letter({
      from: "Lee <lee@example.com>",
      to: "Sam <sam@example.com>",
      subject: "Old note",
      date: new Date(now - 40 * 24 * 60 * 60 * 1000),
      messageId: "<old@example.test>",
      text: "stale",
    });
    await client.append("INBOX", root, [], new Date(now - 3 * 60 * 60 * 1000));
    await client.append("INBOX", mid, [], new Date(now - 2 * 60 * 60 * 1000));
    await client.append(layout.sent, sent, ["\\Seen"], new Date(now - 60 * 60 * 1000));
    await client.append("INBOX", old, ["\\Seen", "\\Flagged"], new Date(now - 40 * 24 * 60 * 60 * 1000));
    for (const [id, subject] of [
      ["<move@example.test>", "Move me"],
      ["<trash@example.test>", "Trash me"],
      ["<flag@example.test>", "Flag me"],
      ["<moved@example.test>", "Move aside"],
      ["<gone@example.test>", "Delete me"],
    ] as const) {
      await client.append("INBOX", letter({
        from: "Sam <sam@example.com>",
        to: "Sam <sam@example.com>",
        subject,
        date: new Date(),
        messageId: id,
        text: subject,
      }), []);
    }
    await client.append(layout.side, letter({
      from: "Sam <sam@example.com>",
      to: "Sam <sam@example.com>",
      subject: "Side copy",
      date: new Date(),
      messageId: "<side@example.test>",
      text: "off to the side",
    }), []);
  }

  async mutate(layout: Layout): Promise<void> {
    const client = await this.open();
    await ensureBox(client, layout.notes);
    await flagUid(client, "INBOX", "<flag@example.test>");
    await moveUid(client, "INBOX", layout.notes, "<moved@example.test>");
    await deleteUid(client, "INBOX", "<gone@example.test>");
    const side = await client.status(layout.side, { uidValidity: true });
    const previous = String(side.uidValidity ?? "");
    await client.mailboxDelete(layout.side);
    await client.mailboxCreate(layout.side);
    const next = await client.status(layout.side, { uidValidity: true });
    if (String(next.uidValidity ?? "") === previous) throw new Error("UIDVALIDITY did not change");
    await client.append(layout.side, letter({
      from: "Sam <sam@example.com>",
      to: "Sam <sam@example.com>",
      subject: "Side copy",
      date: new Date(),
      messageId: "<side@example.test>",
      text: "off to the side",
    }), []);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }

  private async open(): Promise<ImapFlow> {
    if (this.client) return this.client;
    const client = new ImapFlow({
      host: "127.0.0.1",
      port: this.port,
      secure: true,
      servername: "localhost",
      auth: { user: USER, pass: PASSWORD },
      logger: false,
      tls: { rejectUnauthorized: true, servername: "localhost", ca: this.caPem },
    });
    client.on("error", () => undefined);
    await client.connect();
    this.client = client;
    return client;
  }
}

function letter(input: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: Date;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  text: string;
  html?: string;
  extra?: string[];
  filename?: string;
}): Buffer {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${input.date.toUTCString()}`,
    `Message-ID: ${input.messageId}`,
  ];
  if (input.cc) headers.push(`Cc: ${input.cc}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  for (const line of input.extra ?? []) headers.push(line);
  headers.push("MIME-Version: 1.0");
  if (!input.filename) {
    headers.push("Content-Type: text/plain; charset=utf-8", "", input.text, "");
    return Buffer.from(headers.join("\r\n"));
  }
  const boundary = "cbm-live-boundary";
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    input.html ?? "",
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${input.filename}"`,
    `Content-Disposition: attachment; filename="${input.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("file-bytes").toString("base64"),
    "",
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n${parts.join("\r\n")}`);
}

async function ensureBox(client: ImapFlow, path: string): Promise<void> {
  const rows = await client.list();
  if (rows.some((row) => row.path === path)) return;
  await client.mailboxCreate(path);
}

async function headerUids(client: ImapFlow, bare: string): Promise<number[]> {
  const found = await client.search({ header: { "Message-ID": bare } }, { uid: true });
  return Array.isArray(found) ? found : [];
}

async function flagUid(client: ImapFlow, path: string, messageId: string): Promise<void> {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = await headerUids(client, messageId.replace(/[<>]/g, ""));
    if (uids.length === 0) throw new Error(`missing ${messageId}`);
    await client.messageFlagsAdd(uids.join(","), ["\\Flagged"], { uid: true });
  } finally {
    lock.release();
  }
}

async function moveUid(client: ImapFlow, path: string, dest: string, messageId: string): Promise<void> {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = await headerUids(client, messageId.replace(/[<>]/g, ""));
    if (uids.length === 0) throw new Error(`missing ${messageId}`);
    const range = uids.join(",");
    await client.messageCopy(range, dest, { uid: true });
    await client.messageDelete(range, { uid: true });
  } finally {
    lock.release();
  }
}

async function deleteUid(client: ImapFlow, path: string, messageId: string): Promise<void> {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = await headerUids(client, messageId.replace(/[<>]/g, ""));
    if (uids.length === 0) throw new Error(`missing ${messageId}`);
    await client.messageDelete(uids.join(","), { uid: true });
  } finally {
    lock.release();
  }
}

function paths(copies: Copy[]): string[] {
  return copies.map((copy) => copy.path).sort();
}

function flagged(copy: Copy, flag: string): boolean {
  return copy.flags.some((item) => item.toLowerCase() === flag.toLowerCase());
}

function hasFlag(flags: Set<string> | undefined, name: string): boolean {
  return Boolean(flags?.has(name));
}

function beforeStamp(): string {
  const date = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}/${month}/${day}`;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface Gate {
  port: number;
  opened: number;
  arm(): void;
  close(): Promise<void>;
}

/** Bytes Dovecot sent through the proxy. The scale test resets this around one call. */
const gateBytes = { n: 0 };

function startGate(targetPort: number): Promise<Gate> {
  const sockets = new Set<Socket>();
  let dropNext = 0;
  let opened = 0;
  const server = createNetServer((client) => {
    opened += 1;
    sockets.add(client);
    client.on("error", () => undefined);
    if (dropNext > 0) {
      dropNext -= 1;
      client.resetAndDestroy();
      return;
    }
    const upstream = connectNet(targetPort, "127.0.0.1");
    sockets.add(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
    upstream.on("data", (chunk: Buffer) => {
      gateBytes.n += chunk.length;
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        get opened() {
          return opened;
        },
        arm() {
          dropNext = 1;
          opened = 0;
        },
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

type Json = Record<string, unknown>;

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function listen(server: SMTPServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function closeSmtp(server: SMTPServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
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
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
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

async function signIn(app: Running): Promise<{ cookie: string; csrf: string }> {
  const start = await https(app, "GET", "/signin?next=/app");
  expect(start.status, start.text).toBe(200);
  const first = cookieOf(start);
  const csrf = /name="csrf" value="([^"]+)"/.exec(start.text)?.[1] ?? "";
  const posted = await https(app, "POST", "/signin", {
    cookie: first,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf, passphrase: PASSPHRASE, next: "/app" }).toString(),
  });
  expect(posted.status, posted.text).toBe(302);
  const cookie = cookieOf(posted) || first;
  const page = await https(app, "GET", "/app", { cookie });
  expect(page.status, page.text.slice(0, 200)).toBe(200);
  const boot = /window\.__cbm=(\{.*?\});/.exec(page.text)?.[1] ?? "";
  const parsed = JSON.parse(boot) as { csrf?: string };
  if (!parsed.csrf) throw new Error("page csrf missing");
  return { cookie, csrf: parsed.csrf };
}

function parseMcp(text: string): Json | null {
  if (!text) return null;
  if (text.includes("data:")) {
    const rows = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    if (rows.length === 0) return null;
    return JSON.parse(rows[rows.length - 1] ?? "") as Json;
  }
  return JSON.parse(text) as Json;
}

async function initialize(app: Running): Promise<void> {
  const hello = await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lane5a-live", version: "0" } },
    }),
  });
  expect(hello.status, hello.text).toBe(200);
  await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}

async function call(app: Running, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: Json }> {
  const res = await https(app, "POST", "/mcp", {
    type: "application/json",
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status, res.text).toBe(200);
  const json = parseMcp(res.text);
  const result = json?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) as Json : {} };
}

async function ok(app: Running, name: string, args: Record<string, unknown>): Promise<Json> {
  const result = await call(app, name, args);
  expect(result.isError, JSON.stringify(result.data)).toBe(false);
  return result.data;
}

async function countQuery(app: Running, account: string, query: string): Promise<number> {
  const result = await ok(app, "search_threads", { account, query, view: "THREAD_VIEW_IDS_ONLY" });
  return (result.threads as unknown[]).length;
}

async function threadIdFor(app: Running, account: string, query: string): Promise<string> {
  const result = await ok(app, "search_threads", { account, query, view: "THREAD_VIEW_IDS_ONLY" });
  const rows = result.threads as Array<{ id?: string }>;
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? "";
}

async function syncUntil(app: Running, account: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await ok(app, "sync_now", {});
    const rows = result.accounts as Array<{ account?: string; synced?: boolean; note?: string }>;
    const row = rows.find((item) => item.account === account);
    if (row?.note === "sync failed") throw new Error(JSON.stringify(row));
    if (row?.synced === true) return;
  }
  throw new Error("sync did not finish");
}

function sqlOf(app: Running): Sql {
  return (app.store as unknown as { sql: Sql }).sql;
}

async function jobCount(app: Running): Promise<number> {
  const result = await sqlOf(app).query<{ n: number | string }>("SELECT count(*) AS n FROM jobs WHERE done_at IS NOT NULL");
  return Number(result.rows[0]?.n ?? 0);
}

async function subjects(app: Running, account: string, subject: string): Promise<number> {
  const result = await sqlOf(app).query<{ n: number | string }>(
    "SELECT count(*) AS n FROM messages WHERE account_id = $1 AND subject = $2",
    [account, subject],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function labelsFor(app: Running, account: string, subject: string): Promise<string[][]> {
  const result = await sqlOf(app).query<{ label_ids: unknown }>(
    "SELECT label_ids FROM messages WHERE account_id = $1 AND subject = $2",
    [account, subject],
  );
  return result.rows.map((row) => asStrings(row.label_ids));
}

async function foldersFor(app: Running, account: string, subject: string): Promise<string[]> {
  const result = await sqlOf(app).query<{ folder: string }>(
    `SELECT c.folder FROM imap_copies c
     JOIN messages m ON m.account_id = c.account_id AND m.id = c.message_id
     WHERE m.account_id = $1 AND m.subject = $2`,
    [account, subject],
  );
  return result.rows.map((row) => row.folder);
}

async function folderValidity(app: Running, account: string, folder: string): Promise<string> {
  const result = await sqlOf(app).query<{ uidvalidity: string }>(
    "SELECT uidvalidity FROM imap_folder_state WHERE account_id = $1 AND folder = $2",
    [account, folder],
  );
  return result.rows[0]?.uidvalidity ?? "";
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      return [];
    }
  }
  return [];
}
