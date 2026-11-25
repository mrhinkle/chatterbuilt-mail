import { ToolError, notFound } from "../errors.js";
import type { Config } from "../config.js";
import { Logger } from "../log.js";
import { nextToken, offsetOf, pageSizeOf } from "../paging.js";
import { capabilitiesFor } from "../providers/capabilities.js";
import { providerServing, refuseUnavailable } from "../providers/router.js";
import type {
  AccountRecord,
  DraftRecord,
  FilterRecord,
  LabelRecord,
  MailMessage,
  MailProvider,
  MailThread,
  SendAsRecord,
} from "../providers/types.js";
import type { Repo } from "../store/repo.js";
import type { Clock } from "../sync/clock.js";
import { isJobAuthError, READ_JOBS_INTERVAL_MS, type JobService } from "../sync/jobs.js";
import type { SyncService } from "../sync/service.js";
import { SERVER_VERSION } from "../version.js";

export interface ToolInput {
  account?: string;
  acct?: string;
  query?: string;
  pageSize?: number;
  pageToken?: string;
  view?: string;
  threadId?: string;
  messageId?: string;
  messageFormat?: string;
  draftId?: string;
  limit?: number;
}

/**
 * One more try for a transient provider failure. Not exported. Writes must not call it.
 * A failure is transient only when the provider set retryable on the error.
 */
async function readOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ToolError && error.retryable) return await fn();
    throw error;
  }
}

function page<T>(items: T[], input: ToolInput): { items: T[]; nextPageToken: string | null; total: number } {
  const size = pageSizeOf(input.pageSize);
  const offset = offsetOf(input.pageToken);
  return { items: items.slice(offset, offset + size), nextPageToken: nextToken(offset, size, items.length), total: items.length };
}

interface Party {
  name: string;
  email: string;
}

function parseParty(value: string): Party | null {
  const trimmed = value.trim();
  const wrapped = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (wrapped) {
    return { name: wrapped[1].trim().replace(/^"|"$/g, ""), email: wrapped[2].trim().toLowerCase() };
  }
  if (trimmed.includes("@")) return { name: "", email: trimmed.toLowerCase() };
  return null;
}

function summaryMessage(accountId: string, message: MailMessage): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    acct: accountId,
    sender: message.sender,
    subject: message.subject,
    toRecipients: message.toRecipients,
    ccRecipients: message.ccRecipients,
    replyTo: message.replyTo,
    inReplyTo: message.inReplyTo,
    date: message.date,
    labelIds: message.labelIds,
    snippet: message.snippet,
    viewUrl: message.viewUrl,
    attachments: message.attachments,
  };
}

function fullMessage(accountId: string, message: MailMessage, format: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: message.id,
    threadId: message.threadId,
    acct: accountId,
    sender: message.sender,
    toRecipients: message.toRecipients,
    ccRecipients: message.ccRecipients,
    bccRecipients: message.bccRecipients,
    replyTo: message.replyTo,
    inReplyTo: message.inReplyTo,
    references: message.references,
    date: message.date,
    subject: message.subject,
    labelIds: message.labelIds,
    snippet: message.snippet,
    viewUrl: message.viewUrl,
    attachments: message.attachments,
    plaintextBody: message.plaintextBody ?? "",
  };
  if (format === "FULL_CONTENT" && message.htmlBody) out.htmlBody = message.htmlBody;
  return out;
}

function draftOut(accountId: string, draft: DraftRecord, full: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: draft.id,
    threadId: draft.threadId,
    messageId: draft.messageId,
    acct: accountId,
    toRecipients: draft.toRecipients,
    ccRecipients: draft.ccRecipients,
    bccRecipients: draft.bccRecipients,
    date: draft.date,
    subject: draft.subject,
    snippet: draft.snippet,
    viewUrl: draft.viewUrl,
    labelIds: draft.labelIds,
    attachments: draft.attachments,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
  };
  if (full) {
    out.plaintextBody = draft.plaintextBody ?? "";
    if (draft.htmlBody) out.htmlBody = draft.htmlBody;
  }
  return out;
}

function draftQueryMatches(draft: DraftRecord, query: string | undefined): boolean {
  if (!query) return true;
  const match = /^to:(.*)$/i.exec(query.trim());
  if (!match) return true;
  const needle = match[1].trim().toLowerCase();
  if (!needle) return true;
  const haystack = [...draft.toRecipients, ...draft.ccRecipients].join("\n").toLowerCase();
  return haystack.includes(needle);
}

export class ReadService {
  constructor(
    private readonly config: Config,
    private readonly store: Repo,
    private readonly provider: MailProvider,
    private readonly logger: Logger,
    private readonly sync: SyncService,
    private readonly jobs: JobService,
    private readonly clock: Clock,
  ) {}

  async indexAll(): Promise<void> {
    if (this.config.mailMode !== "mirror") return;
    // Only the demo provider is indexed at boot. A Gmail mailbox waits for sync.
    for (const account of await this.store.listAccounts()) {
      const served = providerServing(this.provider, account);
      if (served.kind !== "fake") continue;
      if (await this.store.isIndexed(account.id)) continue;
      const threads = await readOnce(() => served.listThreadMeta(account.id));
      await this.store.saveThreadMeta(account.id, threads);
      const labels = await readOnce(() => served.listLabels(account.id));
      await this.store.replaceLabels(account.id, labels);
      const drafts = await readOnce(() => served.listDraftMeta(account.id));
      await this.store.saveDraftMeta(account.id, drafts);
      const sendAs = await readOnce(() => served.listSendAs(account.id));
      await this.store.replaceSendAs(account.id, sendAs);
      const filters = await readOnce(() => served.listFilters(account.id));
      await this.store.replaceFilters(account.id, filters);
      await this.store.markIndexed(account.id);
    }
  }

  /**
   * Jobs first, then a short incremental sync when the mirror is already past
   * backfill and the last sync is stale. A read never starts a backfill.
   */
  private async beforeRead(accountId?: string): Promise<void> {
    const start = this.clock.now();
    const overdue = () => this.clock.now() - start >= this.config.readSyncBudgetMs;
    await this.runDueFromRead(accountId, overdue);
    if (this.config.mailMode !== "mirror") return;
    const accounts = await this.store.listAccounts();
    const targets = accountId ? accounts.filter((account) => account.id === accountId) : accounts;
    for (const account of targets) {
      const served = providerServing(this.provider, account);
      if (served.kind !== "gmail" && served.kind !== "imap" && served.kind !== "microsoft") continue;
      if (overdue()) return;
      try {
        const state = await this.store.getSyncState(account.id);
        if (state.phase !== "incremental") continue;
        if ((served.kind === "gmail" || served.kind === "microsoft") && !state.historyId) continue;
        if (!this.stale(state.lastSyncAt)) continue;
        const remaining = this.config.readSyncBudgetMs - (this.clock.now() - start);
        if (remaining < 1) return;
        await this.sync.syncAccount(account.id, remaining);
      } catch (error) {
        if (isJobAuthError(error)) throw error;
        this.logger.info("sync skipped", { account: account.id });
      }
    }
  }

  /** Jobs from a read, at most once per account per interval. Cron and push call runDue themselves. */
  private async runDueFromRead(accountId: string | undefined, overdue: () => boolean): Promise<void> {
    const accounts = await this.store.listAccounts();
    const targets = accountId ? accounts.filter((account) => account.id === accountId) : accounts;
    const now = this.clock.now();
    for (const account of targets) {
      if (overdue()) return;
      const last = await this.store.getLastJobsAt(account.id);
      if (last) {
        const then = Date.parse(last);
        if (!Number.isNaN(then) && now - then < READ_JOBS_INTERVAL_MS) continue;
      }
      try {
        await this.jobs.runDue(account.id, overdue);
      } catch (error) {
        if (isJobAuthError(error)) throw error;
        this.logger.info("jobs skipped", { account: account.id });
      }
      await this.store.markJobsRun(account.id, new Date(this.clock.now()).toISOString());
    }
  }

  private stale(lastSyncAt: string | null): boolean {
    if (!lastSyncAt) return true;
    const then = Date.parse(lastSyncAt);
    if (Number.isNaN(then)) return true;
    return Date.now() - then >= this.config.syncStaleMs;
  }

  private async account(input: ToolInput): Promise<AccountRecord> {
    const accounts = await this.store.listAccounts();
    if (accounts.length === 0) throw new ToolError("tool_error", "Unknown account.");
    const requested = input.account || input.acct;
    const found = requested ? accounts.find((item) => item.id === requested) : accounts[0];
    if (!found) throw new ToolError("tool_error", "Unknown account.");
    refuseUnavailable(this.provider, found);
    return found;
  }

  private note(tool: string, accountId: string): void {
    this.logger.info("read", { tool, account: accountId, mode: this.config.mailMode });
  }

  async searchThreads(input: ToolInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("search_threads", account.id);
    const query = input.query ?? "";
    const size = pageSizeOf(input.pageSize);
    const view = (input.view ?? "THREAD_VIEW_SUMMARY") === "THREAD_VIEW_IDS_ONLY" ? "ids" : "summary";
    const result = await readOnce(() => this.provider.searchPage(account.id, query, size, input.pageToken, view));
    if (this.config.mailMode === "mirror") {
      const stored = await this.store.storedThreadIds(account.id);
      const missing = result.hits.filter((hit) => hit.newest && !stored.has(hit.id));
      if (missing.length > 0) {
        await this.store.saveThreadMeta(account.id, missing.map((hit) => ({
          id: hit.id,
          snippet: hit.snippet,
          messageCount: hit.messageCount,
          viewUrl: hit.viewUrl,
          historyId: hit.historyId,
          messages: hit.newest ? [hit.newest] : [],
        })));
      }
    }
    const threads: Record<string, unknown>[] = [];
    for (const hit of result.hits) {
      if (view === "ids") {
        threads.push({ id: hit.id, acct: account.id, snippet: hit.snippet });
        continue;
      }
      if (!hit.newest) continue;
      threads.push({
        id: hit.id,
        acct: account.id,
        messageCount: hit.messageCount,
        viewUrl: hit.viewUrl,
        messages: [summaryMessage(account.id, hit.newest)],
      });
    }
    return { threads, nextPageToken: result.nextPageToken, resultCountEstimate: result.resultCountEstimate };
  }

  async getThread(input: ToolInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("get_thread", account.id);
    const threadId = input.threadId ?? "";
    if (!threadId) throw new ToolError("tool_error", "threadId is required.");
    const format = input.messageFormat ?? "PLAIN_TEXT";
    const thread = await this.loadThread(account.id, threadId);
    return {
      id: thread.id,
      acct: account.id,
      viewUrl: thread.viewUrl,
      messages: thread.messages.map((message) => fullMessage(account.id, message, format)),
    };
  }

  private async loadThread(accountId: string, threadId: string): Promise<MailThread> {
    if (this.config.mailMode === "direct") {
      const thread = await readOnce(() => this.provider.getThread(accountId, threadId));
      if (!thread) throw notFound();
      return thread;
    }
    const stored = await this.store.getThread(accountId, threadId);
    if (!stored) throw notFound();
    if (stored.messages.some((message) => !message.bodyFetched)) {
      const full = await readOnce(() => this.provider.getThread(accountId, threadId));
      if (!full) throw notFound();
      await this.store.saveBodies(accountId, full);
      const again = await this.store.getThread(accountId, threadId);
      if (!again) throw notFound();
      return again;
    }
    return stored;
  }

  async getMessage(input: ToolInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("get_message", account.id);
    const messageId = input.messageId ?? "";
    if (!messageId) throw new ToolError("tool_error", "messageId is required.");
    if (input.messageFormat && input.messageFormat !== "RAW") {
      throw new ToolError("tool_error", "messageFormat must be RAW.");
    }
    if (this.config.mailMode === "direct") {
      const raw = await readOnce(() => this.provider.getMessageRaw(account.id, messageId));
      if (!raw) throw notFound();
      return raw;
    }
    const stored = await this.store.getMessage(account.id, messageId);
    if (!stored) throw notFound();
    if (stored.raw) return { id: stored.id, raw: stored.raw };
    const raw = await readOnce(() => this.provider.getMessageRaw(account.id, messageId));
    if (!raw) throw notFound();
    await this.store.saveRaw(account.id, messageId, raw.raw);
    return raw;
  }

  async listLabels(input: ToolInput): Promise<{ labels: LabelRecord[] }> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("list_labels", account.id);
    if (this.config.mailMode === "direct") {
      return { labels: await readOnce(() => this.provider.listLabels(account.id)) };
    }
    return { labels: await this.store.listLabels(account.id) };
  }

  async listDrafts(input: ToolInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("list_drafts", account.id);
    const full = input.view === "DRAFT_VIEW_FULL";
    const drafts = await this.drafts(account.id, full);
    const matched = drafts.filter((draft) => draftQueryMatches(draft, input.query));
    const paged = page(matched, input);
    return {
      drafts: paged.items.map((draft) => draftOut(account.id, draft, full)),
      nextPageToken: paged.nextPageToken,
    };
  }

  private async drafts(accountId: string, full: boolean): Promise<DraftRecord[]> {
    if (this.config.mailMode === "direct") {
      const meta = await readOnce(() => this.provider.listDraftMeta(accountId));
      if (!full) return meta;
      const out: DraftRecord[] = [];
      for (const draft of meta) {
        const body = await readOnce(() => this.provider.getDraft(accountId, draft.id));
        out.push(body ?? draft);
      }
      return out;
    }
    const stored = await this.store.listDrafts(accountId);
    if (!full) return stored;
    const out: DraftRecord[] = [];
    for (const draft of stored) {
      out.push(draft.bodyFetched ? draft : await this.draftBody(accountId, draft.id));
    }
    return out;
  }

  async getDraft(input: ToolInput): Promise<Record<string, unknown>> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("get_draft", account.id);
    const draftId = input.draftId ?? "";
    if (!draftId) throw new ToolError("tool_error", "draftId is required.");
    const format = input.messageFormat ?? "FULL";
    const draft = await this.draftBody(account.id, draftId);
    if (format === "RAW") {
      if (!draft.raw) throw notFound();
      return { id: draft.id, raw: draft.raw };
    }
    const full = draftOut(account.id, draft, format !== "MINIMAL");
    if (format === "MINIMAL") {
      delete full.plaintextBody;
      delete full.htmlBody;
    }
    return full;
  }

  private async draftBody(accountId: string, draftId: string): Promise<DraftRecord> {
    if (this.config.mailMode === "direct") {
      const draft = await readOnce(() => this.provider.getDraft(accountId, draftId));
      if (!draft) throw notFound();
      return draft;
    }
    const stored = await this.store.getDraft(accountId, draftId);
    if (!stored) throw notFound();
    if (stored.bodyFetched && stored.raw) return stored;
    const full = await readOnce(() => this.provider.getDraft(accountId, draftId));
    if (!full) throw notFound();
    await this.store.saveDraftBody(accountId, full);
    const again = await this.store.getDraft(accountId, draftId);
    if (!again) throw notFound();
    return again;
  }

  async listSendAs(input: ToolInput): Promise<{ sendAs: Array<Record<string, unknown>> }> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("list_send_as", account.id);
    const rows = this.config.mailMode === "direct"
      ? await readOnce(() => this.provider.listSendAs(account.id))
      : await this.store.listSendAs(account.id);
    return {
      sendAs: rows.map((row: SendAsRecord) => ({
        email: row.email.toLowerCase(),
        signature: row.signature,
        isDefault: row.isDefault,
        isPrimary: row.isPrimary,
        verified: row.verified,
      })),
    };
  }

  async listFilters(input: ToolInput): Promise<{ filters: Array<Record<string, unknown>> }> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("list_filters", account.id);
    const rows = this.config.mailMode === "direct"
      ? await readOnce(() => this.provider.listFilters(account.id))
      : await this.store.listFilters(account.id);
    return {
      filters: rows.map((row: FilterRecord) => ({
        id: row.id,
        account: account.id,
        criteria: row.criteria,
        action: row.action,
      })),
    };
  }

  /**
   * Same answer for every account. Google and Microsoft are true when a client
   * is configured in the env or saved in provider_clients. The saved check is
   * an existence query and does not read the secret. IMAP is true on the live
   * and imap providers. The body is booleans and the public URL.
   */
  async serverInfo(): Promise<{
    publicUrl: string;
    version: string;
    providers: { google: boolean; microsoft: boolean; imap: boolean };
  }> {
    const [googleSaved, microsoftSaved] = await Promise.all([
      this.store.providerClientSaved("google"),
      this.store.providerClientSaved("microsoft"),
    ]);
    this.logger.info("read", { tool: "server_info", mode: this.config.mailMode });
    return {
      publicUrl: this.config.publicUrl ?? "",
      version: SERVER_VERSION,
      providers: {
        google: Boolean(this.config.googleClientId) || googleSaved,
        microsoft: this.config.microsoftMode !== "off" || microsoftSaved,
        imap: this.config.mailProvider === "live" || this.config.mailProvider === "imap",
      },
    };
  }

  async listAccounts(): Promise<{ accounts: AccountRecord[] }> {
    await this.beforeRead();
    this.logger.info("read", { tool: "list_accounts", mode: this.config.mailMode });
    const accounts = await this.store.listAccounts();
    return {
      accounts: accounts.map((account) => ({
        ...account,
        capabilities: capabilitiesFor(account.kind),
      })),
    };
  }

  async searchContacts(input: ToolInput): Promise<{ contacts: Array<{ name: string; email: string; count: number }> }> {
    const account = await this.account(input);
    await this.beforeRead(account.id);
    this.note("search_contacts", account.id);
    const query = (input.query ?? "").trim();
    if (query.length < 1) throw new ToolError("tool_error", "query is required.");
    const limit = input.limit == null ? 20 : Math.min(Math.max(input.limit, 1), 50);
    if (input.limit != null && !Number.isInteger(input.limit)) {
      throw new ToolError("tool_error", "Invalid limit.");
    }
    const headers = this.config.mailMode === "direct"
      ? await this.directHeaders(account.id)
      : await this.store.messageHeaders(account.id);
    const byEmail = new Map<string, { name: string; email: string; count: number }>();
    for (const header of headers) {
      const seen = new Set<string>();
      for (const value of [header.sender, ...header.to, ...header.cc]) {
        const party = parseParty(value);
        if (!party || seen.has(party.email)) continue;
        seen.add(party.email);
        const row = byEmail.get(party.email) ?? { name: party.name, email: party.email, count: 0 };
        if (party.name.length > row.name.length) row.name = party.name;
        row.count += 1;
        byEmail.set(party.email, row);
      }
    }
    const needle = query.toLowerCase();
    const contacts = [...byEmail.values()]
      .filter((row) => row.email.includes(needle) || row.name.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
      .slice(0, limit);
    return { contacts };
  }

  private async directHeaders(accountId: string): Promise<Array<{ sender: string; to: string[]; cc: string[] }>> {
    const threads = await readOnce(() => this.provider.listThreadMeta(accountId));
    return threads.flatMap((thread) => thread.messages.map((message) => ({
      sender: message.sender,
      to: message.toRecipients,
      cc: message.ccRecipients,
    })));
  }
}
