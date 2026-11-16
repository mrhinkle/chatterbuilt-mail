/** The IMAP commands this provider sends. ImapFlow 2.10.0 and the in-memory mailbox both implement it. */

export interface ImapCaps {
  move: boolean;
  uidplus: boolean;
  condstore: boolean;
  qresync: boolean;
  specialUse: boolean;
  /** RFC 5256 SORT. Absent means the server cannot order a search by date. */
  sort: boolean;
}

export interface ImapListed {
  path: string;
  name: string;
  delimiter: string;
  /** Set only when the server reported SPECIAL-USE or XLIST. A name guess is not a flag. */
  specialUse: string | null;
  flags: string[];
  noSelect: boolean;
}

export interface ImapNamespace {
  prefix: string;
  delimiter: string;
}

export interface ImapStatus {
  uidValidity: string;
  uidNext: number;
  highestModseq: string | null;
  exists: number;
}

export interface ImapAttachment {
  filename: string;
  mimeType: string;
  cid: string;
}

export interface ImapAddress {
  name: string;
  address: string;
}

export interface ImapEnvelope {
  date: string | null;
  subject: string;
  messageId: string;
  inReplyTo: string;
  from: ImapAddress[];
  to: ImapAddress[];
  cc: ImapAddress[];
  bcc: ImapAddress[];
  replyTo: ImapAddress[];
}

/** Headers a list needs to group a thread. The full source is a different fetch. */
export interface ImapHeaderFields {
  messageId: string;
  inReplyTo: string;
  references: string;
  listId: string;
  draftId: string;
}

export interface FetchWhat {
  source?: boolean;
  structure?: boolean;
  flags?: boolean;
  envelope?: boolean;
  headers?: boolean;
  /** First text part, at most 400 bytes. Not the full body. */
  preview?: boolean;
  /** UID, INTERNALDATE, and size only. No flags, source, or body. */
  datesOnly?: boolean;
}

export interface ImapFetched {
  uid: number;
  flags: string[];
  internalDate: string;
  size: number;
  modseq: string | null;
  source?: Buffer;
  attachments?: ImapAttachment[];
  mixed?: boolean;
  envelope?: ImapEnvelope;
  headers?: ImapHeaderFields;
  preview?: string;
}

/** One SEARCH. Every set field is AND. `deleted` is omitted to mean "not \\Deleted". */
export interface SearchQuery {
  all?: boolean;
  since?: string;
  before?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  header?: { name: string; value: string };
  seen?: boolean;
  flagged?: boolean;
  deleted?: boolean;
  uid?: string;
  not?: SearchQuery;
  or?: SearchQuery[];
  and?: SearchQuery[];
}

export interface ImapTarget {
  /** Resolved address. The socket connects here and nowhere else. */
  host: string;
  /** Owner's host name. SNI and the certificate check use this. */
  servername: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  password: string;
  timeoutMs: number;
  /** Test-only trust anchor. Never a request field. */
  caPem?: string;
}

export class ImapAuthError extends Error {
  constructor() {
    super("authentication failed");
    this.name = "ImapAuthError";
  }
}

export class ImapNoMove extends Error {
  constructor() {
    super("MOVE is not supported");
    this.name = "ImapNoMove";
  }
}

export class ImapTransientError extends Error {
  constructor(message = "connection reset") {
    super(message);
    this.name = "ImapTransientError";
  }
}

export interface ImapSession {
  readonly caps: ImapCaps;
  readonly writeAttempts: number;
  list(): Promise<ImapListed[]>;
  namespace(): Promise<ImapNamespace>;
  status(path: string): Promise<ImapStatus>;
  search(path: string, query: SearchQuery): Promise<number[]>;
  /**
   * UID SORT (REVERSE DATE) for `query`, newest first.
   * Null when the server has no SORT, the query is too complex, or the command fails.
   * A null result means the caller fetches INTERNALDATE instead. It is never an empty mailbox.
   */
  sortByDate(path: string, query: SearchQuery): Promise<number[] | null>;
  fetch(path: string, uids: number[], what: FetchWhat, changedSince?: string | null): Promise<ImapFetched[]>;
  /** FLAGS for every message with MODSEQ above `modseq`. The range is `1:*`. Source is not requested. */
  fetchChangedSince(path: string, modseq: string): Promise<ImapFetched[]>;
  /** Null when the server has no QRESYNC. */
  vanished(path: string, modseq: string, uidValidity: string): Promise<number[] | null>;
  append(path: string, raw: Buffer, flags: string[]): Promise<{ uid: number; uidValidity: string }>;
  createMailbox(path: string): Promise<void>;
  copy(path: string, uids: number[], dest: string): Promise<Map<number, number>>;
  /** Throws ImapNoMove when the server has no MOVE. That throw is not a write attempt. */
  move(path: string, uids: number[], dest: string): Promise<Map<number, number>>;
  storeFlags(path: string, uids: number[], add: string[], remove: string[]): Promise<void>;
  markDeleted(path: string, uids: number[]): Promise<void>;
  /** UID EXPUNGE, or a plain EXPUNGE only when no other \\Deleted message exists. */
  expunge(path: string, uids: number[]): Promise<"expunged" | "left-flagged">;
  logout(): Promise<void>;
}
