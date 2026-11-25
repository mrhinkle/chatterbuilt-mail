import type { Config } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import type { AccountRecord, MailMessage, MailProvider } from "../providers/types.js";
import type { Repo } from "../store/repo.js";
import type { Clock } from "./clock.js";
import { labelIsDue, labelQuery, parseWakeLabel, type WakeKind } from "./labels.js";

const SEARCH_PAGES = 20;
/** A read runs jobs at most this often. Cron and push are not capped. */
export const READ_JOBS_INTERVAL_MS = 5 * 60 * 1000;
/** An unfinished claim older than this can be taken again. apply() is safe to repeat. */
export const CLAIM_LEASE_MS = 10 * 60 * 1000;

/**
 * Snooze and remind-me, using the same label names as the page. The claim row
 * is the lock, so a job runs once when a read, a cron call, and a push overlap.
 * A claim that never finishes can be taken again after the lease. Direct mode
 * writes that row and does not write mail tables.
 */
export class JobService {
  constructor(
    private readonly config: Config,
    private readonly store: Repo,
    private readonly provider: MailProvider,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  async runDue(accountId: string | undefined, overdue: () => boolean): Promise<number> {
    const accounts = await this.store.listAccounts();
    const targets = accountId ? accounts.filter((account) => account.id === accountId) : accounts;
    const now = new Date(this.clock.now());
    let woke = 0;
    for (const account of targets) {
      if (overdue()) return woke;
      try {
        const labels = await this.provider.listLabels(account.id);
        for (const label of labels) {
          if (overdue()) return woke;
          const wake = parseWakeLabel(label.name, this.config.labelPrefix);
          if (!wake || !labelIsDue(wake.date, now, this.config.ownerTimezone)) continue;
          if (await this.store.wakeEmptyAt(account.id, label.labelId)) continue;
          const result = await this.wakeLabel(account, label.labelId, label.name, wake.kind, overdue);
          woke += result.woke;
          if (result.empty) {
            await this.store.markWakeEmpty(account.id, label.labelId, now.toISOString());
          }
        }
      } catch (error) {
        if (accountId !== undefined) throw error;
        this.logger.info("jobs failed", {
          account: account.id,
          name: error instanceof Error ? error.name : "Error",
        });
      }
    }
    return woke;
  }

  private async wakeLabel(
    account: AccountRecord,
    labelId: string,
    name: string,
    kind: WakeKind,
    overdue: () => boolean,
  ): Promise<{ woke: number; empty: boolean }> {
    let woke = 0;
    let seen = 0;
    let token: string | undefined;
    const at = new Date(this.clock.now()).toISOString();
    const cutoff = new Date(this.clock.now() - CLAIM_LEASE_MS).toISOString();
    for (let page = 0; page < SEARCH_PAGES; page += 1) {
      if (overdue()) return { woke, empty: false };
      const result = await this.provider.searchPage(account.id, labelQuery(name), 25, token, "ids");
      seen += result.hits.length;
      for (const hit of result.hits) {
        if (overdue()) return { woke, empty: false };
        const id = `wake:${account.id}:${labelId}:${hit.id}`;
        const claimed = await this.store.claimJob(id, account.id, "wake", at, {
          threadId: hit.id,
          labelId,
          kind,
        }, cutoff);
        if (!claimed) continue;
        try {
          await this.apply(account, hit.id, labelId, kind);
          await this.store.finishJob(id, new Date(this.clock.now()).toISOString());
          woke += 1;
        } catch (error) {
          await this.store.releaseJob(id);
          throw error;
        }
      }
      if (!result.nextPageToken) return { woke, empty: seen === 0 };
      token = result.nextPageToken;
    }
    return { woke, empty: false };
  }

  private async apply(account: AccountRecord, threadId: string, labelId: string, kind: WakeKind): Promise<void> {
    if (kind === "Snooze") {
      await this.provider.modifyThread(account.id, threadId, ["INBOX", "UNREAD"], [labelId]);
      return;
    }
    const thread = await this.provider.getThread(account.id, threadId);
    const newest = thread?.messages.at(-1);
    const add = newest && isOwn(newest, account.email) ? ["INBOX", "UNREAD"] : [];
    await this.provider.modifyThread(account.id, threadId, add, [labelId]);
  }
}

function isOwn(message: MailMessage, email: string): boolean {
  if (message.labelIds.includes("SENT")) return true;
  return bareEmail(message.sender) === email.toLowerCase();
}

function bareEmail(value: string): string {
  const wrapped = /<([^>]+)>/.exec(value);
  return (wrapped?.[1] ?? value).trim().toLowerCase();
}

export function isJobAuthError(error: unknown): boolean {
  return error instanceof ToolError && error.code === "needs_reauth";
}
