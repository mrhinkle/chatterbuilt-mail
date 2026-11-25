import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { demoMailbox } from "./demo-mailbox.js";
import { demoThreadIds } from "./demo-search.js";
import { messageIdFor } from "./threading.js";
import type { MailMessage } from "./types.js";
import { nextToken, offsetOf } from "../paging.js";

/**
 * In-process Gmail HTTP stand-in. Tests import this. The mail server does not
 * mount it and does not open a socket except here, on 127.0.0.1.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  body: string;
}

export type HttpFault = { kind: "status"; status: number } | { kind: "drop" } | { kind: "hang" };

interface StoredMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  headers: Array<{ name: string; value: string }>;
  raw: string;
}

interface StoredDraft {
  id: string;
  message: StoredMessage;
}

interface StoredFilter {
  id: string;
  criteria: Record<string, unknown>;
  action: { addLabelIds: string[]; removeLabelIds: string[] };
}

const WORK = "gmail_work";

export interface ScriptedThread {
  id: string;
  messageId?: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  /** ISO or RFC822. The Date header and internalDate both come from this. */
  date: string;
  body: string;
  labelIds?: string[];
}

interface HistoryEvent {
  id: number;
  body: Record<string, unknown>;
}

function headerValue(rfc822: string, name: string): string {
  const unfolded = rfc822.replace(/\r?\n[ \t]+/g, " ");
  const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(unfolded);
  return match?.[1]?.trim() ?? "";
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function messageFromDemo(message: MailMessage): StoredMessage {
  const headers = [
    { name: "From", value: message.sender },
    { name: "To", value: message.toRecipients.join(", ") },
    { name: "Cc", value: message.ccRecipients.join(", ") },
    { name: "Reply-To", value: message.replyTo.join(", ") },
    { name: "Subject", value: message.subject },
    { name: "Date", value: message.date },
    { name: "Message-ID", value: messageIdFor(message.id) },
    { name: "In-Reply-To", value: message.inReplyTo },
    { name: "References", value: message.references },
  ];
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: [...message.labelIds],
    snippet: message.snippet,
    internalDate: String(Date.parse(message.date) || 0),
    headers,
    raw: message.raw ?? "",
  };
}

function messageFromRaw(
  id: string,
  threadId: string,
  raw: string,
  labelIds: string[],
  internalDate?: string,
): StoredMessage {
  const rfc822 = decodeRaw(raw);
  const subject = headerValue(rfc822, "Subject");
  const textStart = rfc822.indexOf("\r\n\r\n");
  const text = textStart >= 0 ? rfc822.slice(textStart + 4) : "";
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    id,
    threadId,
    labelIds,
    snippet,
    internalDate: internalDate ?? String(Date.now()),
    headers: [
      { name: "From", value: headerValue(rfc822, "From") },
      { name: "To", value: headerValue(rfc822, "To") },
      { name: "Cc", value: headerValue(rfc822, "Cc") },
      { name: "Reply-To", value: headerValue(rfc822, "Reply-To") },
      { name: "Subject", value: subject },
      { name: "Date", value: headerValue(rfc822, "Date") || new Date().toUTCString() },
      { name: "Message-ID", value: headerValue(rfc822, "Message-ID") || messageIdFor(id) },
      { name: "In-Reply-To", value: headerValue(rfc822, "In-Reply-To") },
      { name: "References", value: headerValue(rfc822, "References") },
    ],
    raw,
  };
}

function metadata(message: StoredMessage): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    internalDate: message.internalDate,
    payload: { mimeType: "text/plain", headers: message.headers },
  };
}

function rawMessage(message: StoredMessage): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    internalDate: message.internalDate,
    raw: message.raw,
  };
}

export class FakeGmailServer {
  readonly requests: RecordedRequest[] = [];
  listening = false;
  apiBase = "";
  tokenUrl = "";
  tokenBehavior: "ok" | "invalid_grant" = "ok";
  /** When false, an authorization-code grant omits refresh_token. */
  issueRefresh = true;
  readonly connectAccess = randomBytes(18).toString("base64url");
  readonly connectRefresh = randomBytes(18).toString("base64url");
  private readonly issuedCodes = new Set<string>();
  private server: Server | null = null;
  private writeFault: HttpFault | null = null;
  private readFault: HttpFault | null = null;
  private tokenFault: HttpFault | null = null;
  private readonly sockets = new Set<Socket>();
  private seq = 1000;
  private readonly threads = new Map<string, StoredMessage[]>();
  private readonly drafts: StoredDraft[] = [];
  private readonly labels: Array<{ id: string; name: string; type: "system" | "user" }> = [];
  private readonly filters: StoredFilter[] = [];
  private readonly sendAs: Array<Record<string, unknown>> = [];
  private readonly mode: "demo" | "bulk" | "scripted";
  private readonly mintedAccess = randomBytes(16).toString("hex");
  private historySeq: number;
  private historyFloor = 0;
  private readonly history: HistoryEvent[] = [];
  private readFaultPath = "";

  private constructor(mode: "demo" | "bulk" | "scripted") {
    this.mode = mode;
    this.historySeq = mode === "scripted" ? 1000 : 1;
    if (mode === "demo") this.seedDemo();
    else if (mode === "bulk") this.seedBulk();
    else this.seedScripted();
  }

  static async demo(): Promise<FakeGmailServer> {
    const server = new FakeGmailServer("demo");
    await server.listen();
    return server;
  }

  static async bulk(): Promise<FakeGmailServer> {
    const server = new FakeGmailServer("bulk");
    await server.listen();
    return server;
  }

  /** Empty mailbox. History starts at 1000. Tests script the changes between sync steps. */
  static async scripted(): Promise<FakeGmailServer> {
    const server = new FakeGmailServer("scripted");
    await server.listen();
    return server;
  }

  failNextWrite(fault: HttpFault): void {
    this.writeFault = fault;
  }

  /** The next GET fails. `pathIncludes` limits that to one path, so a labels read does not consume it. */
  failNextRead(fault: HttpFault, pathIncludes?: string): void {
    this.readFault = fault;
    this.readFaultPath = pathIncludes ?? "";
  }

  failNextToken(fault: HttpFault): void {
    this.tokenFault = fault;
  }

  recorded(): RecordedRequest[] {
    if (!this.listening) throw new Error("fake Gmail server is not listening");
    return this.requests.slice();
  }

  recordedWrites(): RecordedRequest[] {
    return this.recorded().filter((item) => isMailWrite(item));
  }

  async close(): Promise<void> {
    this.listening = false;
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private seedDemo(): void {
    const box = demoMailbox();
    for (const thread of box.threads.get(WORK) ?? []) {
      this.threads.set(thread.id, thread.messages.map(messageFromDemo));
    }
    for (const label of box.labels.get(WORK) ?? []) {
      this.labels.push({
        id: label.labelId,
        name: label.name,
        type: label.labelType === "USER" ? "user" : "system",
      });
    }
    for (const row of box.sendAs.get(WORK) ?? []) {
      this.sendAs.push({
        sendAsEmail: row.email,
        signature: row.signature,
        isDefault: row.isDefault,
        isPrimary: row.isPrimary,
        verificationStatus: row.verified ? "accepted" : "pending",
      });
    }
    for (const draft of box.drafts.get(WORK) ?? []) {
      const message = messageFromDemo({
        id: draft.messageId,
        threadId: draft.threadId,
        position: 0,
        sender: "alex@riveralabs.example",
        toRecipients: draft.toRecipients,
        ccRecipients: draft.ccRecipients,
        bccRecipients: draft.bccRecipients,
        replyTo: [],
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        subject: draft.subject,
        date: draft.date,
        labelIds: draft.labelIds,
        snippet: draft.snippet,
        plaintextBody: draft.plaintextBody,
        htmlBody: draft.htmlBody,
        attachments: draft.attachments,
        raw: draft.raw,
        viewUrl: draft.viewUrl,
        bodyFetched: true,
      });
      this.drafts.push({ id: draft.id, message });
    }
  }

  private seedBulk(): void {
    for (let index = 0; index < 500; index += 1) {
      const id = `b${index}`;
      const messageId = `m${id}`;
      this.threads.set(id, [{
        id: messageId,
        threadId: id,
        labelIds: ["INBOX"],
        snippet: "bulk",
        internalDate: "1730721600000",
        headers: [
          { name: "From", value: "Bulk <bulk@example.com>" },
          { name: "To", value: "alex@riveralabs.example" },
          { name: "Cc", value: "" },
          { name: "Reply-To", value: "" },
          { name: "Subject", value: `bulk ${id}` },
          { name: "Date", value: "Wed, 04 Nov 2026 15:00:00 +0000" },
          { name: "Message-ID", value: messageIdFor(messageId) },
          { name: "In-Reply-To", value: "" },
          { name: "References", value: "" },
        ],
        raw: "",
      }]);
    }
  }

  private seedScripted(): void {
    for (const id of ["INBOX", "UNREAD", "SENT", "DRAFT"]) {
      this.labels.push({ id, name: id, type: "system" });
    }
  }

  addLabel(id: string, name: string): void {
    if (this.labels.some((label) => label.id === id)) return;
    this.labels.push({ id, name, type: "user" });
  }

  addThread(input: ScriptedThread): void {
    const messageId = input.messageId ?? `m${this.seq++}`;
    const parsed = Date.parse(input.date);
    const headerDate = Number.isNaN(parsed) ? input.date : new Date(parsed).toUTCString();
    const rfc822 = [
      `From: ${input.from}`,
      `To: ${input.to}`,
      ...(input.cc ? [`Cc: ${input.cc}`] : []),
      `Subject: ${input.subject}`,
      `Date: ${headerDate}`,
      `Message-ID: ${messageIdFor(messageId)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ].join("\r\n");
    const raw = Buffer.from(rfc822, "utf8").toString("base64url");
    const labelIds = input.labelIds ?? ["INBOX"];
    const message = messageFromRaw(messageId, input.id, raw, labelIds, String(Number.isNaN(parsed) ? Date.now() : parsed));
    const list = this.threads.get(input.id) ?? [];
    list.push(message);
    this.threads.set(input.id, list);
    this.record({
      messagesAdded: [{ message: { id: messageId, threadId: input.id, labelIds } }],
    });
  }

  relabel(threadId: string, add: string[], remove: string[]): void {
    if (!this.retouch(threadId, add, remove)) throw new Error(`unknown thread ${threadId}`);
  }

  deleteThread(threadId: string): void {
    const messages = this.threads.get(threadId);
    if (!messages) return;
    this.threads.delete(threadId);
    this.record({
      messagesDeleted: messages.map((message) => ({ message: { id: message.id, threadId } })),
    });
  }

  /**
   * The stored cursor becomes stale, and the id a new sync records stays valid.
   * Setting the floor equal to the current id without bumping it would 404 forever.
   */
  expireHistory(): void {
    this.historyFloor = this.historySeq;
    this.historySeq += 1;
  }

  historyId(): string {
    return String(this.historySeq);
  }

  threadLabelIds(threadId: string): string[] {
    const messages = this.threads.get(threadId) ?? [];
    return [...new Set(messages.flatMap((message) => message.labelIds))];
  }

  private record(partial: Record<string, unknown>): void {
    this.historySeq += 1;
    this.history.push({ id: this.historySeq, body: { id: String(this.historySeq), ...partial } });
  }

  private retouch(threadId: string, add: string[], remove: string[]): StoredMessage[] | null {
    const messages = this.threads.get(threadId);
    if (!messages) return null;
    const drop = new Set(remove);
    for (const message of messages) {
      message.labelIds = [...new Set([...message.labelIds, ...add])].filter((label) => !drop.has(label));
    }
    if (add.length > 0 || remove.length > 0) {
      this.record({
        ...(add.length > 0
          ? { labelsAdded: messages.map((message) => ({ message: { id: message.id, threadId }, labelIds: add })) }
          : {}),
        ...(remove.length > 0
          ? { labelsRemoved: messages.map((message) => ({ message: { id: message.id, threadId }, labelIds: remove })) }
          : {}),
      });
    }
    return messages;
  }

  private async listen(): Promise<void> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) throw new Error("fake Gmail server did not bind");
    this.server = server;
    this.apiBase = `http://127.0.0.1:${port}`;
    this.tokenUrl = `${this.apiBase}/token`;
    this.listening = true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = `${url.pathname}${url.search}`;
    const body = method === "GET" || method === "HEAD" ? "" : await readBody(req);
    this.requests.push({ method, path, body });
    if (method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      this.authorizeRedirect(url, res);
      return;
    }
    if (method === "POST" && url.pathname === "/token" && this.tokenFault) {
      const fault = this.tokenFault;
      this.tokenFault = null;
      this.applyFault(req, res, fault);
      return;
    }
    const write = isMailWrite({ method, path });
    const readMatches = method === "GET"
      && this.readFault !== null
      && (this.readFaultPath === "" || url.pathname.includes(this.readFaultPath));
    const fault = write ? this.writeFault : readMatches ? this.readFault : null;
    if (fault && (write || readMatches)) {
      if (write) this.writeFault = null;
      else {
        this.readFault = null;
        this.readFaultPath = "";
      }
      this.applyFault(req, res, fault);
      return;
    }
    try {
      if (method === "POST" && url.pathname === "/token") {
        this.token(body, res);
        return;
      }
      if (method === "POST" && url.pathname === "/batch/gmail/v1") {
        this.batch(body, res);
        return;
      }
      this.route(method, url, body, res);
    } catch {
      sendJson(res, 500, { error: { message: "backend error" } });
    }
  }

  private applyFault(req: IncomingMessage, res: ServerResponse, fault: HttpFault): void {
    if (fault.kind === "drop") {
      req.socket.destroy();
      return;
    }
    if (fault.kind === "hang") {
      const stop = () => {
        if (!res.destroyed) res.destroy();
      };
      req.on("aborted", stop);
      req.on("close", stop);
      return;
    }
    sendJson(res, fault.status, { error: { message: "backend error" } });
  }

  private authorizeRedirect(url: URL, res: ServerResponse): void {
    const redirectTo = url.searchParams.get("redirect_uri") ?? "";
    let target: URL;
    try {
      target = new URL(redirectTo);
    } catch {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const code = randomBytes(16).toString("hex");
    this.issuedCodes.add(code);
    target.searchParams.set("code", code);
    const state = url.searchParams.get("state");
    if (state) target.searchParams.set("state", state);
    res.statusCode = 302;
    res.setHeader("location", target.toString());
    res.setHeader("cache-control", "no-store");
    res.end();
  }

  private token(body: string, res: ServerResponse): void {
    const params = new URLSearchParams(body);
    if (params.get("grant_type") === "authorization_code") {
      const code = params.get("code") ?? "";
      if (!code || !this.issuedCodes.delete(code)) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }
      const payload: Record<string, unknown> = {
        access_token: this.connectAccess,
        expires_in: 3600,
        token_type: "Bearer",
      };
      if (this.issueRefresh) payload.refresh_token = this.connectRefresh;
      sendJson(res, 200, payload);
      return;
    }
    const refresh = params.get("refresh_token") ?? "";
    if (this.tokenBehavior === "invalid_grant" || refresh.startsWith("revoked")) {
      sendJson(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      return;
    }
    sendJson(res, 200, { access_token: this.mintedAccess, expires_in: 3600, token_type: "Bearer" });
  }

  private route(method: string, url: URL, body: string, res: ServerResponse): void {
    const path = url.pathname;
    const json = body ? parseJson(body) : {};
    if (method === "GET" && path === "/gmail/v1/users/me/profile") {
      sendJson(res, 200, {
        emailAddress: "alex@riveralabs.example",
        historyId: String(this.historySeq),
        messagesTotal: [...this.threads.values()].reduce((sum, messages) => sum + messages.length, 0),
        threadsTotal: this.threads.size,
      });
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/history") {
      this.listHistory(url, res);
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/watch") {
      sendJson(res, 200, {
        historyId: String(this.historySeq),
        expiration: String(Date.now() + 7 * 86_400_000),
      });
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/threads") {
      this.listThreads(url, res);
      return;
    }
    const modify = /^\/gmail\/v1\/users\/me\/threads\/([^/]+)\/modify$/.exec(path);
    if (method === "POST" && modify) {
      this.modify(decodeURIComponent(modify[1]), json, res);
      return;
    }
    const thread = /^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/.exec(path);
    if (method === "GET" && thread) {
      this.getThread(decodeURIComponent(thread[1]), url, res);
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/messages/send") {
      this.send(json, res);
      return;
    }
    const message = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(path);
    if (method === "GET" && message) {
      this.getMessage(decodeURIComponent(message[1]), url, res);
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/drafts") {
      sendJson(res, 200, { drafts: this.drafts.map((draft) => ({ id: draft.id, message: metadata(draft.message) })) });
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/drafts") {
      this.createDraft(json, res);
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/drafts/send") {
      this.sendDraft(json, res);
      return;
    }
    const draft = /^\/gmail\/v1\/users\/me\/drafts\/([^/]+)$/.exec(path);
    if (draft) {
      const id = decodeURIComponent(draft[1]);
      if (method === "GET") this.getDraft(id, res);
      else if (method === "PUT") this.updateDraft(id, json, res);
      else if (method === "DELETE") this.deleteDraft(id, res);
      else sendJson(res, 405, { error: { message: "method" } });
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/labels") {
      sendJson(res, 200, { labels: this.labels });
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/labels") {
      const id = `U${this.seq++}`;
      const name = String(json.name ?? "");
      this.labels.push({ id, name, type: "user" });
      sendJson(res, 200, { id, name, type: "user" });
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/settings/sendAs") {
      sendJson(res, 200, { sendAs: this.sendAs });
      return;
    }
    if (method === "GET" && path === "/gmail/v1/users/me/settings/filters") {
      sendJson(res, 200, { filter: this.filters });
      return;
    }
    if (method === "POST" && path === "/gmail/v1/users/me/settings/filters") {
      const id = `f${this.seq++}`;
      const filter = {
        id,
        criteria: (json.criteria as Record<string, unknown>) ?? {},
        action: {
          addLabelIds: arrayOf(json.action, "addLabelIds"),
          removeLabelIds: arrayOf(json.action, "removeLabelIds"),
        },
      };
      this.filters.push(filter);
      sendJson(res, 200, filter);
      return;
    }
    const filter = /^\/gmail\/v1\/users\/me\/settings\/filters\/([^/]+)$/.exec(path);
    if (method === "DELETE" && filter) {
      const id = decodeURIComponent(filter[1]);
      const index = this.filters.findIndex((item) => item.id === id);
      if (index < 0) {
        sendJson(res, 404, { error: { message: "Requested entity was not found." } });
        return;
      }
      this.filters.splice(index, 1);
      res.statusCode = 204;
      res.end();
      return;
    }
    sendJson(res, 404, { error: { message: "Requested entity was not found." } });
  }

  private listThreads(url: URL, res: ServerResponse): void {
    const pageSize = Number(url.searchParams.get("maxResults") ?? "25");
    const query = url.searchParams.get("q") ?? "";
    const token = url.searchParams.get("pageToken");
    let offset = 0;
    if (token) {
      try {
        offset = offsetOf(token);
      } catch {
        sendJson(res, 400, { error: { message: "Invalid page token." } });
        return;
      }
    }
    const ids = this.matchingThreadIds(query);
    const slice = ids.slice(offset, offset + pageSize);
    sendJson(res, 200, {
      threads: slice.map((id) => ({
        id,
        snippet: this.threads.get(id)?.at(-1)?.snippet ?? "",
        historyId: String(this.historySeq),
      })),
      nextPageToken: nextToken(offset, pageSize, ids.length),
      resultSizeEstimate: ids.length,
    });
  }

  private getThread(id: string, url: URL, res: ServerResponse): void {
    const messages = this.threads.get(id);
    if (!messages) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    const format = url.searchParams.get("format");
    const mapped = format === "metadata" ? messages.map(metadata) : messages.map(rawMessage);
    sendJson(res, 200, {
      id,
      snippet: messages.at(-1)?.snippet ?? "",
      historyId: String(this.historySeq),
      messages: mapped,
    });
  }

  private listHistory(url: URL, res: ServerResponse): void {
    const startRaw = url.searchParams.get("startHistoryId");
    if (!startRaw || !/^\d+$/.test(startRaw)) {
      sendJson(res, 400, { error: { message: "Missing startHistoryId." } });
      return;
    }
    const start = Number(startRaw);
    if (start <= this.historyFloor) {
      sendJson(res, 404, { error: { code: 404, message: "Requested entity was not found." } });
      return;
    }
    const pageSize = Number(url.searchParams.get("maxResults") ?? "100");
    let offset = 0;
    const token = url.searchParams.get("pageToken");
    if (token) {
      try {
        offset = offsetOf(token);
      } catch {
        sendJson(res, 400, { error: { message: "Invalid page token." } });
        return;
      }
    }
    const events = this.history.filter((event) => event.id > start);
    const slice = events.slice(offset, offset + pageSize);
    const body: Record<string, unknown> = { historyId: String(this.historySeq) };
    if (slice.length > 0) body.history = slice.map((event) => event.body);
    const next = nextToken(offset, pageSize, events.length);
    if (next) body.nextPageToken = next;
    sendJson(res, 200, body);
  }

  private matchingThreadIds(query: string): string[] {
    if (this.mode === "bulk") return [...this.threads.keys()];
    if (this.mode === "demo") {
      const base = demoThreadIds(WORK, query);
      const newer = /^newer_than:(\d+)d$/.exec(query);
      if (!newer) return base;
      const known = new Set(base);
      const extra = this.threadsInWindow(Number(newer[1])).filter((id) => !known.has(id));
      return [...base, ...extra];
    }
    return this.scriptedThreadIds(query);
  }

  private scriptedThreadIds(query: string): string[] {
    const newer = /newer_than:(\d+)d/i.exec(query);
    const windowIds = newer ? new Set(this.threadsInWindow(Number(newer[1]))) : null;
    const labelMatch = /(?:^|\s)label:(\S+)/i.exec(query);
    const needle = labelMatch?.[1]?.toLowerCase() ?? "";
    const ids: string[] = [];
    for (const [id, messages] of this.threads) {
      if (windowIds && !windowIds.has(id)) continue;
      if (needle && !this.threadMatchesLabel(messages, needle)) continue;
      ids.push(id);
    }
    return ids;
  }

  private threadsInWindow(days: number): string[] {
    const cutoff = Date.now() - days * 86_400_000;
    const ids: string[] = [];
    for (const [id, messages] of this.threads) {
      const newest = Math.max(...messages.map((message) => Number(message.internalDate) || 0));
      if (newest >= cutoff) ids.push(id);
    }
    return ids;
  }

  private threadMatchesLabel(messages: StoredMessage[], needle: string): boolean {
    for (const message of messages) {
      for (const labelId of message.labelIds) {
        if (labelId.toLowerCase() === needle) return true;
        const name = this.labels.find((label) => label.id === labelId)?.name ?? labelId;
        if (name.replace(/[/ ]/g, "-").toLowerCase() === needle) return true;
      }
    }
    return false;
  }

  private getMessage(id: string, url: URL, res: ServerResponse): void {
    const message = this.findMessage(id);
    if (!message) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    const format = url.searchParams.get("format");
    sendJson(res, 200, format === "metadata" ? metadata(message) : rawMessage(message));
  }

  private modify(id: string, json: Json, res: ServerResponse): void {
    const messages = this.threads.get(id);
    if (!messages) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    const add = stringList(json.addLabelIds);
    const remove = stringList(json.removeLabelIds);
    this.retouch(id, add, remove);
    sendJson(res, 200, { id, messages: messages.map(metadata) });
  }

  private send(json: Json, res: ServerResponse): void {
    const raw = String(json.raw ?? "");
    const threadId = typeof json.threadId === "string" && json.threadId ? json.threadId : `t${this.seq++}`;
    const id = `g${this.seq++}`;
    const message = messageFromRaw(id, threadId, raw, ["SENT"]);
    const list = this.threads.get(threadId) ?? [];
    list.push(message);
    this.threads.set(threadId, list);
    this.record({
      messagesAdded: [{ message: { id, threadId, labelIds: ["SENT"] } }],
    });
    sendJson(res, 200, { id, threadId, labelIds: ["SENT"] });
  }

  private createDraft(json: Json, res: ServerResponse): void {
    const messageBody = objectOf(json.message);
    const raw = String(messageBody.raw ?? "");
    const threadId = typeof messageBody.threadId === "string" ? messageBody.threadId : "";
    const id = `d${this.seq++}`;
    const message = messageFromRaw(`m${id}`, threadId, raw, ["DRAFT"]);
    this.drafts.push({ id, message });
    sendJson(res, 200, { id, message: { id: message.id, threadId, labelIds: ["DRAFT"] } });
  }

  private updateDraft(id: string, json: Json, res: ServerResponse): void {
    const draft = this.drafts.find((item) => item.id === id);
    if (!draft) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    const messageBody = objectOf(json.message);
    const raw = String(messageBody.raw ?? draft.message.raw);
    const threadId = typeof messageBody.threadId === "string" ? messageBody.threadId : draft.message.threadId;
    draft.message = messageFromRaw(draft.message.id, threadId, raw, ["DRAFT"]);
    sendJson(res, 200, { id, message: { id: draft.message.id, threadId, labelIds: ["DRAFT"] } });
  }

  private getDraft(id: string, res: ServerResponse): void {
    const draft = this.drafts.find((item) => item.id === id);
    if (!draft) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    sendJson(res, 200, { id, message: rawMessage(draft.message) });
  }

  private deleteDraft(id: string, res: ServerResponse): void {
    const index = this.drafts.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    this.drafts.splice(index, 1);
    res.statusCode = 204;
    res.end();
  }

  private sendDraft(json: Json, res: ServerResponse): void {
    const id = String(json.id ?? "");
    const index = this.drafts.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: { message: "Requested entity was not found." } });
      return;
    }
    const draft = this.drafts[index];
    if (!draft) return;
    this.drafts.splice(index, 1);
    const provided = objectOf(json.message);
    const raw = String(provided.raw || draft.message.raw);
    const threadId = (typeof provided.threadId === "string" && provided.threadId) || draft.message.threadId || `t${this.seq++}`;
    const sentId = `g${this.seq++}`;
    const message = messageFromRaw(sentId, threadId, raw, ["SENT"]);
    const list = this.threads.get(threadId) ?? [];
    list.push(message);
    this.threads.set(threadId, list);
    this.record({
      messagesAdded: [{ message: { id: sentId, threadId, labelIds: ["SENT"] } }],
    });
    sendJson(res, 200, { id: sentId, threadId, labelIds: ["SENT"] });
  }

  private batch(body: string, res: ServerResponse): void {
    // Only ids this process already holds are written back, in the caller's order.
    const ids: string[] = [];
    for (const match of body.matchAll(/\/gmail\/v1\/users\/me\/threads\/([A-Za-z0-9]+)/g)) {
      const requested = match[1] ?? "";
      for (const key of this.threads.keys()) {
        if (key === requested) ids.push(key);
      }
    }
    const parts = ids.map((id, index) => {
      const messages = this.threads.get(id) ?? [];
      const payload = JSON.stringify({
        id,
        snippet: messages.at(-1)?.snippet ?? "",
        historyId: String(this.historySeq),
        messages: messages.map(metadata),
      });
      return [
        `--batch_cbm`,
        `Content-Type: application/http`,
        `Content-ID: <response-${index}>`,
        ``,
        `HTTP/1.1 200 OK`,
        `Content-Type: application/json; charset=UTF-8`,
        ``,
        payload,
        ``,
      ].join("\r\n");
    });
    const text = `${parts.join("")}--batch_cbm--`;
    res.statusCode = 200;
    res.setHeader("content-type", "multipart/mixed; boundary=batch_cbm");
    res.end(text);
  }

  private findMessage(id: string): StoredMessage | null {
    for (const messages of this.threads.values()) {
      const found = messages.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }
}

type Json = Record<string, unknown>;

function isMailWrite(item: { method: string; path: string }): boolean {
  if (item.method === "GET" || item.method === "HEAD") return false;
  const path = item.path.split("?")[0];
  if (path === "/token" || path === "/batch/gmail/v1") return false;
  return item.method === "POST" || item.method === "PUT" || item.method === "DELETE";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(text);
}

function parseJson(body: string): Json {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
  } catch {
    return {};
  }
}

function objectOf(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function arrayOf(value: unknown, key: string): string[] {
  const obj = objectOf(value);
  return stringList(obj[key]);
}
