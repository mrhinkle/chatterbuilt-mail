import type { MailMode } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import { addressList } from "../providers/addresses.js";
import { refuseUnavailable } from "../providers/router.js";
import { MAX_ATTACHMENT_BYTES } from "../providers/mime.js";
import type {
  AccountRecord,
  FilterAction,
  FilterCriteria,
  MailProvider,
  OutgoingAttachment,
  OutgoingDraft,
  SentResult,
} from "../providers/types.js";
import type { Repo } from "../store/repo.js";

export interface WriteInput {
  account?: string;
  acct?: string;
  displayName?: string;
  threadId?: string;
  labelIds?: string[];
  draftId?: string;
  messageId?: string;
  filterId?: string;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: string;
  body?: string;
  htmlBody?: string;
  replyToMessageId?: string;
  includeSignature?: boolean;
  replyAll?: boolean;
  fromEmail?: string;
  attachments?: OutgoingAttachment[];
  criteria?: Partial<FilterCriteria>;
  action?: Partial<FilterAction>;
}

/**
 * Provider first. Mirror mode then updates the store. Direct mode appends the
 * audit log only. A failed provider call does not change mail rows. Once the
 * provider has accepted the write, a store or audit failure is logged and
 * recorded when it can be, and is not a tool error. A mirror store failure
 * marks that thread for the next sync. Nothing here calls the read retry helper.
 */
export class WriteService {
  constructor(
    private readonly store: Repo,
    private readonly provider: MailProvider,
    private readonly logger: Logger,
    private readonly mailMode: MailMode,
  ) {}

  async createLabel(input: WriteInput): Promise<{ labelId: string; name: string }> {
    const account = await this.account(input);
    const name = input.displayName?.trim() ?? "";
    if (!name) throw new ToolError("tool_error", "displayName is required.");
    const created = await this.commit(
      "create_label",
      account.id,
      [],
      () => this.provider.createLabel(account.id, name),
      (label) => this.store.insertLabel(account.id, label),
      (label) => [label.labelId],
    );
    return { labelId: created.labelId, name: created.name };
  }

  async labelThread(input: WriteInput): Promise<Record<string, never>> {
    const account = await this.account(input);
    const threadId = requiredId(input.threadId, "threadId");
    const labelIds = input.labelIds ?? [];
    await this.commit(
      "label_thread",
      account.id,
      [threadId, ...labelIds],
      () => this.provider.labelThread(account.id, threadId, labelIds),
      () => this.storeLabels(account.id, threadId, labelIds, "add"),
      () => [threadId, ...labelIds],
      () => threadId,
    );
    return {};
  }

  async unlabelThread(input: WriteInput): Promise<Record<string, never>> {
    const account = await this.account(input);
    const threadId = requiredId(input.threadId, "threadId");
    const labelIds = input.labelIds ?? [];
    await this.commit(
      "unlabel_thread",
      account.id,
      [threadId, ...labelIds],
      () => this.provider.unlabelThread(account.id, threadId, labelIds),
      () => this.storeLabels(account.id, threadId, labelIds, "remove"),
      () => [threadId, ...labelIds],
      () => threadId,
    );
    return {};
  }

  async createDraft(input: WriteInput): Promise<{ id: string; threadId: string; viewUrl: string }> {
    const account = await this.account(input);
    const draft = outgoing(input);
    const created = await this.commit(
      "create_draft",
      account.id,
      draft.replyToMessageId ? [draft.replyToMessageId] : [],
      () => {
        assertAttachments(draft.attachments);
        return this.provider.createDraft(account.id, draft);
      },
      (row) => this.store.saveDraftBody(account.id, row),
      (row) => [row.id],
      (row) => row.threadId || null,
    );
    return { id: created.id, threadId: created.threadId, viewUrl: created.viewUrl };
  }

  async updateDraft(input: WriteInput): Promise<{ id: string }> {
    const account = await this.account(input);
    const draftId = requiredId(input.draftId, "draftId");
    const draft = outgoing(input);
    const updated = await this.commit(
      "update_draft",
      account.id,
      [draftId],
      () => {
        assertAttachments(draft.attachments);
        return this.provider.updateDraft(account.id, draftId, draft);
      },
      (row) => this.store.saveDraftBody(account.id, row),
      (row) => [row.id],
      (row) => row.threadId || null,
    );
    return { id: updated.id };
  }

  async deleteDraft(input: WriteInput): Promise<Record<string, never>> {
    const account = await this.account(input);
    const draftId = requiredId(input.draftId, "draftId");
    await this.commit(
      "delete_draft",
      account.id,
      [draftId],
      () => this.provider.deleteDraft(account.id, draftId),
      () => this.store.removeDraft(account.id, draftId),
      () => [draftId],
    );
    return {};
  }

  async sendMessage(input: WriteInput): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    const account = await this.account(input);
    const draft = outgoing(input);
    const sent = await this.commit(
      "send_message",
      account.id,
      [draft.draftId, draft.replyToMessageId].filter((id): id is string => Boolean(id)),
      () => {
        assertAttachments(draft.attachments);
        return this.provider.sendMessage(account.id, draft);
      },
      (result) => this.storeSent(account.id, result, draft.draftId),
      (result) => [result.id, result.threadId],
      (result) => result.threadId,
    );
    return { id: sent.id, threadId: sent.threadId, labelIds: ["SENT"] };
  }

  async reply(input: WriteInput): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    const account = await this.account(input);
    const messageId = requiredId(input.messageId, "messageId");
    const sent = await this.commit(
      "reply",
      account.id,
      [messageId],
      () => {
        assertAttachments(input.attachments);
        return this.provider.reply(account.id, {
          messageId,
          body: input.body ?? "",
          htmlBody: input.htmlBody,
          replyAll: input.replyAll === true,
          cc: addressList(input.cc),
          bcc: addressList(input.bcc),
          includeSignature: input.includeSignature === true,
          attachments: input.attachments,
        });
      },
      (result) => this.storeSent(account.id, result),
      (result) => [messageId, result.id],
      (result) => result.threadId,
    );
    return { id: sent.id, threadId: sent.threadId, labelIds: ["SENT"] };
  }

  async forward(input: WriteInput): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    const account = await this.account(input);
    const messageId = requiredId(input.messageId, "messageId");
    const sent = await this.commit(
      "forward",
      account.id,
      [messageId],
      () => this.provider.forward(account.id, {
        messageId,
        to: addressList(input.to),
        includeSignature: input.includeSignature === true,
      }),
      (result) => this.storeSent(account.id, result),
      (result) => [messageId, result.id],
      (result) => result.threadId,
    );
    return { id: sent.id, threadId: sent.threadId, labelIds: ["SENT"] };
  }

  async createFilter(input: WriteInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    const criteria = normalizeCriteria(input.criteria);
    const action = normalizeAction(input.action);
    const created = await this.commit(
      "create_filter",
      account.id,
      [],
      () => this.provider.createFilter(account.id, criteria, action),
      (filter) => this.store.insertFilter(account.id, filter),
      (filter) => [filter.id],
    );
    return { id: created.id, account: account.id, criteria: created.criteria, action: created.action };
  }

  async deleteFilter(input: WriteInput): Promise<Record<string, never>> {
    const account = await this.account(input);
    const filterId = requiredId(input.filterId, "filterId");
    await this.commit(
      "delete_filter",
      account.id,
      [filterId],
      () => this.provider.deleteFilter(account.id, filterId),
      () => this.store.removeFilter(account.id, filterId),
      () => [filterId],
    );
    return {};
  }

  private async storeSent(accountId: string, result: SentResult, draftId?: string): Promise<void> {
    await this.store.addMessage(accountId, result.message);
    if (draftId) await this.store.removeDraft(accountId, draftId);
  }

  private async storeLabels(accountId: string, threadId: string, labelIds: string[], op: "add" | "remove"): Promise<void> {
    const existing = await this.store.getThread(accountId, threadId);
    if (existing) {
      if (op === "add") await this.store.addThreadLabels(accountId, threadId, labelIds);
      else await this.store.removeThreadLabels(accountId, threadId, labelIds);
      return;
    }
    const thread = await this.provider.getThread(accountId, threadId);
    if (thread) await this.store.saveThreadMeta(accountId, [thread]);
  }

  private async commit<T>(
    tool: string,
    accountId: string,
    preliminary: string[],
    run: () => Promise<T>,
    persist: (result: T) => Promise<void>,
    idsOf: (result: T) => string[],
    threadOf?: (result: T) => string | null,
  ): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      try {
        await this.audit(accountId, tool, preliminary, "error");
      } catch {
        this.noteFailure(tool, accountId, "audit");
      }
      throw error;
    }
    let storeFailed = false;
    if (this.mailMode === "mirror") {
      try {
        await persist(result);
      } catch {
        storeFailed = true;
        this.noteFailure(tool, accountId, "store");
      }
    }
    try {
      await this.audit(accountId, tool, idsOf(result), "ok", storeFailed);
    } catch {
      this.noteFailure(tool, accountId, "audit");
    }
    if (storeFailed && threadOf) {
      const threadId = threadOf(result);
      if (threadId) {
        try {
          await this.store.markResync(accountId, threadId, "store_failed");
        } catch {
          this.noteFailure(tool, accountId, "store");
        }
      }
    }
    return result;
  }

  private noteFailure(tool: string, accountId: string, what: "store" | "audit"): void {
    const msg = what === "store" ? "write store failed" : "write audit failed";
    this.logger.info(msg, { tool, account: accountId, outcome: "ok" });
  }

  private async audit(
    accountId: string,
    tool: string,
    targetIds: string[],
    outcome: "ok" | "error",
    storeFailed = false,
  ): Promise<void> {
    await this.store.appendAudit({
      accountId,
      tool,
      targetIds,
      outcome,
      at: new Date().toISOString(),
      storeFailed,
    });
    this.logger.info("write", { tool, account: accountId, outcome });
  }

  private async account(input: WriteInput): Promise<AccountRecord> {
    const accounts = await this.store.listAccounts();
    if (accounts.length === 0) throw new ToolError("tool_error", "Unknown account.");
    const requested = input.account || input.acct;
    const found = requested ? accounts.find((item) => item.id === requested) : accounts[0];
    if (!found) throw new ToolError("tool_error", "Unknown account.");
    refuseUnavailable(this.provider, found);
    return found;
  }
}

function requiredId(value: string | undefined, name: string): string {
  if (!value) throw new ToolError("tool_error", `${name} is required.`);
  return value;
}

function assertAttachments(items: OutgoingAttachment[] | undefined): void {
  for (const item of items ?? []) {
    if (!item.content) continue;
    if (Buffer.from(item.content, "base64").length > MAX_ATTACHMENT_BYTES) {
      throw new ToolError("tool_error", "Attachment is over 25 MB.");
    }
  }
}

function outgoing(input: WriteInput): OutgoingDraft {
  return {
    to: addressList(input.to),
    cc: addressList(input.cc),
    bcc: addressList(input.bcc),
    subject: input.subject ?? "",
    body: input.body ?? "",
    htmlBody: input.htmlBody,
    present: {
      to: input.to !== undefined,
      cc: input.cc !== undefined,
      bcc: input.bcc !== undefined,
      subject: input.subject !== undefined,
      body: input.body !== undefined,
      htmlBody: input.htmlBody !== undefined,
    },
    replyToMessageId: input.replyToMessageId,
    includeSignature: input.includeSignature === true,
    attachments: input.attachments,
    threadId: input.threadId,
    fromEmail: input.fromEmail,
    draftId: input.draftId,
  };
}

function normalizeCriteria(input: Partial<FilterCriteria> | undefined): FilterCriteria {
  return {
    from: input?.from ?? "",
    to: input?.to ?? "",
    subject: input?.subject ?? "",
    query: input?.query ?? "",
    hasAttachment: input?.hasAttachment === true,
  };
}

function normalizeAction(input: Partial<FilterAction> | undefined): FilterAction {
  const remove = new Set(input?.removeLabelIds ?? []);
  if (input?.skipInbox) remove.add("INBOX");
  return {
    addLabelIds: [...(input?.addLabelIds ?? [])],
    removeLabelIds: [...remove],
    skipInbox: input?.skipInbox === true || remove.has("INBOX"),
  };
}
