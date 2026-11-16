export type AccountKind = "gmail" | "imap" | "microsoft";

export interface AccountRecord {
  id: string;
  email: string;
  label: string;
  kind: AccountKind;
  color?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  cid: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  position: number;
  sender: string;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  replyTo: string[];
  inReplyTo: string;
  references: string;
  subject: string;
  date: string;
  labelIds: string[];
  snippet: string;
  plaintextBody: string | null;
  htmlBody: string | null;
  attachments: Attachment[];
  raw: string | null;
  viewUrl: string;
  bodyFetched: boolean;
}

export interface MailThread {
  id: string;
  snippet: string;
  messageCount: number;
  viewUrl: string;
  historyId: string | null;
  messages: MailMessage[];
}

export interface LabelRecord {
  labelId: string;
  name: string;
  labelType: "SYSTEM" | "USER";
}

export interface DraftRecord {
  id: string;
  messageId: string;
  threadId: string;
  subject: string;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  date: string;
  snippet: string;
  plaintextBody: string | null;
  htmlBody: string | null;
  attachments: Attachment[];
  labelIds: string[];
  raw: string | null;
  viewUrl: string;
  bodyFetched: boolean;
  inReplyTo: string;
  references: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Base64 of the bytes. Absent when the part is already on the draft. */
  content?: string;
  msgId?: string;
  attId?: string;
  cid?: string;
}

/** True when the tool caller sent the field, including an explicit empty value. */
export interface DraftFieldPresence {
  to: boolean;
  cc: boolean;
  bcc: boolean;
  subject: boolean;
  body: boolean;
  htmlBody: boolean;
}

export interface OutgoingDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  /** Tool path only. Absent on a hand-built draft, which still means nonempty fields. */
  present?: DraftFieldPresence;
  replyToMessageId?: string;
  includeSignature?: boolean;
  attachments?: OutgoingAttachment[];
  threadId?: string;
  fromEmail?: string;
  draftId?: string;
}

export interface ReplyInput {
  messageId: string;
  body: string;
  htmlBody?: string;
  replyAll: boolean;
  cc: string[];
  bcc: string[];
  includeSignature: boolean;
  attachments?: OutgoingAttachment[];
}

export interface ForwardInput {
  messageId: string;
  to: string[];
  includeSignature: boolean;
}

export interface SentResult {
  id: string;
  threadId: string;
  labelIds: string[];
  message: MailMessage;
}

export type SearchView = "summary" | "ids";

export interface SearchHit {
  id: string;
  snippet: string;
  messageCount: number;
  viewUrl: string;
  historyId: string | null;
  newest: MailMessage | null;
}

export interface ProviderSearchPage {
  hits: SearchHit[];
  nextPageToken: string | null;
  resultCountEstimate: number;
}

export interface SendAsRecord {
  email: string;
  signature: string;
  isDefault: boolean;
  isPrimary: boolean;
  verified: boolean;
}

export interface FilterCriteria {
  from: string;
  to: string;
  subject: string;
  query: string;
  hasAttachment: boolean;
}

export interface FilterAction {
  addLabelIds: string[];
  removeLabelIds: string[];
  skipInbox: boolean;
}

export interface FilterRecord {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

export interface MailProvider {
  readonly kind: "fake" | "gmail" | "imap" | "microsoft" | "live";
  listAccounts(): AccountRecord[];
  /**
   * One page of search hits. The provider applies pageSize. Direct mode uses this
   * result as the summary. Callers must not list the mailbox once per id.
   */
  searchPage(
    accountId: string,
    query: string,
    pageSize: number,
    pageToken: string | undefined,
    view: SearchView,
  ): Promise<ProviderSearchPage>;
  /** Headers and snippet only. Bodies stay null. Cold backfill, not search. */
  listThreadMeta(accountId: string): Promise<MailThread[]>;
  getThread(accountId: string, threadId: string): Promise<MailThread | null>;
  getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null>;
  listLabels(accountId: string): Promise<LabelRecord[]>;
  listDraftMeta(accountId: string): Promise<DraftRecord[]>;
  getDraft(accountId: string, draftId: string): Promise<DraftRecord | null>;
  listSendAs(accountId: string): Promise<SendAsRecord[]>;
  listFilters(accountId: string): Promise<FilterRecord[]>;
  createLabel(accountId: string, displayName: string): Promise<LabelRecord>;
  labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void>;
  unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void>;
  /** One Gmail threads.modify: add and remove together. */
  modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void>;
  createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord>;
  updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord>;
  deleteDraft(accountId: string, draftId: string): Promise<void>;
  sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult>;
  reply(accountId: string, input: ReplyInput): Promise<SentResult>;
  forward(accountId: string, input: ForwardInput): Promise<SentResult>;
  createFilter(accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord>;
  deleteFilter(accountId: string, filterId: string): Promise<void>;
}
