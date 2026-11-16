import { Buffer } from "node:buffer";
import { openSeal } from "../crypto/seal.js";
import { notFound, ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import type { MailMode } from "../config.js";
import type { Repo } from "../store/repo.js";
import { buildGraphQuery, messageMatches, normalizeLabel, type QueryMessage } from "./microsoft-query.js";
import { replyHeaders } from "./threading.js";
import type {
  AccountRecord,
  Attachment,
  DraftRecord,
  FilterAction,
  FilterCriteria,
  FilterRecord,
  ForwardInput,
  LabelRecord,
  MailMessage,
  MailProvider,
  MailThread,
  OutgoingAttachment,
  OutgoingDraft,
  ProviderSearchPage,
  ReplyInput,
  SearchHit,
  SearchView,
  SendAsRecord,
  SentResult,
} from "./types.js";

export const GRAPH_INLINE_MAX = 3 * 1024 * 1024;
export const GRAPH_UPLOAD_MAX = 150 * 1024 * 1024;
/** Documented Outlook upload host. It is not the Graph origin. */
export const OUTLOOK_UPLOAD_HOST = "outlook.office.com";
/** Example chunk from the Outlook large-attachment contract. Each range stays under 4 MB. */
export const GRAPH_UPLOAD_CHUNK = 2 * 1024 * 1024;
export const GRAPH_UPLOAD_CHUNK_MAX = 4 * 1024 * 1024 - 1;
export const MICROSOFT_FOLDERS = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "archive"] as const;
export type MicrosoftFolder = (typeof MICROSOFT_FOLDERS)[number];

export const DEVICE_BLOCKED_MESSAGE = "Your organization turned this kind of sign-in off. You can use your own Microsoft app instead — see Settings.";

const SELECT = [
  "id", "conversationId", "subject", "bodyPreview", "receivedDateTime", "isRead", "isDraft",
  "importance", "parentFolderId", "flag", "categories", "from", "toRecipients", "ccRecipients",
  "bccRecipients", "replyTo", "internetMessageId", "hasAttachments", "internetMessageHeaders",
].join(",");
const SELECT_BODY = `${SELECT},body`;

const SYSTEM = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "UNREAD", "STARRED", "IMPORTANT"]);

const SYSTEM_LABELS: LabelRecord[] = [
  { labelId: "INBOX", name: "INBOX", labelType: "SYSTEM" },
  { labelId: "SENT", name: "SENT", labelType: "SYSTEM" },
  { labelId: "DRAFT", name: "DRAFT", labelType: "SYSTEM" },
  { labelId: "TRASH", name: "TRASH", labelType: "SYSTEM" },
  { labelId: "SPAM", name: "SPAM", labelType: "SYSTEM" },
  { labelId: "UNREAD", name: "UNREAD", labelType: "SYSTEM" },
  { labelId: "STARRED", name: "STARRED", labelType: "SYSTEM" },
  { labelId: "IMPORTANT", name: "IMPORTANT", labelType: "SYSTEM" },
];

export interface MicrosoftDeps {
  store: Repo;
  key: Buffer;
  clientId: string;
  clientSecret?: string;
  graphBase: string;
  tokenUrl: string;
  timeoutMs: number;
  logger: Logger;
  mailMode: MailMode;
  syncDays: number;
  pageSize: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  inlineBytes?: number;
  maxBytes?: number;
  uploadChunkBytes?: number;
}

interface StoredToken {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  importance?: string;
  parentFolderId?: string;
  flag?: { flagStatus?: string };
  categories?: string[];
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  attachments?: Array<{ id?: string; name?: string; contentType?: string; contentId?: string }>;
  "@removed"?: { reason?: string };
}

interface GraphPage {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

type Purpose = "read" | "write";

/** Graph delta token is gone. The caller re-syncs that folder only. */
export class DeltaExpired extends Error {
  constructor() {
    super("delta expired");
    this.name = "DeltaExpired";
  }
}

/** Form body for a token call. The secret is added only when the caller has one. */
export function formBody(fields: Record<string, string>, clientSecret?: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "client_secret") continue;
    body.set(key, value);
  }
  if (clientSecret) body.set("client_secret", clientSecret);
  return body;
}

export function attachmentRoute(bytes: number, inlineMax = GRAPH_INLINE_MAX, uploadMax = GRAPH_UPLOAD_MAX): "inline" | "upload" | "too_big" {
  if (bytes <= inlineMax) return "inline";
  if (bytes <= uploadMax) return "upload";
  return "too_big";
}

/** A requested chunk above the Outlook limit is clamped. A bad value uses the 2 MB example. */
export function uploadChunkSize(requested?: number): number {
  if (requested == null || !Number.isFinite(requested) || requested < 1) return GRAPH_UPLOAD_CHUNK;
  return Math.min(Math.floor(requested), GRAPH_UPLOAD_CHUNK_MAX);
}

/** Device-code and device-token errors that mean the tenant turned the flow off. */
export function tenantBlockedDeviceCode(error: string, description: string): boolean {
  const blob = `${error}\n${description}`.toLowerCase();
  if (error === "unauthorized_client") return true;
  if (blob.includes("aadsts50059") || blob.includes("aadsts7000218")) return true;
  return blob.includes("device code") && (blob.includes("disabled") || blob.includes("not enabled") || blob.includes("turned off"));
}

export class MicrosoftProvider implements MailProvider {
  readonly kind = "microsoft" as const;
  private readonly folderIds = new Map<string, string>();
  private readonly folderNames = new Map<string, string>();

  constructor(private readonly deps: MicrosoftDeps) {
    if (deps.clientSecret) deps.logger.redact(deps.clientSecret);
  }

  /** A secret means the owner's web app. No secret means device code. Read on each token call. */
  get mode(): "device" | "confidential" {
    return this.deps.clientSecret ? "confidential" : "device";
  }

  /** A client saved from /connect replaces the one this process started with. */
  useClient(clientId: string, clientSecret: string | undefined): void {
    this.deps.clientId = clientId;
    this.deps.clientSecret = clientSecret;
    if (clientSecret) this.deps.logger.redact(clientSecret);
  }

  listAccounts(): AccountRecord[] {
    return [];
  }

  async searchPage(accountId: string, query: string, pageSize: number, pageToken: string | undefined, _view: SearchView): Promise<ProviderSearchPage> {
    await this.accountEmail(accountId);
    const built = buildGraphQuery(query, this.now());
    if (built.empty) return { hits: [], nextPageToken: null, resultCountEstimate: 0 };
    if (this.deps.mailMode === "mirror" && built.both) return this.searchStored(accountId, built, pageSize, pageToken);
    const page = await this.queryGraph(accountId, built, pageSize, pageToken);
    const messages = page.messages.map((item) => this.toMail(item, 0, undefined, accountId));
    const filtered = built.both ? messages.filter((item) => this.matches(item, built)) : messages;
    return {
      hits: hitsFrom(filtered),
      nextPageToken: page.nextLink,
      resultCountEstimate: filtered.length,
    };
  }

  async listThreadMeta(): Promise<MailThread[]> {
    throw new ToolError("tool_error", "Full mailbox listing is not used.");
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    const params = new URLSearchParams();
    params.set("$filter", `conversationId eq '${threadId.replace(/'/g, "''")}'`);
    params.set("$select", SELECT_BODY);
    const messages = await this.followPages(accountId, `/v1.0/me/messages?${params.toString()}`);
    if (messages.length === 0) return null;
    return this.toThread(messages, undefined, accountId);
  }

  async getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null> {
    const message = await this.getOptional<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${SELECT_BODY}`);
    if (!message) return null;
    return { id: message.id, raw: rfc822(this.toMail(message, 0, undefined, accountId)) };
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    const page = await this.getJson<{ value?: Array<{ displayName?: string }> }>(accountId, "/v1.0/me/outlook/masterCategories");
    const users = (page.value ?? []).map((item) => {
      const name = item.displayName ?? "";
      return { labelId: name, name, labelType: "USER" as const };
    }).filter((item) => item.name.length > 0);
    return [...SYSTEM_LABELS, ...users];
  }

  async listDraftMeta(accountId: string): Promise<DraftRecord[]> {
    const messages = await this.followPages(accountId, `/v1.0/me/mailFolders/drafts/messages?$select=${SELECT_BODY}`);
    return messages.filter((item) => item.isDraft !== false).map((item) => this.toDraft(item, accountId));
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    const message = await this.getOptional<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(draftId)}?$select=${SELECT_BODY}`);
    if (!message || message.isDraft === false) return null;
    return this.toDraft(message, accountId);
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    const email = await this.accountEmail(accountId);
    return [{ email, signature: "", isDefault: true, isPrimary: true, verified: true }];
  }

  async listFilters(accountId: string): Promise<FilterRecord[]> {
    const page = await this.getJson<{ value?: Array<Record<string, unknown>> }>(accountId, "/v1.0/me/mailFolders/inbox/messageRules");
    return (page.value ?? []).map(ruleToFilter);
  }

  async createLabel(accountId: string, displayName: string): Promise<LabelRecord> {
    await this.writeJson(accountId, "/v1.0/me/outlook/masterCategories", { displayName, color: "preset0" });
    return { labelId: displayName, name: displayName, labelType: "USER" };
  }

  async labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.modifyThread(accountId, threadId, labelIds, []);
  }

  async unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.modifyThread(accountId, threadId, [], labelIds);
  }

  async modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
    const thread = await this.getThread(accountId, threadId);
    if (!thread) throw notFound();
    let destination: string | null = null;
    if (add.includes("INBOX")) destination = "inbox";
    else if (remove.includes("INBOX")) destination = "archive";
    else if (add.includes("TRASH")) destination = "deleteditems";
    else if (add.includes("SPAM")) destination = "junkemail";
    for (const message of thread.messages) {
      if (destination) await this.move(accountId, message.id, destination);
      const patch = this.propertyPatch(message, add, remove);
      if (Object.keys(patch).length > 0) {
        await this.writeJson(accountId, `/v1.0/me/messages/${encodeURIComponent(message.id)}`, patch, "PATCH");
      }
    }
  }

  async createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord> {
    await this.ownAddress(accountId, input.fromEmail);
    const split = this.splitAttachments(input.attachments);
    const created = input.replyToMessageId
      ? await this.createReplyDraft(accountId, input.replyToMessageId, input)
      : await this.writeJson<GraphMessage>(accountId, "/v1.0/me/messages", this.draftPayload(input, split.inline));
    await this.attachLarge(accountId, created, split.upload);
    return this.toDraft(created, accountId);
  }

  async updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord> {
    await this.ownAddress(accountId, input.fromEmail);
    const split = this.splitAttachments(input.attachments);
    const updated = await this.writeJson<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(draftId)}`, this.draftPayload(input, split.inline), "PATCH");
    const draft = { ...updated, id: updated.id || draftId };
    await this.attachLarge(accountId, draft, split.upload);
    return this.toDraft(draft, accountId);
  }

  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    await this.call(accountId, `${this.graph()}/v1.0/me/messages/${encodeURIComponent(draftId)}`, { method: "DELETE" }, "write");
  }

  async sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    await this.ownAddress(accountId, input.fromEmail);
    if (input.draftId) return this.sendSavedDraft(accountId, input);
    const split = this.splitAttachments(input.attachments);
    const draft = input.replyToMessageId
      ? await this.createReplyDraft(accountId, input.replyToMessageId, input)
      : await this.writeJson<GraphMessage>(accountId, "/v1.0/me/messages", this.draftPayload(input, split.inline));
    await this.attachLarge(accountId, draft, split.upload);
    return this.acceptSend(accountId, draft);
  }

  async reply(accountId: string, input: ReplyInput): Promise<SentResult> {
    const draft = await this.createReplyDraft(accountId, input.messageId, {
      to: [],
      cc: input.cc,
      bcc: input.bcc,
      subject: "",
      body: input.body,
      htmlBody: input.htmlBody,
      attachments: input.attachments,
    }, input.replyAll);
    const split = this.splitAttachments(input.attachments);
    await this.attachLarge(accountId, draft, split.upload);
    return this.acceptSend(accountId, draft);
  }

  async forward(accountId: string, input: ForwardInput): Promise<SentResult> {
    const created = await this.writeJson<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(input.messageId)}/createForward`, {
      comment: "",
      message: { toRecipients: recipients(input.to) },
    });
    return this.acceptSend(accountId, created);
  }

  async createFilter(accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord> {
    if (!ruleSupported(criteria, action)) {
      throw new ToolError("tool_error", "This rule can't be expressed in Outlook.");
    }
    for (const name of action.addLabelIds) await this.ensureCategory(accountId, name);
    const actions: Record<string, unknown> = {};
    if (action.skipInbox || action.removeLabelIds.includes("INBOX")) {
      actions.moveToFolder = await this.wellKnownId(accountId, "archive");
    }
    if (action.addLabelIds.length > 0) actions.assignCategories = action.addLabelIds;
    const created = await this.writeJson<{ id?: string }>(accountId, "/v1.0/me/mailFolders/inbox/messageRules", {
      displayName: "Chatterbuilt",
      sequence: 1,
      isEnabled: true,
      conditions: ruleConditions(criteria),
      actions,
    });
    return { id: created.id ?? "", criteria, action };
  }

  async deleteFilter(accountId: string, filterId: string): Promise<void> {
    await this.call(accountId, `${this.graph()}/v1.0/me/mailFolders/inbox/messageRules/${encodeURIComponent(filterId)}`, { method: "DELETE" }, "write");
  }

  async listFolder(accountId: string, folder: string, sinceIso: string, nextUrl?: string): Promise<{ messages: GraphMessage[]; nextLink: string | null }> {
    if (nextUrl) {
      const page = parseJson<GraphPage>(await this.call(accountId, nextUrl, { method: "GET" }, "read"));
      const messages = page.value ?? [];
      this.remember(accountId, folder, messages);
      return { messages, nextLink: page["@odata.nextLink"] ?? null };
    }
    const params = new URLSearchParams();
    params.set("$top", String(this.deps.pageSize));
    params.set("$select", SELECT_BODY);
    params.set("$filter", `receivedDateTime ge ${sinceIso}`);
    const page = await this.getJson<GraphPage>(accountId, `/v1.0/me/mailFolders/${folder}/messages?${params.toString()}`);
    const messages = page.value ?? [];
    this.remember(accountId, folder, messages);
    return { messages, nextLink: page["@odata.nextLink"] ?? null };
  }

  async openDelta(accountId: string, folder: string): Promise<{ deltaLink: string; messages: GraphMessage[] }> {
    let url = `${this.graph()}/v1.0/me/mailFolders/${folder}/messages/delta?$select=${SELECT_BODY}`;
    const messages: GraphMessage[] = [];
    for (let hop = 0; hop < 20; hop += 1) {
      const page = parseJson<GraphPage>(await this.call(accountId, url, { method: "GET" }, "read"));
      const value = (page.value ?? []).filter((item) => !item["@removed"]);
      this.remember(accountId, folder, value);
      messages.push(...value);
      if (page["@odata.deltaLink"]) return { deltaLink: page["@odata.deltaLink"], messages };
      if (!page["@odata.nextLink"]) break;
      url = page["@odata.nextLink"];
    }
    throw new ToolError("upstream_error", "The provider failed.", false);
  }

  async pullDelta(accountId: string, url: string): Promise<{ messages: GraphMessage[]; removed: Array<{ id: string; reason: "changed" | "deleted" }>; nextLink: string | null; deltaLink: string | null }> {
    const page = parseJson<GraphPage>(await this.call(accountId, url, { method: "GET" }, "read"));
    const value = page.value ?? [];
    const removed = value.filter((item) => item["@removed"] && item.id).map((item) => ({
      id: item.id,
      reason: item["@removed"]?.reason === "changed" ? "changed" as const : "deleted" as const,
    }));
    const messages = value.filter((item) => !item["@removed"]);
    const folder = /\/mailFolders\/([^/]+)\/messages\/delta/.exec(new URL(url).pathname)?.[1];
    if (folder) this.remember(accountId, decodeURIComponent(folder), messages);
    return {
      messages,
      removed,
      nextLink: page["@odata.nextLink"] ?? null,
      deltaLink: page["@odata.deltaLink"] ?? null,
    };
  }

  /**
   * Folder delta uses `@removed.reason = deleted` for a delete and for a move.
   * Null means the message is gone. `folder` is a synced well-known name, or
   * null when the message lives outside those six folders.
   */
  async findMessage(accountId: string, messageId: string): Promise<{ message: GraphMessage; folder: string | null } | null> {
    const message = await this.getOptional<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${SELECT_BODY}`);
    if (!message?.id) return null;
    const folder = this.folderOf(message, undefined, accountId);
    return { message, folder: folder && isMicrosoftFolder(folder) ? folder : null };
  }

  /**
   * One read for `@removed.reason = changed`. Null means Graph returned 404.
   * `folder` is null when the parent folder is outside the synced six.
   */
  async readPlacement(accountId: string, messageId: string): Promise<{ id: string; folder: MicrosoftFolder | null } | null> {
    const select = "id,parentFolderId,conversationId";
    const message = await this.getOptional<GraphMessage>(
      accountId,
      `/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${select}`,
    );
    if (!message?.id) return null;
    const folder = this.folderOf({ ...message, id: message.id }, undefined, accountId);
    return { id: message.id, folder: folder && isMicrosoftFolder(folder) ? folder : null };
  }

  toThread(messages: GraphMessage[], folderHint?: string, accountId?: string): MailThread {
    const sorted = [...messages].sort((left, right) => (left.receivedDateTime ?? "").localeCompare(right.receivedDateTime ?? ""));
    const mail = sorted.map((item, index) => this.toMail(item, index, folderHint, accountId));
    const newest = mail[mail.length - 1];
    const id = newest?.threadId || sorted[0]?.conversationId || sorted[0]?.id || "";
    return {
      id,
      snippet: newest?.snippet ?? "",
      messageCount: mail.length,
      viewUrl: newest?.viewUrl ?? outlookUrl(id),
      historyId: null,
      messages: mail,
    };
  }

  private async queryGraph(accountId: string, built: ReturnType<typeof buildGraphQuery>, pageSize: number, pageToken?: string): Promise<{ messages: GraphMessage[]; nextLink: string | null }> {
    if (pageToken && pageToken.startsWith("http")) {
      const page = parseJson<GraphPage>(await this.call(accountId, pageToken, { method: "GET" }, "read"));
      return { messages: page.value ?? [], nextLink: page["@odata.nextLink"] ?? null };
    }
    const params = new URLSearchParams();
    params.set("$top", String(pageSize));
    params.set("$select", SELECT_BODY);
    let filter = built.filter;
    if (!built.both && built.local.labelTokens.length > 0) {
      const extra = await this.categoryClause(accountId, built.local.labelTokens);
      filter = [filter, extra].filter((part) => part && part.length > 0).join(" and ") || null;
    }
    if (built.search) params.set("$search", `"${built.search.replace(/"/g, "")}"`);
    else if (filter) params.set("$filter", filter);
    const path = built.folder ? `/v1.0/me/mailFolders/${built.folder}/messages` : "/v1.0/me/messages";
    const page = await this.getJson<GraphPage>(accountId, `${path}?${params.toString()}`);
    const messages = page.value ?? [];
    if (built.folder) this.remember(accountId, built.folder, messages);
    return { messages, nextLink: page["@odata.nextLink"] ?? null };
  }

  private async searchStored(accountId: string, built: ReturnType<typeof buildGraphQuery>, pageSize: number, pageToken?: string): Promise<ProviderSearchPage> {
    const offset = pageToken?.startsWith("local:") ? Number(pageToken.slice("local:".length)) : 0;
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const messages = await this.deps.store.listMessages(accountId);
    const matched = messages.filter((item) => this.matches(item, built));
    const page = matched.slice(start, start + pageSize);
    const next = start + pageSize < matched.length ? `local:${start + pageSize}` : null;
    return { hits: hitsFrom(page), nextPageToken: next, resultCountEstimate: matched.length };
  }

  private async categoryClause(accountId: string, tokens: string[]): Promise<string> {
    const page = await this.getJson<{ value?: Array<{ displayName?: string }> }>(accountId, "/v1.0/me/outlook/masterCategories");
    const names = (page.value ?? []).map((item) => item.displayName ?? "").filter((name) => name.length > 0);
    return tokens.map((token) => {
      const found = names.find((name) => normalizeLabel(name) === token) ?? token;
      return `categories/any(c:c eq '${found.replace(/'/g, "''")}')`;
    }).join(" and ");
  }

  private async createReplyDraft(accountId: string, messageId: string, input: OutgoingDraft, replyAll = false): Promise<GraphMessage> {
    const source = await this.getOptional<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${SELECT_BODY}`);
    if (!source) throw notFound();
    const headers = replyHeaders({
      id: source.internetMessageId || source.id,
      references: headerOf(source, "References"),
    });
    const split = this.splitAttachments(input.attachments);
    const action = replyAll ? "createReplyAll" : "createReply";
    return this.writeJson<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(messageId)}/${action}`, {
      message: {
        ...this.draftPayload(input, split.inline, true),
        internetMessageHeaders: [
          { name: "In-Reply-To", value: headers.inReplyTo },
          { name: "References", value: headers.references },
        ],
      },
    });
  }

  /** omitEmpty leaves blank subject and recipient lists off a reply so Graph keeps what it calculated. */
  private draftPayload(input: OutgoingDraft, inline: OutgoingAttachment[], omitEmpty = false): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      body: input.htmlBody ? { contentType: "HTML", content: input.htmlBody } : { contentType: "Text", content: input.body },
    };
    if (!omitEmpty || input.subject.length > 0) payload.subject = input.subject;
    if (!omitEmpty || input.to.length > 0) payload.toRecipients = recipients(input.to);
    if (!omitEmpty || input.cc.length > 0) payload.ccRecipients = recipients(input.cc);
    if (!omitEmpty || input.bcc.length > 0) payload.bccRecipients = recipients(input.bcc);
    if (inline.length > 0) {
      payload.attachments = inline.map((item) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: item.filename,
        contentType: item.mimeType,
        contentBytes: item.content ?? "",
      }));
    }
    return payload;
  }

  private splitAttachments(items: OutgoingAttachment[] | undefined): { inline: OutgoingAttachment[]; upload: Array<{ item: OutgoingAttachment; bytes: number }> } {
    const inline: OutgoingAttachment[] = [];
    const upload: Array<{ item: OutgoingAttachment; bytes: number }> = [];
    for (const item of items ?? []) {
      if (!item.content) continue;
      const bytes = Buffer.from(item.content, "base64").length;
      const route = attachmentRoute(bytes, this.deps.inlineBytes ?? GRAPH_INLINE_MAX, this.deps.maxBytes ?? GRAPH_UPLOAD_MAX);
      if (route === "too_big") throw new ToolError("tool_error", "This attachment is over the 150 MB limit.");
      if (route === "upload") upload.push({ item, bytes });
      else inline.push(item);
    }
    return { inline, upload };
  }

  private async sendSavedDraft(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    const draftId = input.draftId;
    if (!draftId) throw new ToolError("tool_error", "draftId is required.");
    const existing = await this.getOptional<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(draftId)}?$select=${SELECT_BODY}&$expand=attachments`);
    if (!existing?.id || existing.isDraft === false) throw notFound();
    const patch = this.patchPresent(input);
    let draft = existing;
    if (Object.keys(patch).length > 0) {
      const updated = await this.writeJson<GraphMessage>(accountId, `/v1.0/me/messages/${encodeURIComponent(draftId)}`, patch, "PATCH");
      draft = {
        ...existing,
        ...updated,
        id: updated.id || existing.id,
        conversationId: updated.conversationId || existing.conversationId,
        attachments: updated.attachments ?? existing.attachments,
      };
    }
    const split = this.splitAttachments(input.attachments);
    for (const item of split.inline) await this.addInline(accountId, draft, item);
    await this.attachLarge(accountId, draft, split.upload);
    return this.acceptSend(accountId, draft);
  }

  /**
   * Fields the caller set, including an explicit empty subject, body, or recipient list.
   * An omitted field stays as saved. A draft object with no presence flags still patches
   * only nonempty values, so a hand-built send does not wipe a stored draft.
   */
  private patchPresent(input: OutgoingDraft): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const set = input.present;
    if (!set) {
      if (input.subject) patch.subject = input.subject;
      if (input.htmlBody) patch.body = { contentType: "HTML", content: input.htmlBody };
      else if (input.body) patch.body = { contentType: "Text", content: input.body };
      if (input.to.length > 0) patch.toRecipients = recipients(input.to);
      if (input.cc.length > 0) patch.ccRecipients = recipients(input.cc);
      if (input.bcc.length > 0) patch.bccRecipients = recipients(input.bcc);
      return patch;
    }
    if (set.subject) patch.subject = input.subject;
    if (set.htmlBody && input.htmlBody) patch.body = { contentType: "HTML", content: input.htmlBody };
    else if (set.body) patch.body = { contentType: "Text", content: input.body };
    else if (set.htmlBody) patch.body = { contentType: "HTML", content: input.htmlBody ?? "" };
    if (set.to) patch.toRecipients = recipients(input.to);
    if (set.cc) patch.ccRecipients = recipients(input.cc);
    if (set.bcc) patch.bccRecipients = recipients(input.bcc);
    return patch;
  }

  private async addInline(accountId: string, draft: GraphMessage, item: OutgoingAttachment): Promise<void> {
    const created = await this.writeJson<{ id?: string; name?: string; contentType?: string }>(accountId, `/v1.0/me/messages/${encodeURIComponent(draft.id)}/attachments`, {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: item.filename,
      contentType: item.mimeType,
      contentBytes: item.content ?? "",
    });
    this.noteUploaded(draft, item.filename, item.mimeType, created.id);
  }

  private async attachLarge(accountId: string, draft: GraphMessage, upload: Array<{ item: OutgoingAttachment; bytes: number }>): Promise<void> {
    for (const item of upload) {
      await this.upload(accountId, draft.id, item.item, item.bytes);
      this.noteUploaded(draft, item.item.filename, item.item.mimeType);
    }
  }

  private noteUploaded(draft: GraphMessage, filename: string, mimeType: string, id?: string): void {
    const attachments = draft.attachments ? [...draft.attachments] : [];
    attachments.push({ id, name: filename, contentType: mimeType });
    draft.attachments = attachments;
    draft.hasAttachments = true;
  }

  /**
   * sendMail and draft send both return 202 with an empty body. That 202 is acceptance.
   * The immutable draft id is the message id. A later Sent Items read cannot decide success.
   */
  private async acceptSend(accountId: string, draft: GraphMessage): Promise<SentResult> {
    if (!draft.id) throw new ToolError("upstream_error", "The provider failed.", false);
    await this.call(accountId, `${this.graph()}/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" }, "write");
    const sent: GraphMessage = { ...draft, isDraft: false, isRead: true, parentFolderId: "sentitems" };
    const mail = this.toMail(sent, 0, "sentitems", accountId);
    return { id: mail.id, threadId: mail.threadId, labelIds: mail.labelIds, message: mail };
  }

  private async upload(accountId: string, messageId: string, item: OutgoingAttachment, bytes: number): Promise<void> {
    const session = await this.writeJson<{ uploadUrl?: string }>(accountId, `/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`, {
      AttachmentItem: { attachmentType: "file", name: item.filename, size: bytes, contentType: item.mimeType },
    });
    if (!session.uploadUrl) throw new ToolError("upstream_error", "The provider failed.", false);
    this.assertUploadUrl(session.uploadUrl);
    const raw = Buffer.from(item.content ?? "", "base64");
    const total = raw.length;
    let offset = 0;
    const size = uploadChunkSize(this.deps.uploadChunkBytes);
    while (offset < total) {
      const end = Math.min(offset + size, total) - 1;
      const result = await this.putUpload(session.uploadUrl, raw.subarray(offset, end + 1), offset, end, total);
      const next = end + 1;
      if (next >= total) {
        if (result.status !== 201) throw new ToolError("upstream_error", "The provider failed.", false);
        return;
      }
      if (result.status !== 200 || !rangeStartsAt(result.nextExpectedRanges, next)) {
        throw new ToolError("upstream_error", "The provider failed.", false);
      }
      offset = next;
    }
  }

  /**
   * The upload URL is preauthenticated on outlook.office.com. It is not a Graph call:
   * no bearer token, no rewrite, and no second try.
   */
  private async putUpload(url: string, body: Buffer, start: number, end: number, total: number): Promise<{ status: number; nextExpectedRanges: string[] }> {
    this.assertUploadUrl(url);
    const bytes = new Uint8Array(body.byteLength);
    bytes.set(body);
    let response: Response;
    try {
      response = await this.fetcher()(url, {
        method: "PUT",
        redirect: "manual",
        headers: {
          "content-type": "application/octet-stream",
          "content-range": `bytes ${start}-${end}/${total}`,
          "content-length": String(bytes.byteLength),
        },
        body: bytes,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch {
      throw new ToolError("upstream_error", "The provider connection failed.", false);
    }
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ToolError("tool_error", "Refusing a Microsoft upload redirect.");
    }
    const text = await response.text();
    if (response.status !== 200 && response.status !== 201) {
      throw new ToolError("upstream_error", "The provider failed.", false);
    }
    const parsed = text ? parseJson<{ nextExpectedRanges?: string[] }>(text) : {};
    return { status: response.status, nextExpectedRanges: parsed.nextExpectedRanges ?? [] };
  }

  private assertUploadUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ToolError("tool_error", "Refusing a Microsoft upload URL.");
    }
    const portOk = parsed.port === "" || parsed.port === "443";
    if (parsed.protocol !== "https:" || parsed.hostname !== OUTLOOK_UPLOAD_HOST || parsed.username || parsed.password || !portOk) {
      throw new ToolError("tool_error", "Refusing a Microsoft upload URL.");
    }
  }

  private async move(accountId: string, id: string, folder: string): Promise<void> {
    const destinationId = await this.wellKnownId(accountId, folder);
    await this.writeJson(accountId, `/v1.0/me/messages/${encodeURIComponent(id)}/move`, { destinationId });
  }

  private async wellKnownId(accountId: string, folder: string): Promise<string> {
    const cached = this.folderIds.get(this.cacheKey(accountId, folder));
    if (cached) return cached;
    const body = await this.getJson<{ id?: string }>(accountId, `/v1.0/me/mailFolders/${folder}`);
    const id = body.id || folder;
    this.folderIds.set(this.cacheKey(accountId, folder), id);
    this.folderNames.set(this.cacheKey(accountId, id), folder);
    return id;
  }

  private async ensureCategory(accountId: string, name: string): Promise<void> {
    const page = await this.getJson<{ value?: Array<{ displayName?: string }> }>(accountId, "/v1.0/me/outlook/masterCategories");
    if ((page.value ?? []).some((item) => item.displayName === name)) return;
    await this.writeJson(accountId, "/v1.0/me/outlook/masterCategories", { displayName: name, color: "preset0" });
  }

  private propertyPatch(message: MailMessage, add: string[], remove: string[]): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (add.includes("UNREAD")) patch.isRead = false;
    if (remove.includes("UNREAD")) patch.isRead = true;
    if (add.includes("STARRED")) patch.flag = { flagStatus: "flagged" };
    if (remove.includes("STARRED")) patch.flag = { flagStatus: "notFlagged" };
    if (add.includes("IMPORTANT")) patch.importance = "high";
    if (remove.includes("IMPORTANT")) patch.importance = "normal";
    const addCats = add.filter((id) => !SYSTEM.has(id));
    const removeCats = new Set(remove.filter((id) => !SYSTEM.has(id)));
    if (addCats.length > 0 || removeCats.size > 0) {
      const current = message.labelIds.filter((id) => !SYSTEM.has(id) && !removeCats.has(id));
      for (const name of addCats) if (!current.includes(name)) current.push(name);
      patch.categories = current;
    }
    return patch;
  }

  private toMail(message: GraphMessage, position: number, folderHint?: string, accountId?: string): MailMessage {
    const folder = this.folderOf(message, folderHint, accountId);
    const labels = labelsFor(message, folder);
    const body = message.body?.content ?? null;
    const html = message.body?.contentType?.toLowerCase() === "html";
    const attachments = graphAttachments(message);
    return {
      id: message.id,
      threadId: message.conversationId || message.id,
      position,
      sender: formatAddress(message.from?.emailAddress),
      toRecipients: (message.toRecipients ?? []).map((item) => formatAddress(item.emailAddress)),
      ccRecipients: (message.ccRecipients ?? []).map((item) => formatAddress(item.emailAddress)),
      bccRecipients: (message.bccRecipients ?? []).map((item) => formatAddress(item.emailAddress)),
      replyTo: (message.replyTo ?? []).map((item) => formatAddress(item.emailAddress)),
      inReplyTo: headerOf(message, "In-Reply-To"),
      references: headerOf(message, "References"),
      subject: message.subject ?? "",
      date: message.receivedDateTime ?? new Date(0).toISOString(),
      labelIds: labels,
      snippet: message.bodyPreview ?? "",
      plaintextBody: body === null || html ? null : body,
      htmlBody: html ? body : null,
      attachments,
      raw: null,
      viewUrl: outlookUrl(message.id),
      bodyFetched: body !== null,
    };
  }

  private toDraft(message: GraphMessage, accountId?: string): DraftRecord {
    const mail = this.toMail(message, 0, "drafts", accountId);
    return {
      id: mail.id,
      messageId: mail.id,
      threadId: mail.threadId,
      subject: mail.subject,
      toRecipients: mail.toRecipients,
      ccRecipients: mail.ccRecipients,
      bccRecipients: mail.bccRecipients,
      date: mail.date,
      snippet: mail.snippet,
      plaintextBody: mail.plaintextBody,
      htmlBody: mail.htmlBody,
      attachments: mail.attachments,
      labelIds: mail.labelIds,
      raw: null,
      viewUrl: mail.viewUrl,
      bodyFetched: mail.bodyFetched,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
    };
  }

  private folderOf(message: GraphMessage, hint?: string, accountId?: string): string | null {
    if (message.parentFolderId && accountId) {
      const known = this.folderNames.get(this.cacheKey(accountId, message.parentFolderId));
      if (known) return known;
      for (const folder of MICROSOFT_FOLDERS) {
        if (this.folderIds.get(this.cacheKey(accountId, folder)) === message.parentFolderId) return folder;
      }
    }
    if (message.parentFolderId && isMicrosoftFolder(message.parentFolderId)) return message.parentFolderId;
    return hint ?? null;
  }

  private remember(accountId: string, folder: string, messages: GraphMessage[]): void {
    this.folderNames.set(this.cacheKey(accountId, folder), folder);
    for (const message of messages) {
      if (message.parentFolderId) this.folderNames.set(this.cacheKey(accountId, message.parentFolderId), folder);
    }
  }

  private cacheKey(accountId: string, name: string): string {
    return `${accountId}\u0000${name}`;
  }

  /** Read pages only. A next link on another origin is refused before it is fetched. */
  private async followPages(accountId: string, path: string): Promise<GraphMessage[]> {
    const messages: GraphMessage[] = [];
    let url = `${this.graph()}${path}`;
    for (let hop = 0; hop < 50; hop += 1) {
      this.assertGraph(url);
      const page = parseJson<GraphPage>(await this.call(accountId, url, { method: "GET" }, "read"));
      messages.push(...(page.value ?? []));
      const next = page["@odata.nextLink"];
      if (!next) return messages;
      url = next;
    }
    throw new ToolError("upstream_error", "The provider failed.", false);
  }

  private matches(message: MailMessage, built: ReturnType<typeof buildGraphQuery>): boolean {
    const queryMessage: QueryMessage = {
      labelIds: message.labelIds,
      sender: message.sender,
      toRecipients: message.toRecipients,
      subject: message.subject,
      date: message.date,
      attachments: message.attachments,
    };
    return messageMatches(queryMessage, built, this.now(), message.labelIds);
  }

  private async ownAddress(accountId: string, fromEmail: string | undefined): Promise<void> {
    if (!fromEmail) return;
    const email = await this.accountEmail(accountId);
    if (fromEmail.toLowerCase() !== email.toLowerCase()) {
      throw new ToolError("tool_error", "Sending as another mailbox is not available for this account.");
    }
  }

  private async accountEmail(accountId: string): Promise<string> {
    const accounts = await this.deps.store.listAccounts();
    const found = accounts.find((item) => item.id === accountId);
    if (!found) throw new ToolError("tool_error", "Unknown account.");
    return found.email;
  }

  private async getJson<T>(accountId: string, path: string): Promise<T> {
    const text = await this.call(accountId, `${this.graph()}${path}`, { method: "GET" }, "read");
    return parseJson<T>(text || "{}");
  }

  private async getOptional<T>(accountId: string, path: string): Promise<T | null> {
    try {
      return await this.getJson<T>(accountId, path);
    } catch (error) {
      if (error instanceof ToolError && error.message.includes("404")) return null;
      throw error;
    }
  }

  private async writeJson<T>(accountId: string, path: string, payload: unknown, method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST"): Promise<T> {
    const text = await this.call(accountId, `${this.graph()}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, "write");
    if (!text) return {} as T;
    return parseJson<T>(text);
  }

  private async call(accountId: string, url: string, init: RequestInit, purpose: Purpose, refreshed = false, retried = false): Promise<string> {
    this.assertGraph(url);
    const access = await this.ensureAccess(accountId, purpose, false);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${access}`);
    headers.set("prefer", 'IdType="ImmutableId"');
    let response: Response;
    try {
      response = await this.fetcher()(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch {
      throw new ToolError("upstream_error", "The provider connection failed.", purpose === "read" && !retried);
    }
    if (response.status === 401 && purpose === "read" && !refreshed) {
      await response.text();
      await this.ensureAccess(accountId, "read", true);
      return this.call(accountId, url, init, purpose, true, retried);
    }
    if (response.status === 401) {
      await response.text();
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    if ((response.status === 429 || response.status === 503) && purpose === "read" && !retried) {
      const wait = retryAfterMs(response, this.now());
      await response.text();
      if (wait !== null && wait <= this.deps.timeoutMs) {
        await this.pause(wait);
        return this.call(accountId, url, init, purpose, refreshed, true);
      }
      throw new ToolError("rate_limited", "The provider asked us to slow down.", false);
    }
    if (response.status === 429) {
      await response.text();
      throw new ToolError("rate_limited", "The provider asked us to slow down.", false);
    }
    if (response.status === 503) {
      await response.text();
      throw new ToolError("upstream_error", "The provider failed.", false);
    }
    const text = await response.text();
    if (response.status === 410 || (!response.ok && text.includes("syncStateNotFound"))) throw new DeltaExpired();
    if (response.status === 404) throw notFound();
    if (response.status >= 500) throw new ToolError("upstream_error", "The provider failed.", purpose === "read" && !retried);
    if (!response.ok && response.status !== 202 && response.status !== 204) {
      throw new ToolError("tool_error", `The provider returned ${response.status}.`, false);
    }
    return text;
  }

  private async ensureAccess(accountId: string, purpose: Purpose, force: boolean): Promise<string> {
    const token = await this.loadToken(accountId);
    if (!force && token.accessToken && token.expiresAt > this.now() + 30_000) return token.accessToken;
    return this.refresh(accountId, token.refreshToken, purpose);
  }

  private async loadToken(accountId: string): Promise<StoredToken> {
    const sealed = await this.deps.store.tokenCiphertext(accountId);
    if (!sealed) throw new ToolError("needs_reauth", "Connect this account again.", false);
    let parsed: Partial<StoredToken>;
    try {
      parsed = JSON.parse(openSeal(this.deps.key, sealed)) as Partial<StoredToken>;
    } catch {
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    if (parsed.refreshToken) this.deps.logger.redact(parsed.refreshToken);
    if (parsed.accessToken) this.deps.logger.redact(parsed.accessToken);
    if (!parsed.refreshToken) throw new ToolError("needs_reauth", "Connect this account again.", false);
    return {
      refreshToken: parsed.refreshToken,
      accessToken: parsed.accessToken ?? "",
      expiresAt: parsed.expiresAt ?? 0,
    };
  }

  private async refresh(accountId: string, refreshToken: string, purpose: Purpose): Promise<string> {
    const url = this.deps.tokenUrl;
    this.assertLogin(url);
    let response: Response;
    try {
      response = await this.fetcher()(url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.deps.clientId,
        }, this.deps.clientSecret),
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch {
      throw new ToolError("upstream_error", "The provider connection failed.", purpose === "read");
    }
    const text = await response.text();
    const parsed = parseJson<{ access_token?: string; expires_in?: number; refresh_token?: string; error?: string }>(text || "{}");
    if (parsed.error === "invalid_grant" || response.status === 400) {
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    if (!response.ok || !parsed.access_token) {
      if (response.status === 429) throw new ToolError("rate_limited", "The provider asked us to slow down.", purpose === "read");
      if (response.status >= 500) throw new ToolError("upstream_error", "The provider failed.", purpose === "read");
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    this.deps.logger.redact(parsed.access_token);
    const nextRefresh = parsed.refresh_token || refreshToken;
    if (parsed.refresh_token) this.deps.logger.redact(parsed.refresh_token);
    const next: StoredToken = {
      refreshToken: nextRefresh,
      accessToken: parsed.access_token,
      expiresAt: this.now() + (parsed.expires_in ?? 3600) * 1000,
    };
    await this.deps.store.upsertToken(accountId, this.deps.key, JSON.stringify(next));
    return next.accessToken;
  }

  private assertGraph(url: string): void {
    if (new URL(url).origin !== new URL(this.deps.graphBase).origin) {
      throw new ToolError("tool_error", "Refusing a request outside the configured Microsoft origin.");
    }
  }

  private assertLogin(url: string): void {
    if (new URL(url).origin !== new URL(this.deps.tokenUrl).origin) {
      throw new ToolError("tool_error", "Refusing a request outside the configured Microsoft origin.");
    }
  }

  private graph(): string {
    return this.deps.graphBase.replace(/\/$/, "");
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private fetcher(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

function rangeStartsAt(ranges: string[], start: number): boolean {
  const expected = String(start);
  return ranges.some((range) => range === expected || range.startsWith(`${expected}-`));
}

function recipients(list: string[]): GraphRecipient[] {
  return list.filter((item) => item.length > 0).map((address) => ({ emailAddress: { address } }));
}

function formatAddress(value: { address?: string; name?: string } | undefined): string {
  const address = value?.address ?? "";
  const name = value?.name ?? "";
  if (name && address) return `${name} <${address}>`;
  return address || name;
}

function headerOf(message: GraphMessage, name: string): string {
  const found = (message.internetMessageHeaders ?? []).find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

function isMicrosoftFolder(value: string): value is MicrosoftFolder {
  return (MICROSOFT_FOLDERS as readonly string[]).includes(value);
}

function labelsFor(message: GraphMessage, folder: string | null): string[] {
  const labels: string[] = [];
  if (folder === "inbox") labels.push("INBOX");
  if (folder === "sentitems") labels.push("SENT");
  if (folder === "drafts") labels.push("DRAFT");
  if (folder === "deleteditems") labels.push("TRASH");
  if (folder === "junkemail") labels.push("SPAM");
  if (message.isRead === false) labels.push("UNREAD");
  if (message.flag?.flagStatus === "flagged") labels.push("STARRED");
  if (message.importance === "high") labels.push("IMPORTANT");
  for (const category of message.categories ?? []) labels.push(category);
  return labels;
}

function graphAttachments(message: GraphMessage): Attachment[] {
  const listed = (message.attachments ?? []).map((item) => ({
    id: item.id ?? item.name ?? "attachment",
    filename: item.name ?? "",
    mimeType: item.contentType ?? "application/octet-stream",
    cid: item.contentId ?? "",
  }));
  if (listed.length > 0) return listed;
  if (message.hasAttachments) return [{ id: "attachment", filename: "", mimeType: "application/octet-stream", cid: "" }];
  return [];
}

function outlookUrl(id: string): string {
  return `https://outlook.office.com/mail/deeplink?itemid=${encodeURIComponent(id)}`;
}

function hitsFrom(messages: MailMessage[]): SearchHit[] {
  const order: string[] = [];
  const grouped = new Map<string, MailMessage[]>();
  for (const message of messages) {
    const list = grouped.get(message.threadId);
    if (!list) {
      grouped.set(message.threadId, [message]);
      order.push(message.threadId);
    } else list.push(message);
  }
  return order.map((id) => {
    const list = grouped.get(id) ?? [];
    const newest = list[list.length - 1] ?? null;
    return {
      id,
      snippet: newest?.snippet ?? "",
      messageCount: list.length,
      viewUrl: newest?.viewUrl ?? outlookUrl(id),
      historyId: null,
      newest,
    };
  });
}

function ruleSupported(criteria: FilterCriteria, action: FilterAction): boolean {
  if (criteria.query.trim().length > 0) return false;
  if (action.removeLabelIds.some((id) => id !== "INBOX")) return false;
  if (action.addLabelIds.some((id) => SYSTEM.has(id))) return false;
  const moves = action.skipInbox || action.removeLabelIds.includes("INBOX");
  const labels = action.addLabelIds.length > 0;
  return moves || labels;
}

function ruleConditions(criteria: FilterCriteria): Record<string, unknown> {
  const conditions: Record<string, unknown> = {};
  if (criteria.from) conditions.fromAddresses = [{ emailAddress: { address: criteria.from } }];
  if (criteria.to) conditions.sentToAddresses = [{ emailAddress: { address: criteria.to } }];
  if (criteria.subject) conditions.subjectContains = [criteria.subject];
  if (criteria.hasAttachment) conditions.hasAttachments = true;
  return conditions;
}

function ruleToFilter(row: Record<string, unknown>): FilterRecord {
  const conditions = objectOf(row.conditions);
  const actions = objectOf(row.actions);
  const from = addressOf(conditions.fromAddresses);
  const to = addressOf(conditions.sentToAddresses);
  const subjectList = conditions.subjectContains;
  const subject = Array.isArray(subjectList) && typeof subjectList[0] === "string" ? subjectList[0] : "";
  const categories = actions.assignCategories;
  return {
    id: typeof row.id === "string" ? row.id : "",
    criteria: {
      from,
      to,
      subject,
      query: "",
      hasAttachment: conditions.hasAttachments === true,
    },
    action: {
      addLabelIds: Array.isArray(categories) ? categories.filter((item): item is string => typeof item === "string") : [],
      removeLabelIds: actions.moveToFolder ? ["INBOX"] : [],
      skipInbox: Boolean(actions.moveToFolder),
    },
  };
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function addressOf(value: unknown): string {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return "";
  const email = (value[0] as { emailAddress?: { address?: string } }).emailAddress?.address;
  return email ?? "";
}

function rfc822(message: MailMessage): string {
  const lines = [
    `From: ${message.sender}`,
    `To: ${message.toRecipients.join(", ")}`,
    `Subject: ${message.subject}`,
    `Date: ${message.date}`,
    `Message-ID: ${message.id}`,
    "",
    message.plaintextBody ?? "",
  ];
  return lines.join("\r\n");
}

function retryAfterMs(response: Response, now: number): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ToolError("tool_error", "The provider returned a response that could not be read.", false);
  }
}
