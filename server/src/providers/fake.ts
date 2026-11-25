import { ToolError, notFound } from "../errors.js";
import { Logger } from "../log.js";
import { nextToken, offsetOf } from "../paging.js";
import type { Repo } from "../store/repo.js";
import { addressList, dedupeAddresses, emailOf, fwdSubject, reSubject, stripHtml, textToHtml } from "./addresses.js";
import { draftView, snippetOf, threadView } from "./codec.js";
import { demoThreadIds } from "./demo-search.js";
import { demoMailbox, seedToken } from "./demo-mailbox.js";
import { buildMime, parseMime, type MimeAttachment } from "./mime.js";
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
  SearchView,
  SendAsRecord,
  SentResult,
} from "./types.js";

export interface ProviderCounts {
  searchIds: number;
  listThreadMeta: number;
  getThread: number;
  getMessageRaw: number;
  listLabels: number;
  listDraftMeta: number;
  getDraft: number;
  listSendAs: number;
  listFilters: number;
  createLabel: number;
  labelThread: number;
  unlabelThread: number;
  modifyThread: number;
  createDraft: number;
  updateDraft: number;
  deleteDraft: number;
  sendMessage: number;
  reply: number;
  forward: number;
  createFilter: number;
  deleteFilter: number;
}

function cloneMessage(message: MailMessage, bodies: boolean): MailMessage {
  return {
    ...message,
    toRecipients: [...message.toRecipients],
    ccRecipients: [...message.ccRecipients],
    bccRecipients: [...message.bccRecipients],
    replyTo: [...message.replyTo],
    labelIds: [...message.labelIds],
    attachments: message.attachments.map((item) => ({ ...item })),
    plaintextBody: bodies ? message.plaintextBody : null,
    htmlBody: bodies ? message.htmlBody : null,
    raw: bodies ? message.raw : null,
    bodyFetched: bodies,
  };
}

function cloneThread(thread: MailThread, bodies: boolean): MailThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => cloneMessage(message, bodies)),
  };
}

function cloneDraft(draft: DraftRecord, bodies: boolean): DraftRecord {
  return {
    ...draft,
    toRecipients: [...draft.toRecipients],
    ccRecipients: [...draft.ccRecipients],
    bccRecipients: [...draft.bccRecipients],
    labelIds: [...draft.labelIds],
    attachments: draft.attachments.map((item) => ({ ...item })),
    plaintextBody: bodies ? draft.plaintextBody : null,
    htmlBody: bodies ? draft.htmlBody : null,
    raw: bodies ? draft.raw : null,
    bodyFetched: bodies,
  };
}

function cloneBox(source: ReturnType<typeof demoMailbox>): ReturnType<typeof demoMailbox> {
  const threads = new Map<string, MailThread[]>();
  for (const [id, list] of source.threads) threads.set(id, list.map((thread) => cloneThread(thread, true)));
  const drafts = new Map<string, DraftRecord[]>();
  for (const [id, list] of source.drafts) drafts.set(id, list.map((draft) => cloneDraft(draft, true)));
  const labels = new Map<string, LabelRecord[]>();
  for (const [id, list] of source.labels) labels.set(id, list.map((label) => ({ ...label })));
  const sendAs = new Map<string, SendAsRecord[]>();
  for (const [id, list] of source.sendAs) sendAs.set(id, list.map((row) => ({ ...row })));
  return { accounts: source.accounts.map((account) => ({ ...account })), threads, labels, drafts, sendAs, signature: source.signature, invoicePdf: source.invoicePdf };
}

type Box = ReturnType<typeof cloneBox>;

function decodeAttachments(items: OutgoingAttachment[] | undefined): MimeAttachment[] {
  return (items ?? []).filter((item) => item.content).map((item) => ({
    filename: item.filename,
    mimeType: item.mimeType,
    content: Buffer.from(item.content ?? "", "base64"),
    cid: item.cid,
  }));
}

function storedAttachments(items: MimeAttachment[]): Attachment[] {
  return items.map((item, index) => ({
    id: `att${index}`,
    filename: item.filename,
    mimeType: item.mimeType,
    cid: item.cid ?? "",
  }));
}

export class FakeProvider implements MailProvider {
  readonly kind = "fake" as const;
  readonly counts: ProviderCounts = {
    searchIds: 0,
    listThreadMeta: 0,
    getThread: 0,
    getMessageRaw: 0,
    listLabels: 0,
    listDraftMeta: 0,
    getDraft: 0,
    listSendAs: 0,
    listFilters: 0,
    createLabel: 0,
    labelThread: 0,
    unlabelThread: 0,
    modifyThread: 0,
    createDraft: 0,
    updateDraft: 0,
    deleteDraft: 0,
    sendMessage: 0,
    reply: 0,
    forward: 0,
    createFilter: 0,
    deleteFilter: 0,
  };
  private readonly failures: ToolError[] = [];
  private readonly box: Box;
  private readonly filters = new Map<string, FilterRecord[]>();
  private seq = 100;

  constructor(box?: Box) {
    this.box = box ?? cloneBox(demoMailbox());
  }

  failNext(error: ToolError): void {
    this.failures.push(error);
  }

  private count(key: keyof ProviderCounts): void {
    this.counts[key] += 1;
  }

  /** Counts the call and throws a queued failure. Index methods do not use this. */
  private hit(key: keyof ProviderCounts): void {
    this.count(key);
    const next = this.failures.shift();
    if (next) throw next;
  }

  /** Seals the demo token once per account. Real providers read tokens that are already stored. */
  async installDemo(store: Repo, key: Buffer, logger: Logger): Promise<void> {
    for (const [index, account] of this.listAccounts().entries()) {
      await store.upsertAccount(account, index);
      const token = seedToken(account.id);
      logger.redact(token);
      const existing = await store.tokenCiphertext(account.id);
      if (!existing) await store.upsertToken(account.id, key, token);
    }
  }

  listAccounts(): AccountRecord[] {
    return this.box.accounts.map((account) => ({ ...account }));
  }

  private account(accountId: string): AccountRecord {
    const found = this.box.accounts.find((item) => item.id === accountId);
    if (!found) throw new ToolError("tool_error", "Unknown account.");
    return found;
  }

  private threads(accountId: string): MailThread[] {
    return this.box.threads.get(accountId) ?? [];
  }

  private drafts(accountId: string): DraftRecord[] {
    const list = this.box.drafts.get(accountId);
    if (list) return list;
    const created: DraftRecord[] = [];
    this.box.drafts.set(accountId, created);
    return created;
  }

  private ownEmails(accountId: string): Set<string> {
    const emails = new Set<string>();
    const account = this.account(accountId);
    emails.add(account.email.toLowerCase());
    for (const row of this.box.sendAs.get(accountId) ?? []) emails.add(row.email.toLowerCase());
    return emails;
  }

  private signatureFor(accountId: string, fromEmail: string): string {
    const rows = this.box.sendAs.get(accountId) ?? [];
    const match = rows.find((row) => row.email.toLowerCase() === fromEmail.toLowerCase());
    return (match ?? rows.find((row) => row.isDefault))?.signature ?? "";
  }

  private findMessage(accountId: string, messageId: string): { thread: MailThread; message: MailMessage } | null {
    for (const thread of this.threads(accountId)) {
      const message = thread.messages.find((item) => item.id === messageId);
      if (message) return { thread, message };
    }
    return null;
  }

  private threadingFor(accountId: string, messageId: string): { threadId: string; inReplyTo: string; references: string; last: MailMessage } {
    const found = this.findMessage(accountId, messageId);
    if (!found) throw notFound();
    const last = found.thread.messages[found.thread.messages.length - 1];
    if (!last) throw notFound();
    const headers = replyHeaders(last);
    return { threadId: found.thread.id, ...headers, last };
  }

  async searchPage(
    accountId: string,
    query: string,
    pageSize: number,
    pageToken: string | undefined,
    _view: SearchView,
  ): Promise<ProviderSearchPage> {
    const offset = offsetOf(pageToken);
    this.hit("searchIds");
    const ids = demoThreadIds(accountId, query);
    const slice = ids.slice(offset, offset + pageSize);
    const threads = this.threads(accountId);
    const hits = slice.map((id) => {
      const thread = threads.find((item) => item.id === id);
      const newest = thread?.messages[thread.messages.length - 1];
      return {
        id,
        snippet: thread?.snippet ?? "",
        messageCount: thread?.messageCount ?? 0,
        viewUrl: thread?.viewUrl ?? "",
        historyId: thread?.historyId ?? null,
        newest: newest ? cloneMessage(newest, false) : null,
      };
    });
    return {
      hits,
      nextPageToken: nextToken(offset, pageSize, ids.length),
      resultCountEstimate: ids.length,
    };
  }

  async listThreadMeta(accountId: string): Promise<MailThread[]> {
    this.count("listThreadMeta");
    return this.threads(accountId).map((thread) => cloneThread(thread, false));
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    this.hit("getThread");
    const thread = this.threads(accountId).find((item) => item.id === threadId);
    return thread ? cloneThread(thread, true) : null;
  }

  async getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null> {
    this.hit("getMessageRaw");
    const found = this.findMessage(accountId, messageId);
    if (found?.message.raw) return { id: found.message.id, raw: found.message.raw };
    return null;
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    this.count("listLabels");
    return (this.box.labels.get(accountId) ?? []).map((label) => ({ ...label }));
  }

  async listDraftMeta(accountId: string): Promise<DraftRecord[]> {
    this.count("listDraftMeta");
    return this.drafts(accountId).map((draft) => cloneDraft(draft, false));
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    this.hit("getDraft");
    const draft = this.drafts(accountId).find((item) => item.id === draftId);
    return draft ? cloneDraft(draft, true) : null;
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    this.count("listSendAs");
    return (this.box.sendAs.get(accountId) ?? []).map((row) => ({ ...row }));
  }

  async listFilters(accountId: string): Promise<FilterRecord[]> {
    this.count("listFilters");
    return (this.filters.get(accountId) ?? []).map((filter) => ({
      id: filter.id,
      criteria: { ...filter.criteria },
      action: {
        addLabelIds: [...filter.action.addLabelIds],
        removeLabelIds: [...filter.action.removeLabelIds],
        skipInbox: filter.action.skipInbox,
      },
    }));
  }

  async createLabel(accountId: string, displayName: string): Promise<LabelRecord> {
    this.hit("createLabel");
    this.account(accountId);
    const name = displayName.trim();
    if (!name) throw new ToolError("tool_error", "displayName is required.");
    const labels = this.box.labels.get(accountId) ?? [];
    if (labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      throw new ToolError("tool_error", "That label already exists.");
    }
    const label: LabelRecord = { labelId: `U${this.seq++}`, name, labelType: "USER" };
    labels.push(label);
    this.box.labels.set(accountId, labels);
    return { ...label };
  }

  async labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    this.hit("labelThread");
    this.retouch(accountId, threadId, (message) => {
      message.labelIds = [...new Set([...message.labelIds, ...labelIds])];
    });
  }

  async unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    this.hit("unlabelThread");
    const drop = new Set(labelIds);
    this.retouch(accountId, threadId, (message) => {
      message.labelIds = message.labelIds.filter((id) => !drop.has(id));
    });
  }

  async modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
    this.hit("modifyThread");
    const drop = new Set(remove);
    this.retouch(accountId, threadId, (message) => {
      message.labelIds = [...new Set([...message.labelIds, ...add])].filter((id) => !drop.has(id));
    });
  }

  private retouch(accountId: string, threadId: string, apply: (message: MailMessage) => void): void {
    const thread = this.threads(accountId).find((item) => item.id === threadId);
    if (!thread) throw notFound();
    for (const message of thread.messages) apply(message);
  }

  async createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord> {
    this.hit("createDraft");
    const account = this.account(accountId);
    const threading = input.replyToMessageId
      ? this.threadingFor(accountId, input.replyToMessageId)
      : { threadId: input.threadId ?? "", inReplyTo: "", references: "", last: undefined };
    const from = input.fromEmail || account.email;
    const signed = this.sign(accountId, from, input.body, input.htmlBody, input.includeSignature === true);
    const attachments = decodeAttachments(input.attachments);
    const mime = await buildMime({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
      attachments,
    });
    const id = `d${this.seq++}`;
    const now = new Date().toISOString();
    const draft: DraftRecord = {
      id,
      messageId: `m${id}`,
      threadId: threading.threadId,
      subject: input.subject,
      toRecipients: [...input.to],
      ccRecipients: [...input.cc],
      bccRecipients: [...input.bcc],
      date: now,
      snippet: snippetOf(signed.text),
      plaintextBody: signed.text,
      htmlBody: signed.html ?? null,
      attachments: storedAttachments(attachments),
      labelIds: ["DRAFT"],
      raw: mime.raw,
      viewUrl: draftView(account.email),
      bodyFetched: true,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
    };
    this.drafts(accountId).push(draft);
    return cloneDraft(draft, true);
  }

  async updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord> {
    this.hit("updateDraft");
    const account = this.account(accountId);
    const draft = this.drafts(accountId).find((item) => item.id === draftId);
    if (!draft) throw notFound();
    const from = input.fromEmail || account.email;
    const body = input.body;
    const signed = this.sign(accountId, from, body, input.htmlBody, input.includeSignature === true);
    const attachments = input.attachments
      ? decodeAttachments(input.attachments)
      : await mimeAttachments(draft.raw);
    const mime = await buildMime({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      attachments,
    });
    draft.threadId = input.threadId ?? draft.threadId;
    draft.subject = input.subject;
    draft.toRecipients = [...input.to];
    draft.ccRecipients = [...input.cc];
    draft.bccRecipients = [...input.bcc];
    draft.plaintextBody = signed.text;
    draft.htmlBody = signed.html ?? null;
    draft.snippet = snippetOf(signed.text);
    draft.attachments = storedAttachments(attachments);
    draft.raw = mime.raw;
    draft.date = new Date().toISOString();
    return cloneDraft(draft, true);
  }

  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    this.hit("deleteDraft");
    const list = this.drafts(accountId);
    const index = list.findIndex((item) => item.id === draftId);
    if (index < 0) throw notFound();
    list.splice(index, 1);
  }

  async sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    this.hit("sendMessage");
    const account = this.account(accountId);
    if (input.draftId) {
      const draft = this.drafts(accountId).find((item) => item.id === input.draftId);
      if (!draft) throw notFound();
      const sent = await this.storeSent(account, {
        threadId: draft.threadId || `t${this.seq++}`,
        from: account.email,
        to: draft.toRecipients,
        cc: draft.ccRecipients,
        bcc: draft.bccRecipients,
        subject: draft.subject,
        text: draft.plaintextBody ?? "",
        html: draft.htmlBody ?? undefined,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        attachments: [],
      });
      await this.deleteDraft(accountId, draft.id);
      this.counts.deleteDraft -= 1;
      return sent;
    }
    const threading = input.replyToMessageId ? this.threadingFor(accountId, input.replyToMessageId) : undefined;
    const from = input.fromEmail || account.email;
    const signed = this.sign(accountId, from, input.body, input.htmlBody, input.includeSignature === true);
    return this.storeSent(account, {
      threadId: threading?.threadId || input.threadId || `t${this.seq++}`,
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: signed.text,
      html: signed.html,
      inReplyTo: threading?.inReplyTo ?? "",
      references: threading?.references ?? "",
      attachments: decodeAttachments(input.attachments),
    });
  }

  async reply(accountId: string, input: ReplyInput): Promise<SentResult> {
    this.hit("reply");
    const account = this.account(accountId);
    const found = this.findMessage(accountId, input.messageId);
    if (!found) throw notFound();
    const threading = this.threadingFor(accountId, input.messageId);
    const own = this.ownEmails(accountId);
    const primary = found.message.replyTo.length > 0 ? found.message.replyTo : [found.message.sender];
    const to = dedupeAddresses(input.replyAll ? [...primary, ...found.message.toRecipients] : primary, own);
    const ccSource = input.cc.length > 0 || !input.replyAll ? input.cc : found.message.ccRecipients;
    const cc = dedupeAddresses(ccSource, own).filter((value) => !to.some((item) => emailOf(item) === emailOf(value)));
    if (to.length === 0) throw new ToolError("tool_error", "The reply has no recipient.");
    const from = account.email;
    const signed = this.sign(accountId, from, input.body, input.htmlBody, input.includeSignature);
    return this.storeSent(account, {
      threadId: threading.threadId,
      from,
      to,
      cc,
      bcc: input.bcc,
      subject: reSubject(found.message.subject),
      text: signed.text,
      html: signed.html,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
      attachments: decodeAttachments(input.attachments),
    });
  }

  async forward(accountId: string, input: ForwardInput): Promise<SentResult> {
    this.hit("forward");
    const account = this.account(accountId);
    const found = this.findMessage(accountId, input.messageId);
    if (!found) throw notFound();
    const quoted = found.message.plaintextBody ?? found.message.snippet;
    const text = `---------- Forwarded message ----------\nFrom: ${found.message.sender}\nSubject: ${found.message.subject}\n\n${quoted}`;
    const signed = this.sign(accountId, account.email, text, undefined, input.includeSignature);
    return this.storeSent(account, {
      threadId: `t${this.seq++}`,
      from: account.email,
      to: input.to,
      cc: [],
      bcc: [],
      subject: fwdSubject(found.message.subject),
      text: signed.text,
      html: signed.html,
      inReplyTo: "",
      references: "",
      attachments: [],
    });
  }

  async createFilter(accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord> {
    this.hit("createFilter");
    this.account(accountId);
    const filter: FilterRecord = {
      id: `f${this.seq++}`,
      criteria: { ...criteria },
      action: {
        addLabelIds: [...action.addLabelIds],
        removeLabelIds: [...action.removeLabelIds],
        skipInbox: action.skipInbox,
      },
    };
    const list = this.filters.get(accountId) ?? [];
    list.push(filter);
    this.filters.set(accountId, list);
    return {
      id: filter.id,
      criteria: { ...filter.criteria },
      action: { ...filter.action, addLabelIds: [...filter.action.addLabelIds], removeLabelIds: [...filter.action.removeLabelIds] },
    };
  }

  async deleteFilter(accountId: string, filterId: string): Promise<void> {
    this.hit("deleteFilter");
    const list = this.filters.get(accountId) ?? [];
    const index = list.findIndex((item) => item.id === filterId);
    if (index < 0) throw notFound();
    list.splice(index, 1);
  }

  private sign(accountId: string, from: string, text: string, html: string | undefined, include: boolean): { text: string; html?: string } {
    if (!include) return { text, html };
    const signature = this.signatureFor(accountId, from);
    if (!signature) return { text, html };
    const plain = stripHtml(signature);
    return {
      text: plain ? `${text}\n\n${plain}` : text,
      html: `${html ?? textToHtml(text)}<br>${signature}`,
    };
  }

  private async storeSent(account: AccountRecord, input: {
    threadId: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    html?: string;
    inReplyTo: string;
    references: string;
    attachments: MimeAttachment[];
  }): Promise<SentResult> {
    const mime = await buildMime({
      from: input.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      inReplyTo: input.inReplyTo,
      references: input.references,
      attachments: input.attachments,
    });
    const threads = this.threads(account.id);
    let thread = threads.find((item) => item.id === input.threadId);
    if (!thread) {
      thread = {
        id: input.threadId,
        snippet: snippetOf(input.text),
        messageCount: 0,
        viewUrl: threadView(account.email, input.threadId),
        historyId: null,
        messages: [],
      };
      threads.push(thread);
      this.box.threads.set(account.id, threads);
    }
    const message: MailMessage = {
      id: `m${this.seq++}`,
      threadId: thread.id,
      position: thread.messages.length,
      sender: input.from.includes("<") ? input.from : input.from,
      toRecipients: [...input.to],
      ccRecipients: [...input.cc],
      bccRecipients: [...input.bcc],
      replyTo: [],
      inReplyTo: input.inReplyTo,
      references: input.references,
      subject: input.subject,
      date: new Date().toISOString(),
      labelIds: ["SENT"],
      snippet: snippetOf(input.text),
      plaintextBody: input.text,
      htmlBody: input.html ?? null,
      attachments: storedAttachments(input.attachments),
      raw: mime.raw,
      viewUrl: thread.viewUrl,
      bodyFetched: true,
    };
    thread.messages.push(message);
    thread.messageCount = thread.messages.length;
    thread.snippet = message.snippet;
    return { id: message.id, threadId: thread.id, labelIds: ["SENT"], message: cloneMessage(message, true) };
  }
}

export function normalizeCriteria(input: Partial<FilterCriteria> | undefined): FilterCriteria {
  return {
    from: input?.from ?? "",
    to: input?.to ?? "",
    subject: input?.subject ?? "",
    query: input?.query ?? "",
    hasAttachment: input?.hasAttachment === true,
  };
}

export function normalizeAction(input: Partial<FilterAction> | undefined): FilterAction {
  const remove = new Set(input?.removeLabelIds ?? []);
  if (input?.skipInbox) remove.add("INBOX");
  return {
    addLabelIds: [...(input?.addLabelIds ?? [])],
    removeLabelIds: [...remove],
    skipInbox: input?.skipInbox === true || remove.has("INBOX"),
  };
}

export function outgoingDraft(input: {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  htmlBody?: unknown;
  replyToMessageId?: unknown;
  includeSignature?: unknown;
  attachments?: OutgoingAttachment[];
  threadId?: unknown;
  fromEmail?: unknown;
  draftId?: unknown;
}): OutgoingDraft {
  return {
    to: addressList(input.to),
    cc: addressList(input.cc),
    bcc: addressList(input.bcc),
    subject: typeof input.subject === "string" ? input.subject : "",
    body: typeof input.body === "string" ? input.body : "",
    htmlBody: typeof input.htmlBody === "string" ? input.htmlBody : undefined,
    replyToMessageId: typeof input.replyToMessageId === "string" ? input.replyToMessageId : undefined,
    includeSignature: input.includeSignature === true,
    attachments: input.attachments,
    threadId: typeof input.threadId === "string" ? input.threadId : undefined,
    fromEmail: typeof input.fromEmail === "string" ? input.fromEmail : undefined,
    draftId: typeof input.draftId === "string" ? input.draftId : undefined,
  };
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
