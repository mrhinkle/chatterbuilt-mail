import { openSeal } from "../crypto/seal.js";
import { ToolError, notFound } from "../errors.js";
import { HistoryExpired } from "../sync/history.js";
import type { Logger } from "../log.js";
import type { Repo } from "../store/repo.js";
import { fwdSubject, replyAudience, reSubject, stripHtml, textToHtml } from "./addresses.js";
import { draftView, snippetOf, threadView } from "./codec.js";
import {
  buildMime,
  headerText,
  MAX_ATTACHMENT_BYTES,
  parsedAttachments,
  parseMime,
  referencesText,
  type MimeAttachment,
} from "./mime.js";
import { replyHeaders } from "./threading.js";
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
  OutgoingAttachment,
  OutgoingDraft,
  ProviderSearchPage,
  ReplyInput,
  SearchHit,
  SearchView,
  SendAsRecord,
  SentResult,
} from "./types.js";

interface GmailDeps {
  store: Repo;
  key: Buffer;
  clientId: string;
  clientSecret: string;
  apiBase: string;
  tokenUrl: string;
  timeoutMs: number;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

interface StoredToken {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

type Purpose = "read" | "write";

interface GmailThreadList {
  threads?: Array<{ id?: string; snippet?: string; historyId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  raw?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

interface GmailThread {
  id?: string;
  snippet?: string;
  historyId?: string;
  messages?: GmailMessage[];
}

interface GmailHistoryMessage {
  message?: { id?: string; threadId?: string };
}

interface GmailHistoryResponse {
  history?: Array<{
    id?: string;
    messagesAdded?: GmailHistoryMessage[];
    messagesDeleted?: GmailHistoryMessage[];
    labelsAdded?: GmailHistoryMessage[];
    labelsRemoved?: GmailHistoryMessage[];
  }>;
  historyId?: string;
  nextPageToken?: string;
}

export interface GmailHistoryPage {
  historyId: string | null;
  nextPageToken: string | null;
  threadIds: string[];
}

const METADATA_HEADERS = ["From", "To", "Cc", "Reply-To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"];

/**
 * Gmail REST via fetch. A write is one mutating request: no retry option and no second POST.
 * A fetch that times out is upstream_error. A read timeout is retryable. A write timeout is not,
 * because the request may have run. MIME is built and parsed in mime.ts (nodemailer MailComposer, mailparser).
 */
export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;

  constructor(private readonly deps: GmailDeps) {}

  /** A client saved from /connect replaces the one this process started with. */
  useClient(clientId: string, clientSecret: string): void {
    this.deps.clientId = clientId;
    this.deps.clientSecret = clientSecret;
    this.deps.logger.redact(clientSecret);
  }

  listAccounts(): AccountRecord[] {
    return [];
  }

  async searchPage(
    accountId: string,
    query: string,
    pageSize: number,
    pageToken: string | undefined,
    view: SearchView,
  ): Promise<ProviderSearchPage> {
    const account = await this.account(accountId);
    const params = new URLSearchParams({ maxResults: String(pageSize), q: query });
    if (pageToken) params.set("pageToken", pageToken);
    const listed = await this.getJson<GmailThreadList>(
      accountId,
      `/gmail/v1/users/me/threads?${params.toString()}`,
      "read",
    );
    const threads = listed.threads ?? [];
    const estimate = listed.resultSizeEstimate ?? threads.length;
    if (view === "ids" || threads.length === 0) {
      return {
        hits: threads.map((thread) => this.hitFromList(account, thread)),
        nextPageToken: listed.nextPageToken ?? null,
        resultCountEstimate: estimate,
      };
    }
    const full = await this.batchThreads(accountId, threads.map((thread) => String(thread.id ?? "")));
    const hits = threads.map((thread, index) => {
      const body = full[index];
      const messages = body?.messages ?? [];
      const newest = messages.length ? this.messageFromMetadata(account, messages[messages.length - 1], messages.length - 1) : null;
      return {
        id: String(thread.id ?? body?.id ?? ""),
        snippet: body?.snippet || thread.snippet || newest?.snippet || "",
        messageCount: messages.length,
        viewUrl: threadView(account.email, String(thread.id ?? "")),
        historyId: body?.historyId ?? thread.historyId ?? null,
        newest,
      };
    });
    return { hits, nextPageToken: listed.nextPageToken ?? null, resultCountEstimate: estimate };
  }

  async listThreadMeta(): Promise<MailThread[]> {
    throw new ToolError("tool_error", "Full mailbox listing is not used. Search one page.");
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    const account = await this.account(accountId);
    const thread = await this.getOptional<GmailThread>(accountId, `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=raw`, "read");
    if (!thread) return null;
    const messages = await Promise.all((thread.messages ?? []).map((message, position) => this.messageFromRaw(account, message, position)));
    return {
      id: thread.id ?? threadId,
      snippet: thread.snippet ?? messages.at(-1)?.snippet ?? "",
      messageCount: messages.length,
      viewUrl: threadView(account.email, thread.id ?? threadId),
      historyId: thread.historyId ?? null,
      messages,
    };
  }

  async getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null> {
    const message = await this.getOptional<GmailMessage>(
      accountId,
      `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`,
      "read",
    );
    if (!message?.raw) return null;
    return { id: message.id ?? messageId, raw: message.raw };
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    const body = await this.getJson<{ labels?: Array<{ id?: string; name?: string; type?: string }> }>(
      accountId,
      "/gmail/v1/users/me/labels",
      "read",
    );
    return (body.labels ?? []).map((label) => ({
      labelId: String(label.id ?? ""),
      name: String(label.name ?? ""),
      labelType: label.type === "user" ? "USER" : "SYSTEM",
    }));
  }

  async listDraftMeta(accountId: string): Promise<DraftRecord[]> {
    const account = await this.account(accountId);
    const body = await this.getJson<{ drafts?: Array<{ id?: string; message?: GmailMessage }> }>(
      accountId,
      "/gmail/v1/users/me/drafts?maxResults=100",
      "read",
    );
    return (body.drafts ?? []).map((draft) => this.draftRecord(account, String(draft.id ?? ""), draft.message ?? {}, null));
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    const account = await this.account(accountId);
    const draft = await this.getOptional<{ id?: string; message?: GmailMessage }>(
      accountId,
      `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}?format=raw`,
      "read",
    );
    if (!draft) return null;
    return this.draftFromRaw(account, draft.id ?? draftId, draft.message ?? {});
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    return this.sendAs(accountId, "read");
  }

  async listFilters(accountId: string): Promise<FilterRecord[]> {
    const body = await this.getJson<{ filter?: Array<{ id?: string; criteria?: FilterCriteria; action?: FilterAction }> }>(
      accountId,
      "/gmail/v1/users/me/settings/filters",
      "read",
    );
    return (body.filter ?? []).map((filter) => this.filterRecord(String(filter.id ?? ""), filter.criteria, filter.action));
  }

  async createLabel(accountId: string, displayName: string): Promise<LabelRecord> {
    const name = displayName.trim();
    if (!name) throw new ToolError("tool_error", "displayName is required.");
    const created = await this.sendJson<{ id?: string; name?: string }>(
      accountId,
      "/gmail/v1/users/me/labels",
      { name },
    );
    return { labelId: String(created.id ?? ""), name: String(created.name ?? name), labelType: "USER" };
  }

  async labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.sendJson(accountId, `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, {
      addLabelIds: labelIds,
      removeLabelIds: [],
    });
  }

  async unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.sendJson(accountId, `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, {
      addLabelIds: [],
      removeLabelIds: labelIds,
    });
  }

  async modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
    await this.sendJson(accountId, `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, {
      addLabelIds: add,
      removeLabelIds: remove,
    });
  }

  async listRecentThreadIds(
    accountId: string,
    days: number,
    pageSize: number,
    pageToken?: string,
  ): Promise<{ ids: string[]; nextPageToken: string | null }> {
    const params = new URLSearchParams({ maxResults: String(pageSize), q: `newer_than:${days}d` });
    if (pageToken) params.set("pageToken", pageToken);
    const listed = await this.getJson<GmailThreadList>(
      accountId,
      `/gmail/v1/users/me/threads?${params.toString()}`,
      "read",
    );
    return {
      ids: (listed.threads ?? []).map((thread) => String(thread.id ?? "")).filter((id) => id.length > 0),
      nextPageToken: listed.nextPageToken ?? null,
    };
  }

  async profileHistoryId(accountId: string): Promise<string> {
    const body = await this.getJson<{ historyId?: string }>(accountId, "/gmail/v1/users/me/profile", "read");
    if (!body.historyId) throw new ToolError("upstream_error", "The provider failed.", true);
    return String(body.historyId);
  }

  async listHistory(accountId: string, startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage> {
    const params = new URLSearchParams({ startHistoryId, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    try {
      const body = await this.getJson<GmailHistoryResponse>(
        accountId,
        `/gmail/v1/users/me/history?${params.toString()}`,
        "read",
      );
      const threadIds = threadIdsFromHistory(body.history ?? []);
      if (threadIds.length > 0 && !body.historyId) {
        throw new ToolError("upstream_error", "The provider failed.", true);
      }
      return {
        historyId: body.historyId ? String(body.historyId) : null,
        nextPageToken: body.nextPageToken ?? null,
        threadIds,
      };
    } catch (error) {
      if (error instanceof ToolError && error.message.includes("404")) throw new HistoryExpired();
      throw error;
    }
  }

  async watch(accountId: string, topic: string): Promise<void> {
    await this.sendJson(accountId, "/gmail/v1/users/me/watch", {
      topicName: topic,
      labelIds: ["INBOX"],
    });
  }

  async createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord> {
    const account = await this.account(accountId);
    const built = await this.compose(account, input, "write");
    const created = await this.sendJson<{ id?: string; message?: { id?: string; threadId?: string } }>(
      accountId,
      "/gmail/v1/users/me/drafts",
      { message: { raw: built.raw, threadId: built.threadId || undefined } },
    );
    return built.draft(String(created.id ?? ""), String(created.message?.id ?? ""), created.message?.threadId ?? built.threadId);
  }

  async updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord> {
    const account = await this.account(accountId);
    const existing = await this.draftForWrite(accountId, draftId);
    const attachments = input.attachments
      ? decodeAttachments(input.attachments)
      : await mimeAttachments(existing.raw);
    const from = input.fromEmail || account.email;
    const signed = await this.withSignature(accountId, from, input.body, input.htmlBody, input.includeSignature === true, "write");
    const mime = await buildMime({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo: existing.inReplyTo,
      references: existing.references,
      attachments,
    }, { keepBcc: true });
    const threadId = input.threadId ?? existing.threadId;
    await this.sendJson(accountId, `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
      message: { raw: mime.raw, threadId: threadId || undefined },
    }, "PUT");
    return {
      ...existing,
      threadId,
      subject: input.subject,
      toRecipients: [...input.to],
      ccRecipients: [...input.cc],
      bccRecipients: [...input.bcc],
      snippet: snippetOf(signed.text),
      plaintextBody: signed.text,
      htmlBody: signed.html ?? null,
      attachments: storedAttachments(attachments),
      raw: mime.raw,
      bodyFetched: true,
      date: new Date().toISOString(),
    };
  }

  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    await this.sendJson(accountId, `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, undefined, "DELETE");
  }

  async sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    const account = await this.account(accountId);
    if (input.draftId) {
      const draft = await this.draftForWrite(accountId, input.draftId);
      const sent = await this.sendJson<{ id?: string; threadId?: string; labelIds?: string[] }>(
        accountId,
        "/gmail/v1/users/me/drafts/send",
        {
          id: input.draftId,
          message: { raw: draft.raw ?? "", threadId: draft.threadId || undefined },
        },
      );
      return this.sentFrom(account, sent, {
        from: account.email,
        to: draft.toRecipients,
        cc: draft.ccRecipients,
        bcc: draft.bccRecipients,
        subject: draft.subject,
        text: draft.plaintextBody ?? "",
        html: draft.htmlBody ?? undefined,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        raw: draft.raw ?? "",
        attachments: draft.attachments,
        position: 999999,
      });
    }
    const built = await this.compose(account, input, "write");
    const sent = await this.sendJson<{ id?: string; threadId?: string; labelIds?: string[] }>(
      accountId,
      "/gmail/v1/users/me/messages/send",
      { raw: built.raw, threadId: built.threadId || undefined },
    );
    return built.sent(sent);
  }

  async reply(accountId: string, input: ReplyInput): Promise<SentResult> {
    const account = await this.account(accountId);
    const target = await this.messageMeta(accountId, input.messageId, "write");
    const thread = await this.threadMeta(accountId, target.threadId, "write");
    const last = thread.messages[thread.messages.length - 1];
    if (!last) throw notFound();
    const headers = replyHeaders(last);
    const own = await this.ownEmails(accountId, "write");
    const audience = replyAudience({
      replyAll: input.replyAll,
      sender: target.sender,
      replyTo: target.replyTo,
      to: target.toRecipients,
      cc: target.ccRecipients,
      passedCc: input.cc,
      own,
    });
    if (audience.to.length === 0) throw new ToolError("tool_error", "The reply has no recipient.");
    const signed = await this.withSignature(accountId, account.email, input.body, input.htmlBody, input.includeSignature, "write");
    const attachments = decodeAttachments(input.attachments);
    const mime = await buildMime({
      from: account.email,
      to: audience.to,
      cc: audience.cc,
      bcc: input.bcc,
      subject: reSubject(target.subject),
      text: signed.text,
      html: signed.html,
      inReplyTo: headers.inReplyTo,
      references: headers.references,
      attachments,
    }, { keepBcc: true });
    const sent = await this.sendJson<{ id?: string; threadId?: string }>(
      accountId,
      "/gmail/v1/users/me/messages/send",
      { raw: mime.raw, threadId: thread.id },
    );
    return this.sentFrom(account, sent, {
      from: account.email,
      to: audience.to,
      cc: audience.cc,
      bcc: input.bcc,
      subject: reSubject(target.subject),
      text: signed.text,
      html: signed.html,
      inReplyTo: headers.inReplyTo,
      references: headers.references,
      raw: mime.raw,
      attachments: storedAttachments(attachments),
      position: thread.messages.length,
    });
  }

  async forward(accountId: string, input: ForwardInput): Promise<SentResult> {
    const account = await this.account(accountId);
    const raw = await this.getOptional<GmailMessage>(
      accountId,
      `/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}?format=raw`,
      "write",
    );
    if (!raw?.raw) throw notFound();
    const parsed = await this.messageFromRaw(account, raw, 0);
    const quoted = parsed.plaintextBody || parsed.snippet;
    const text = `---------- Forwarded message ----------\nFrom: ${parsed.sender}\nSubject: ${parsed.subject}\n\n${quoted}`;
    const signed = await this.withSignature(accountId, account.email, text, undefined, input.includeSignature, "write");
    const mime = await buildMime({
      from: account.email,
      to: input.to,
      cc: [],
      bcc: [],
      subject: fwdSubject(parsed.subject),
      text: signed.text,
      html: signed.html,
    }, { keepBcc: true });
    const sent = await this.sendJson<{ id?: string; threadId?: string }>(
      accountId,
      "/gmail/v1/users/me/messages/send",
      { raw: mime.raw },
    );
    return this.sentFrom(account, sent, {
      from: account.email,
      to: input.to,
      cc: [],
      bcc: [],
      subject: fwdSubject(parsed.subject),
      text: signed.text,
      html: signed.html,
      inReplyTo: "",
      references: "",
      raw: mime.raw,
      attachments: [],
      position: 0,
    });
  }

  async createFilter(accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord> {
    const created = await this.sendJson<{ id?: string; criteria?: FilterCriteria; action?: FilterAction }>(
      accountId,
      "/gmail/v1/users/me/settings/filters",
      {
        criteria: {
          from: criteria.from || undefined,
          to: criteria.to || undefined,
          subject: criteria.subject || undefined,
          query: criteria.query || undefined,
          hasAttachment: criteria.hasAttachment || undefined,
        },
        action: { addLabelIds: action.addLabelIds, removeLabelIds: action.removeLabelIds },
      },
    );
    return this.filterRecord(String(created.id ?? ""), created.criteria ?? criteria, created.action ?? action);
  }

  async deleteFilter(accountId: string, filterId: string): Promise<void> {
    await this.sendJson(accountId, `/gmail/v1/users/me/settings/filters/${encodeURIComponent(filterId)}`, undefined, "DELETE");
  }

  private hitFromList(account: AccountRecord, thread: { id?: string; snippet?: string; historyId?: string }): SearchHit {
    const id = String(thread.id ?? "");
    return {
      id,
      snippet: thread.snippet ?? "",
      messageCount: 0,
      viewUrl: threadView(account.email, id),
      historyId: thread.historyId ?? null,
      newest: null,
    };
  }

  private async batchThreads(accountId: string, ids: string[]): Promise<GmailThread[]> {
    const boundary = "cbm_batch";
    const parts = ids.map((id, index) => {
      const params = new URLSearchParams({ format: "metadata" });
      for (const header of METADATA_HEADERS) params.append("metadataHeaders", header);
      return [
        `--${boundary}`,
        "Content-Type: application/http",
        `Content-ID: <item-${index}>`,
        "",
        `GET /gmail/v1/users/me/threads/${encodeURIComponent(id)}?${params.toString()} HTTP/1.1`,
        "",
      ].join("\r\n");
    });
    const body = `${parts.join("\r\n")}\r\n--${boundary}--`;
    const text = await this.call(accountId, `${this.origin()}/batch/gmail/v1`, {
      method: "POST",
      headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      body,
    }, "read");
    const parsed = parseBatch(text);
    if (parsed.length < ids.length) throw new ToolError("tool_error", "The provider returned a short page.");
    return parsed;
  }

  private async compose(account: AccountRecord, input: OutgoingDraft, purpose: Purpose): Promise<{
    raw: string;
    threadId: string;
    draft: (id: string, messageId: string, threadId: string) => DraftRecord;
    sent: (body: { id?: string; threadId?: string }) => SentResult;
  }> {
    let threadId = input.threadId ?? "";
    let inReplyTo = "";
    let references = "";
    let position = 0;
    if (input.replyToMessageId) {
      const target = await this.messageMeta(account.id, input.replyToMessageId, purpose);
      const thread = await this.threadMeta(account.id, target.threadId, purpose);
      if (thread.messages.length === 0) throw notFound();
      // A draft answers the message the caller named, even after a newer message landed.
      const headers = replyHeaders(target);
      threadId = target.threadId || thread.id;
      inReplyTo = headers.inReplyTo;
      references = headers.references;
      position = thread.messages.length;
    }
    const from = input.fromEmail || account.email;
    const signed = await this.withSignature(account.id, from, input.body, input.htmlBody, input.includeSignature === true, purpose);
    const attachments = decodeAttachments(input.attachments);
    const mime = await buildMime({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo,
      references,
      attachments,
    }, { keepBcc: true });
    const fields = {
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo,
      references,
      raw: mime.raw,
      attachments: storedAttachments(attachments),
      position,
    };
    return {
      raw: mime.raw,
      threadId,
      draft: (id, messageId, returnedThread) => ({
        id,
        messageId: messageId || `m${id}`,
        threadId: returnedThread,
        subject: input.subject,
        toRecipients: [...input.to],
        ccRecipients: [...input.cc],
        bccRecipients: [...input.bcc],
        date: new Date().toISOString(),
        snippet: snippetOf(signed.text),
        plaintextBody: signed.text,
        htmlBody: signed.html ?? null,
        attachments: storedAttachments(attachments),
        labelIds: ["DRAFT"],
        raw: mime.raw,
        viewUrl: draftView(account.email),
        bodyFetched: true,
        inReplyTo,
        references,
      }),
      sent: (body) => this.sentFrom(account, body, { ...fields, threadHint: threadId }),
    };
  }

  private sentFrom(
    account: AccountRecord,
    body: { id?: string; threadId?: string },
    fields: {
      from: string;
      to: string[];
      cc: string[];
      bcc: string[];
      subject: string;
      text: string;
      html?: string;
      inReplyTo: string;
      references: string;
      raw: string;
      attachments: MailMessage["attachments"];
      position: number;
      threadHint?: string;
    },
  ): SentResult {
    const id = String(body.id ?? "");
    const threadId = String(body.threadId ?? fields.threadHint ?? "");
    const message: MailMessage = {
      id,
      threadId,
      position: fields.position,
      sender: fields.from,
      toRecipients: [...fields.to],
      ccRecipients: [...fields.cc],
      bccRecipients: [...fields.bcc],
      replyTo: [],
      inReplyTo: fields.inReplyTo,
      references: fields.references,
      subject: fields.subject,
      date: new Date().toISOString(),
      labelIds: ["SENT"],
      snippet: snippetOf(fields.text),
      plaintextBody: fields.text,
      htmlBody: fields.html ?? null,
      attachments: fields.attachments,
      raw: fields.raw,
      viewUrl: threadView(account.email, threadId),
      bodyFetched: true,
    };
    return { id, threadId, labelIds: ["SENT"], message };
  }

  private async messageMeta(accountId: string, messageId: string, purpose: Purpose): Promise<MailMessage> {
    const account = await this.account(accountId);
    const message = await this.getJson<GmailMessage>(
      accountId,
      `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&${METADATA_HEADERS.map((header) => `metadataHeaders=${encodeURIComponent(header)}`).join("&")}`,
      purpose,
    );
    if (!message.id) throw notFound();
    return this.messageFromMetadata(account, message, 0);
  }

  private async threadMeta(accountId: string, threadId: string, purpose: Purpose): Promise<{ id: string; messages: MailMessage[] }> {
    const account = await this.account(accountId);
    const params = new URLSearchParams({ format: "metadata" });
    for (const header of METADATA_HEADERS) params.append("metadataHeaders", header);
    const thread = await this.getJson<GmailThread>(
      accountId,
      `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${params.toString()}`,
      purpose,
    );
    const messages = (thread.messages ?? []).map((message, position) => this.messageFromMetadata(account, message, position));
    return { id: thread.id ?? threadId, messages };
  }

  private async draftForWrite(accountId: string, draftId: string): Promise<DraftRecord> {
    const account = await this.account(accountId);
    const draft = await this.getOptional<{ id?: string; message?: GmailMessage }>(
      accountId,
      `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}?format=raw`,
      "write",
    );
    if (!draft?.message) throw notFound();
    return this.draftFromRaw(account, draft.id ?? draftId, draft.message);
  }

  private messageFromMetadata(account: AccountRecord, message: GmailMessage, position: number): MailMessage {
    const headers = message.payload?.headers ?? [];
    const value = (name: string) => headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
    const threadId = message.threadId ?? "";
    return {
      id: String(message.id ?? ""),
      threadId,
      position,
      sender: value("From"),
      toRecipients: splitList(value("To")),
      ccRecipients: splitList(value("Cc")),
      bccRecipients: [],
      replyTo: splitList(value("Reply-To")),
      inReplyTo: value("In-Reply-To"),
      references: value("References"),
      subject: value("Subject"),
      date: isoDate(value("Date")),
      labelIds: message.labelIds ?? [],
      snippet: message.snippet ?? "",
      plaintextBody: null,
      htmlBody: null,
      attachments: [],
      raw: null,
      viewUrl: threadView(account.email, threadId),
      bodyFetched: false,
    };
  }

  private async messageFromRaw(account: AccountRecord, message: GmailMessage, position: number): Promise<MailMessage> {
    const parsed = message.raw ? await parseMime(Buffer.from(message.raw, "base64url")) : null;
    const text = parsed?.text ?? "";
    const html = typeof parsed?.html === "string" ? parsed.html : null;
    const threadId = message.threadId ?? "";
    return {
      id: String(message.id ?? ""),
      threadId,
      position,
      sender: parsed?.from?.text ?? "",
      toRecipients: addressText(parsed?.to),
      ccRecipients: addressText(parsed?.cc),
      bccRecipients: addressText(parsed?.bcc),
      replyTo: addressText(parsed?.replyTo),
      inReplyTo: bracket(headerText(parsed?.inReplyTo)),
      references: bracketList(referencesText(parsed?.references)),
      subject: parsed?.subject ?? "",
      date: parsed?.date ? parsed.date.toISOString() : "",
      labelIds: message.labelIds ?? [],
      snippet: message.snippet || snippetOf(text),
      plaintextBody: text,
      htmlBody: html,
      attachments: parsed ? parsedAttachments(parsed) : [],
      raw: message.raw ?? null,
      viewUrl: threadView(account.email, threadId),
      bodyFetched: true,
    };
  }

  private draftRecord(account: AccountRecord, id: string, message: GmailMessage, parsed: DraftRecord | null): DraftRecord {
    if (parsed) return parsed;
    return {
      id,
      messageId: String(message.id ?? ""),
      threadId: message.threadId ?? "",
      subject: "",
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      date: "",
      snippet: message.snippet ?? "",
      plaintextBody: null,
      htmlBody: null,
      attachments: [],
      labelIds: message.labelIds ?? ["DRAFT"],
      raw: null,
      viewUrl: draftView(account.email),
      bodyFetched: false,
      inReplyTo: "",
      references: "",
    };
  }

  private async draftFromRaw(account: AccountRecord, id: string, message: GmailMessage): Promise<DraftRecord> {
    const full = await this.messageFromRaw(account, message, 0);
    return {
      id,
      messageId: full.id,
      threadId: full.threadId,
      subject: full.subject,
      toRecipients: full.toRecipients,
      ccRecipients: full.ccRecipients,
      bccRecipients: full.bccRecipients,
      date: full.date,
      snippet: full.snippet,
      plaintextBody: full.plaintextBody,
      htmlBody: full.htmlBody,
      attachments: full.attachments,
      labelIds: full.labelIds.length ? full.labelIds : ["DRAFT"],
      raw: full.raw,
      viewUrl: draftView(account.email),
      bodyFetched: true,
      inReplyTo: full.inReplyTo,
      references: full.references,
    };
  }

  private filterRecord(id: string, criteria: Partial<FilterCriteria> | undefined, action: Partial<FilterAction> | undefined): FilterRecord {
    const remove = action?.removeLabelIds ?? [];
    return {
      id,
      criteria: {
        from: criteria?.from ?? "",
        to: criteria?.to ?? "",
        subject: criteria?.subject ?? "",
        query: criteria?.query ?? "",
        hasAttachment: criteria?.hasAttachment === true,
      },
      action: {
        addLabelIds: action?.addLabelIds ?? [],
        removeLabelIds: remove,
        skipInbox: action?.skipInbox === true || remove.includes("INBOX"),
      },
    };
  }

  private async sendAs(accountId: string, purpose: Purpose): Promise<SendAsRecord[]> {
    const body = await this.getJson<{ sendAs?: Array<Record<string, unknown>> }>(
      accountId,
      "/gmail/v1/users/me/settings/sendAs",
      purpose,
    );
    return (body.sendAs ?? []).map((row) => ({
      email: String(row.sendAsEmail ?? ""),
      signature: String(row.signature ?? ""),
      isDefault: row.isDefault === true,
      isPrimary: row.isPrimary === true,
      verified: row.verificationStatus === "accepted",
    }));
  }

  private async ownEmails(accountId: string, purpose: Purpose): Promise<Set<string>> {
    const account = await this.account(accountId);
    const emails = new Set<string>([account.email.toLowerCase()]);
    for (const row of await this.sendAs(accountId, purpose)) emails.add(row.email.toLowerCase());
    return emails;
  }

  private async withSignature(
    accountId: string,
    from: string,
    text: string,
    html: string | undefined,
    include: boolean,
    purpose: Purpose,
  ): Promise<{ text: string; html?: string }> {
    if (!include) return { text, html };
    const rows = await this.sendAs(accountId, purpose);
    const match = rows.find((row) => row.email.toLowerCase() === from.toLowerCase()) ?? rows.find((row) => row.isDefault);
    const signature = match?.signature ?? "";
    if (!signature) return { text, html };
    const plain = stripHtml(signature);
    return {
      text: plain ? `${text}\n\n${plain}` : text,
      html: `${html ?? textToHtml(text)}<br>${signature}`,
    };
  }

  private async account(accountId: string): Promise<AccountRecord> {
    const accounts = await this.deps.store.listAccounts();
    const found = accounts.find((item) => item.id === accountId);
    if (!found) throw new ToolError("tool_error", "Unknown account.");
    return found;
  }

  private origin(): string {
    return this.deps.apiBase.replace(/\/$/, "");
  }

  private async getJson<T>(accountId: string, path: string, purpose: Purpose): Promise<T> {
    const text = await this.call(accountId, `${this.origin()}${path}`, { method: "GET" }, purpose);
    return parseJson<T>(text);
  }

  private async getOptional<T>(accountId: string, path: string, purpose: Purpose): Promise<T | null> {
    try {
      return await this.getJson<T>(accountId, path, purpose);
    } catch (error) {
      if (error instanceof ToolError && error.message.includes("404")) return null;
      throw error;
    }
  }

  private async sendJson<T>(accountId: string, path: string, payload: unknown, method: "POST" | "PUT" | "DELETE" = "POST"): Promise<T> {
    const text = await this.call(accountId, `${this.origin()}${path}`, {
      method,
      headers: payload === undefined ? {} : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }, "write");
    if (!text) return {} as T;
    return parseJson<T>(text);
  }

  private async call(accountId: string, url: string, init: RequestInit, purpose: Purpose, refreshed = false): Promise<string> {
    this.assertOrigin(url);
    const access = await this.ensureAccess(accountId, purpose, false);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${access}`);
    let response: Response;
    try {
      response = await this.fetcher()(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch {
      throw new ToolError("upstream_error", "The provider connection failed.", purpose === "read");
    }
    if (response.status === 401 && purpose === "read" && !refreshed) {
      await response.text();
      await this.ensureAccess(accountId, "read", true);
      return this.call(accountId, url, init, purpose, true);
    }
    if (response.status === 401) {
      await response.text();
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    const text = await response.text();
    if (response.status === 404) throw notFound();
    if (response.status === 429) {
      throw new ToolError("rate_limited", "The provider asked us to slow down.", purpose === "read");
    }
    if (response.status >= 500) throw new ToolError("upstream_error", "The provider failed.", purpose === "read");
    if (!response.ok && response.status !== 204) {
      throw new ToolError("tool_error", `The provider returned ${response.status}.`, false);
    }
    return text;
  }

  private async ensureAccess(accountId: string, purpose: Purpose, force: boolean): Promise<string> {
    const token = await this.loadToken(accountId);
    if (!force && token.accessToken && token.expiresAt > Date.now() + 30_000) return token.accessToken;
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
    this.assertOrigin(url);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
    });
    let response: Response;
    try {
      response = await this.fetcher()(url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch {
      throw new ToolError("upstream_error", "The provider connection failed.", purpose === "read");
    }
    const text = await response.text();
    const parsed = parseJson<{ access_token?: string; expires_in?: number; error?: string }>(text || "{}");
    if (parsed.error === "invalid_grant" || response.status === 400) {
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    if (!response.ok || !parsed.access_token) {
      if (response.status === 429 || response.status >= 500) {
        throw new ToolError("upstream_error", "The provider failed.", purpose === "read");
      }
      throw new ToolError("needs_reauth", "Connect this account again.", false);
    }
    this.deps.logger.redact(parsed.access_token);
    const next: StoredToken = {
      refreshToken,
      accessToken: parsed.access_token,
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
    };
    await this.deps.store.upsertToken(accountId, this.deps.key, JSON.stringify(next));
    return next.accessToken;
  }

  private assertOrigin(url: string): void {
    const target = new URL(url);
    const allowed = [this.deps.apiBase, this.deps.tokenUrl].map((value) => new URL(value).origin);
    if (!allowed.includes(target.origin)) {
      throw new ToolError("tool_error", "Refusing a request outside the configured Gmail origin.");
    }
  }

  private fetcher(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }
}

function threadIdsFromHistory(history: NonNullable<GmailHistoryResponse["history"]>): string[] {
  const ids = new Set<string>();
  for (const record of history) {
    const buckets = [record.messagesAdded, record.messagesDeleted, record.labelsAdded, record.labelsRemoved];
    for (const bucket of buckets) {
      for (const item of bucket ?? []) {
        const threadId = item.message?.threadId;
        if (threadId) ids.add(threadId);
      }
    }
  }
  return [...ids];
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ToolError("tool_error", "The provider returned a body that was not JSON.");
  }
}

function parseBatch(body: string): GmailThread[] {
  const chunks = body.split(/--batch_[A-Za-z0-9_-]+/);
  const threads: GmailThread[] = [];
  for (const chunk of chunks) {
    const start = chunk.indexOf("{");
    if (start < 0) continue;
    const json = sliceJson(chunk, start);
    if (!json) continue;
    try {
      threads.push(JSON.parse(json) as GmailThread);
    } catch {
      throw new ToolError("tool_error", "The provider returned a page that was not JSON.");
    }
  }
  return threads;
}

function sliceJson(text: string, start: number): string | null {
  let depth = 0;
  let quoted = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function splitList(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function isoDate(value: string): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function bracket(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/^<|>$/g, "")}>`;
}

function bracketList(value: string): string {
  return value.split(/\s+/).filter(Boolean).map(bracket).join(" ");
}

function addressText(value: { value?: Array<{ address?: string; name?: string }>; text?: string } | Array<{ value?: Array<{ address?: string; name?: string }>; text?: string }> | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    for (const party of item.value ?? []) {
      if (!party.address) continue;
      out.push(party.name ? `${party.name} <${party.address}>` : party.address);
    }
  }
  return out;
}

function decodeAttachments(items: OutgoingAttachment[] | undefined): MimeAttachment[] {
  const decoded: MimeAttachment[] = [];
  for (const item of items ?? []) {
    if (!item.content) continue;
    const content = Buffer.from(item.content, "base64");
    if (content.length > MAX_ATTACHMENT_BYTES) {
      throw new ToolError("tool_error", "Attachment is over 25 MB.");
    }
    decoded.push({ filename: item.filename, mimeType: item.mimeType, content, cid: item.cid });
  }
  return decoded;
}

function storedAttachments(items: MimeAttachment[]): MailMessage["attachments"] {
  return items.map((item, index) => ({
    id: item.cid || `att${index}`,
    filename: item.filename,
    mimeType: item.mimeType,
    cid: item.cid ?? "",
  }));
}

async function mimeAttachments(raw: string | null): Promise<MimeAttachment[]> {
  if (!raw) return [];
  const parsed = await parseMime(Buffer.from(raw, "base64url"));
  return parsed.attachments.map((item) => ({
    filename: item.filename || "attachment",
    mimeType: item.contentType || "application/octet-stream",
    content: item.content,
    cid: item.cid || undefined,
  }));
}
