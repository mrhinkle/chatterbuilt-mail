import { randomBytes } from "node:crypto";
import type { ParsedMail } from "mailparser";
import { openSeal } from "../crypto/seal.js";
import { ToolError, notFound } from "../errors.js";
import type { Logger } from "../log.js";
import type { ImapFolderState, ImapMailboxRow, Repo, SyncState } from "../store/repo.js";
import { emailOf, fwdSubject, replyAudience, reSubject, stripHtml, textToHtml } from "./addresses.js";
import type { ImapHooks, ResolvedHooks } from "./imap-hooks.js";
import { resolveHooks } from "./imap-hooks.js";
import {
  folderByLabel,
  isFlagLabel,
  labelIdsFor,
  labelsFrom,
  mapFolders,
  parentPaths,
  rolePath,
  toDisplay,
  toServer,
  userLabel,
  type FolderRole,
  type MappedFolder,
} from "./imap-folders.js";
import {
  fallbackIdentity,
  firstReference,
  imapMessageId,
  imapThreadId,
  interpretParsed,
  needsHashWalk,
  normalizeMessageId,
  rfcLookup,
} from "./imap-identity.js";
import { compileQuery, type PostFilter } from "./imap-search.js";
import {
  ImapAuthError,
  ImapNoMove,
  ImapTransientError,
  type ImapAddress,
  type ImapFetched,
  type ImapSession,
  type SearchQuery,
} from "./imap-session.js";
import { pinHost } from "./imap-ssrf.js";
import type { SmtpTarget } from "./imap-smtp.js";
import { buildMime, MAX_ATTACHMENT_BYTES, parseMime, type MimeAttachment } from "./mime.js";
import { replyHeaders } from "./threading.js";
import type {
  AccountRecord,
  DraftRecord,
  FilterAction,
  FilterCriteria,
  FilterRecord,
  LabelRecord,
  MailMessage,
  MailProvider,
  MailThread,
  OutgoingAttachment,
  OutgoingDraft,
  ProviderSearchPage,
  ReplyInput,
  ForwardInput,
  SearchView,
  SendAsRecord,
  SentResult,
} from "./types.js";

/** Newest UIDs considered when a draft listing has no tighter key. */
const POST_CAP = 500;
/** At or below this, a list fetches thread headers for every hit so the count stays exact. */
const HEADER_ALL = 300;
/** Newest-first header batch while filling one page of a large mailbox. */
const PAGE_CHUNK = 40;
/** UID FETCH batch. A 2,000-UID line is legal, and a shorter one is safer. */
const DATE_CHUNK = 400;
/** Flags and UID diffs without CONDSTORE or QRESYNC, per call. */
const FLAG_WINDOW = 500;
/** Header matches kept for one thread. A thread fetch is not a mailbox scan. */
const THREAD_MATCH = 50;
/**
 * Newest UIDs fetched, headers only, when the local id is a hash (`h` or `k`).
 * CONTRACT.md states this number. A reversible id never uses it.
 */
export const HASH_WALK_UIDS = 200;
const FILTERS = "Filters aren't available for this account type.";
const DRAFT_HEADER = "X-CBM-Draft-Id";

const CANONICAL: Record<FolderRole, string> = {
  INBOX: "INBOX",
  SENT: "Sent",
  DRAFT: "Drafts",
  TRASH: "Trash",
  SPAM: "Junk",
  ARCHIVE: "Archive",
};

const ROLES = new Set<string>(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE"]);

export interface ImapRuntime {
  store: Repo;
  key: Buffer;
  logger: Logger;
  mailMode: "mirror" | "direct";
  allowPrivateHosts: boolean;
  timeoutMs: number;
  syncDays: number;
  hooks?: ImapHooks;
}

/** Same shape as AccountSync. Declared here so this file does not import the sync service. */
export interface ImapSyncResult {
  account: string;
  synced: boolean;
  partial?: boolean;
  note?: string;
}

interface Loaded {
  account: AccountRecord;
  mailbox: ImapMailboxRow;
  password: string;
}

interface Layout {
  folders: MappedFolder[];
  prefix: string;
  delimiter: string;
}

interface CopyRef {
  path: string;
  uid: number;
  uidValidity: string;
  flags: string[];
}

interface LiveMessage {
  message: MailMessage;
  headerId: string;
  draftKey: string | null;
  root: string;
  copies: CopyRef[];
}

interface DatedUid {
  folder: MappedFolder;
  uid: number;
  uidValidity: string;
  date: string;
}

interface LiveThread {
  id: string;
  messages: LiveMessage[];
  newest: LiveMessage;
}

/**
 * IMAP mailbox behind the router. The client is ImapFlow 2.10.0, or the in-memory
 * session the tests inject. Both speak the same ImapSession methods.
 */
export class ImapProvider implements MailProvider {
  readonly kind = "imap" as const;
  private readonly hooks: ResolvedHooks;

  constructor(private readonly runtime: ImapRuntime) {
    this.hooks = resolveHooks(runtime.hooks);
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
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      const collected = await this.collectDated(session, layout, query, new Date());
      collected.sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid || a.folder.path.localeCompare(b.folder.path));
      const size = pageSize > 0 ? pageSize : 25;
      const start = pageOffset(pageToken);
      const windowed = collected.length > HEADER_ALL;
      const found = new Map<string, LiveMessage>();
      const need = start + size;
      let index = 0;
      while (index < collected.length && (!windowed || threadCount(found) < need)) {
        const step = windowed ? PAGE_CHUNK : collected.length;
        const chunk = collected.slice(index, index + step);
        if (chunk.length === 0) break;
        index += chunk.length;
        await this.summarize(session, accountId, layout, chunk, found);
        if (!windowed) break;
      }
      const threads = groupLive([...found.values()]);
      threads.sort((a, b) => b.newest.message.position - a.newest.message.position || a.id.localeCompare(b.id));
      const slice = threads.slice(start, start + size);
      if (view === "summary") await this.fillSnippets(session, accountId, slice);
      await this.rememberCopies(accountId, slice);
      const more = windowed ? index < collected.length : start + size < threads.length;
      return {
        hits: slice.map((thread) => ({
          id: thread.id,
          snippet: view === "ids" ? "" : thread.newest.message.snippet,
          messageCount: thread.messages.length,
          viewUrl: thread.newest.message.viewUrl,
          historyId: null,
          // Ids-only still carries the message so mirror mode can store the copy's metadata.
          newest: thread.newest.message,
        })),
        nextPageToken: more ? String(start + size) : null,
        resultCountEstimate: windowed ? collected.length : threads.length,
      };
    });
  }

  async listThreadMeta(): Promise<MailThread[]> {
    return [];
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      const messages = await this.locateThread(session, accountId, layout, threadId);
      return threadOf(messages);
    });
  }

  async getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null> {
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      const found = await this.loadMessage(session, accountId, layout, messageId);
      if (!found?.message.raw) return null;
      return { id: found.message.id, raw: found.message.raw };
    });
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      return labelsFrom(layout.folders);
    });
  }

  async listDraftMeta(accountId: string): Promise<DraftRecord[]> {
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      return this.draftsIn(session, accountId, layout);
    });
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      const drafts = await this.draftsIn(session, accountId, layout);
      return drafts.find((draft) => draft.id === draftId) ?? null;
    });
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    const account = await this.accountRow(accountId);
    const rows = await this.runtime.store.listSendAs(accountId);
    if (rows.length > 0) return rows;
    return [{ email: account.email, signature: "", isDefault: true, isPrimary: true, verified: true }];
  }

  async listFilters(): Promise<FilterRecord[]> {
    return [];
  }

  async createLabel(accountId: string, displayName: string): Promise<LabelRecord> {
    rejectLabelName(displayName);
    return this.withSession(accountId, true, async (session) => {
      const layout = await this.layoutOf(session);
      const path = toServer(displayName, layout.prefix, layout.delimiter);
      await this.createPath(session, layout, path);
      return userLabel(displayName);
    });
  }

  async labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.modifyThread(accountId, threadId, labelIds, []);
  }

  async unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.modifyThread(accountId, threadId, [], labelIds);
  }

  async modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
    await this.withSession(accountId, true, async (session) => {
      const layout = await this.layoutOf(session);
      const messages = await this.locateThread(session, accountId, layout, threadId);
      if (messages.length === 0) throw notFound();
      for (const message of messages) {
        await this.modifyOne(session, layout, message, add, remove);
      }
    });
  }

  async createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord> {
    return this.withSession(accountId, true, async (session, loaded) => {
      const layout = await this.layoutOf(session);
      const from = await this.sendingAddress(loaded, input.fromEmail);
      const signed = await this.withSignature(accountId, from, input.body, input.htmlBody, input.includeSignature === true);
      const headers = await this.replyToHeaders(session, accountId, layout, input.replyToMessageId);
      const draftId = newDraftId();
      const messageId = newMessageId(from);
      const attachments = decodeAttachments(input.attachments);
      const mime = await buildMime({
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: signed.text,
        html: signed.html,
        inReplyTo: headers.inReplyTo,
        references: headers.references,
        messageId,
        headers: { [DRAFT_HEADER]: draftId },
        attachments,
      }, { keepBcc: true });
      const path = await this.ensureRole(session, layout, "DRAFT");
      await session.append(path, mime.rfc822, ["\\Draft", "\\Seen"]);
      return draftRecord(accountId, mime.rfc822, draftId);
    });
  }

  async updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord> {
    return this.withSession(accountId, true, async (session, loaded) => {
      const layout = await this.layoutOf(session);
      const current = await this.draftMessages(session, accountId, layout, draftId);
      const newest = newestCopy(current);
      if (!newest) throw notFound();
      const from = await this.sendingAddress(loaded, input.fromEmail);
      const signed = await this.withSignature(accountId, from, input.body, input.htmlBody, input.includeSignature === true);
      const prior = await parseMime(Buffer.from(newest.message.raw ?? "", "base64url"));
      const headers = input.replyToMessageId
        ? await this.replyToHeaders(session, accountId, layout, input.replyToMessageId)
        : { inReplyTo: newest.message.inReplyTo, references: newest.message.references };
      const attachments = input.attachments === undefined ? attachmentsFromParsed(prior) : decodeAttachments(input.attachments);
      const messageId = prior.messageId ? angle(prior.messageId) : newMessageId(from);
      const mime = await buildMime({
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: signed.text,
        html: signed.html,
        inReplyTo: headers.inReplyTo,
        references: headers.references,
        messageId,
        headers: { [DRAFT_HEADER]: draftId },
        attachments,
      }, { keepBcc: true });
      const path = await this.ensureRole(session, layout, "DRAFT");
      const appended = await session.append(path, mime.rfc822, ["\\Draft", "\\Seen"]);
      const stale = current.flatMap((item) => item.copies).filter((copy) => !(copy.path === path && copy.uid === appended.uid));
      try {
        await this.deleteCopies(session, stale);
      } catch {
        await this.noteStoreFailed(accountId, "update_draft", [draftId]);
      }
      return draftRecord(accountId, mime.rfc822, draftId);
    });
  }

  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    await this.withSession(accountId, true, async (session) => {
      const layout = await this.layoutOf(session);
      const current = await this.draftMessages(session, accountId, layout, draftId);
      const copies = current.flatMap((item) => item.copies);
      if (copies.length === 0) throw notFound();
      await this.deleteCopies(session, copies);
    });
  }

  async sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    return this.withSession(accountId, true, async (session, loaded) => {
      if (input.draftId) return this.sendExistingDraft(session, loaded, input.draftId);
      const layout = await this.layoutOf(session);
      const from = await this.sendingAddress(loaded, input.fromEmail);
      const signed = await this.withSignature(accountId, from, input.body, input.htmlBody, input.includeSignature === true);
      const headers = await this.replyToHeaders(session, accountId, layout, input.replyToMessageId);
      const messageId = newMessageId(from);
      const attachments = decodeAttachments(input.attachments);
      const sentAt = new Date();
      const built = await mimePair({
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: signed.text,
        html: signed.html,
        inReplyTo: headers.inReplyTo,
        references: headers.references,
        messageId,
        attachments,
      }, sentAt);
      await this.deliver(loaded, built.wire, from, [...input.to, ...input.cc, ...input.bcc]);
      await this.storeSentCopy(session, loaded, accountId, built.kept, messageId);
      return sentResult(accountId, built.kept);
    });
  }

  async reply(accountId: string, input: ReplyInput): Promise<SentResult> {
    return this.withSession(accountId, true, async (session, loaded) => {
      const layout = await this.layoutOf(session);
      const thread = await this.loadLive(session, accountId, layout, { messageId: input.messageId });
      const target = thread.find((item) => item.message.id === input.messageId);
      if (!target) throw notFound();
      const last = [...thread].sort(byDate)[thread.length - 1];
      if (!last) throw notFound();
      const headers = replyHeaders({ id: last.headerId || last.message.id, references: last.message.references });
      const own = await this.ownEmails(loaded);
      const audience = replyAudience({
        replyAll: input.replyAll,
        sender: target.message.sender,
        replyTo: target.message.replyTo,
        to: target.message.toRecipients,
        cc: target.message.ccRecipients,
        passedCc: input.cc,
        own,
      });
      if (audience.to.length === 0) throw new ToolError("tool_error", "The reply has no recipient.");
      const from = loaded.account.email;
      const signed = await this.withSignature(accountId, from, input.body, input.htmlBody, input.includeSignature);
      const attachments = decodeAttachments(input.attachments);
      const messageId = newMessageId(from);
      const sentAt = new Date();
      const built = await mimePair({
        from,
        to: audience.to,
        cc: audience.cc,
        bcc: input.bcc,
        subject: reSubject(target.message.subject),
        text: signed.text,
        html: signed.html,
        inReplyTo: headers.inReplyTo,
        references: headers.references,
        messageId,
        attachments,
      }, sentAt);
      await this.deliver(loaded, built.wire, from, [...audience.to, ...audience.cc, ...input.bcc]);
      await this.storeSentCopy(session, loaded, accountId, built.kept, messageId);
      return sentResult(accountId, built.kept);
    });
  }

  async forward(accountId: string, input: ForwardInput): Promise<SentResult> {
    return this.withSession(accountId, true, async (session, loaded) => {
      const layout = await this.layoutOf(session);
      const target = await this.loadMessage(session, accountId, layout, input.messageId);
      if (!target) throw notFound();
      const quoted = target.message.plaintextBody || target.message.snippet;
      const text = `---------- Forwarded message ----------\nFrom: ${target.message.sender}\nSubject: ${target.message.subject}\n\n${quoted}`;
      const from = loaded.account.email;
      const signed = await this.withSignature(accountId, from, text, undefined, input.includeSignature);
      const messageId = newMessageId(from);
      const mime = await buildMime({
        from,
        to: input.to,
        cc: [],
        bcc: [],
        subject: fwdSubject(target.message.subject),
        text: signed.text,
        html: signed.html,
        messageId,
      });
      await this.deliver(loaded, mime.rfc822, from, input.to);
      await this.storeSentCopy(session, loaded, accountId, mime.rfc822, messageId);
      return sentResult(accountId, mime.rfc822);
    });
  }

  async createFilter(_accountId: string, _criteria: FilterCriteria, _action: FilterAction): Promise<FilterRecord> {
    throw new ToolError("tool_error", FILTERS);
  }

  async deleteFilter(_accountId: string, _filterId: string): Promise<void> {
    throw new ToolError("tool_error", FILTERS);
  }

  /**
   * Mirror backfill and incremental sync. Direct mode returns before a clock
   * sample and before any login. An unconnected account throws before the sample.
   */
  async syncSlice(accountId: string, budgetMs: number, clock: { now(): number }): Promise<ImapSyncResult> {
    if (this.runtime.mailMode === "direct") {
      return { account: accountId, synced: false, note: "direct mode does not sync" };
    }
    await this.load(accountId);
    const start = clock.now();
    const overdue = () => clock.now() >= start + budgetMs;
    return this.withSession(accountId, false, async (session) => {
      const layout = await this.layoutOf(session);
      await this.runtime.store.replaceLabels(accountId, labelsFrom(layout.folders));
      const folders = selectable(layout);
      const state = await this.runtime.store.getSyncState(accountId);
      if (state.phase !== "incremental") {
        const stopped = await this.backfill(accountId, session, layout, folders, state, start, overdue);
        if (stopped) return { account: accountId, synced: false, partial: true };
      }
      const partial = await this.incremental(accountId, session, layout, folders, overdue);
      if (partial) return { account: accountId, synced: false, partial: true };
      await this.runtime.store.touchSync(accountId, new Date().toISOString());
      return { account: accountId, synced: true };
    });
  }

  private async withSession<T>(
    accountId: string,
    write: boolean,
    fn: (session: ImapSession, loaded: Loaded) => Promise<T>,
  ): Promise<T> {
    const loaded = await this.load(accountId);
    const run = async () => {
      const session = await this.open(loaded);
      try {
        return await fn(session, loaded);
      } finally {
        try {
          await session.logout();
        } catch {
          /* A logout failure must not replace a successful result or cause a retry. */
        }
      }
    };
    try {
      return await run();
    } catch (error) {
      if (write || !isTransient(error)) throw mapImapError(error);
      try {
        return await run();
      } catch (again) {
        throw mapImapError(again);
      }
    }
  }

  private async load(accountId: string): Promise<Loaded> {
    const account = await this.accountRow(accountId);
    const mailbox = await this.runtime.store.getImapMailbox(accountId);
    const ciphertext = await this.runtime.store.tokenCiphertext(accountId);
    if (!mailbox || !ciphertext) throw new ToolError("needs_reauth", "Connect this account again.");
    let password: string;
    try {
      password = openSeal(this.runtime.key, ciphertext);
    } catch {
      throw new ToolError("needs_reauth", "Connect this account again.");
    }
    if (password.length >= 4) this.runtime.logger.redact(password);
    return { account, mailbox, password };
  }

  private async accountRow(accountId: string): Promise<AccountRecord> {
    const accounts = await this.runtime.store.listAccounts();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) throw new ToolError("tool_error", "Unknown account.");
    return account;
  }

  private async open(loaded: Loaded): Promise<ImapSession> {
    const pinned = await pinHost(loaded.mailbox.host, this.hooks.resolve, this.runtime.allowPrivateHosts);
    return this.hooks.open({
      host: pinned,
      servername: loaded.mailbox.host,
      port: loaded.mailbox.port,
      secure: loaded.mailbox.security === "tls",
      requireTLS: loaded.mailbox.security === "starttls",
      user: loaded.mailbox.username,
      password: loaded.password,
      timeoutMs: this.runtime.timeoutMs,
      caPem: this.hooks.caPem,
    });
  }

  private async layoutOf(session: ImapSession): Promise<Layout> {
    const namespace = await session.namespace();
    const listed = await session.list();
    return {
      folders: mapFolders(listed, namespace),
      prefix: namespace.prefix,
      delimiter: namespace.delimiter || "/",
    };
  }

  private async collectDated(session: ImapSession, layout: Layout, query: string, now: Date): Promise<DatedUid[]> {
    const hits: Array<{ folder: MappedFolder; uidValidity: string; uids: number[]; searched: SearchQuery; post: PostFilter[] }> = [];
    for (const folder of selectable(layout)) {
      const compiled = compileQuery(query, { role: folder.role, display: folder.display }, now);
      if (compiled.query === "none") continue;
      const searched: SearchQuery = compiled.query === "all" ? { all: true } : compiled.query;
      let uids = await session.search(folder.path, searched);
      if (uids.length === 0) continue;
      if (compiled.post.length > 0) uids = await this.filterStructure(session, folder.path, uids, compiled.post);
      if (uids.length === 0) continue;
      const status = await session.status(folder.path);
      hits.push({ folder, uidValidity: status.uidValidity, uids, searched, post: compiled.post });
    }
    const single = hits.length === 1 ? hits[0] : undefined;
    const dated: DatedUid[] = [];
    for (const hit of hits) {
      let ordered: Array<{ uid: number; date: string }> | null = null;
      if (single && hit.post.length === 0 && session.caps.sort) {
        const sorted = await session.sortByDate(hit.folder.path, hit.searched);
        if (sorted && sameUidSet(sorted, hit.uids)) {
          ordered = sorted.map((uid, index) => ({ uid, date: rankDate(index) }));
        }
      }
      if (!ordered) {
        const dates = await this.fetchDates(session, hit.folder.path, hit.uids);
        ordered = hit.uids.map((uid) => ({ uid, date: dates.get(uid) ?? "1970-01-01T00:00:00.000Z" }));
      }
      for (const item of ordered) {
        dated.push({ folder: hit.folder, uid: item.uid, uidValidity: hit.uidValidity, date: item.date });
      }
    }
    return dated;
  }

  private async filterStructure(session: ImapSession, path: string, uids: number[], post: PostFilter[]): Promise<number[]> {
    const kept: number[] = [];
    for (let index = 0; index < uids.length; index += DATE_CHUNK) {
      const rows = await session.fetch(path, uids.slice(index, index + DATE_CHUNK), { structure: true, datesOnly: true });
      for (const row of rows) {
        if (passesStructure(row, post)) kept.push(row.uid);
      }
    }
    return kept;
  }

  private async fetchDates(session: ImapSession, path: string, uids: number[]): Promise<Map<number, string>> {
    const dates = new Map<number, string>();
    for (let index = 0; index < uids.length; index += DATE_CHUNK) {
      const rows = await session.fetch(path, uids.slice(index, index + DATE_CHUNK), { datesOnly: true });
      for (const row of rows) dates.set(row.uid, row.internalDate);
    }
    return dates;
  }

  private async summarize(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    dated: DatedUid[],
    found: Map<string, LiveMessage>,
  ): Promise<void> {
    const byPath = new Map<string, DatedUid[]>();
    for (const item of dated) {
      const list = byPath.get(item.folder.path) ?? [];
      list.push(item);
      byPath.set(item.folder.path, list);
    }
    for (const [path, items] of byPath) {
      const rows = await session.fetch(path, items.map((item) => item.uid), { flags: true, envelope: true, headers: true, structure: true });
      const byUid = new Map(rows.map((row) => [row.uid, row]));
      for (const item of items) {
        const row = byUid.get(item.uid);
        if (!row || row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) continue;
        const live = summaryLive(accountId, item, row);
        if (!live) {
          const full = await session.fetch(path, [item.uid], { source: true, flags: true });
          for (const source of full) await this.mergeRow(found, accountId, layout, item.folder, item.uidValidity, source);
          continue;
        }
        this.mergeLive(found, layout, live);
      }
    }
  }

  private mergeLive(found: Map<string, LiveMessage>, layout: Layout, live: LiveMessage): void {
    const existing = found.get(live.message.id);
    if (!existing) {
      live.message.labelIds = labelsForCopies(live.copies, layout.folders);
      found.set(live.message.id, live);
      return;
    }
    for (const copy of live.copies) {
      const previous = existing.copies
        .filter((item) => item.path === copy.path)
        .reduce((max, item) => Math.max(max, item.uid), -1);
      if (!existing.copies.some((item) => item.path === copy.path && item.uid === copy.uid)) existing.copies.push(copy);
      if (copy.uid >= previous) {
        const snippet = existing.message.snippet;
        existing.message = live.message;
        if (snippet && !existing.message.snippet) existing.message.snippet = snippet;
        existing.headerId = live.headerId || existing.headerId;
        existing.draftKey = live.draftKey || existing.draftKey;
        existing.root = rootOf(existing.message, existing.headerId);
      }
    }
    existing.message.labelIds = labelsForCopies(existing.copies, layout.folders);
  }

  private async fillSnippets(session: ImapSession, accountId: string, threads: LiveThread[]): Promise<void> {
    const pending: Array<{ path: string; uid: number; message: MailMessage }> = [];
    for (const thread of threads) {
      const message = thread.newest.message;
      if (this.runtime.mailMode === "mirror") {
        const stored = await this.runtime.store.getMessage(accountId, message.id);
        if (stored?.snippet) {
          message.snippet = stored.snippet;
          continue;
        }
      }
      const copy = thread.newest.copies.reduce((best, item) => (item.uid > best.uid ? item : best));
      pending.push({ path: copy.path, uid: copy.uid, message });
    }
    const byPath = new Map<string, Array<{ uid: number; message: MailMessage }>>();
    for (const item of pending) {
      const list = byPath.get(item.path) ?? [];
      list.push({ uid: item.uid, message: item.message });
      byPath.set(item.path, list);
    }
    for (const [path, items] of byPath) {
      const rows = await session.fetch(path, items.map((item) => item.uid), { preview: true });
      const previews = new Map(rows.map((row) => [row.uid, row.preview ?? ""]));
      for (const item of items) item.message.snippet = snippetText(previews.get(item.uid) ?? "", item.message.subject);
    }
  }

  /** Mirror lists remember folder, UIDVALIDITY, and UID so a later open does not scan the mailbox. */
  private async rememberCopies(accountId: string, threads: LiveThread[]): Promise<void> {
    if (this.runtime.mailMode !== "mirror") return;
    for (const thread of threads) {
      for (const message of thread.messages) {
        for (const copy of message.copies) {
          await this.runtime.store.saveImapCopy(accountId, {
            messageId: message.message.id,
            folder: copy.path,
            uidValidity: copy.uidValidity,
            uid: copy.uid,
          });
        }
      }
    }
  }

  private async locateThread(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    threadId: string,
  ): Promise<LiveMessage[]> {
    return this.loadLive(session, accountId, layout, { threadId });
  }

  private async loadMessage(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    messageId: string,
  ): Promise<LiveMessage | null> {
    const thread = await this.loadLive(session, accountId, layout, { messageId });
    return thread.find((item) => item.message.id === messageId) ?? null;
  }

  /**
   * One thread, source only for its messages. Mirror uses the stored folder,
   * UIDVALIDITY, and UID. A reversible id searches HEADER Message-ID (a thread
   * id also searches References and In-Reply-To). A miss is not found.
   * A hash id walks the newest HASH_WALK_UIDS headers in each folder.
   */
  private async loadLive(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    wanted: { threadId?: string; messageId?: string },
  ): Promise<LiveMessage[]> {
    const seeds = await this.findSeeds(session, accountId, layout, wanted);
    if (seeds.length === 0) return [];
    const found = new Map<string, LiveMessage>();
    await this.fetchSources(session, accountId, layout, seeds, found);
    await this.expandThread(session, accountId, layout, found);
    const messages = [...found.values()];
    if (wanted.messageId) {
      const hit = messages.find((item) => item.message.id === wanted.messageId);
      if (!hit) return [];
      return messages.filter((item) => item.message.threadId === hit.message.threadId);
    }
    if (wanted.threadId) return messages.filter((item) => item.message.threadId === wanted.threadId);
    return [];
  }

  private async findSeeds(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    wanted: { threadId?: string; messageId?: string },
  ): Promise<DatedUid[]> {
    if (this.runtime.mailMode === "mirror") {
      const copies = await this.copiesFor(accountId, wanted);
      if (copies.length > 0) {
        const matched = await this.seedsFromCopies(session, accountId, layout, copies, wanted);
        if (matched.length > 0) return matched;
      }
    }
    const decoded = rfcLookup(wanted);
    if (decoded) return this.seedsFromHeader(session, layout, decoded);
    if (needsHashWalk(wanted)) return this.seedsFromWalk(session, accountId, layout, wanted);
    return [];
  }

  /**
   * UID SEARCH in every selectable folder. An empty result means the message
   * is not on the server. This does not fetch and does not walk.
   */
  private async seedsFromHeader(
    session: ImapSession,
    layout: Layout,
    decoded: { kind: "message" | "thread"; rfc: string },
  ): Promise<DatedUid[]> {
    const value = normalizeMessageId(decoded.rfc);
    if (!value) return [];
    const query: SearchQuery = decoded.kind === "message"
      ? { header: { name: "Message-ID", value } }
      : {
        or: [
          { header: { name: "Message-ID", value } },
          { header: { name: "References", value } },
          { header: { name: "In-Reply-To", value } },
        ],
      };
    const seeds: DatedUid[] = [];
    for (const folder of selectable(layout)) {
      const uids = await session.search(folder.path, query);
      if (uids.length === 0) continue;
      const status = await session.status(folder.path);
      for (const uid of uids.slice(0, THREAD_MATCH)) {
        seeds.push({
          folder,
          uid,
          uidValidity: status.uidValidity,
          date: "1970-01-01T00:00:00.000Z",
        });
      }
    }
    return seeds;
  }

  private async copiesFor(
    accountId: string,
    wanted: { threadId?: string; messageId?: string },
  ): Promise<Array<{ messageId: string; folder: string; uidValidity: string; uid: number }>> {
    if (wanted.messageId) return this.runtime.store.listImapCopies(accountId, wanted.messageId);
    if (!wanted.threadId) return [];
    const stored = await this.runtime.store.getThread(accountId, wanted.threadId);
    if (stored && stored.messages.length > 0) {
      const rows = [];
      for (const message of stored.messages) {
        rows.push(...await this.runtime.store.listImapCopies(accountId, message.id));
      }
      if (rows.length > 0) return rows;
    }
    return this.runtime.store.listImapCopies(accountId);
  }

  private async seedsFromCopies(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    copies: Array<{ messageId: string; folder: string; uidValidity: string; uid: number }>,
    wanted: { threadId?: string; messageId?: string },
  ): Promise<DatedUid[]> {
    const byPath = new Map<string, typeof copies>();
    for (const copy of copies) {
      const list = byPath.get(copy.folder) ?? [];
      list.push(copy);
      byPath.set(copy.folder, list);
    }
    const seeds: DatedUid[] = [];
    for (const [path, rows] of byPath) {
      const folder = layout.folders.find((item) => item.path === path);
      if (!folder) continue;
      const status = await session.status(path);
      const live = rows.filter((copy) => copy.uidValidity === status.uidValidity);
      if (live.length === 0) continue;
      const dated: DatedUid[] = live.map((copy) => ({
        folder,
        uid: copy.uid,
        uidValidity: copy.uidValidity,
        date: "1970-01-01T00:00:00.000Z",
      }));
      const found = new Map<string, LiveMessage>();
      await this.summarize(session, accountId, layout, dated, found);
      for (const item of found.values()) {
        if (!seedHit(item, wanted)) continue;
        for (const copy of item.copies) {
          const match = dated.find((row) => row.folder.path === copy.path && row.uid === copy.uid);
          if (match) seeds.push({ ...match, date: item.message.date });
        }
      }
    }
    return seeds;
  }

  /**
   * Hash ids have no Message-ID to search. Headers of the newest
   * HASH_WALK_UIDS in each folder, then stop. Never fetches source.
   */
  private async seedsFromWalk(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    wanted: { threadId?: string; messageId?: string },
  ): Promise<DatedUid[]> {
    for (const folder of selectable(layout)) {
      const uids = await session.search(folder.path, { all: true });
      if (uids.length === 0) continue;
      const status = await session.status(folder.path);
      const newest = [...uids].sort((a, b) => b - a).slice(0, HASH_WALK_UIDS);
      for (let index = 0; index < newest.length; index += PAGE_CHUNK) {
        const slice = newest.slice(index, index + PAGE_CHUNK);
        const rows = await session.fetch(folder.path, slice, { flags: true, envelope: true, headers: true });
        const hits: DatedUid[] = [];
        for (const row of rows) {
          if (row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) continue;
          const dated: DatedUid = {
            folder,
            uid: row.uid,
            uidValidity: status.uidValidity,
            date: row.internalDate || "1970-01-01T00:00:00.000Z",
          };
          const live = summaryLive(accountId, dated, row);
          if (!live || !seedHit(live, wanted)) continue;
          hits.push({ ...dated, date: live.message.date });
        }
        if (hits.length > 0) return hits;
      }
    }
    return [];
  }

  private async fetchSources(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    seeds: DatedUid[],
    found: Map<string, LiveMessage>,
  ): Promise<void> {
    const byPath = new Map<string, DatedUid[]>();
    for (const seed of seeds) {
      const list = byPath.get(seed.folder.path) ?? [];
      list.push(seed);
      byPath.set(seed.folder.path, list);
    }
    for (const [path, items] of byPath) {
      const folder = items[0]?.folder;
      if (!folder) continue;
      const uids = [...new Set(items.map((item) => item.uid))].filter((uid) => !sourcedUid(found, path, uid));
      if (uids.length === 0) continue;
      const rows = await session.fetch(path, uids, { source: true, flags: true });
      const validity = items[0]?.uidValidity ?? "";
      for (const row of rows) await this.mergeRow(found, accountId, layout, folder, validity, row);
    }
  }

  private async expandThread(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    found: Map<string, LiveMessage>,
  ): Promise<void> {
    const roots = new Set([...found.values()].map((item) => item.root).filter((root) => root.length > 0));
    for (const root of roots) {
      const query: SearchQuery = {
        or: [
          { header: { name: "Message-ID", value: root } },
          { header: { name: "References", value: root } },
          { header: { name: "In-Reply-To", value: root } },
        ],
      };
      for (const folder of selectable(layout)) {
        const uids = await session.search(folder.path, query);
        const missing = uids.filter((uid) => !sourcedUid(found, folder.path, uid)).slice(0, THREAD_MATCH);
        if (missing.length === 0) continue;
        const status = await session.status(folder.path);
        const rows = await session.fetch(folder.path, missing, { source: true, flags: true });
        for (const row of rows) await this.mergeRow(found, accountId, layout, folder, status.uidValidity, row);
      }
    }
  }

  private async mergeRow(
    found: Map<string, LiveMessage>,
    accountId: string,
    layout: Layout,
    folder: MappedFolder,
    uidValidity: string,
    row: ImapFetched,
  ): Promise<void> {
    if (!row.source) return;
    if (row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) return;
    const parsed = await parseMime(row.source);
    const interpreted = interpretParsed(accountId, parsed, row.source, labelIdsFor(folder, row.flags), row.internalDate);
    interpreted.message.viewUrl = viewUrl(accountId, interpreted.message.id);
    interpreted.message.position = messagePosition(interpreted.message.date);
    const copy: CopyRef = { path: folder.path, uid: row.uid, uidValidity, flags: row.flags };
    const existing = found.get(interpreted.message.id);
    if (!existing) {
      const live: LiveMessage = {
        message: interpreted.message,
        headerId: interpreted.messageIdHeader,
        draftKey: interpreted.draftKey,
        root: rootOf(interpreted.message, interpreted.messageIdHeader),
        copies: [copy],
      };
      live.message.labelIds = labelsForCopies(live.copies, layout.folders);
      found.set(interpreted.message.id, live);
      return;
    }
    const previousInFolder = existing.copies
      .filter((item) => item.path === copy.path)
      .reduce((max, item) => Math.max(max, item.uid), -1);
    if (!existing.copies.some((item) => item.path === copy.path && item.uid === copy.uid)) {
      existing.copies.push(copy);
    }
    // A later APPEND of the same Message-ID (a draft update) is the copy a read shows.
    if (row.uid >= previousInFolder) {
      existing.message = interpreted.message;
      existing.headerId = interpreted.messageIdHeader || existing.headerId;
      existing.draftKey = interpreted.draftKey || existing.draftKey;
      existing.root = rootOf(existing.message, existing.headerId);
    }
    existing.message.labelIds = labelsForCopies(existing.copies, layout.folders);
  }

  private async modifyOne(
    session: ImapSession,
    layout: Layout,
    message: LiveMessage,
    add: string[],
    remove: string[],
  ): Promise<void> {
    const folderAdds = add.filter((label) => !isFlagLabel(label));
    const folderRemoves = remove.filter((label) => !isFlagLabel(label));
    const current = [...new Set(message.copies.map((copy) => copy.path))];
    const removePaths = new Set<string>();
    for (const label of folderRemoves) {
      const folder = folderByLabel(layout.folders, label);
      if (folder) removePaths.add(folder.path);
    }
    const addPaths: string[] = [];
    for (const label of folderAdds) {
      const path = await this.pathForLabel(session, layout, label);
      if (path) addPaths.push(path);
    }
    const archive = rolePath(layout.folders, "ARCHIVE");
    let target: Set<string>;
    const onlyArchive = archive !== null && current.length === 1 && current[0] === archive;
    const unarchive = onlyArchive && folderAdds.length === 1 && folderAdds[0] === "INBOX" && folderRemoves.length === 0;
    if (unarchive) {
      target = new Set([await this.ensureRole(session, layout, "INBOX")]);
    } else {
      target = new Set(current.filter((path) => !removePaths.has(path)));
      for (const path of addPaths) target.add(path);
      if (target.size === 0) target.add(await this.ensureRole(session, layout, "ARCHIVE"));
    }
    const toAdd = [...target].filter((path) => !current.includes(path));
    const toRemove = current.filter((path) => !target.has(path));
    const kept: Array<{ path: string; uid: number }> = message.copies
      .filter((copy) => !toRemove.includes(copy.path))
      .map((copy) => ({ path: copy.path, uid: copy.uid }));
    const added: Array<{ path: string; uid: number }> = [];
    if (toAdd.length === 1 && toRemove.length === 1) {
      const src = toRemove[0] ?? "";
      const dest = toAdd[0] ?? "";
      const uids = message.copies.filter((copy) => copy.path === src).map((copy) => copy.uid);
      if (src && dest && uids.length > 0) {
        const map = session.caps.move
          ? await session.move(src, uids, dest)
          : await this.copyThenDelete(session, src, uids, dest);
        for (const uid of uids) {
          const next = map.get(uid);
          if (next === undefined) throw new ToolError("upstream_error", "The mail server did not finish that change.");
          added.push({ path: dest, uid: next });
        }
      }
    } else {
      for (const dest of toAdd) {
        const source = message.copies.find((copy) => !toRemove.includes(copy.path)) ?? message.copies[0];
        if (!source) continue;
        const map = await session.copy(source.path, [source.uid], dest);
        const next = map.get(source.uid);
        if (next === undefined) throw new ToolError("upstream_error", "The mail server did not finish that change.");
        added.push({ path: dest, uid: next });
      }
      for (const src of toRemove) {
        const uids = message.copies.filter((copy) => copy.path === src).map((copy) => copy.uid);
        if (uids.length === 0) continue;
        await session.markDeleted(src, uids);
        await session.expunge(src, uids);
      }
    }
    await this.applyFlags(session, [...kept, ...added], add, remove);
  }

  private async copyThenDelete(
    session: ImapSession,
    src: string,
    uids: number[],
    dest: string,
  ): Promise<Map<number, number>> {
    const map = await session.copy(src, uids, dest);
    await session.markDeleted(src, uids);
    await session.expunge(src, uids);
    return map;
  }

  private async applyFlags(
    session: ImapSession,
    copies: Array<{ path: string; uid: number }>,
    add: string[],
    remove: string[],
  ): Promise<void> {
    const flagAdd: string[] = [];
    const flagRemove: string[] = [];
    if (remove.includes("UNREAD")) flagAdd.push("\\Seen");
    if (add.includes("UNREAD")) flagRemove.push("\\Seen");
    if (add.includes("STARRED")) flagAdd.push("\\Flagged");
    if (remove.includes("STARRED")) flagRemove.push("\\Flagged");
    if (flagAdd.length === 0 && flagRemove.length === 0) return;
    const byPath = new Map<string, number[]>();
    for (const copy of copies) {
      const list = byPath.get(copy.path) ?? [];
      list.push(copy.uid);
      byPath.set(copy.path, list);
    }
    for (const [path, uids] of byPath) {
      if (uids.length === 0) continue;
      await session.storeFlags(path, uids, flagAdd, flagRemove);
    }
  }

  private async pathForLabel(session: ImapSession, layout: Layout, labelId: string): Promise<string | null> {
    if (isFlagLabel(labelId)) return null;
    if (ROLES.has(labelId)) return this.ensureRole(session, layout, labelId as FolderRole);
    const found = folderByLabel(layout.folders, labelId);
    if (found) return found.path;
    rejectLabelName(labelId);
    const path = toServer(labelId, layout.prefix, layout.delimiter);
    await this.createPath(session, layout, path);
    return path;
  }

  private async ensureRole(session: ImapSession, layout: Layout, role: FolderRole): Promise<string> {
    const existing = rolePath(layout.folders, role);
    if (existing) return existing;
    if (role === "INBOX") return "INBOX";
    const display = CANONICAL[role];
    const path = toServer(display, layout.prefix, layout.delimiter);
    await this.createPath(session, layout, path);
    const folder = layout.folders.find((item) => item.path === path);
    if (folder) folder.role = role;
    else layout.folders.push({ path, delimiter: layout.delimiter, display, role, noSelect: false });
    return path;
  }

  private async createPath(session: ImapSession, layout: Layout, path: string): Promise<void> {
    const known = new Set(layout.folders.map((folder) => folder.path));
    for (const next of [...parentPaths(path, layout.prefix, layout.delimiter), path]) {
      if (known.has(next)) continue;
      await session.createMailbox(next);
      known.add(next);
      layout.folders.push({
        path: next,
        delimiter: layout.delimiter,
        display: toDisplay(next, layout.prefix, layout.delimiter),
        role: null,
        noSelect: false,
      });
    }
  }

  private async deleteCopies(session: ImapSession, copies: CopyRef[]): Promise<void> {
    const byPath = new Map<string, number[]>();
    for (const copy of copies) {
      const list = byPath.get(copy.path) ?? [];
      list.push(copy.uid);
      byPath.set(copy.path, list);
    }
    for (const [path, uids] of byPath) {
      await session.markDeleted(path, uids);
      await session.expunge(path, uids);
    }
  }

  private async draftsIn(session: ImapSession, accountId: string, layout: Layout): Promise<DraftRecord[]> {
    const messages = await this.messagesInRole(session, accountId, layout, "DRAFT");
    const grouped = new Map<string, LiveMessage>();
    for (const message of messages) {
      const key = message.draftKey || message.message.id;
      const top = highestUid(message);
      const current = grouped.get(key);
      if (!current || top > highestUid(current)) grouped.set(key, message);
    }
    return [...grouped.entries()].map(([id, message]) => toDraft(id, message));
  }

  private async draftMessages(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    draftId: string,
  ): Promise<LiveMessage[]> {
    const messages = await this.messagesInRole(session, accountId, layout, "DRAFT");
    return messages.filter((message) => (message.draftKey || message.message.id) === draftId);
  }

  private async messagesInRole(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    role: FolderRole,
  ): Promise<LiveMessage[]> {
    const folder = layout.folders.find((item) => item.role === role && !item.noSelect);
    if (!folder) return [];
    const status = await session.status(folder.path);
    const start = Math.max(1, status.uidNext - POST_CAP);
    const recent = await session.search(folder.path, { uid: `${start}:*` });
    const found = new Map<string, LiveMessage>();
    if (recent.length > 0) {
      const rows = await session.fetch(folder.path, recent, { source: true, flags: true });
      for (const row of rows) await this.mergeRow(found, accountId, layout, folder, status.uidValidity, row);
    }
    return [...found.values()];
  }

  private async replyToHeaders(
    session: ImapSession,
    accountId: string,
    layout: Layout,
    messageId: string | undefined,
  ): Promise<{ inReplyTo: string; references: string }> {
    if (!messageId) return { inReplyTo: "", references: "" };
    const target = await this.loadMessage(session, accountId, layout, messageId);
    if (!target) return { inReplyTo: "", references: "" };
    return replyHeaders({ id: target.headerId || target.message.id, references: target.message.references });
  }

  private async sendingAddress(loaded: Loaded, fromEmail: string | undefined): Promise<string> {
    const from = (fromEmail || loaded.account.email).trim();
    const rows = await this.runtime.store.listSendAs(loaded.account.id);
    const allowed = new Set([loaded.account.email.toLowerCase(), ...rows.map((row) => row.email.toLowerCase())]);
    if (!allowed.has(from.toLowerCase())) {
      throw new ToolError("tool_error", "That sending address is not on this account.");
    }
    return from;
  }

  private async ownEmails(loaded: Loaded): Promise<Set<string>> {
    const emails = new Set<string>([loaded.account.email.toLowerCase()]);
    for (const row of await this.runtime.store.listSendAs(loaded.account.id)) emails.add(row.email.toLowerCase());
    return emails;
  }

  private async withSignature(
    accountId: string,
    from: string,
    text: string,
    html: string | undefined,
    include: boolean,
  ): Promise<{ text: string; html?: string }> {
    if (!include) return { text, html };
    const rows = await this.runtime.store.listSendAs(accountId);
    const match = rows.find((row) => row.email.toLowerCase() === from.toLowerCase()) ?? rows.find((row) => row.isDefault);
    const signature = match?.signature ?? "";
    if (!signature) return { text, html };
    const plain = stripHtml(signature);
    return {
      text: plain ? `${text}\n\n${plain}` : text,
      html: `${html ?? textToHtml(text)}<br>${signature}`,
    };
  }

  private async deliver(loaded: Loaded, raw: Buffer, from: string, recipients: string[]): Promise<void> {
    const pinned = await pinHost(loaded.mailbox.smtpHost, this.hooks.resolve, this.runtime.allowPrivateHosts);
    const secure = loaded.mailbox.smtpSecurity === "tls";
    const target: SmtpTarget = {
      host: pinned,
      servername: loaded.mailbox.smtpHost,
      port: loaded.mailbox.smtpPort,
      secure,
      requireTLS: !secure,
      user: loaded.mailbox.username,
      password: loaded.password,
      timeoutMs: this.runtime.timeoutMs,
      caPem: this.hooks.caPem,
    };
    const to = recipients.map((value) => emailOf(value)).filter((value) => value.length > 0);
    await this.hooks.sendRaw(target, raw, { from: emailOf(from), to });
  }

  private async storeSentCopy(
    session: ImapSession,
    loaded: Loaded,
    accountId: string,
    raw: Buffer,
    messageId: string,
  ): Promise<void> {
    if (!loaded.mailbox.saveSent) return;
    try {
      const layout = await this.layoutOf(session);
      const path = await this.ensureRole(session, layout, "SENT");
      await session.append(path, raw, ["\\Seen"]);
    } catch {
      await this.noteStoreFailed(accountId, "send_message", [messageId]);
    }
  }

  private async sendExistingDraft(session: ImapSession, loaded: Loaded, draftId: string): Promise<SentResult> {
    const accountId = loaded.account.id;
    const layout = await this.layoutOf(session);
    const current = await this.draftMessages(session, accountId, layout, draftId);
    const newest = newestCopy(current);
    if (!newest?.message.raw) throw notFound();
    const raw = Buffer.from(newest.message.raw, "base64url");
    const parsed = await parseMime(raw);
    const fromHeader = parsed.from?.text || loaded.account.email;
    const from = emailOf(fromHeader);
    const to = newest.message.toRecipients;
    const cc = newest.message.ccRecipients;
    const bcc = newest.message.bccRecipients;
    const messageId = newest.headerId ? angle(newest.headerId) : newMessageId(from);
    const sentAt = new Date();
    const built = await mimePair({
      from: fromHeader,
      to,
      cc,
      bcc,
      subject: newest.message.subject,
      text: typeof parsed.text === "string" ? parsed.text : "",
      html: typeof parsed.html === "string" ? parsed.html : undefined,
      inReplyTo: newest.message.inReplyTo ? angle(newest.message.inReplyTo) : undefined,
      references: newest.message.references || undefined,
      messageId,
      attachments: attachmentsFromParsed(parsed),
    }, sentAt);
    await this.deliver(loaded, built.wire, from, [...to, ...cc, ...bcc]);
    await this.storeSentCopy(session, loaded, accountId, built.kept, messageId);
    try {
      await this.deleteCopies(session, current.flatMap((item) => item.copies));
    } catch {
      await this.noteStoreFailed(accountId, "send_message", [draftId]);
    }
    return sentResult(accountId, built.kept);
  }

  private async noteStoreFailed(accountId: string, tool: string, targetIds: string[]): Promise<void> {
    try {
      await this.runtime.store.appendAudit({
        accountId,
        tool,
        targetIds,
        outcome: "ok",
        at: new Date().toISOString(),
        storeFailed: true,
      });
    } catch {
      /* The send or update already succeeded. A failed audit row is not a second try. */
    }
  }

  private async backfill(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folders: MappedFolder[],
    state: SyncState,
    start: number,
    overdue: () => boolean,
  ): Promise<boolean> {
    const since = sinceDay(start, this.runtime.syncDays);
    const token = state.pageToken ?? "";
    const resume = token.startsWith("bf:") ? token.slice(3) : "";
    let skipping = resume.length > 0;
    let offset = skipping ? state.pageOffset : 0;
    let saw = !skipping;
    for (const folder of folders) {
      if (skipping) {
        if (folder.path !== resume) continue;
        skipping = false;
        saw = true;
      } else {
        offset = 0;
      }
      const status = await session.status(folder.path);
      const uids = await session.search(folder.path, { since });
      for (let index = offset; index < uids.length; index += 1) {
        const uid = uids[index] ?? 0;
        const rows = await session.fetch(folder.path, [uid], { source: true, flags: true });
        const row = rows[0];
        if (row?.source) await this.storeFetched(accountId, layout, folder, status.uidValidity, row);
        if (overdue()) {
          await this.saveCursor(accountId, "backfill", `bf:${folder.path}`, index + 1);
          return true;
        }
      }
      await this.runtime.store.saveImapFolderState(accountId, {
        folder: folder.path,
        uidValidity: status.uidValidity,
        highestUid: Math.max(0, status.uidNext - 1),
        highestModseq: status.highestModseq,
        syncedAt: new Date().toISOString(),
      });
    }
    if (!saw) {
      return this.backfill(accountId, session, layout, folders, { ...state, pageToken: null, pageOffset: 0 }, start, overdue);
    }
    await this.saveCursor(accountId, "incremental", null, 0);
    return false;
  }

  private async incremental(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folders: MappedFolder[],
    overdue: () => boolean,
  ): Promise<boolean> {
    const state = await this.runtime.store.getSyncState(accountId);
    const known = new Map((await this.runtime.store.listImapFolderState(accountId)).map((row) => [row.folder, row]));
    const token = state.pageToken ?? "";
    const ordered = [...folders];
    const pinned = token.startsWith("rs:") || token.startsWith("df:") || token.startsWith("bf:") ? token.slice(3) : "";
    if (pinned) ordered.sort((a, b) => Number(b.path === pinned) - Number(a.path === pinned));
    for (const folder of ordered) {
      const status = await session.status(folder.path);
      const row = known.get(folder.path);
      if (!row) {
        const stopped = await this.backfill(
          accountId,
          session,
          layout,
          [folder],
          { ...state, phase: "backfill", pageToken: token.startsWith(`bf:${folder.path}`) ? token : null, pageOffset: token.startsWith(`bf:${folder.path}`) ? state.pageOffset : 0 },
          Date.now(),
          overdue,
        );
        if (stopped) return true;
        continue;
      }
      if (row.uidValidity !== status.uidValidity) {
        const stopped = await this.resync(accountId, session, layout, folder, status, state, overdue);
        if (stopped) return true;
        continue;
      }
      const news = await this.syncNewUids(accountId, session, layout, folder, row, status, overdue);
      if (news) return true;
      const flags = await this.syncFlags(accountId, session, layout, folder, row, status, state, overdue);
      if (flags) return true;
    }
    await this.saveCursor(accountId, "incremental", null, 0);
    return false;
  }

  private async resync(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folder: MappedFolder,
    status: { uidValidity: string; uidNext: number; highestModseq: string | null },
    state: SyncState,
    overdue: () => boolean,
  ): Promise<boolean> {
    const token = state.pageToken ?? "";
    let offset = token === `rs:${folder.path}` ? state.pageOffset : 0;
    const uids = await session.search(folder.path, { all: true });
    for (let index = offset; index < uids.length; index += 1) {
      const uid = uids[index] ?? 0;
      const rows = await session.fetch(folder.path, [uid], { source: true, flags: true });
      const row = rows[0];
      if (row?.source) await this.storeFetched(accountId, layout, folder, status.uidValidity, row);
      if (overdue()) {
        await this.saveCursor(accountId, "incremental", `rs:${folder.path}`, index + 1);
        return true;
      }
      offset = index + 1;
    }
    const removed = await this.runtime.store.deleteImapCopiesExcept(accountId, folder.path, status.uidValidity);
    for (const messageId of new Set(removed.map((copy) => copy.messageId))) {
      await this.refreshStored(accountId, messageId, session, layout);
    }
    await this.runtime.store.saveImapFolderState(accountId, {
      folder: folder.path,
      uidValidity: status.uidValidity,
      highestUid: Math.max(0, status.uidNext - 1),
      highestModseq: status.highestModseq,
      syncedAt: new Date().toISOString(),
    });
    await this.saveCursor(accountId, "incremental", null, 0);
    return false;
  }

  private async syncNewUids(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folder: MappedFolder,
    known: ImapFolderState,
    status: { uidNext: number; highestModseq: string | null; uidValidity: string },
    overdue: () => boolean,
  ): Promise<boolean> {
    if (status.uidNext - 1 <= known.highestUid) return false;
    const uids = await session.search(folder.path, { uid: `${known.highestUid + 1}:*` });
    for (const uid of uids) {
      const rows = await session.fetch(folder.path, [uid], { source: true, flags: true });
      const row = rows[0];
      if (row?.source) await this.storeFetched(accountId, layout, folder, known.uidValidity, row);
      if (overdue()) return true;
    }
    await this.runtime.store.saveImapFolderState(accountId, {
      ...known,
      highestUid: Math.max(known.highestUid, status.uidNext - 1),
      highestModseq: status.highestModseq ?? known.highestModseq,
      syncedAt: new Date().toISOString(),
    });
    return false;
  }

  private async syncFlags(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folder: MappedFolder,
    known: ImapFolderState,
    status: { highestModseq: string | null; uidValidity: string; uidNext: number },
    state: SyncState,
    overdue: () => boolean,
  ): Promise<boolean> {
    if (session.caps.condstore && known.highestModseq) {
      const changed = await session.fetchChangedSince(folder.path, known.highestModseq);
      const copies = await this.runtime.store.listImapCopies(accountId);
      const knownUids = new Set(
        copies
          .filter((copy) => copy.folder === folder.path && copy.uidValidity === known.uidValidity)
          .map((copy) => copy.uid),
      );
      const missing = changed
        .filter((row) => !knownUids.has(row.uid) && !row.flags.some((flag) => flag.toLowerCase() === "\\deleted"))
        .map((row) => row.uid);
      if (missing.length > 0) {
        const full = await session.fetch(folder.path, missing, { source: true, flags: true });
        const byUid = new Map(full.map((row) => [row.uid, row]));
        for (const row of changed) {
          const extra = byUid.get(row.uid);
          if (!extra?.source) continue;
          row.source = extra.source;
          row.flags = extra.flags;
          row.internalDate = extra.internalDate;
          row.size = extra.size;
        }
      }
      for (const row of changed) {
        await this.applyChanged(accountId, session, layout, folder, known.uidValidity, row);
        if (overdue()) return true;
      }
    }
    const copies = (await this.runtime.store.listImapCopies(accountId)).filter(
      (copy) => copy.folder === folder.path && copy.uidValidity === known.uidValidity,
    );
    if (session.caps.qresync && known.highestModseq) {
      const gone = await session.vanished(folder.path, known.highestModseq, known.uidValidity);
      if (gone) {
        for (const uid of gone) {
          const copy = copies.find((item) => item.uid === uid);
          if (!copy) continue;
          await this.runtime.store.deleteImapCopy(accountId, copy.folder, copy.uidValidity, copy.uid);
          await this.refreshStored(accountId, copy.messageId, session, layout);
          if (overdue()) return true;
        }
      }
    } else {
      const token = state.pageToken ?? "";
      let offset = token === `df:${folder.path}` ? state.pageOffset : 0;
      while (offset < copies.length) {
        const window = copies.slice(offset, offset + FLAG_WINDOW);
        const spec = window.map((copy) => copy.uid).join(",");
        const live = new Set(spec ? await session.search(folder.path, { uid: spec }) : []);
        for (const copy of window) {
          if (live.has(copy.uid)) continue;
          await this.runtime.store.deleteImapCopy(accountId, copy.folder, copy.uidValidity, copy.uid);
          await this.refreshStored(accountId, copy.messageId, session, layout);
        }
        if (!session.caps.condstore && live.size > 0) {
          const rows = await session.fetch(folder.path, [...live], { flags: true });
          for (const row of rows) await this.applyChanged(accountId, session, layout, folder, known.uidValidity, row);
        }
        offset += window.length;
        if (offset < copies.length) {
          await this.saveCursor(accountId, "incremental", `df:${folder.path}`, offset);
          if (overdue()) return true;
        }
      }
    }
    await this.runtime.store.saveImapFolderState(accountId, {
      ...known,
      highestUid: Math.max(known.highestUid, status.uidNext - 1),
      highestModseq: status.highestModseq ?? known.highestModseq,
      syncedAt: new Date().toISOString(),
    });
    return false;
  }

  private async applyChanged(
    accountId: string,
    session: ImapSession,
    layout: Layout,
    folder: MappedFolder,
    uidValidity: string,
    row: ImapFetched,
  ): Promise<void> {
    const copies = await this.runtime.store.listImapCopies(accountId);
    const copy = copies.find((item) => item.folder === folder.path && item.uid === row.uid && item.uidValidity === uidValidity);
    if (row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) {
      if (!copy) return;
      await this.runtime.store.deleteImapCopy(accountId, copy.folder, copy.uidValidity, copy.uid);
      await this.refreshStored(accountId, copy.messageId, session, layout);
      return;
    }
    if (!copy) {
      if (row.source) await this.storeFetched(accountId, layout, folder, uidValidity, row);
      return;
    }
    await this.refreshStored(accountId, copy.messageId, session, layout);
  }

  private async storeFetched(
    accountId: string,
    layout: Layout,
    folder: MappedFolder,
    uidValidity: string,
    row: ImapFetched,
  ): Promise<void> {
    if (!row.source) return;
    if (row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) return;
    const parsed = await parseMime(row.source);
    const interpreted = interpretParsed(accountId, parsed, row.source, labelIdsFor(folder, row.flags), row.internalDate);
    interpreted.message.viewUrl = viewUrl(accountId, interpreted.message.id);
    interpreted.message.position = messagePosition(interpreted.message.date);
    const labels = new Set<string>(interpreted.message.labelIds.filter((label) => !isFlagLabel(label)));
    const priorCopies = await this.runtime.store.listImapCopies(accountId, interpreted.message.id);
    for (const copy of priorCopies) {
      const other = layout.folders.find((item) => item.path === copy.folder);
      if (!other) continue;
      if (other.role) labels.add(other.role);
      else if (other.display) labels.add(other.display);
    }
    if (folder.role) labels.add(folder.role);
    else if (folder.display) labels.add(folder.display);
    const prior = await this.runtime.store.getMessage(accountId, interpreted.message.id);
    const unread = interpreted.message.labelIds.includes("UNREAD") || prior?.labelIds.includes("UNREAD") === true;
    const starred = interpreted.message.labelIds.includes("STARRED") || prior?.labelIds.includes("STARRED") === true;
    if (prior) {
      for (const label of prior.labelIds) {
        if (!isFlagLabel(label)) labels.add(label);
      }
    }
    if (unread) labels.add("UNREAD");
    if (starred) labels.add("STARRED");
    interpreted.message.labelIds = [...labels];
    await this.runtime.store.addMessage(accountId, interpreted.message);
    await this.runtime.store.saveImapCopy(accountId, {
      messageId: interpreted.message.id,
      folder: folder.path,
      uidValidity,
      uid: row.uid,
    });
    if (folder.role === "DRAFT") {
      await this.runtime.store.saveDraftBody(accountId, toDraft(interpreted.draftKey || interpreted.message.id, {
        message: interpreted.message,
        headerId: interpreted.messageIdHeader,
        draftKey: interpreted.draftKey,
        root: "",
        copies: [],
      }));
    }
  }

  private async refreshStored(
    accountId: string,
    messageId: string,
    session: ImapSession,
    layout: Layout,
  ): Promise<void> {
    const copies = (await this.runtime.store.listImapCopies(accountId, messageId)).filter((copy) => copy.messageId === messageId);
    const labels = new Set<string>();
    let unread = false;
    let starred = false;
    let kept = 0;
    for (const copy of copies) {
      const folder = layout.folders.find((item) => item.path === copy.folder);
      if (!folder) continue;
      const rows = await session.fetch(copy.folder, [copy.uid], { flags: true });
      const row = rows.find((item) => item.uid === copy.uid);
      if (!row || row.flags.some((flag) => flag.toLowerCase() === "\\deleted")) {
        await this.runtime.store.deleteImapCopy(accountId, copy.folder, copy.uidValidity, copy.uid);
        continue;
      }
      kept += 1;
      for (const label of labelIdsFor(folder, row.flags)) {
        if (label === "UNREAD") unread = true;
        else if (label === "STARRED") starred = true;
        else labels.add(label);
      }
    }
    if (kept === 0) {
      await this.runtime.store.deleteMessage(accountId, messageId);
      const drafts = await this.runtime.store.listDrafts(accountId);
      for (const draft of drafts) {
        if (draft.messageId === messageId || draft.id === messageId) {
          await this.runtime.store.removeDraft(accountId, draft.id);
        }
      }
      return;
    }
    if (unread) labels.add("UNREAD");
    if (starred) labels.add("STARRED");
    const message = await this.runtime.store.getMessage(accountId, messageId);
    if (!message) return;
    message.labelIds = [...labels];
    await this.runtime.store.addMessage(accountId, message);
  }

  private async saveCursor(
    accountId: string,
    phase: SyncState["phase"],
    pageToken: string | null,
    pageOffset: number,
  ): Promise<void> {
    const state = await this.runtime.store.getSyncState(accountId);
    await this.runtime.store.saveSyncState(accountId, { ...state, phase, pageToken, pageOffset });
  }
}

function selectable(layout: Layout): MappedFolder[] {
  return layout.folders.filter((folder) => !folder.noSelect);
}

function pageOffset(token: string | undefined): number {
  if (!token) return 0;
  const value = Number(token);
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

function groupLive(messages: LiveMessage[]): LiveThread[] {
  const threads = new Map<string, LiveMessage[]>();
  for (const message of messages) {
    const list = threads.get(message.message.threadId) ?? [];
    list.push(message);
    threads.set(message.message.threadId, list);
  }
  const out: LiveThread[] = [];
  for (const [id, list] of threads) {
    const sorted = [...list].sort(byDate);
    const newest = sorted[sorted.length - 1];
    if (!newest) continue;
    out.push({ id, messages: sorted, newest });
  }
  return out;
}

function threadCount(found: Map<string, LiveMessage>): number {
  return new Set([...found.values()].map((item) => item.message.threadId)).size;
}

function seedHit(live: LiveMessage, wanted: { threadId?: string; messageId?: string }): boolean {
  if (wanted.messageId && live.message.id === wanted.messageId) return true;
  if (wanted.threadId && live.message.threadId === wanted.threadId) return true;
  return false;
}

function sourcedUid(found: Map<string, LiveMessage>, path: string, uid: number): boolean {
  for (const item of found.values()) {
    if (!item.message.raw) continue;
    if (item.copies.some((copy) => copy.path === path && copy.uid === uid)) return true;
  }
  return false;
}

function summaryLive(accountId: string, item: DatedUid, row: ImapFetched): LiveMessage | null {
  const own = normalizeMessageId(row.headers?.messageId || row.envelope?.messageId || "");
  const references = row.headers?.references || "";
  const inReplyTo = row.headers?.inReplyTo || row.envelope?.inReplyTo || "";
  const from = addressLines(row.envelope?.from).join(", ");
  const subject = row.envelope?.subject || "";
  const date = row.envelope?.date || row.internalDate || item.date;
  if (!own && row.envelope == null && row.headers == null) return null;
  const fallback = fallbackIdentity(date, from, subject, row.size);
  const id = imapMessageId(accountId, own, fallback);
  const threadId = imapThreadId(accountId, references, inReplyTo, own, fallback);
  const draft = row.headers?.draftId?.trim() ?? "";
  const message: MailMessage = {
    id,
    threadId,
    position: messagePosition(item.date),
    sender: from,
    toRecipients: addressLines(row.envelope?.to),
    ccRecipients: addressLines(row.envelope?.cc),
    bccRecipients: addressLines(row.envelope?.bcc),
    replyTo: addressLines(row.envelope?.replyTo),
    inReplyTo,
    references,
    subject,
    date,
    labelIds: labelIdsFor(item.folder, row.flags),
    snippet: "",
    plaintextBody: null,
    htmlBody: null,
    attachments: (row.attachments ?? []).map((attachment, index) => ({
      id: attachment.cid || `att${index}`,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      cid: attachment.cid,
    })),
    raw: null,
    viewUrl: viewUrl(accountId, id),
    bodyFetched: false,
  };
  return {
    message,
    headerId: own,
    draftKey: draft || null,
    root: rootOf(message, own),
    copies: [{ path: item.folder.path, uid: item.uid, uidValidity: item.uidValidity, flags: row.flags }],
  };
}

function addressLines(list: ImapAddress[] | undefined): string[] {
  if (!list) return [];
  return list.map((item) => (item.name ? `${item.name} <${item.address}>` : item.address)).filter((item) => item.length > 0);
}

function threadOf(messages: LiveMessage[]): MailThread | null {
  if (messages.length === 0) return null;
  const sorted = [...messages].sort(byDate);
  const newest = sorted[sorted.length - 1];
  if (!newest) return null;
  return {
    id: newest.message.threadId,
    snippet: newest.message.snippet,
    messageCount: sorted.length,
    viewUrl: newest.message.viewUrl,
    historyId: null,
    messages: sorted.map((item) => item.message),
  };
}

function byDate(a: LiveMessage, b: LiveMessage): number {
  return a.message.position - b.message.position || a.message.date.localeCompare(b.message.date);
}

function labelsForCopies(copies: CopyRef[], folders: MappedFolder[]): string[] {
  const ids = new Set<string>();
  let unread = false;
  let starred = false;
  for (const copy of copies) {
    const folder = folders.find((item) => item.path === copy.path);
    if (!folder) continue;
    for (const label of labelIdsFor(folder, copy.flags)) {
      if (label === "UNREAD") unread = true;
      else if (label === "STARRED") starred = true;
      else ids.add(label);
    }
  }
  if (unread) ids.add("UNREAD");
  if (starred) ids.add("STARRED");
  return [...ids];
}

function rootOf(message: MailMessage, headerId: string): string {
  return firstReference(message.references) || normalizeMessageId(message.inReplyTo) || headerId;
}

function viewUrl(accountId: string, id: string): string {
  return `https://imap.local/${accountId}/${id}`;
}

function rejectLabelName(name: string): void {
  if (!name.trim() || name.includes("\0") || name.startsWith("/") || name.split("/").some((part) => part === "." || part === "..")) {
    throw new ToolError("tool_error", "That label name is not allowed.");
  }
}

/** SMTP DATA omits Bcc. The saved copy keeps it. Both use one Message-ID and one Date. */
async function mimePair(input: Parameters<typeof buildMime>[0], date: Date): Promise<{ wire: Buffer; kept: Buffer }> {
  const wire = await buildMime(input, { date });
  const kept = await buildMime(input, { keepBcc: true, date });
  return { wire: wire.rfc822, kept: kept.rfc822 };
}

function newMessageId(from: string): string {
  const domain = from.split("@")[1]?.replace(/[>\s]/g, "") || "mail.example";
  return `<cbm.${randomBytes(12).toString("hex")}@${domain}>`;
}

function newDraftId(): string {
  return `draft_${randomBytes(12).toString("hex")}`;
}

function angle(value: string): string {
  const bare = value.trim().replace(/^<|>$/g, "");
  return `<${bare}>`;
}

function decodeAttachments(items: OutgoingAttachment[] | undefined): MimeAttachment[] {
  const out: MimeAttachment[] = [];
  for (const item of items ?? []) {
    if (!item.content) continue;
    const content = Buffer.from(item.content, "base64");
    if (content.length > MAX_ATTACHMENT_BYTES) throw new ToolError("tool_error", "Attachment is over 25 MB.");
    out.push({ filename: item.filename, mimeType: item.mimeType, content, cid: item.cid });
  }
  return out;
}

function attachmentsFromParsed(parsed: ParsedMail): MimeAttachment[] {
  return parsed.attachments
    .filter((item) => item.content && item.content.length > 0)
    .map((item) => ({
      filename: item.filename || "attachment",
      mimeType: item.contentType || "application/octet-stream",
      content: item.content,
      cid: item.cid || item.contentId || undefined,
    }));
}

async function draftRecord(accountId: string, raw: Buffer, draftId: string): Promise<DraftRecord> {
  const parsed = await parseMime(raw);
  const interpreted = interpretParsed(accountId, parsed, raw, ["DRAFT"], new Date().toISOString());
  return toDraft(draftId, {
    message: { ...interpreted.message, viewUrl: viewUrl(accountId, interpreted.message.id) },
    headerId: interpreted.messageIdHeader,
    draftKey: draftId,
    root: "",
    copies: [],
  });
}

function toDraft(id: string, message: LiveMessage): DraftRecord {
  const row = message.message;
  return {
    id,
    messageId: row.id,
    threadId: row.threadId,
    subject: row.subject,
    toRecipients: row.toRecipients,
    ccRecipients: row.ccRecipients,
    bccRecipients: row.bccRecipients,
    date: row.date,
    snippet: row.snippet,
    plaintextBody: row.plaintextBody,
    htmlBody: row.htmlBody,
    attachments: row.attachments,
    labelIds: row.labelIds.includes("DRAFT") ? row.labelIds : ["DRAFT", ...row.labelIds],
    raw: row.raw,
    viewUrl: row.viewUrl || viewUrl("imap", row.id),
    bodyFetched: true,
    inReplyTo: row.inReplyTo,
    references: row.references,
  };
}

function newestCopy(messages: LiveMessage[]): LiveMessage | null {
  let best: LiveMessage | null = null;
  let uid = -1;
  for (const message of messages) {
    const top = highestUid(message);
    if (top >= uid) {
      best = message;
      uid = top;
    }
  }
  return best;
}

function highestUid(message: LiveMessage): number {
  return message.copies.reduce((max, copy) => Math.max(max, copy.uid), 0);
}

function passesStructure(row: ImapFetched, post: PostFilter[]): boolean {
  if (post.length === 0) return true;
  const files = row.attachments ?? [];
  for (const filter of post) {
    const hit = filter.kind === "attachment"
      ? files.length > 0
      : files.some((file) => file.filename.toLowerCase().includes(filter.value.toLowerCase()));
    if (hit === filter.neg) return false;
  }
  return true;
}

function snippetText(preview: string, subject: string): string {
  const text = preview.replace(/\s+/g, " ").trim();
  return (text || subject).slice(0, 140);
}

function sameUidSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const have = new Set(left);
  return right.every((uid) => have.has(uid));
}

/** Newest-first rank that still fits in messages.position. Used only inside one folder. */
function rankDate(index: number): string {
  return new Date(Date.UTC(2030, 0, 1) - index * 1000).toISOString();
}

async function sentResult(accountId: string, raw: Buffer): Promise<SentResult> {
  const parsed = await parseMime(raw);
  const interpreted = interpretParsed(accountId, parsed, raw, ["SENT"], new Date().toISOString());
  interpreted.message.viewUrl = viewUrl(accountId, interpreted.message.id);
  interpreted.message.position = messagePosition(interpreted.message.date);
  interpreted.message.labelIds = ["SENT"];
  return {
    id: interpreted.message.id,
    threadId: interpreted.message.threadId,
    labelIds: ["SENT"],
    message: interpreted.message,
  };
}

/** messages.position is a 32-bit integer. Seconds still sort, and milliseconds do not fit. */
function messagePosition(date: string): number {
  const ms = Date.parse(date);
  if (!Number.isFinite(ms)) return 0;
  const seconds = Math.trunc(ms / 1000);
  if (seconds > 2_147_483_647) return 2_147_483_647;
  if (seconds < -2_147_483_648) return -2_147_483_648;
  return seconds;
}

function sinceDay(nowMs: number, days: number): string {
  const date = new Date(nowMs);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - days);
  return utc.toISOString().slice(0, 10);
}

function isTransient(error: unknown): boolean {
  if (error instanceof ToolError || error instanceof ImapAuthError || error instanceof ImapNoMove) return false;
  if (error instanceof ImapTransientError) return true;
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  // ImapFlow 2.10 reports a socket that dies during connect as "Unexpected close"
  // (ClosedAfterConnectTLS / ClosedAfterConnectText), not ECONNRESET. That is a dropped
  // server, so a read may try once more. A write never reaches this retry.
  if (/^(ClosedAfterConnectTLS|ClosedAfterConnectText|EConnectionClosed|NoConnection|ETIMEOUT|CONNECT_TIMEOUT|GREETING_TIMEOUT)$/i.test(code)) {
    return true;
  }
  return /econnreset|etimedout|econnrefused|ehostunreach|enetunreach|epipe|timeout|socket hang up|connection reset|unexpected close|connection closed/i.test(`${code} ${message}`);
}

function mapImapError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof ImapAuthError) return new ToolError("needs_reauth", "Connect this account again.");
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/auth|535|invalid credentials/i.test(text)) return new ToolError("needs_reauth", "Connect this account again.");
  return new ToolError("upstream_error", "The mail server did not answer.");
}
