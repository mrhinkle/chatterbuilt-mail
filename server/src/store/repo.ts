import { createHash, randomBytes } from "node:crypto";
import { seal } from "../crypto/seal.js";
import { DEMO_NOW } from "../providers/demo-mailbox.js";
import type {
  AccountRecord,
  Attachment,
  DraftRecord,
  FilterAction,
  FilterCriteria,
  FilterRecord,
  LabelRecord,
  MailMessage,
  MailThread,
  SendAsRecord,
} from "../providers/types.js";
import type { Sql } from "./sql.js";

function jsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export interface ImapMailboxRow {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
  saveSent: boolean;
}

export interface ImapCopyRow {
  messageId: string;
  folder: string;
  uidValidity: string;
  uid: number;
}

export interface ImapFolderState {
  folder: string;
  uidValidity: string;
  highestUid: number;
  highestModseq: string | null;
  syncedAt: string | null;
}

interface CopySql {
  message_id: string;
  folder: string;
  uidvalidity: string;
  uid: number | string;
}

function mapCopy(row: CopySql): ImapCopyRow {
  return {
    messageId: row.message_id,
    folder: row.folder,
    uidValidity: row.uidvalidity,
    uid: Number(row.uid),
  };
}

export interface SyncState {
  phase: "backfill" | "incremental";
  pageToken: string | null;
  pageOffset: number;
  anchorHistoryId: string | null;
  historyId: string | null;
  lastSyncAt: string | null;
}

export class Repo {
  constructor(private readonly sql: Sql) {}

  async upsertAccount(account: AccountRecord, position: number): Promise<void> {
    await this.sql.query(
      `INSERT INTO accounts (id, email, label, kind, color, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         label = EXCLUDED.label,
         kind = EXCLUDED.kind,
         color = EXCLUDED.color,
         position = EXCLUDED.position`,
      [account.id, account.email, account.label, account.kind, account.color ?? null, position, DEMO_NOW],
    );
  }

  async upsertToken(accountId: string, key: Buffer, plaintext: string): Promise<void> {
    const ciphertext = seal(key, plaintext);
    await this.sql.query(
      `INSERT INTO provider_tokens (account_id, ciphertext, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = EXCLUDED.updated_at`,
      [accountId, ciphertext, DEMO_NOW],
    );
  }

  async tokenCiphertext(accountId: string): Promise<string | null> {
    const result = await this.sql.query<{ ciphertext: string }>(
      "SELECT ciphertext FROM provider_tokens WHERE account_id = $1",
      [accountId],
    );
    return result.rows[0]?.ciphertext ?? null;
  }

  /** Existence only. The selected column is a constant, never the client id or the secret. */
  async providerClientSaved(provider: "google" | "microsoft"): Promise<boolean> {
    const result = await this.sql.query<{ present: number }>(
      "SELECT 1 AS present FROM provider_clients WHERE provider = $1 AND length(client_id) > 0 LIMIT 1",
      [provider],
    );
    return result.rows.length > 0;
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const result = await this.sql.query<{
      id: string;
      email: string;
      label: string;
      kind: "gmail" | "imap" | "microsoft";
      color: string | null;
    }>("SELECT id, email, label, kind, color FROM accounts ORDER BY position, id");
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      label: row.label,
      kind: row.kind,
      ...(row.color ? { color: row.color } : {}),
    }));
  }

  async isIndexed(accountId: string): Promise<boolean> {
    const result = await this.sql.query<{ indexed_at: string | null }>(
      "SELECT indexed_at FROM sync_state WHERE account_id = $1",
      [accountId],
    );
    return Boolean(result.rows[0]?.indexed_at);
  }

  async markIndexed(accountId: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO sync_state (account_id, history_id, uidvalidity, modseq, uids, indexed_at)
       VALUES ($1, NULL, NULL, NULL, '{}'::jsonb, $2)
       ON CONFLICT (account_id) DO UPDATE SET indexed_at = EXCLUDED.indexed_at`,
      [accountId, DEMO_NOW],
    );
  }

  async saveThreadMeta(accountId: string, threads: MailThread[]): Promise<void> {
    for (const thread of threads) {
      await this.sql.query(
        `INSERT INTO threads (account_id, id, snippet, message_count, history_id, view_url, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account_id, id) DO UPDATE SET
           snippet = EXCLUDED.snippet,
           message_count = EXCLUDED.message_count,
           history_id = EXCLUDED.history_id,
           view_url = EXCLUDED.view_url,
           updated_at = EXCLUDED.updated_at`,
        [accountId, thread.id, thread.snippet, thread.messageCount, thread.historyId, thread.viewUrl, DEMO_NOW],
      );
      for (const message of thread.messages) {
        await this.saveMessage(accountId, message, false);
      }
    }
  }

  async saveBodies(accountId: string, thread: MailThread): Promise<void> {
    for (const message of thread.messages) {
      await this.saveMessage(accountId, { ...message, bodyFetched: true }, true);
    }
  }

  async saveRaw(accountId: string, messageId: string, raw: string): Promise<void> {
    await this.sql.query(
      "UPDATE messages SET raw = $3 WHERE account_id = $1 AND id = $2 AND raw IS NULL",
      [accountId, messageId, raw],
    );
  }

  private async saveMessage(accountId: string, message: MailMessage, withBody: boolean): Promise<void> {
    await this.sql.query(
      `INSERT INTO messages (
         account_id, id, thread_id, position, sender, to_recipients, cc_recipients, bcc_recipients,
         reply_to, in_reply_to, references_header, subject, date, label_ids, snippet,
         text_body, html_body, attachments, raw, body_fetched, view_url
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
         $9::jsonb, $10, $11, $12, $13, $14::jsonb, $15,
         $16, $17, $18::jsonb, $19, $20, $21
       )
       ON CONFLICT (account_id, id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         position = EXCLUDED.position,
         sender = EXCLUDED.sender,
         to_recipients = EXCLUDED.to_recipients,
         cc_recipients = EXCLUDED.cc_recipients,
         bcc_recipients = EXCLUDED.bcc_recipients,
         reply_to = EXCLUDED.reply_to,
         in_reply_to = EXCLUDED.in_reply_to,
         references_header = EXCLUDED.references_header,
         subject = EXCLUDED.subject,
         date = EXCLUDED.date,
         label_ids = EXCLUDED.label_ids,
         snippet = EXCLUDED.snippet,
         attachments = EXCLUDED.attachments,
         view_url = EXCLUDED.view_url,
         text_body = CASE WHEN messages.body_fetched THEN messages.text_body ELSE EXCLUDED.text_body END,
         html_body = CASE WHEN messages.body_fetched THEN messages.html_body ELSE EXCLUDED.html_body END,
         raw = CASE
           WHEN messages.raw IS NOT NULL AND EXCLUDED.raw IS NULL THEN messages.raw
           ELSE COALESCE(EXCLUDED.raw, messages.raw)
         END,
         body_fetched = messages.body_fetched OR EXCLUDED.body_fetched`,
      [
        accountId,
        message.id,
        message.threadId,
        message.position,
        message.sender,
        JSON.stringify(message.toRecipients),
        JSON.stringify(message.ccRecipients),
        JSON.stringify(message.bccRecipients),
        JSON.stringify(message.replyTo),
        message.inReplyTo,
        message.references,
        message.subject,
        message.date,
        JSON.stringify(message.labelIds),
        message.snippet,
        withBody ? message.plaintextBody : null,
        withBody ? message.htmlBody : null,
        JSON.stringify(message.attachments),
        withBody ? message.raw : null,
        withBody,
        message.viewUrl,
      ],
    );
  }

  async storedThreadIds(accountId: string): Promise<Set<string>> {
    const result = await this.sql.query<{ id: string }>("SELECT id FROM threads WHERE account_id = $1", [accountId]);
    return new Set(result.rows.map((row) => row.id));
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    const threads = await this.sql.query<{
      id: string;
      snippet: string;
      message_count: number;
      view_url: string;
      history_id: string | null;
    }>("SELECT id, snippet, message_count, view_url, history_id FROM threads WHERE account_id = $1 AND id = $2", [
      accountId,
      threadId,
    ]);
    const thread = threads.rows[0];
    if (!thread) return null;
    const messages = await this.messagesFor(accountId, threadId);
    return {
      id: thread.id,
      snippet: thread.snippet,
      messageCount: thread.message_count,
      viewUrl: thread.view_url,
      historyId: thread.history_id,
      messages,
    };
  }

  async newestMessage(accountId: string, threadId: string): Promise<MailMessage | null> {
    const result = await this.sql.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE account_id = $1 AND thread_id = $2
       ORDER BY position DESC LIMIT 1`,
      [accountId, threadId],
    );
    const row = result.rows[0];
    return row ? mapMessage(row) : null;
  }

  async getMessage(accountId: string, messageId: string): Promise<MailMessage | null> {
    const result = await this.sql.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = $1 AND id = $2`,
      [accountId, messageId],
    );
    const row = result.rows[0];
    return row ? mapMessage(row) : null;
  }

  async messageHeaders(accountId: string): Promise<Array<{ sender: string; to: string[]; cc: string[] }>> {
    const result = await this.sql.query<{ sender: string; to_recipients: unknown; cc_recipients: unknown }>(
      "SELECT sender, to_recipients, cc_recipients FROM messages WHERE account_id = $1",
      [accountId],
    );
    return result.rows.map((row) => ({
      sender: row.sender,
      to: jsonb<string[]>(row.to_recipients, []),
      cc: jsonb<string[]>(row.cc_recipients, []),
    }));
  }

  async countMessages(): Promise<number> {
    const result = await this.sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM messages");
    return Number(result.rows[0]?.n ?? 0);
  }

  async countThreads(): Promise<number> {
    const result = await this.sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM threads");
    return Number(result.rows[0]?.n ?? 0);
  }

  async replaceLabels(accountId: string, labels: LabelRecord[]): Promise<void> {
    await this.sql.query("DELETE FROM labels WHERE account_id = $1", [accountId]);
    for (const label of labels) {
      await this.sql.query(
        "INSERT INTO labels (account_id, label_id, name, label_type) VALUES ($1, $2, $3, $4)",
        [accountId, label.labelId, label.name, label.labelType],
      );
    }
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    const result = await this.sql.query<{ label_id: string; name: string; label_type: "SYSTEM" | "USER" }>(
      "SELECT label_id, name, label_type FROM labels WHERE account_id = $1 ORDER BY label_type, label_id",
      [accountId],
    );
    return result.rows.map((row) => ({ labelId: row.label_id, name: row.name, labelType: row.label_type }));
  }

  async saveDraftMeta(accountId: string, drafts: DraftRecord[]): Promise<void> {
    for (const draft of drafts) await this.saveDraft(accountId, draft, false);
  }

  async saveDraftBody(accountId: string, draft: DraftRecord): Promise<void> {
    await this.saveDraft(accountId, { ...draft, bodyFetched: true }, true);
  }

  private async saveDraft(accountId: string, draft: DraftRecord, withBody: boolean): Promise<void> {
    await this.sql.query(
      `INSERT INTO drafts (
         account_id, id, message_id, thread_id, subject, to_recipients, cc_recipients, bcc_recipients,
         date, snippet, text_body, html_body, attachments, label_ids, raw, view_url, body_fetched,
         in_reply_to, references_header
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
         $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17,
         $18, $19
       )
       ON CONFLICT (account_id, id) DO UPDATE SET
         message_id = EXCLUDED.message_id,
         thread_id = EXCLUDED.thread_id,
         subject = EXCLUDED.subject,
         to_recipients = EXCLUDED.to_recipients,
         cc_recipients = EXCLUDED.cc_recipients,
         bcc_recipients = EXCLUDED.bcc_recipients,
         date = EXCLUDED.date,
         snippet = EXCLUDED.snippet,
         attachments = EXCLUDED.attachments,
         label_ids = EXCLUDED.label_ids,
         view_url = EXCLUDED.view_url,
         in_reply_to = EXCLUDED.in_reply_to,
         references_header = EXCLUDED.references_header,
         text_body = CASE WHEN drafts.body_fetched AND EXCLUDED.text_body IS NULL THEN drafts.text_body ELSE EXCLUDED.text_body END,
         html_body = CASE WHEN drafts.body_fetched AND EXCLUDED.html_body IS NULL THEN drafts.html_body ELSE EXCLUDED.html_body END,
         raw = CASE
           WHEN drafts.raw IS NOT NULL AND EXCLUDED.raw IS NULL THEN drafts.raw
           ELSE COALESCE(EXCLUDED.raw, drafts.raw)
         END,
         body_fetched = drafts.body_fetched OR EXCLUDED.body_fetched`,
      [
        accountId,
        draft.id,
        draft.messageId,
        draft.threadId,
        draft.subject,
        JSON.stringify(draft.toRecipients),
        JSON.stringify(draft.ccRecipients),
        JSON.stringify(draft.bccRecipients),
        draft.date,
        draft.snippet,
        withBody ? draft.plaintextBody : null,
        withBody ? draft.htmlBody : null,
        JSON.stringify(draft.attachments),
        JSON.stringify(draft.labelIds),
        withBody ? draft.raw : null,
        draft.viewUrl,
        withBody,
        draft.inReplyTo,
        draft.references,
      ],
    );
  }

  async listDrafts(accountId: string): Promise<DraftRecord[]> {
    const result = await this.sql.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM drafts WHERE account_id = $1 ORDER BY date DESC, id`,
      [accountId],
    );
    return result.rows.map(mapDraft);
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    const result = await this.sql.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM drafts WHERE account_id = $1 AND id = $2`,
      [accountId, draftId],
    );
    const row = result.rows[0];
    return row ? mapDraft(row) : null;
  }

  async replaceSendAs(accountId: string, rows: SendAsRecord[]): Promise<void> {
    await this.sql.query("DELETE FROM send_as WHERE account_id = $1", [accountId]);
    for (const row of rows) {
      await this.sql.query(
        `INSERT INTO send_as (account_id, email, signature, is_default, is_primary, verified)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, row.email, row.signature, row.isDefault, row.isPrimary, row.verified],
      );
    }
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    const result = await this.sql.query<{
      email: string;
      signature: string;
      is_default: boolean;
      is_primary: boolean;
      verified: boolean;
    }>("SELECT email, signature, is_default, is_primary, verified FROM send_as WHERE account_id = $1 ORDER BY email", [
      accountId,
    ]);
    return result.rows.map((row) => ({
      email: row.email,
      signature: row.signature,
      isDefault: row.is_default,
      isPrimary: row.is_primary,
      verified: row.verified,
    }));
  }

  async replaceFilters(accountId: string, filters: FilterRecord[]): Promise<void> {
    await this.sql.query("DELETE FROM filters WHERE account_id = $1", [accountId]);
    for (const filter of filters) {
      await this.sql.query(
        "INSERT INTO filters (account_id, id, criteria, action) VALUES ($1, $2, $3::jsonb, $4::jsonb)",
        [accountId, filter.id, JSON.stringify(filter.criteria), JSON.stringify(filter.action)],
      );
    }
  }

  async forgetThread(accountId: string, threadId: string): Promise<void> {
    await this.sql.query("DELETE FROM messages WHERE account_id = $1 AND thread_id = $2", [accountId, threadId]);
    await this.sql.query("DELETE FROM threads WHERE account_id = $1 AND id = $2", [accountId, threadId]);
  }

  async addMessage(accountId: string, message: MailMessage): Promise<void> {
    const existing = await this.getThread(accountId, message.threadId);
    const messages = existing
      ? [...existing.messages.filter((item) => item.id !== message.id), message]
      : [message];
    messages.sort((a, b) => a.position - b.position);
    const thread: MailThread = {
      id: message.threadId,
      snippet: message.snippet,
      messageCount: messages.length,
      viewUrl: message.viewUrl || existing?.viewUrl || "",
      historyId: existing?.historyId ?? null,
      messages,
    };
    await this.saveThreadMeta(accountId, [thread]);
    await this.saveBodies(accountId, { ...thread, messages: [message] });
  }

  /** Upsert these messages and recompute each conversation. Does not delete siblings. */
  async mergeSyncedMessages(accountId: string, messages: MailMessage[]): Promise<void> {
    const threads = new Set<string>();
    for (const message of messages) {
      await this.addMessage(accountId, message);
      if (message.threadId) threads.add(message.threadId);
    }
    for (const threadId of threads) await this.refreshThread(accountId, threadId);
  }

  /** Replace one message's labels. An unknown id is a no-op. Other messages stay. */
  async setMessageLabels(accountId: string, messageId: string, labelIds: string[]): Promise<void> {
    const existing = await this.getMessage(accountId, messageId);
    if (!existing) return;
    await this.sql.query(
      "UPDATE messages SET label_ids = $3::jsonb WHERE account_id = $1 AND id = $2",
      [accountId, messageId, JSON.stringify(labelIds)],
    );
  }

  /** Delete one message and fix the conversation it belonged to. An unknown id is a no-op. */
  async forgetMessage(accountId: string, messageId: string): Promise<void> {
    const found = await this.sql.query<{ thread_id: string }>(
      "SELECT thread_id FROM messages WHERE account_id = $1 AND id = $2",
      [accountId, messageId],
    );
    const threadId = found.rows[0]?.thread_id;
    if (!threadId) return;
    await this.sql.query("DELETE FROM messages WHERE account_id = $1 AND id = $2", [accountId, messageId]);
    await this.refreshThread(accountId, threadId);
  }

  private async refreshThread(accountId: string, threadId: string): Promise<void> {
    const messages = await this.messagesFor(accountId, threadId);
    if (messages.length === 0) {
      await this.sql.query("DELETE FROM threads WHERE account_id = $1 AND id = $2", [accountId, threadId]);
      return;
    }
    const sorted = [...messages].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
    for (let index = 0; index < sorted.length; index += 1) {
      const message = sorted[index];
      if (!message || message.position === index) continue;
      await this.sql.query(
        "UPDATE messages SET position = $3 WHERE account_id = $1 AND id = $2",
        [accountId, message.id, index],
      );
    }
    const newest = sorted[sorted.length - 1];
    if (!newest) return;
    await this.sql.query(
      `UPDATE threads SET snippet = $3, message_count = $4, view_url = $5, updated_at = $6
       WHERE account_id = $1 AND id = $2`,
      [accountId, threadId, newest.snippet, sorted.length, newest.viewUrl, new Date().toISOString()],
    );
  }

  async insertLabel(accountId: string, label: LabelRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO labels (account_id, label_id, name, label_type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, label_id) DO UPDATE SET name = EXCLUDED.name, label_type = EXCLUDED.label_type`,
      [accountId, label.labelId, label.name, label.labelType],
    );
  }

  async addThreadLabels(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    await this.rewriteLabels(accountId, threadId, (current) => [...new Set([...current, ...labelIds])]);
  }

  async removeThreadLabels(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    const drop = new Set(labelIds);
    await this.rewriteLabels(accountId, threadId, (current) => current.filter((id) => !drop.has(id)));
  }

  private async rewriteLabels(
    accountId: string,
    threadId: string,
    next: (current: string[]) => string[],
  ): Promise<void> {
    const messages = await this.messagesFor(accountId, threadId);
    for (const message of messages) {
      await this.sql.query(
        "UPDATE messages SET label_ids = $3::jsonb WHERE account_id = $1 AND id = $2",
        [accountId, message.id, JSON.stringify(next(message.labelIds))],
      );
    }
  }

  async removeDraft(accountId: string, draftId: string): Promise<void> {
    await this.sql.query("DELETE FROM drafts WHERE account_id = $1 AND id = $2", [accountId, draftId]);
  }

  async insertFilter(accountId: string, filter: FilterRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO filters (account_id, id, criteria, action) VALUES ($1, $2, $3::jsonb, $4::jsonb)
       ON CONFLICT (account_id, id) DO UPDATE SET criteria = EXCLUDED.criteria, action = EXCLUDED.action`,
      [accountId, filter.id, JSON.stringify(filter.criteria), JSON.stringify(filter.action)],
    );
  }

  async removeFilter(accountId: string, filterId: string): Promise<void> {
    await this.sql.query("DELETE FROM filters WHERE account_id = $1 AND id = $2", [accountId, filterId]);
  }

  async appendAudit(entry: {
    accountId: string;
    tool: string;
    targetIds: string[];
    outcome: "ok" | "error";
    at: string;
    storeFailed?: boolean;
  }): Promise<void> {
    const detail: Record<string, unknown> = { targetIds: entry.targetIds, outcome: entry.outcome };
    if (entry.storeFailed) detail.store_failed = true;
    await this.sql.query(
      "INSERT INTO audit_log (account_id, action, at, detail) VALUES ($1, $2, $3, $4::jsonb)",
      [entry.accountId, entry.tool, entry.at, JSON.stringify(detail)],
    );
  }

  async listAudit(): Promise<Array<{ accountId: string | null; tool: string; at: string; detail: Record<string, unknown> }>> {
    const result = await this.sql.query<{ account_id: string | null; action: string; at: string; detail: unknown }>(
      "SELECT account_id, action, at, detail FROM audit_log ORDER BY id",
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      tool: row.action,
      at: row.at,
      detail: jsonb<Record<string, unknown>>(row.detail, {}),
    }));
  }

  async mailDigest(): Promise<string> {
    const threads = await this.sql.query(
      "SELECT account_id, id, snippet, message_count FROM threads ORDER BY account_id, id",
    );
    const messages = await this.sql.query(
      "SELECT account_id, id, thread_id, subject, label_ids, in_reply_to, references_header, length(coalesce(text_body, '')) AS text_len FROM messages ORDER BY account_id, id",
    );
    const drafts = await this.sql.query(
      "SELECT account_id, id, thread_id, subject, in_reply_to, references_header, length(coalesce(text_body, '')) AS text_len FROM drafts ORDER BY account_id, id",
    );
    const labels = await this.sql.query(
      "SELECT account_id, label_id, name FROM labels ORDER BY account_id, label_id",
    );
    const filters = await this.sql.query(
      "SELECT account_id, id, criteria, action FROM filters ORDER BY account_id, id",
    );
    return JSON.stringify({
      threads: threads.rows,
      messages: messages.rows,
      drafts: drafts.rows,
      labels: labels.rows,
      filters: filters.rows,
    });
  }

  async getSyncState(accountId: string): Promise<SyncState> {
    const result = await this.sql.query<{
      phase: string | null;
      page_token: string | null;
      page_offset: number | null;
      anchor_history_id: string | null;
      history_id: string | null;
      last_sync_at: string | null;
    }>(
      `SELECT phase, page_token, page_offset, anchor_history_id, history_id, last_sync_at
       FROM sync_state WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        phase: "backfill",
        pageToken: null,
        pageOffset: 0,
        anchorHistoryId: null,
        historyId: null,
        lastSyncAt: null,
      };
    }
    return {
      phase: row.phase === "incremental" ? "incremental" : "backfill",
      pageToken: row.page_token,
      pageOffset: row.page_offset ?? 0,
      anchorHistoryId: row.anchor_history_id,
      historyId: row.history_id,
      lastSyncAt: row.last_sync_at,
    };
  }

  async saveSyncState(accountId: string, state: SyncState): Promise<void> {
    await this.sql.query(
      `INSERT INTO sync_state (
         account_id, phase, page_token, page_offset, anchor_history_id, history_id, last_sync_at, uids
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET
         phase = EXCLUDED.phase,
         page_token = EXCLUDED.page_token,
         page_offset = EXCLUDED.page_offset,
         anchor_history_id = EXCLUDED.anchor_history_id,
         history_id = EXCLUDED.history_id,
         last_sync_at = EXCLUDED.last_sync_at`,
      [
        accountId,
        state.phase,
        state.pageToken,
        state.pageOffset,
        state.anchorHistoryId,
        state.historyId,
        state.lastSyncAt,
      ],
    );
  }

  /** Sets last_sync_at only. A fake sync uses this so a later read is not stale. */
  async touchSync(accountId: string, at: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO sync_state (account_id, uids, last_sync_at)
       VALUES ($1, '{}'::jsonb, $2)
       ON CONFLICT (account_id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at`,
      [accountId, at],
    );
  }

  async clearSyncSeen(accountId: string): Promise<void> {
    await this.sql.query("DELETE FROM sync_seen WHERE account_id = $1", [accountId]);
  }

  async recordSyncSeen(accountId: string, messageIds: string[]): Promise<void> {
    for (const messageId of messageIds) {
      await this.sql.query(
        `INSERT INTO sync_seen (account_id, message_id) VALUES ($1, $2)
         ON CONFLICT (account_id, message_id) DO NOTHING`,
        [accountId, messageId],
      );
    }
  }

  async listSyncSeen(accountId: string): Promise<Set<string>> {
    const result = await this.sql.query<{ message_id: string }>(
      "SELECT message_id FROM sync_seen WHERE account_id = $1",
      [accountId],
    );
    return new Set(result.rows.map((row) => row.message_id));
  }

  async markResync(accountId: string, threadId: string, reason: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO resync_threads (account_id, thread_id, reason, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, thread_id) DO UPDATE SET
         reason = EXCLUDED.reason,
         created_at = EXCLUDED.created_at`,
      [accountId, threadId, reason, new Date().toISOString()],
    );
  }

  async listResync(accountId: string): Promise<string[]> {
    const result = await this.sql.query<{ thread_id: string }>(
      "SELECT thread_id FROM resync_threads WHERE account_id = $1 ORDER BY thread_id",
      [accountId],
    );
    return result.rows.map((row) => row.thread_id);
  }

  async clearResync(accountId: string, threadId: string): Promise<void> {
    await this.sql.query(
      "DELETE FROM resync_threads WHERE account_id = $1 AND thread_id = $2",
      [accountId, threadId],
    );
  }

  async replaceSyncedThread(accountId: string, thread: MailThread): Promise<void> {
    if (thread.messages.length === 0) {
      await this.forgetThread(accountId, thread.id);
      return;
    }
    await this.saveThreadMeta(accountId, [thread]);
    await this.saveBodies(accountId, thread);
    const keep = JSON.stringify(thread.messages.map((message) => message.id));
    await this.sql.query(
      `DELETE FROM messages
       WHERE account_id = $1 AND thread_id = $2
         AND id <> ALL (SELECT jsonb_array_elements_text($3::jsonb))`,
      [accountId, thread.id, keep],
    );
  }

  async reconcileWindow(accountId: string, cutoffIso: string, seen: Set<string>): Promise<void> {
    const rows = await this.sql.query<{ id: string; thread_id: string; date: string }>(
      "SELECT id, thread_id, date FROM messages WHERE account_id = $1",
      [accountId],
    );
    const touched = new Set<string>();
    for (const row of rows.rows) {
      if (!row.date || row.date < cutoffIso) continue;
      if (seen.has(row.id)) continue;
      await this.sql.query("DELETE FROM messages WHERE account_id = $1 AND id = $2", [accountId, row.id]);
      touched.add(row.thread_id);
    }
    for (const threadId of touched) {
      const left = await this.sql.query<{ id: string }>(
        "SELECT id FROM messages WHERE account_id = $1 AND thread_id = $2 LIMIT 1",
        [accountId, threadId],
      );
      if (left.rows.length === 0) {
        await this.sql.query("DELETE FROM threads WHERE account_id = $1 AND id = $2", [accountId, threadId]);
      }
    }
  }

  /**
   * One statement. PGlite runs queries on a single connection, so a multi-statement
   * transaction would interleave under two triggers. The loser gets no row back.
   */
  /**
   * One statement. A new id inserts. An unfinished claim older than `cutoff`
   * updates claimed_at and returns the id. A finished row, or a claim that is
   * still inside the lease, returns nothing.
   */
  async claimJob(
    id: string,
    accountId: string,
    kind: string,
    at: string,
    payload: Record<string, string>,
    cutoff: string,
  ): Promise<boolean> {
    const result = await this.sql.query<{ id: string }>(
      `INSERT INTO jobs (id, account_id, kind, run_at, payload, claimed_at, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $4, $4)
       ON CONFLICT (id) DO UPDATE SET claimed_at = EXCLUDED.claimed_at
       WHERE jobs.done_at IS NULL AND jobs.claimed_at < $6
       RETURNING id`,
      [id, accountId, kind, at, JSON.stringify(payload), cutoff],
    );
    return result.rows.length > 0;
  }

  async getLastJobsAt(accountId: string): Promise<string | null> {
    const result = await this.sql.query<{ last_jobs_at: string | null }>(
      "SELECT last_jobs_at FROM sync_state WHERE account_id = $1",
      [accountId],
    );
    return result.rows[0]?.last_jobs_at ?? null;
  }

  async markJobsRun(accountId: string, at: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO sync_state (account_id, uids, last_jobs_at)
       VALUES ($1, '{}'::jsonb, $2)
       ON CONFLICT (account_id) DO UPDATE SET last_jobs_at = EXCLUDED.last_jobs_at`,
      [accountId, at],
    );
  }

  async wakeEmptyAt(accountId: string, labelId: string): Promise<string | null> {
    const result = await this.sql.query<{ empty_at: string }>(
      "SELECT empty_at FROM wake_empty WHERE account_id = $1 AND label_id = $2",
      [accountId, labelId],
    );
    return result.rows[0]?.empty_at ?? null;
  }

  async markWakeEmpty(accountId: string, labelId: string, at: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO wake_empty (account_id, label_id, empty_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, label_id) DO UPDATE SET empty_at = EXCLUDED.empty_at`,
      [accountId, labelId, at],
    );
  }

  async finishJob(id: string, at: string): Promise<void> {
    await this.sql.query("UPDATE jobs SET done_at = $2 WHERE id = $1", [id, at]);
  }

  async releaseJob(id: string): Promise<void> {
    await this.sql.query("DELETE FROM jobs WHERE id = $1 AND done_at IS NULL", [id]);
  }

  async listMessageIds(accountId: string): Promise<string[]> {
    const result = await this.sql.query<{ id: string }>(
      "SELECT id FROM messages WHERE account_id = $1 ORDER BY id",
      [accountId],
    );
    return result.rows.map((row) => row.id);
  }

  async listFilters(accountId: string): Promise<FilterRecord[]> {
    const result = await this.sql.query<{ id: string; criteria: unknown; action: unknown }>(
      "SELECT id, criteria, action FROM filters WHERE account_id = $1 ORDER BY id",
      [accountId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      criteria: jsonb<FilterCriteria>(row.criteria, { from: "", to: "", subject: "", query: "", hasAttachment: false }),
      action: jsonb<FilterAction>(row.action, { addLabelIds: [], removeLabelIds: [], skipInbox: false }),
    }));
  }

  /** Creates or updates the Gmail account and seals the token. Does not copy mail. */
  async connectGmail(email: string, tokenJson: string, key: Buffer, at: string): Promise<string> {
    const id = `gmail_${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
    const pos = await this.sql.query<{ n: number | string }>(
      "SELECT coalesce(max(position), -1) + 1 AS n FROM accounts",
    );
    const position = Number(pos.rows[0]?.n ?? 0);
    await this.sql.query(
      `INSERT INTO accounts (id, email, label, kind, color, position, created_at)
       VALUES ($1, $2, $3, 'gmail', NULL, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         label = EXCLUDED.label,
         kind = EXCLUDED.kind`,
      [id, email, email, position, at],
    );
    await this.upsertToken(id, key, tokenJson);
    return id;
  }

  async connectImap(input: {
    email: string;
    host: string;
    port: number;
    security: "tls" | "starttls";
    username: string;
    password: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: "tls" | "starttls";
    saveSent: boolean;
    aliases: string[];
    key: Buffer;
    at: string;
  }): Promise<string> {
    const id = `imap_${createHash("sha256").update(input.email.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
    const pos = await this.sql.query<{ n: number | string }>(
      "SELECT coalesce(max(position), -1) + 1 AS n FROM accounts",
    );
    const position = Number(pos.rows[0]?.n ?? 0);
    await this.sql.query(
      `INSERT INTO accounts (id, email, label, kind, color, position, created_at)
       VALUES ($1, $2, $3, 'imap', NULL, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         label = EXCLUDED.label,
         kind = EXCLUDED.kind`,
      [id, input.email, input.email, position, input.at],
    );
    await this.upsertToken(id, input.key, input.password);
    await this.sql.query(
      `INSERT INTO imap_mailboxes (
         account_id, host, port, security, username, smtp_host, smtp_port, smtp_security, save_sent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (account_id) DO UPDATE SET
         host = EXCLUDED.host,
         port = EXCLUDED.port,
         security = EXCLUDED.security,
         username = EXCLUDED.username,
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_security = EXCLUDED.smtp_security,
         save_sent = EXCLUDED.save_sent`,
      [
        id, input.host, input.port, input.security, input.username,
        input.smtpHost, input.smtpPort, input.smtpSecurity, input.saveSent,
      ],
    );
    const aliases = input.aliases
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0 && alias.toLowerCase() !== input.email.trim().toLowerCase());
    await this.replaceSendAs(id, [
      { email: input.email, signature: "", isDefault: true, isPrimary: true, verified: true },
      ...aliases.map((email) => ({ email, signature: "", isDefault: false, isPrimary: false, verified: true })),
    ]);
    return id;
  }

  async getImapMailbox(accountId: string): Promise<ImapMailboxRow | null> {
    const result = await this.sql.query<{
      host: string;
      port: number | string;
      security: "tls" | "starttls";
      username: string;
      smtp_host: string;
      smtp_port: number | string;
      smtp_security: "tls" | "starttls";
      save_sent: boolean;
    }>(
      `SELECT host, port, security, username, smtp_host, smtp_port, smtp_security, save_sent
       FROM imap_mailboxes WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      host: row.host,
      port: Number(row.port),
      security: row.security,
      username: row.username,
      smtpHost: row.smtp_host,
      smtpPort: Number(row.smtp_port),
      smtpSecurity: row.smtp_security,
      saveSent: row.save_sent === true || String(row.save_sent) === "true" || String(row.save_sent) === "t",
    };
  }

  async listImapCopies(accountId: string, messageId?: string): Promise<ImapCopyRow[]> {
    const result = messageId
      ? await this.sql.query<CopySql>(
        `SELECT message_id, folder, uidvalidity, uid FROM imap_copies
         WHERE account_id = $1 AND message_id = $2`,
        [accountId, messageId],
      )
      : await this.sql.query<CopySql>(
        "SELECT message_id, folder, uidvalidity, uid FROM imap_copies WHERE account_id = $1",
        [accountId],
      );
    return result.rows.map(mapCopy);
  }

  async saveImapCopy(accountId: string, copy: ImapCopyRow): Promise<void> {
    await this.sql.query(
      `INSERT INTO imap_copies (account_id, message_id, folder, uidvalidity, uid)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, folder, uidvalidity, uid) DO UPDATE SET message_id = EXCLUDED.message_id`,
      [accountId, copy.messageId, copy.folder, copy.uidValidity, copy.uid],
    );
  }

  async deleteImapCopy(accountId: string, folder: string, uidValidity: string, uid: number): Promise<void> {
    await this.sql.query(
      "DELETE FROM imap_copies WHERE account_id = $1 AND folder = $2 AND uidvalidity = $3 AND uid = $4",
      [accountId, folder, uidValidity, uid],
    );
  }

  /** Drops copies of one folder whose UIDVALIDITY is not the one just listed. */
  async deleteImapCopiesExcept(accountId: string, folder: string, uidValidity: string): Promise<ImapCopyRow[]> {
    const gone = await this.sql.query<CopySql>(
      `DELETE FROM imap_copies WHERE account_id = $1 AND folder = $2 AND uidvalidity <> $3
       RETURNING message_id, folder, uidvalidity, uid`,
      [accountId, folder, uidValidity],
    );
    return gone.rows.map(mapCopy);
  }

  async listImapFolderState(accountId: string): Promise<ImapFolderState[]> {
    const result = await this.sql.query<{
      folder: string;
      uidvalidity: string;
      highest_uid: number | string;
      highest_modseq: string | null;
      synced_at: string | null;
    }>(
      `SELECT folder, uidvalidity, highest_uid, highest_modseq, synced_at
       FROM imap_folder_state WHERE account_id = $1`,
      [accountId],
    );
    return result.rows.map((row) => ({
      folder: row.folder,
      uidValidity: row.uidvalidity,
      highestUid: Number(row.highest_uid),
      highestModseq: row.highest_modseq,
      syncedAt: row.synced_at,
    }));
  }

  async saveImapFolderState(accountId: string, row: ImapFolderState): Promise<void> {
    await this.sql.query(
      `INSERT INTO imap_folder_state (account_id, folder, uidvalidity, highest_uid, highest_modseq, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, folder) DO UPDATE SET
         uidvalidity = EXCLUDED.uidvalidity,
         highest_uid = EXCLUDED.highest_uid,
         highest_modseq = EXCLUDED.highest_modseq,
         synced_at = EXCLUDED.synced_at`,
      [accountId, row.folder, row.uidValidity, row.highestUid, row.highestModseq, row.syncedAt],
    );
  }

  async countImapConnectAttempts(sessionHash: string, since: string): Promise<number> {
    const result = await this.sql.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM imap_connect_attempts WHERE session_hash = $1 AND at >= $2",
      [sessionHash, since],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async recordImapConnectAttempt(sessionHash: string, at: string): Promise<void> {
    const id = randomBytes(12).toString("hex");
    await this.sql.query(
      "INSERT INTO imap_connect_attempts (id, session_hash, at) VALUES ($1, $2, $3)",
      [id, sessionHash, at],
    );
  }

  async deleteMessage(accountId: string, messageId: string): Promise<void> {
    const found = await this.sql.query<{ thread_id: string }>(
      "SELECT thread_id FROM messages WHERE account_id = $1 AND id = $2",
      [accountId, messageId],
    );
    const threadId = found.rows[0]?.thread_id;
    if (!threadId) return;
    await this.sql.query("DELETE FROM messages WHERE account_id = $1 AND id = $2", [accountId, messageId]);
    const left = await this.sql.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM messages WHERE account_id = $1 AND thread_id = $2",
      [accountId, threadId],
    );
    if (Number(left.rows[0]?.n ?? 0) === 0) {
      await this.sql.query("DELETE FROM threads WHERE account_id = $1 AND id = $2", [accountId, threadId]);
    } else {
      await this.sql.query(
        "UPDATE threads SET message_count = $3 WHERE account_id = $1 AND id = $2",
        [accountId, threadId, Number(left.rows[0]?.n ?? 0)],
      );
    }
  }

  /** Creates or updates the Microsoft account and seals the token. Does not copy mail. */
  async connectMicrosoft(email: string, tokenJson: string, key: Buffer, at: string): Promise<string> {
    const id = `microsoft_${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
    const pos = await this.sql.query<{ n: number | string }>(
      "SELECT coalesce(max(position), -1) + 1 AS n FROM accounts",
    );
    const position = Number(pos.rows[0]?.n ?? 0);
    await this.sql.query(
      `INSERT INTO accounts (id, email, label, kind, color, position, created_at)
       VALUES ($1, $2, $3, 'microsoft', NULL, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         label = EXCLUDED.label,
         kind = EXCLUDED.kind`,
      [id, email, email, position, at],
    );
    await this.upsertToken(id, key, tokenJson);
    return id;
  }

  async getDelta(accountId: string, folder: string): Promise<string | null> {
    const result = await this.sql.query<{ delta_link: string | null }>(
      "SELECT delta_link FROM microsoft_delta WHERE account_id = $1 AND folder = $2",
      [accountId, folder],
    );
    return result.rows[0]?.delta_link ?? null;
  }

  async saveDelta(accountId: string, folder: string, deltaLink: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO microsoft_delta (account_id, folder, delta_link)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, folder) DO UPDATE SET delta_link = EXCLUDED.delta_link`,
      [accountId, folder, deltaLink],
    );
  }

  async clearDelta(accountId: string, folder: string): Promise<void> {
    await this.sql.query(
      "DELETE FROM microsoft_delta WHERE account_id = $1 AND folder = $2",
      [accountId, folder],
    );
  }

  /** Messages stored for this account. Mirror search uses these when Graph cannot combine search and filter. */
  async listMessages(accountId: string): Promise<MailMessage[]> {
    const result = await this.sql.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = $1 ORDER BY date, position, id`,
      [accountId],
    );
    return result.rows.map(mapMessage);
  }

  /** Removes the account, its token, and its mail rows. The audit log stays. */
  async disconnectAccount(accountId: string): Promise<boolean> {
    const existing = await this.sql.query("SELECT id FROM accounts WHERE id = $1", [accountId]);
    if (existing.rows.length === 0) return false;
    await this.sql.query("DELETE FROM microsoft_delta WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM messages WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM threads WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM labels WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM drafts WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM filters WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM send_as WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM resync_threads WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM sync_seen WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM wake_empty WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM jobs WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM sync_state WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM provider_tokens WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM imap_copies WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM imap_folder_state WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM imap_mailboxes WHERE account_id = $1", [accountId]);
    await this.sql.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    return true;
  }

  private async messagesFor(accountId: string, threadId: string): Promise<MailMessage[]> {
    const result = await this.sql.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = $1 AND thread_id = $2 ORDER BY position ASC`,
      [accountId, threadId],
    );
    return result.rows.map(mapMessage);
  }
}

const MESSAGE_COLUMNS = `id, thread_id, position, sender, to_recipients, cc_recipients, bcc_recipients,
  reply_to, in_reply_to, references_header, subject, date, label_ids, snippet,
  text_body, html_body, attachments, raw, body_fetched, view_url`;

const DRAFT_COLUMNS = `id, message_id, thread_id, subject, to_recipients, cc_recipients, bcc_recipients,
  date, snippet, text_body, html_body, attachments, label_ids, raw, view_url, body_fetched,
  in_reply_to, references_header`;

interface MessageRow {
  id: string;
  thread_id: string;
  position: number;
  sender: string;
  to_recipients: unknown;
  cc_recipients: unknown;
  bcc_recipients: unknown;
  reply_to: unknown;
  in_reply_to: string;
  references_header: string;
  subject: string;
  date: string;
  label_ids: unknown;
  snippet: string;
  text_body: string | null;
  html_body: string | null;
  attachments: unknown;
  raw: string | null;
  body_fetched: boolean;
  view_url: string;
}

function mapMessage(row: MessageRow): MailMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    position: row.position,
    sender: row.sender,
    toRecipients: jsonb<string[]>(row.to_recipients, []),
    ccRecipients: jsonb<string[]>(row.cc_recipients, []),
    bccRecipients: jsonb<string[]>(row.bcc_recipients, []),
    replyTo: jsonb<string[]>(row.reply_to, []),
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    subject: row.subject,
    date: row.date,
    labelIds: jsonb<string[]>(row.label_ids, []),
    snippet: row.snippet,
    plaintextBody: row.text_body,
    htmlBody: row.html_body,
    attachments: jsonb<Attachment[]>(row.attachments, []),
    raw: row.raw,
    bodyFetched: row.body_fetched,
    viewUrl: row.view_url,
  };
}

interface DraftRow {
  id: string;
  message_id: string;
  thread_id: string;
  subject: string;
  to_recipients: unknown;
  cc_recipients: unknown;
  bcc_recipients: unknown;
  date: string;
  snippet: string;
  text_body: string | null;
  html_body: string | null;
  attachments: unknown;
  label_ids: unknown;
  raw: string | null;
  view_url: string;
  body_fetched: boolean;
  in_reply_to: string;
  references_header: string;
}

function mapDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    messageId: row.message_id,
    threadId: row.thread_id,
    subject: row.subject,
    toRecipients: jsonb<string[]>(row.to_recipients, []),
    ccRecipients: jsonb<string[]>(row.cc_recipients, []),
    bccRecipients: jsonb<string[]>(row.bcc_recipients, []),
    date: row.date,
    snippet: row.snippet,
    plaintextBody: row.text_body,
    htmlBody: row.html_body,
    attachments: jsonb<Attachment[]>(row.attachments, []),
    labelIds: jsonb<string[]>(row.label_ids, []),
    raw: row.raw,
    viewUrl: row.view_url,
    bodyFetched: row.body_fetched,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
  };
}
