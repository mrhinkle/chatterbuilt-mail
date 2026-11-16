import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { demoMailbox } from "./demo-mailbox.js";
import type { MailMessage } from "./types.js";

/**
 * Loopback stand-in for Microsoft identity and Graph. Tests and the smoke
 * script import this. The mail server does not mount it. It binds 127.0.0.1.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
}

export type MsFault = { kind: "status"; status: number; retryAfter?: string } | { kind: "drop" } | { kind: "hang" };

export type DevicePoll = "ok" | "pending" | "slow_down" | "declined" | "expired" | "bad_code";

/** Same six names as MICROSOFT_FOLDERS. A parent folder outside this set is not mirrored. */
const SYNCED_FOLDERS = new Set(["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "archive"]);

interface GraphAddress {
  emailAddress: { address: string; name?: string };
}

interface StoredMessage {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  receivedDateTime: string;
  isRead: boolean;
  isDraft: boolean;
  importance: string;
  parentFolderId: string;
  flag: { flagStatus: string };
  categories: string[];
  from: GraphAddress;
  toRecipients: GraphAddress[];
  ccRecipients: GraphAddress[];
  bccRecipients: GraphAddress[];
  replyTo: GraphAddress[];
  body: { contentType: string; content: string };
  hasAttachments: boolean;
  internetMessageId: string;
  internetMessageHeaders: Array<{ name: string; value: string }>;
  attachments: Array<{ id: string; name: string; contentType: string; contentBytes?: string }>;
}

interface StoredRule {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
}

const SYSTEM = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "UNREAD", "STARRED", "IMPORTANT"]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function headerMap(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

function emailOf(value: string): GraphAddress {
  const match = /^(.*)<([^>]+)>$/.exec(value.trim());
  if (!match) return { emailAddress: { address: value.trim() } };
  const name = match[1]?.trim() ?? "";
  const address = match[2]?.trim() ?? "";
  return name ? { emailAddress: { address, name } } : { emailAddress: { address } };
}

function folderFor(labels: string[]): string {
  if (labels.includes("INBOX")) return "inbox";
  if (labels.includes("SENT")) return "sentitems";
  if (labels.includes("DRAFT")) return "drafts";
  if (labels.includes("TRASH")) return "deleteditems";
  if (labels.includes("SPAM")) return "junkemail";
  return "archive";
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)), ...extra });
  res.end(payload);
}

function matchesFilter(message: StoredMessage, filter: string | null): boolean {
  if (!filter) return true;
  return filter.split(/\s+and\s+/i).every((part) => matchClause(message, part.trim()));
}

function matchClause(message: StoredMessage, part: string): boolean {
  const conversation = /^conversationId eq '((?:[^']|'')*)'$/.exec(part);
  if (conversation?.[1] !== undefined) return message.conversationId === conversation[1].replace(/''/g, "'");
  const read = /^isRead eq (true|false)$/.exec(part);
  if (read) return message.isRead === (read[1] === "true");
  const ge = /^receivedDateTime ge (\S+)$/.exec(part);
  if (ge?.[1]) return message.receivedDateTime >= ge[1];
  const lt = /^receivedDateTime lt (\S+)$/.exec(part);
  if (lt?.[1]) return message.receivedDateTime < lt[1];
  if (part === "hasAttachments eq true") return message.hasAttachments;
  if (part === "flag/flagStatus eq 'flagged'") return message.flag.flagStatus === "flagged";
  if (part === "flag/flagStatus ne 'flagged'") return message.flag.flagStatus !== "flagged";
  if (part === "importance eq 'high'") return message.importance === "high";
  if (part === "importance ne 'high'") return message.importance !== "high";
  const category = /^categories\/any\(c:c eq '((?:[^']|'')*)'\)$/.exec(part);
  if (category?.[1] !== undefined) return message.categories.includes(category[1].replace(/''/g, "'"));
  return false;
}

function matchesSearch(message: StoredMessage, search: string | null): boolean {
  if (!search) return true;
  const text = search.replace(/^"|"$/g, "");
  const blob = `${message.subject} ${message.bodyPreview} ${message.body.content} ${message.from.emailAddress.address}`.toLowerCase();
  for (const bit of text.split(/\s+/).filter((item) => item.length > 0)) {
    const from = /^from:(.+)$/i.exec(bit);
    if (from?.[1]) {
      if (!message.from.emailAddress.address.toLowerCase().includes(from[1].replace(/^"|"$/g, "").toLowerCase())) return false;
      continue;
    }
    if (/^hasAttachments:true$/i.test(bit)) {
      if (!message.hasAttachments) return false;
      continue;
    }
    if (bit.startsWith("received")) continue;
    if (!blob.includes(bit.replace(/^"|"$/g, "").toLowerCase())) return false;
  }
  return true;
}

export class FakeMicrosoftServer {
  origin = "";
  deviceUrl = "";
  tokenUrl = "";
  authUrl = "";
  graphBase = "";
  issuedDeviceCode = "";
  userCode = "";
  issuedAuthCode = "";
  autoApprove = true;
  blockDeviceCode = false;
  requireSecret = false;
  devicePoll: DevicePoll = "ok";
  refreshError: string | null = null;
  meMail: string | null = "owner@outlook.example";
  meUpn = "owner@outlook.example";
  /** Graph send returns 202 before the message is visible. Tests turn this on. */
  hideAfterSend = false;
  /** Page size when a list request omits `$top`. */
  listPageSize = 50;
  /** Split an incremental delta after this many changes. 0 keeps one page. */
  deltaPageSize = 0;
  /** Removals the fake put on a delta page, in emit order. */
  readonly removals: Array<{ folder: string; id: string; reason: "changed" | "deleted" }> = [];
  /** Ids whose next removal is `changed` even when the message moved between synced folders. */
  private readonly changedIds = new Set<string>();
  /** When set, every list page returns this next link instead of the real one. */
  poisonNextLink: string | null = null;
  /** Replaces the documented Outlook upload URL. Tests use this for URLs that must be refused. */
  nextUploadUrl: string | null = null;
  /** ok stores the bytes. The other modes fail the first PUT without a second chance. */
  uploadMode: "ok" | "redirect" | "bad-range" | "reject" = "ok";
  deviceExpiresIn = 900;
  deviceInterval = 5;
  listening = false;

  private server: Server | null = null;
  private readonly log: RecordedRequest[] = [];
  private readonly messages: StoredMessage[] = [];
  private readonly categories: Array<{ displayName: string; color: string }> = [];
  private readonly rules: StoredRule[] = [];
  private readonly writeFaults: MsFault[] = [];
  private readonly readFaults: MsFault[] = [];
  private readonly deltaFails = new Map<string, number>();
  private readonly deltaState = new Map<string, { token: string; snapshot: Map<string, string> }>();
  private readonly deltaCarry = new Map<string, { snapshot: Map<string, string>; rest: Array<Record<string, unknown>> }>();
  private readonly hiddenIds = new Set<string>();
  private readonly folderOverrides = new Map<string, string>();
  private readonly uploaded = new Map<string, Buffer>();
  private readonly uploadNames = new Map<string, { name: string; contentType: string }>();
  private access = "";
  private refresh = "";

  static async scripted(): Promise<FakeMicrosoftServer> {
    const server = new FakeMicrosoftServer();
    await server.listen();
    return server;
  }

  static async demo(): Promise<FakeMicrosoftServer> {
    const server = new FakeMicrosoftServer();
    const box = demoMailbox();
    for (const threads of box.threads.values()) {
      for (const thread of threads) {
        for (const message of thread.messages) server.messages.push(fromDemo(message));
      }
    }
    await server.listen();
    return server;
  }

  recorded(): RecordedRequest[] {
    if (!this.listening) throw new Error("fake Microsoft server is not listening");
    return this.log.map((row) => ({ ...row, headers: { ...row.headers } }));
  }

  failNextWrite(fault: MsFault): void {
    this.writeFaults.push(fault);
  }

  failNextRead(fault: MsFault): void {
    this.readFaults.push(fault);
  }

  /** The next `times` delta calls for this folder return 410 syncStateNotFound. */
  failDelta(folder: string, times: number): void {
    this.deltaFails.set(folder, times);
  }

  snapshot(): Array<{
    id: string;
    conversationId: string;
    parentFolderId: string;
    isDraft: boolean;
    subject: string;
    body: string;
    attachmentIds: string[];
    to: string[];
    cc: string[];
    bcc: string[];
  }> {
    return this.messages.map((item) => ({
      id: item.id,
      conversationId: item.conversationId,
      parentFolderId: item.parentFolderId,
      isDraft: item.isDraft,
      subject: item.subject,
      body: item.body.content,
      attachmentIds: item.attachments.map((attachment) => attachment.id),
      to: item.toRecipients.map((row) => row.emailAddress.address),
      cc: item.ccRecipients.map((row) => row.emailAddress.address),
      bcc: item.bccRecipients.map((row) => row.emailAddress.address),
    }));
  }

  addMessage(input: Partial<StoredMessage> & { id: string; parentFolderId: string }): StoredMessage {
    const message: StoredMessage = {
      id: input.id,
      conversationId: input.conversationId ?? input.id,
      subject: input.subject ?? "",
      bodyPreview: input.bodyPreview ?? "",
      receivedDateTime: input.receivedDateTime ?? new Date().toISOString(),
      isRead: input.isRead ?? true,
      isDraft: input.isDraft ?? input.parentFolderId === "drafts",
      importance: input.importance ?? "normal",
      parentFolderId: input.parentFolderId,
      flag: input.flag ?? { flagStatus: "notFlagged" },
      categories: input.categories ?? [],
      from: input.from ?? { emailAddress: { address: "alex@example.com", name: "Alex" } },
      toRecipients: input.toRecipients ?? [{ emailAddress: { address: this.meMail ?? this.meUpn } }],
      ccRecipients: input.ccRecipients ?? [],
      bccRecipients: input.bccRecipients ?? [],
      replyTo: input.replyTo ?? [],
      body: input.body ?? { contentType: "Text", content: input.bodyPreview ?? "" },
      hasAttachments: input.hasAttachments ?? false,
      internetMessageId: input.internetMessageId ?? `<${input.id}@mail.example>`,
      internetMessageHeaders: input.internetMessageHeaders ?? [],
      attachments: input.attachments ?? [],
    };
    this.messages.push(message);
    return message;
  }

  editSubject(id: string, subject: string): void {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return;
    message.subject = subject;
    message.bodyPreview = subject;
  }

  moveMessage(id: string, folder: string): void {
    const message = this.messages.find((item) => item.id === id);
    if (message) message.parentFolderId = folder;
  }

  /**
   * The next removal of this id uses `reason: changed`. A move between synced
   * folders is otherwise `deleted`, which is what message delta documents.
   */
  expectChanged(id: string): void {
    this.changedIds.add(id);
  }

  removeMessage(id: string): void {
    const index = this.messages.findIndex((item) => item.id === id);
    if (index >= 0) this.messages.splice(index, 1);
  }

  /** Well-known folder ids differ per mailbox. The bearer is the access token. */
  setFolderId(bearer: string, folder: string, id: string): void {
    this.folderOverrides.set(`${bearer}\u0000${folder}`, id);
  }

  uploadedBytes(id: string): Buffer {
    return Buffer.from(this.uploaded.get(id) ?? Buffer.alloc(0));
  }

  async close(): Promise<void> {
    this.listening = false;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async listen(): Promise<void> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.origin = `http://127.0.0.1:${port}`;
    this.graphBase = this.origin;
    this.deviceUrl = `${this.origin}/common/oauth2/v2.0/devicecode`;
    this.tokenUrl = `${this.origin}/common/oauth2/v2.0/token`;
    this.authUrl = `${this.origin}/common/oauth2/v2.0/authorize`;
    this.server = server;
    this.listening = true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", this.origin || "http://127.0.0.1");
    const method = req.method ?? "GET";
    const headers = headerMap(req);
    this.log.push({
      method,
      path: `${url.pathname}${url.search}`,
      body: body.toString("utf8"),
      headers,
    });
    if (url.pathname === "/common/oauth2/v2.0/devicecode") return this.deviceCode(res, body.toString("utf8"));
    if (url.pathname === "/common/oauth2/v2.0/token") return this.token(res, body.toString("utf8"));
    if (url.pathname === "/common/oauth2/v2.0/authorize") return this.authorize(res, url);
    if (url.pathname.startsWith("/upload/")) return this.upload(req, res, url.pathname, method, body, headers);
    if (this.faulted(req, res, url.pathname, method)) return;
    this.graph(res, url, method, body.toString("utf8"), headers);
  }

  private faulted(req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
    const write = method !== "GET" && method !== "HEAD";
    const queue = write ? this.writeFaults : this.readFaults;
    if (queue.length === 0) return false;
    if (!write && !path.includes("/messages") && !path.includes("/mailFolders")) return false;
    const fault = queue.shift();
    if (!fault) return false;
    if (fault.kind === "drop") {
      req.socket.destroy();
      return true;
    }
    if (fault.kind === "hang") return true;
    const extra: Record<string, string> = {};
    if (fault.retryAfter !== undefined) extra["retry-after"] = fault.retryAfter;
    json(res, fault.status, { error: { code: "Error", message: "scripted" } }, extra);
    return true;
  }

  private deviceCode(res: ServerResponse, body: string): void {
    if (this.blockDeviceCode) {
      json(res, 400, { error: "unauthorized_client", error_description: "AADSTS50059: device code flow is disabled" });
      return;
    }
    const form = new URLSearchParams(body);
    if (!form.get("client_id") || !form.get("scope")) {
      json(res, 400, { error: "invalid_request", error_description: "client_id and scope are required" });
      return;
    }
    this.issuedDeviceCode = `device-${randomBytes(18).toString("base64url")}`;
    this.userCode = "ABCD-EFGH";
    json(res, 200, {
      device_code: this.issuedDeviceCode,
      user_code: this.userCode,
      verification_uri: "https://microsoft.com/devicelogin",
      expires_in: this.deviceExpiresIn,
      interval: this.deviceInterval,
      message: "Open microsoft.com/devicelogin",
    });
  }

  private token(res: ServerResponse, body: string): void {
    const form = new URLSearchParams(body);
    if (this.requireSecret && !(form.get("client_secret") ?? "").trim()) {
      json(res, 401, { error: "invalid_client", error_description: "client_secret is required" });
      return;
    }
    const grant = form.get("grant_type") ?? "";
    if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
      if (form.get("device_code") !== this.issuedDeviceCode) {
        json(res, 400, { error: "bad_verification_code", error_description: "bad device code" });
        return;
      }
      if (!this.autoApprove || this.devicePoll === "pending") {
        json(res, 400, { error: "authorization_pending", error_description: "still waiting" });
        return;
      }
      if (this.devicePoll === "slow_down") {
        json(res, 400, { error: "slow_down", error_description: "slow down" });
        return;
      }
      if (this.devicePoll === "declined") {
        json(res, 400, { error: "authorization_declined", error_description: "declined" });
        return;
      }
      if (this.devicePoll === "expired") {
        json(res, 400, { error: "expired_token", error_description: "expired" });
        return;
      }
      if (this.devicePoll === "bad_code") {
        json(res, 400, { error: "bad_verification_code", error_description: "bad code" });
        return;
      }
      json(res, 200, this.tokens());
      return;
    }
    if (grant === "refresh_token") {
      if (this.refreshError) {
        json(res, 400, { error: this.refreshError, error_description: this.refreshError });
        return;
      }
      json(res, 200, this.tokens());
      return;
    }
    if (grant === "authorization_code") {
      if (form.get("code") !== this.issuedAuthCode || !form.get("code_verifier")) {
        json(res, 400, { error: "invalid_grant", error_description: "code was not accepted" });
        return;
      }
      json(res, 200, this.tokens());
      return;
    }
    json(res, 400, { error: "unsupported_grant_type", error_description: "unsupported" });
  }

  private tokens(): { access_token: string; refresh_token: string; expires_in: number; token_type: string } {
    this.access = `access-${randomBytes(12).toString("base64url")}`;
    this.refresh = `refresh-${randomBytes(12).toString("base64url")}`;
    return { access_token: this.access, refresh_token: this.refresh, expires_in: 3600, token_type: "Bearer" };
  }

  private authorize(res: ServerResponse, url: URL): void {
    this.issuedAuthCode = `code-${randomBytes(12).toString("base64url")}`;
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    let target: URL;
    try {
      target = new URL(redirect);
    } catch {
      json(res, 400, { error: "invalid_request", error_description: "redirect_uri" });
      return;
    }
    target.searchParams.set("code", this.issuedAuthCode);
    const state = url.searchParams.get("state");
    if (state) target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString() });
    res.end();
  }

  private upload(req: IncomingMessage, res: ServerResponse, path: string, method: string, body: Buffer, headers: Record<string, string>): void {
    if (this.faulted(req, res, path, method)) return;
    if (method !== "PUT") {
      json(res, 405, { error: { code: "Error", message: "method" } });
      return;
    }
    const id = decodeURIComponent(path.slice("/upload/".length));
    const message = this.messages.find((item) => item.id === id);
    if (!message) {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    if (this.uploadMode === "redirect") {
      res.writeHead(302, { location: "https://evil.example/collect" });
      res.end();
      return;
    }
    if (this.uploadMode === "reject") {
      json(res, 400, { error: { code: "invalidRange", message: "invalid chunk" } });
      return;
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers["content-range"] ?? "");
    if (!match) {
      json(res, 400, { error: { code: "invalidRange", message: "Content-Range" } });
      return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    const length = end - start + 1;
    const have = this.uploaded.get(id)?.length ?? 0;
    if (length < 1 || length >= 4 * 1024 * 1024 || body.length !== length || start !== have || end >= total) {
      json(res, 400, { error: { code: "invalidRange", message: "invalid chunk" } });
      return;
    }
    const next = Buffer.concat([this.uploaded.get(id) ?? Buffer.alloc(0), body]);
    this.uploaded.set(id, next);
    if (this.uploadMode === "bad-range") {
      json(res, 200, { nextExpectedRanges: ["0"] });
      return;
    }
    if (end + 1 < total) {
      json(res, 200, { nextExpectedRanges: [String(end + 1)] });
      return;
    }
    const named = this.uploadNames.get(id);
    message.hasAttachments = true;
    message.attachments.push({
      id: `att_${randomBytes(3).toString("hex")}`,
      name: named?.name ?? "file",
      contentType: named?.contentType ?? "application/octet-stream",
    });
    res.writeHead(201, {
      location: `https://outlook.office.com/api/v2.0/Users('synthetic')/Messages('${id}')/Attachments('att')`,
      "content-length": "0",
    });
    res.end();
  }

  private graph(res: ServerResponse, url: URL, method: string, body: string, headers: Record<string, string>): void {
    const path = url.pathname;
    if (path === "/v1.0/me" && method === "GET") {
      const me: Record<string, string> = {};
      if (this.meMail) me.mail = this.meMail;
      if (this.meUpn) me.userPrincipalName = this.meUpn;
      json(res, 200, me);
      return;
    }
    if (path === "/v1.0/me/sendMail" && method === "POST") return this.sendMail(res, body);
    if (path === "/v1.0/me/outlook/masterCategories") return this.categoriesRoute(res, method, body);
    if (path === "/v1.0/me/mailFolders/inbox/messageRules" && (method === "GET" || method === "POST")) {
      return this.rulesRoute(res, method, body);
    }
    const ruleId = /^\/v1\.0\/me\/mailFolders\/inbox\/messageRules\/([^/]+)$/.exec(path);
    if (ruleId && method === "DELETE") {
      const id = decodeURIComponent(ruleId[1] ?? "");
      const index = this.rules.findIndex((item) => item.id === id);
      if (index >= 0) this.rules.splice(index, 1);
      res.writeHead(204);
      res.end();
      return;
    }
    const delta = /^\/v1\.0\/me\/mailFolders\/([^/]+)\/messages\/delta$/.exec(path);
    if (delta && method === "GET") return this.delta(res, decodeURIComponent(delta[1] ?? ""), url);
    const folderMessages = /^\/v1\.0\/me\/mailFolders\/([^/]+)\/messages$/.exec(path);
    if (folderMessages && method === "GET") return this.list(res, url, decodeURIComponent(folderMessages[1] ?? ""));
    const folder = /^\/v1\.0\/me\/mailFolders\/([^/]+)$/.exec(path);
    if (folder && method === "GET") {
      const name = decodeURIComponent(folder[1] ?? "");
      const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const mapped = this.folderOverrides.get(`${bearer}\u0000${name}`);
      json(res, 200, { id: mapped ?? name });
      return;
    }
    const attach = /^\/v1\.0\/me\/messages\/([^/]+)\/attachments$/.exec(path);
    if (attach && method === "POST") return this.addAttachment(res, decodeURIComponent(attach[1] ?? ""), body);
    const action = /^\/v1\.0\/me\/messages\/([^/]+)\/(createReplyAll|createReply|createForward|send|move|attachments\/createUploadSession)$/.exec(path);
    if (action) return this.messageAction(res, decodeURIComponent(action[1] ?? ""), action[2] ?? "", method, body);
    const one = /^\/v1\.0\/me\/messages\/([^/]+)$/.exec(path);
    if (one) return this.oneMessage(res, decodeURIComponent(one[1] ?? ""), method, body);
    if (path === "/v1.0/me/messages" && method === "GET") return this.list(res, url, null);
    if (path === "/v1.0/me/messages" && method === "POST") return this.createMessage(res, body, null);
    json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
  }

  private sendMail(res: ServerResponse, body: string): void {
    const parsed = parseObject(body);
    const message = objectOf(parsed.message);
    const created = this.createFromPayload(message, "sentitems", false);
    this.concealSent(created.id);
    res.writeHead(202);
    res.end();
  }

  private categoriesRoute(res: ServerResponse, method: string, body: string): void {
    if (method === "POST") {
      const parsed = parseObject(body);
      const name = typeof parsed.displayName === "string" ? parsed.displayName : "";
      if (name && !this.categories.some((item) => item.displayName === name)) {
        this.categories.push({ displayName: name, color: "preset0" });
      }
      json(res, 201, { displayName: name, color: "preset0" });
      return;
    }
    json(res, 200, { value: this.categories });
  }

  private rulesRoute(res: ServerResponse, method: string, body: string): void {
    if (method === "POST") {
      const parsed = parseObject(body);
      const rule: StoredRule = {
        id: `rule-${randomBytes(4).toString("hex")}`,
        displayName: typeof parsed.displayName === "string" ? parsed.displayName : "Chatterbuilt",
        sequence: 1,
        isEnabled: true,
        conditions: objectOf(parsed.conditions),
        actions: objectOf(parsed.actions),
      };
      this.rules.push(rule);
      json(res, 201, rule);
      return;
    }
    json(res, 200, { value: this.rules });
  }

  private delta(res: ServerResponse, folder: string, url: URL): void {
    const left = this.deltaFails.get(folder) ?? 0;
    if (left > 0) {
      this.deltaFails.set(folder, left - 1);
      json(res, 410, { error: { code: "syncStateNotFound", message: "syncStateNotFound" } });
      return;
    }
    const token = url.searchParams.get("token");
    const page = url.searchParams.get("page");
    if (token && page) {
      const carry = this.deltaCarry.get(`${folder}:${page}`);
      if (!carry) {
        json(res, 410, { error: { code: "syncStateNotFound", message: "syncStateNotFound" } });
        return;
      }
      this.deltaCarry.delete(`${folder}:${page}`);
      this.emitDelta(res, folder, carry.rest, carry.snapshot);
      return;
    }
    const known = this.deltaState.get(folder);
    if (token) {
      if (!known || known.token !== token) {
        json(res, 410, { error: { code: "syncStateNotFound", message: "syncStateNotFound" } });
        return;
      }
      const current = this.folderSnapshot(folder);
      const value: Array<Record<string, unknown>> = [];
      for (const message of this.messages) {
        if (message.parentFolderId !== folder || this.hiddenIds.has(message.id)) continue;
        if (known.snapshot.get(message.id) !== current.get(message.id)) value.push(view(message));
      }
      for (const id of known.snapshot.keys()) {
        if (current.has(id)) continue;
        const reason = this.removalReason(folder, id);
        this.removals.push({ folder, id, reason });
        value.push({ id, "@removed": { reason } });
      }
      if (value.length === 0) {
        json(res, 200, { value: [], "@odata.deltaLink": `${this.origin}${url.pathname}?token=${token}` });
        return;
      }
      this.emitDelta(res, folder, value, current);
      return;
    }
    const next = randomBytes(6).toString("hex");
    this.deltaState.set(folder, { token: next, snapshot: this.folderSnapshot(folder) });
    json(res, 200, {
      value: this.messages.filter((item) => item.parentFolderId === folder && !this.hiddenIds.has(item.id)).map(view),
      "@odata.deltaLink": `${this.origin}/v1.0/me/mailFolders/${folder}/messages/delta?token=${next}`,
    });
  }

  /**
   * A move into a synced folder is `deleted` on the folder that lost the message.
   * https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0
   * Emptying Deleted Items, and a move into a folder this sync does not track,
   * is `changed`: deleted and restorable.
   * https://learn.microsoft.com/en-us/graph/delta-query-overview
   */
  private removalReason(folder: string, id: string): "changed" | "deleted" {
    if (this.changedIds.has(id)) return "changed";
    const message = this.messages.find((item) => item.id === id);
    const visible = Boolean(message && !this.hiddenIds.has(message.id));
    if (!visible) return folder === "deleteditems" ? "changed" : "deleted";
    if (message && SYNCED_FOLDERS.has(message.parentFolderId)) return "deleted";
    return "changed";
  }

  /** The snapshot commits on the last page, with the deltaLink. Earlier pages only carry a next link. */
  private emitDelta(res: ServerResponse, folder: string, items: Array<Record<string, unknown>>, snapshot: Map<string, string>): void {
    const size = this.deltaPageSize > 0 ? this.deltaPageSize : items.length;
    const head = items.slice(0, size);
    const rest = items.slice(size);
    if (rest.length > 0) {
      const page = randomBytes(6).toString("hex");
      this.deltaCarry.set(`${folder}:${page}`, { snapshot, rest });
      const token = this.deltaState.get(folder)?.token ?? page;
      json(res, 200, {
        value: head,
        "@odata.nextLink": `${this.origin}/v1.0/me/mailFolders/${folder}/messages/delta?token=${token}&page=${page}`,
      });
      return;
    }
    const next = randomBytes(6).toString("hex");
    this.deltaState.set(folder, { token: next, snapshot });
    json(res, 200, {
      value: head,
      "@odata.deltaLink": `${this.origin}/v1.0/me/mailFolders/${folder}/messages/delta?token=${next}`,
    });
  }

  private folderSnapshot(folder: string): Map<string, string> {
    const snap = new Map<string, string>();
    for (const message of this.messages) {
      if (message.parentFolderId !== folder || this.hiddenIds.has(message.id)) continue;
      snap.set(message.id, JSON.stringify(view(message)));
    }
    return snap;
  }

  private list(res: ServerResponse, url: URL, folder: string | null): void {
    const filter = url.searchParams.get("$filter");
    const search = url.searchParams.get("$search");
    const rows = this.messages.filter((item) => !this.hiddenIds.has(item.id) && (folder === null || item.parentFolderId === folder) && matchesFilter(item, filter) && matchesSearch(item, search));
    const skip = Number(url.searchParams.get("$skip") ?? "0");
    const requested = Number(url.searchParams.get("$top") ?? "");
    const start = Number.isFinite(skip) && skip > 0 ? skip : 0;
    const size = Number.isFinite(requested) && requested > 0 ? requested : this.listPageSize;
    const page = rows.slice(start, start + size);
    const payload: Record<string, unknown> = { value: page.map(view) };
    if (this.poisonNextLink) {
      payload["@odata.nextLink"] = this.poisonNextLink;
    } else if (start + size < rows.length) {
      const next = new URL(url.toString());
      next.searchParams.set("$skip", String(start + size));
      next.searchParams.set("$top", String(size));
      payload["@odata.nextLink"] = next.toString();
    }
    json(res, 200, payload);
  }

  private messageAction(res: ServerResponse, id: string, action: string, method: string, body: string): void {
    const source = this.messages.find((item) => item.id === id);
    if (!source || method !== "POST") {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    if (action === "send") {
      source.isDraft = false;
      source.parentFolderId = "sentitems";
      this.concealSent(source.id);
      res.writeHead(202);
      res.end();
      return;
    }
    if (action === "move") {
      const destination = parseObject(body).destinationId;
      if (typeof destination === "string" && destination.length > 0) source.parentFolderId = destination;
      json(res, 201, view(source));
      return;
    }
    if (action === "attachments/createUploadSession") {
      const item = objectOf(parseObject(body).AttachmentItem);
      const name = typeof item.name === "string" && item.name.length > 0 ? item.name : "file";
      const contentType = typeof item.contentType === "string" && item.contentType.length > 0 ? item.contentType : "application/octet-stream";
      this.uploadNames.set(source.id, { name, contentType });
      const uploadUrl = this.nextUploadUrl ?? `https://outlook.office.com/api/v2.0/Users('synthetic')/Messages('${source.id}')/AttachmentSessions('${source.id}')?authtoken=synthetic`;
      json(res, 201, { uploadUrl, nextExpectedRanges: ["0-"] });
      return;
    }
    const parsed = parseObject(body);
    const message = objectOf(parsed.message);
    const created = this.createFromPayload(message, "drafts", true);
    created.conversationId = source.conversationId;
    copyHeaders(created, message);
    if (action === "createReply" || action === "createReplyAll") this.fillReplyRecipients(created, source, message, action);
    json(res, 201, view(created));
  }

  /** Absent recipient keys keep Graph's calculated set. A present key, even empty, wins. */
  private fillReplyRecipients(created: StoredMessage, source: StoredMessage, message: Record<string, unknown>, action: "createReply" | "createReplyAll"): void {
    const self = (this.meMail ?? this.meUpn).toLowerCase();
    const primary = source.replyTo.length > 0 ? source.replyTo : [source.from];
    const ownSent = source.parentFolderId === "sentitems" || source.from.emailAddress.address.toLowerCase() === self;
    if (!Object.prototype.hasOwnProperty.call(message, "toRecipients")) {
      created.toRecipients = action === "createReplyAll"
        ? dropSelf([...primary, ...source.toRecipients], self)
        : dropSelf(ownSent ? source.toRecipients : primary, self);
    }
    if (!Object.prototype.hasOwnProperty.call(message, "ccRecipients")) {
      if (action === "createReply") created.ccRecipients = [];
      else {
        const to = new Set(created.toRecipients.map((item) => item.emailAddress.address.toLowerCase()));
        created.ccRecipients = dropSelf(source.ccRecipients, self).filter((item) => !to.has(item.emailAddress.address.toLowerCase()));
      }
    }
    if (!Object.prototype.hasOwnProperty.call(message, "bccRecipients")) created.bccRecipients = [];
    if (!Object.prototype.hasOwnProperty.call(message, "subject")) {
      created.subject = /^re:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`;
    }
  }

  private addAttachment(res: ServerResponse, id: string, body: string): void {
    const message = this.messages.find((item) => item.id === id);
    if (!message || this.hiddenIds.has(id)) {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    const parsed = parseObject(body);
    const attachment = {
      id: `att_${randomBytes(3).toString("hex")}`,
      name: typeof parsed.name === "string" ? parsed.name : "file",
      contentType: typeof parsed.contentType === "string" ? parsed.contentType : "application/octet-stream",
      contentBytes: typeof parsed.contentBytes === "string" ? parsed.contentBytes : undefined,
    };
    message.attachments.push(attachment);
    message.hasAttachments = true;
    json(res, 201, { id: attachment.id, name: attachment.name, contentType: attachment.contentType });
  }

  private concealSent(id: string): void {
    if (this.hideAfterSend) this.hiddenIds.add(id);
  }

  private oneMessage(res: ServerResponse, id: string, method: string, body: string): void {
    if (this.hiddenIds.has(id)) {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    const index = this.messages.findIndex((item) => item.id === id);
    if (index < 0) {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    const current = this.messages[index];
    if (!current) {
      json(res, 404, { error: { code: "ErrorItemNotFound", message: "404" } });
      return;
    }
    if (method === "DELETE") {
      this.messages.splice(index, 1);
      res.writeHead(204);
      res.end();
      return;
    }
    if (method === "PATCH") {
      applyPatch(current, parseObject(body));
      json(res, 200, view(current));
      return;
    }
    json(res, 200, view(current));
  }

  private createMessage(res: ServerResponse, body: string, folder: string | null): void {
    const created = this.createFromPayload(parseObject(body), folder ?? "drafts", true);
    json(res, 201, view(created));
  }

  private createFromPayload(payload: Record<string, unknown>, folder: string, draft: boolean): StoredMessage {
    const id = `m_${randomBytes(6).toString("hex")}`;
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const body = objectOf(payload.body);
    const content = typeof body.content === "string" ? body.content : "";
    const contentType = typeof body.contentType === "string" ? body.contentType : "Text";
    const attachments = Array.isArray(payload.attachments) ? payload.attachments.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { name?: unknown; contentType?: unknown; contentBytes?: unknown };
      return [{
        id: `att_${randomBytes(3).toString("hex")}`,
        name: typeof row.name === "string" ? row.name : "file",
        contentType: typeof row.contentType === "string" ? row.contentType : "application/octet-stream",
        contentBytes: typeof row.contentBytes === "string" ? row.contentBytes : undefined,
      }];
    }) : [];
    const message: StoredMessage = {
      id,
      conversationId: id,
      subject,
      bodyPreview: content.slice(0, 120),
      receivedDateTime: new Date().toISOString(),
      isRead: true,
      isDraft: draft,
      importance: "normal",
      parentFolderId: folder,
      flag: { flagStatus: "notFlagged" },
      categories: [],
      from: { emailAddress: { address: this.meMail ?? this.meUpn } },
      toRecipients: recipientsOf(payload.toRecipients),
      ccRecipients: recipientsOf(payload.ccRecipients),
      bccRecipients: recipientsOf(payload.bccRecipients),
      replyTo: [],
      body: { contentType, content },
      hasAttachments: attachments.length > 0,
      internetMessageId: `<${id}@mail.example>`,
      internetMessageHeaders: [],
      attachments,
    };
    this.messages.push(message);
    return message;
  }
}

function fromDemo(message: MailMessage): StoredMessage {
  const labels = message.labelIds.filter((id) => !SYSTEM.has(id));
  return {
    id: message.id,
    conversationId: message.threadId,
    subject: message.subject,
    bodyPreview: message.snippet,
    receivedDateTime: message.date,
    isRead: !message.labelIds.includes("UNREAD"),
    isDraft: message.labelIds.includes("DRAFT"),
    importance: message.labelIds.includes("IMPORTANT") ? "high" : "normal",
    parentFolderId: folderFor(message.labelIds),
    flag: { flagStatus: message.labelIds.includes("STARRED") ? "flagged" : "notFlagged" },
    categories: labels,
    from: emailOf(message.sender),
    toRecipients: message.toRecipients.map(emailOf),
    ccRecipients: message.ccRecipients.map(emailOf),
    bccRecipients: [],
    replyTo: [],
    body: { contentType: message.htmlBody ? "HTML" : "Text", content: message.htmlBody ?? message.plaintextBody ?? "" },
    hasAttachments: message.attachments.length > 0,
    internetMessageId: `<${message.id}@mail.example>`,
    internetMessageHeaders: [],
    attachments: message.attachments.map((item) => ({ id: item.id, name: item.filename, contentType: item.mimeType })),
  };
}

function view(message: StoredMessage): Record<string, unknown> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    subject: message.subject,
    bodyPreview: message.bodyPreview,
    receivedDateTime: message.receivedDateTime,
    isRead: message.isRead,
    isDraft: message.isDraft,
    importance: message.importance,
    parentFolderId: message.parentFolderId,
    flag: message.flag,
    categories: message.categories,
    from: message.from,
    toRecipients: message.toRecipients,
    ccRecipients: message.ccRecipients,
    bccRecipients: message.bccRecipients,
    replyTo: message.replyTo,
    body: message.body,
    hasAttachments: message.hasAttachments,
    internetMessageId: message.internetMessageId,
    internetMessageHeaders: message.internetMessageHeaders,
    attachments: message.attachments.map((item) => ({ id: item.id, name: item.name, contentType: item.contentType })),
  };
}

function applyPatch(message: StoredMessage, patch: Record<string, unknown>): void {
  if (typeof patch.isRead === "boolean") message.isRead = patch.isRead;
  if (typeof patch.importance === "string") message.importance = patch.importance;
  if (Array.isArray(patch.categories)) message.categories = patch.categories.filter((item): item is string => typeof item === "string");
  const flag = objectOf(patch.flag);
  if (typeof flag.flagStatus === "string") message.flag = { flagStatus: flag.flagStatus };
  if (typeof patch.subject === "string") message.subject = patch.subject;
  if (Array.isArray(patch.toRecipients)) message.toRecipients = recipientsOf(patch.toRecipients);
  if (Array.isArray(patch.ccRecipients)) message.ccRecipients = recipientsOf(patch.ccRecipients);
  if (Array.isArray(patch.bccRecipients)) message.bccRecipients = recipientsOf(patch.bccRecipients);
  const body = objectOf(patch.body);
  if (typeof body.content === "string") {
    message.body = {
      contentType: typeof body.contentType === "string" ? body.contentType : message.body.contentType,
      content: body.content,
    };
    message.bodyPreview = body.content.slice(0, 120);
  }
}

function copyHeaders(created: StoredMessage, message: Record<string, unknown>): void {
  const headers = message.internetMessageHeaders;
  if (!Array.isArray(headers)) return;
  created.internetMessageHeaders = headers.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = (item as { name?: unknown }).name;
    const value = (item as { value?: unknown }).value;
    return typeof name === "string" && typeof value === "string" ? [{ name, value }] : [];
  });
}

function dropSelf(list: GraphAddress[], self: string): GraphAddress[] {
  const seen = new Set<string>();
  const out: GraphAddress[] = [];
  for (const item of list) {
    const address = item.emailAddress.address.toLowerCase();
    if (address === self || seen.has(address)) continue;
    seen.add(address);
    out.push(item);
  }
  return out;
}

function recipientsOf(value: unknown): GraphAddress[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const address = (item as { emailAddress?: { address?: unknown; name?: unknown } }).emailAddress;
    if (!address || typeof address.address !== "string") return [];
    return [{ emailAddress: { address: address.address, ...(typeof address.name === "string" ? { name: address.name } : {}) } }];
  });
}

function parseObject(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    return objectOf(parsed);
  } catch {
    return {};
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
