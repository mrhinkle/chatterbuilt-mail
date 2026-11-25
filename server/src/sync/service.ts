import type { Config } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import { GmailProvider } from "../providers/gmail.js";
import { ImapProvider } from "../providers/imap.js";
import { DeltaExpired, MICROSOFT_FOLDERS, MicrosoftProvider, type GraphMessage } from "../providers/microsoft.js";
import { providerServing } from "../providers/router.js";
import type { MailProvider } from "../providers/types.js";
import type { Repo, SyncState } from "../store/repo.js";
import type { Clock } from "./clock.js";
import { HistoryExpired } from "./history.js";

export interface AccountSync {
  account: string;
  synced: boolean;
  partial?: boolean;
  note?: string;
  /** ToolError code, or upstream_error. Absent on a clean row. */
  code?: string;
}

/**
 * `clock.now()` is sampled once at the start of each `syncAccount` call and once
 * after each thread is stored or applied. It is not sampled before the first
 * store, inside an empty resync, or inside an empty history page. A profile
 * read does not sample it. Direct mode and the fake provider return before the
 * first sample. The deadline is that first sample plus the budget. Overdue is
 * checked after the store, so the last thread of a finished page still completes
 * the backfill when there is no next page.
 */
export class SyncService {
  constructor(
    private readonly config: Config,
    private readonly store: Repo,
    private readonly provider: MailProvider,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  async syncNow(): Promise<{ accounts: AccountSync[] }> {
    const accounts = await this.store.listAccounts();
    const out: AccountSync[] = [];
    for (const account of accounts) {
      try {
        out.push(await this.syncAccount(account.id, this.config.syncBudgetMs));
      } catch (error) {
        this.logger.info("sync failed", {
          account: account.id,
          name: error instanceof Error ? error.name : "Error",
        });
        out.push({
          account: account.id,
          synced: false,
          note: "sync failed",
          code: error instanceof ToolError ? error.code : "upstream_error",
        });
      }
    }
    return { accounts: out };
  }

  async syncAccount(accountId: string, budgetMs: number): Promise<AccountSync> {
    if (this.config.mailMode === "direct") {
      return { account: accountId, synced: false, note: "direct mode does not sync" };
    }
    const accounts = await this.store.listAccounts();
    const account = accounts.find((item) => item.id === accountId);
    const served = account ? providerServing(this.provider, account) : this.provider;
    if (served instanceof MicrosoftProvider) return this.syncMicrosoft(accountId, served, budgetMs);
    if (!(served instanceof GmailProvider)) {
      if (served.kind === "fake") {
        await this.store.touchSync(accountId, new Date().toISOString());
        return { account: accountId, synced: true };
      }
      if (served instanceof ImapProvider) return served.syncSlice(accountId, budgetMs, this.clock);
      return { account: accountId, synced: false, note: "sync is not available for this provider" };
    }
    const gmail = served;
    const start = this.clock.now();
    const overdue = () => this.clock.now() >= start + budgetMs;
    const expired = { used: false };
    if (await this.applyResync(accountId, gmail, overdue)) {
      return { account: accountId, synced: false, partial: true };
    }
    const state = await this.store.getSyncState(accountId);
    if (state.phase !== "incremental" || !state.historyId) {
      if (await this.backfill(accountId, gmail, overdue)) {
        return { account: accountId, synced: false, partial: true };
      }
    }
    const after = await this.store.getSyncState(accountId);
    if (after.phase === "incremental" && after.historyId) {
      if (await this.incremental(accountId, gmail, overdue, expired)) {
        return { account: accountId, synced: false, partial: true };
      }
    }
    await this.store.touchSync(accountId, new Date().toISOString());
    return { account: accountId, synced: true };
  }

  /** Empty list returns without sampling the clock. A partial stop leaves the rest for the next call. */
  private async applyResync(accountId: string, gmail: GmailProvider, overdue: () => boolean): Promise<boolean> {
    const ids = await this.store.listResync(accountId);
    if (ids.length === 0) return false;
    for (const threadId of ids) {
      const thread = await gmail.getThread(accountId, threadId);
      if (thread) await this.store.replaceSyncedThread(accountId, thread);
      else await this.store.forgetThread(accountId, threadId);
      await this.store.clearResync(accountId, threadId);
      if (overdue()) return true;
    }
    return false;
  }

  /** Returns true when the budget stopped the backfill before it finished. */
  private async backfill(accountId: string, gmail: GmailProvider, overdue: () => boolean): Promise<boolean> {
    let state = await this.store.getSyncState(accountId);
    if (!state.pageToken && state.pageOffset === 0) await this.store.clearSyncSeen(accountId);
    if (!state.anchorHistoryId) {
      const anchor = await gmail.profileHistoryId(accountId);
      state = { ...state, phase: "backfill", anchorHistoryId: anchor };
      await this.store.saveSyncState(accountId, state);
    }
    const anchor = state.anchorHistoryId;
    for (;;) {
      const page = await gmail.listRecentThreadIds(
        accountId,
        this.config.syncDays,
        this.config.syncPageSize,
        state.pageToken ?? undefined,
      );
      const ids = page.ids.slice(state.pageOffset);
      if (ids.length === 0) {
        if (!page.nextPageToken) {
          await this.finishBackfill(accountId, gmail, anchor, state.lastSyncAt);
          return false;
        }
        state = { ...state, phase: "backfill", pageToken: page.nextPageToken, pageOffset: 0, anchorHistoryId: anchor };
        await this.store.saveSyncState(accountId, state);
        continue;
      }
      for (let index = 0; index < ids.length; index += 1) {
        const threadId = ids[index] ?? "";
        const thread = await gmail.getThread(accountId, threadId);
        if (thread) {
          await this.store.replaceSyncedThread(accountId, thread);
          await this.store.recordSyncSeen(accountId, thread.messages.map((message) => message.id));
        }
        const stop = overdue();
        const moreOnPage = index + 1 < ids.length;
        if (!stop) continue;
        if (moreOnPage) {
          await this.store.saveSyncState(accountId, {
            ...state,
            phase: "backfill",
            pageToken: state.pageToken,
            pageOffset: state.pageOffset + index + 1,
            anchorHistoryId: anchor,
          });
          return true;
        }
        if (page.nextPageToken) {
          state = { ...state, phase: "backfill", pageToken: page.nextPageToken, pageOffset: 0, anchorHistoryId: anchor };
          await this.store.saveSyncState(accountId, state);
          return true;
        }
        await this.finishBackfill(accountId, gmail, anchor, state.lastSyncAt);
        return false;
      }
      if (!page.nextPageToken) {
        await this.finishBackfill(accountId, gmail, anchor, state.lastSyncAt);
        return false;
      }
      state = { ...state, phase: "backfill", pageToken: page.nextPageToken, pageOffset: 0, anchorHistoryId: anchor };
      await this.store.saveSyncState(accountId, state);
    }
  }

  private async finishBackfill(
    accountId: string,
    gmail: GmailProvider,
    anchor: string | null,
    lastSyncAt: string | null,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.syncDays * 86_400_000).toISOString();
    const seen = await this.store.listSyncSeen(accountId);
    await this.store.reconcileWindow(accountId, cutoff, seen);
    const next: SyncState = {
      phase: "incremental",
      pageToken: null,
      pageOffset: 0,
      anchorHistoryId: anchor,
      historyId: anchor,
      lastSyncAt,
    };
    await this.store.saveSyncState(accountId, next);
    await this.store.clearSyncSeen(accountId);
    const topic = this.config.gmailPubsubTopic;
    if (!topic) return;
    try {
      await gmail.watch(accountId, topic);
    } catch {
      this.logger.info("watch failed", { account: accountId });
    }
  }

  /**
   * Returns true when the budget stopped the history walk. An expired historyId
   * starts one bounded backfill in this call. A second expiry is an error, not a skip.
   */
  private async incremental(
    accountId: string,
    gmail: GmailProvider,
    overdue: () => boolean,
    expired: { used: boolean },
  ): Promise<boolean> {
    let state = await this.store.getSyncState(accountId);
    for (;;) {
      if (state.phase !== "incremental" || !state.historyId) return false;
      let page;
      try {
        page = await gmail.listHistory(accountId, state.historyId, state.pageToken ?? undefined);
      } catch (error) {
        if (!(error instanceof HistoryExpired)) throw error;
        if (expired.used) throw new ToolError("upstream_error", "The provider failed.", true);
        expired.used = true;
        await this.store.saveSyncState(accountId, {
          phase: "backfill",
          pageToken: null,
          pageOffset: 0,
          anchorHistoryId: null,
          historyId: null,
          lastSyncAt: state.lastSyncAt,
        });
        await this.store.clearSyncSeen(accountId);
        if (await this.backfill(accountId, gmail, overdue)) return true;
        state = await this.store.getSyncState(accountId);
        continue;
      }
      if (page.threadIds.length === 0 && !page.nextPageToken) {
        if (page.historyId) {
          await this.store.saveSyncState(accountId, {
            ...state,
            historyId: page.historyId,
            pageToken: null,
            pageOffset: 0,
          });
        }
        return false;
      }
      for (let index = 0; index < page.threadIds.length; index += 1) {
        const threadId = page.threadIds[index] ?? "";
        const thread = await gmail.getThread(accountId, threadId);
        if (thread) await this.store.replaceSyncedThread(accountId, thread);
        else await this.store.forgetThread(accountId, threadId);
        if (overdue()) {
          await this.store.saveSyncState(accountId, { ...state, pageToken: state.pageToken });
          return true;
        }
      }
      if (page.nextPageToken) {
        state = { ...state, pageToken: page.nextPageToken };
        await this.store.saveSyncState(accountId, state);
        continue;
      }
      await this.store.saveSyncState(accountId, {
        ...state,
        historyId: page.historyId ?? state.historyId,
        pageToken: null,
        pageOffset: 0,
      });
      return false;
    }
  }

  /**
   * Per-folder delta. The clock is sampled once here and once after each stored
   * thread. Direct mode never reaches this method.
   */
  private async syncMicrosoft(accountId: string, microsoft: MicrosoftProvider, budgetMs: number): Promise<AccountSync> {
    const start = this.clock.now();
    const overdue = () => this.clock.now() >= start + budgetMs;
    const state = await this.store.getSyncState(accountId);
    if (state.phase !== "incremental" || !state.historyId) {
      if (await this.microsoftBackfill(accountId, microsoft, overdue)) {
        return { account: accountId, synced: false, partial: true };
      }
    }
    const after = await this.store.getSyncState(accountId);
    if (after.phase === "incremental" && after.historyId) {
      if (await this.microsoftDelta(accountId, microsoft, overdue)) {
        return { account: accountId, synced: false, partial: true };
      }
    }
    await this.store.touchSync(accountId, new Date().toISOString());
    return { account: accountId, synced: true };
  }

  private async microsoftBackfill(accountId: string, microsoft: MicrosoftProvider, overdue: () => boolean): Promise<boolean> {
    let state = await this.store.getSyncState(accountId);
    if (state.anchorHistoryId?.startsWith("delta:")) {
      return this.openRemainingDeltas(accountId, microsoft, overdue, state.anchorHistoryId.slice("delta:".length));
    }
    const since = new Date(Date.now() - this.config.syncDays * 86_400_000).toISOString();
    const startAt = state.anchorHistoryId && MICROSOFT_FOLDERS.includes(state.anchorHistoryId as typeof MICROSOFT_FOLDERS[number])
      ? MICROSOFT_FOLDERS.indexOf(state.anchorHistoryId as typeof MICROSOFT_FOLDERS[number])
      : 0;
    for (let folderIndex = startAt; folderIndex < MICROSOFT_FOLDERS.length; folderIndex += 1) {
      const folder = MICROSOFT_FOLDERS[folderIndex] ?? "inbox";
      const resume = folder === state.anchorHistoryId;
      let nextUrl = resume ? state.pageToken : null;
      let offset = resume ? state.pageOffset : 0;
      for (;;) {
        const page = await microsoft.listFolder(accountId, folder, since, nextUrl ?? undefined);
        const slice = page.messages.slice(offset);
        const groups = groupMessages(slice);
        if (groups.length === 0) {
          if (!page.nextLink) break;
          nextUrl = page.nextLink;
          offset = 0;
          state = { ...state, phase: "backfill", pageToken: nextUrl, pageOffset: 0, anchorHistoryId: folder };
          await this.store.saveSyncState(accountId, state);
          continue;
        }
        let consumed = 0;
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index] ?? [];
          await this.mergeGroup(accountId, microsoft, group, folder);
          consumed += group.length;
          const moreOnPage = index + 1 < groups.length;
          const moreFolders = folderIndex + 1 < MICROSOFT_FOLDERS.length;
          if (overdue() && (moreOnPage || page.nextLink || moreFolders)) {
            if (moreOnPage) {
              await this.store.saveSyncState(accountId, {
                ...state,
                phase: "backfill",
                pageToken: nextUrl,
                pageOffset: offset + consumed,
                anchorHistoryId: folder,
              });
            } else if (page.nextLink) {
              await this.store.saveSyncState(accountId, {
                ...state,
                phase: "backfill",
                pageToken: page.nextLink,
                pageOffset: 0,
                anchorHistoryId: folder,
              });
            } else {
              const nextFolder = MICROSOFT_FOLDERS[folderIndex + 1] ?? folder;
              await this.store.saveSyncState(accountId, {
                ...state,
                phase: "backfill",
                pageToken: null,
                pageOffset: 0,
                anchorHistoryId: nextFolder,
              });
            }
            return true;
          }
        }
        if (!page.nextLink) break;
        nextUrl = page.nextLink;
        offset = 0;
        state = { ...state, phase: "backfill", pageToken: nextUrl, pageOffset: 0, anchorHistoryId: folder };
        await this.store.saveSyncState(accountId, state);
      }
    }
    return this.openRemainingDeltas(accountId, microsoft, overdue, MICROSOFT_FOLDERS[0] ?? "inbox");
  }

  private async openRemainingDeltas(
    accountId: string,
    microsoft: MicrosoftProvider,
    overdue: () => boolean,
    startFolder: string,
  ): Promise<boolean> {
    const startAt = Math.max(0, MICROSOFT_FOLDERS.indexOf(startFolder as typeof MICROSOFT_FOLDERS[number]));
    for (let index = startAt; index < MICROSOFT_FOLDERS.length; index += 1) {
      const folder = MICROSOFT_FOLDERS[index] ?? "inbox";
      if (await this.store.getDelta(accountId, folder)) continue;
      const opened = await microsoft.openDelta(accountId, folder);
      const moreFolders = index + 1 < MICROSOFT_FOLDERS.length;
      const stopped = await this.storeGroups(accountId, microsoft, opened.messages, folder, overdue, moreFolders);
      await this.store.saveDelta(accountId, folder, opened.deltaLink);
      if (stopped) {
        const next = MICROSOFT_FOLDERS[index + 1];
        await this.store.saveSyncState(accountId, {
          phase: "backfill",
          pageToken: null,
          pageOffset: 0,
          anchorHistoryId: next ? `delta:${next}` : `delta:${folder}`,
          historyId: null,
          lastSyncAt: (await this.store.getSyncState(accountId)).lastSyncAt,
        });
        return true;
      }
    }
    const previous = await this.store.getSyncState(accountId);
    await this.store.saveSyncState(accountId, {
      phase: "incremental",
      pageToken: null,
      pageOffset: 0,
      anchorHistoryId: null,
      historyId: "delta",
      lastSyncAt: previous.lastSyncAt,
    });
    return false;
  }

  /**
   * A 410 drops that folder's link and re-reads that folder only. A second 410
   * for the same folder in this call is reported, not swallowed.
   */
  private async microsoftDelta(accountId: string, microsoft: MicrosoftProvider, overdue: () => boolean): Promise<boolean> {
    const state = await this.store.getSyncState(accountId);
    if (state.anchorHistoryId?.startsWith("resync:")) {
      const folder = state.anchorHistoryId.slice("resync:".length);
      if (await this.refetchFolder(accountId, microsoft, folder, overdue, true)) return true;
    }
    const expired = new Set<string>();
    for (const folder of MICROSOFT_FOLDERS) {
      try {
        if (await this.pullFolder(accountId, microsoft, folder, overdue)) return true;
      } catch (error) {
        if (!(error instanceof DeltaExpired)) throw error;
        if (expired.has(folder)) throw new ToolError("upstream_error", "The provider failed.", false);
        expired.add(folder);
        await this.store.clearDelta(accountId, folder);
        if (await this.refetchFolder(accountId, microsoft, folder, overdue, false)) return true;
      }
    }
    return false;
  }

  private async pullFolder(
    accountId: string,
    microsoft: MicrosoftProvider,
    folder: string,
    overdue: () => boolean,
  ): Promise<boolean> {
    let link = await this.store.getDelta(accountId, folder);
    if (!link) {
      const opened = await microsoft.openDelta(accountId, folder);
      const stopped = await this.storeGroups(accountId, microsoft, opened.messages, folder, overdue, false);
      await this.store.saveDelta(accountId, folder, opened.deltaLink);
      return stopped;
    }
    while (link) {
      const page = await microsoft.pullDelta(accountId, link);
      for (const removal of page.removed) {
        if (removal.reason === "changed") {
          await this.resolveChanged(accountId, microsoft, removal.id);
          continue;
        }
        // reason deleted means the message left this folder. It may still exist elsewhere.
        const live = await microsoft.findMessage(accountId, removal.id);
        if (!live?.folder) {
          await this.store.forgetMessage(accountId, removal.id);
          continue;
        }
        await this.mergeGroup(accountId, microsoft, [live.message], live.folder);
      }
      const stopped = await this.storeGroups(accountId, microsoft, page.messages, folder, overdue, false);
      if (stopped) return true;
      if (page.nextLink) {
        link = page.nextLink;
        continue;
      }
      if (page.deltaLink) await this.store.saveDelta(accountId, folder, page.deltaLink);
      return false;
    }
    return false;
  }

  /** Re-reads one folder. Existing messages stay until a thread is replaced. */
  private async refetchFolder(
    accountId: string,
    microsoft: MicrosoftProvider,
    folder: string,
    overdue: () => boolean,
    resume: boolean,
  ): Promise<boolean> {
    const since = new Date(Date.now() - this.config.syncDays * 86_400_000).toISOString();
    const state = await this.store.getSyncState(accountId);
    let nextUrl = resume ? state.pageToken : null;
    let offset = resume ? state.pageOffset : 0;
    for (;;) {
      const page = await microsoft.listFolder(accountId, folder, since, nextUrl ?? undefined);
      const groups = groupMessages(page.messages.slice(offset));
      let consumed = 0;
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index] ?? [];
        await this.mergeGroup(accountId, microsoft, group, folder);
        consumed += group.length;
        if (overdue() && (index + 1 < groups.length || page.nextLink)) {
          await this.store.saveSyncState(accountId, {
            ...state,
            phase: "incremental",
            pageToken: index + 1 < groups.length ? nextUrl : page.nextLink,
            pageOffset: index + 1 < groups.length ? offset + consumed : 0,
            anchorHistoryId: `resync:${folder}`,
          });
          return true;
        }
      }
      if (!page.nextLink) break;
      nextUrl = page.nextLink;
      offset = 0;
    }
    let opened: { deltaLink: string; messages: GraphMessage[] };
    try {
      opened = await microsoft.openDelta(accountId, folder);
    } catch (error) {
      if (error instanceof DeltaExpired) {
        throw new ToolError("upstream_error", "The provider failed.", false);
      }
      throw error;
    }
    await this.storeGroups(accountId, microsoft, opened.messages, folder, overdue, false);
    await this.store.saveDelta(accountId, folder, opened.deltaLink);
    const latest = await this.store.getSyncState(accountId);
    await this.store.saveSyncState(accountId, {
      ...latest,
      phase: "incremental",
      pageToken: null,
      pageOffset: 0,
      anchorHistoryId: null,
      historyId: latest.historyId ?? "delta",
    });
    return false;
  }

  private async storeGroups(
    accountId: string,
    microsoft: MicrosoftProvider,
    messages: GraphMessage[],
    folder: string,
    overdue: () => boolean,
    moreAfter: boolean,
  ): Promise<boolean> {
    const groups = groupMessages(messages);
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? [];
      await this.mergeGroup(accountId, microsoft, group, folder);
      const more = index + 1 < groups.length || moreAfter;
      if (overdue() && more) return true;
    }
    return false;
  }

  /** A folder page is a subset of a conversation. Merge it. Do not delete the messages that were not on the page. */
  private async mergeGroup(accountId: string, microsoft: MicrosoftProvider, group: GraphMessage[], folder: string): Promise<void> {
    await this.store.mergeSyncedMessages(accountId, microsoft.toThread(group, folder).messages);
  }

  /**
   * `changed` means the item was deleted and can be restored. One read decides
   * whether the row stays. A 404 or a folder outside the synced six drops that
   * message. A folder inside the six updates that message's labels.
   */
  private async resolveChanged(accountId: string, microsoft: MicrosoftProvider, messageId: string): Promise<void> {
    const placed = await microsoft.readPlacement(accountId, messageId);
    if (!placed?.folder) {
      await this.store.forgetMessage(accountId, messageId);
      return;
    }
    const current = await this.store.getMessage(accountId, messageId);
    if (!current) return;
    const kept = current.labelIds.filter((id) => !FOLDER_LABELS.has(id));
    const folderLabel = FOLDER_LABEL[placed.folder];
    await this.store.setMessageLabels(accountId, messageId, folderLabel ? [...kept, folderLabel] : kept);
  }
}

const FOLDER_LABELS = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM"]);

const FOLDER_LABEL: Record<string, string | null> = {
  inbox: "INBOX",
  sentitems: "SENT",
  drafts: "DRAFT",
  deleteditems: "TRASH",
  junkemail: "SPAM",
  archive: null,
};

function groupMessages(messages: GraphMessage[]): GraphMessage[][] {
  const order: string[] = [];
  const grouped = new Map<string, GraphMessage[]>();
  for (const message of messages) {
    const id = message.conversationId || message.id;
    const list = grouped.get(id);
    if (!list) {
      grouped.set(id, [message]);
      order.push(id);
    } else {
      list.push(message);
    }
  }
  return order.map((id) => grouped.get(id) ?? []);
}
