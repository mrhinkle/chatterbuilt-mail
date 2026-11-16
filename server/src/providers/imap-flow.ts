import { ImapFlow, AuthenticationFailure } from "imapflow";
import type { FetchMessageObject, MessageStructureObject, SearchObject } from "imapflow";
import type {
  FetchWhat,
  ImapAddress,
  ImapAttachment,
  ImapCaps,
  ImapEnvelope,
  ImapFetched,
  ImapHeaderFields,
  ImapListed,
  ImapNamespace,
  ImapSession,
  ImapStatus,
  ImapTarget,
  SearchQuery,
} from "./imap-session.js";
import { ImapAuthError, ImapNoMove } from "./imap-session.js";

/**
 * ImapFlow 2.10.0. The socket connects to `target.host` (a resolved address).
 * SNI and certificate verification use `target.servername`. Logging is off.
 * An instance cannot reconnect; the caller builds a new one for a read retry.
 */
export async function openImapFlow(target: ImapTarget): Promise<ImapSession> {
  const client = new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.secure,
    servername: target.servername,
    doSTARTTLS: target.requireTLS ? true : undefined,
    auth: { user: target.user, pass: target.password },
    logger: false,
    qresync: true,
    disableAutoIdle: true,
    connectionTimeout: target.timeoutMs,
    greetingTimeout: target.timeoutMs,
    socketTimeout: target.timeoutMs,
    tls: {
      rejectUnauthorized: true,
      servername: target.servername,
      ca: target.caPem,
    },
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    client.close();
    if (error instanceof AuthenticationFailure) throw new ImapAuthError();
    throw error;
  }
  return new FlowSession(client);
}

export class FlowSession implements ImapSession {
  readonly caps: ImapCaps;
  writeAttempts = 0;

  constructor(private readonly client: ImapFlow) {
    this.caps = {
      move: hasCap(client, "MOVE"),
      uidplus: hasCap(client, "UIDPLUS"),
      condstore: hasCap(client, "CONDSTORE"),
      qresync: hasCap(client, "QRESYNC"),
      specialUse: hasCap(client, "SPECIAL-USE"),
      sort: hasCap(client, "SORT"),
    };
  }

  async list(): Promise<ImapListed[]> {
    const rows = await this.client.list();
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      delimiter: row.delimiter || "/",
      specialUse: row.specialUseSource === "name" ? null : row.specialUse ?? null,
      flags: [...row.flags],
      noSelect: row.flags.has("\\Noselect") || row.flags.has("\\NonExistent"),
    }));
  }

  async namespace(): Promise<ImapNamespace> {
    const personal = this.client.namespace;
    return {
      prefix: personal?.prefix ?? "",
      delimiter: personal?.delimiter || "/",
    };
  }

  async status(path: string): Promise<ImapStatus> {
    const row = await this.client.status(path, {
      uidValidity: true,
      uidNext: true,
      highestModseq: true,
      messages: true,
    });
    if (!row) throw new Error("STATUS failed");
    return {
      uidValidity: String(row.uidValidity ?? "0"),
      uidNext: Number(row.uidNext ?? 1),
      highestModseq: row.highestModseq == null ? null : String(row.highestModseq),
      exists: Number(row.messages ?? 0),
    };
  }

  async search(path: string, query: SearchQuery): Promise<number[]> {
    if (query.and && query.and.length > 0) {
      let hit: Set<number> | null = null;
      for (const part of query.and) {
        const next = new Set(await this.search(path, part));
        if (!hit) {
          hit = next;
          continue;
        }
        const kept: number[] = [];
        for (const uid of hit) {
          if (next.has(uid)) kept.push(uid);
        }
        hit = new Set(kept);
      }
      return [...(hit ?? [])].sort((a, b) => a - b);
    }
    const flow = toFlow(query);
    if (query.deleted !== true) flow.deleted = false;
    const lock = await this.client.getMailboxLock(path, { readOnly: true });
    try {
      const result = await this.client.search(flow, { uid: true });
      return Array.isArray(result) ? result : [];
    } finally {
      lock.release();
    }
  }

  async sortByDate(path: string, query: SearchQuery): Promise<number[] | null> {
    if (!this.caps.sort) return null;
    let criteria: ImapAtom[];
    try {
      const built = sortCriteria(query);
      if (!built) return null;
      criteria = built;
    } catch {
      return null;
    }
    const lock = await this.client.getMailboxLock(path, { readOnly: true });
    try {
      const numbers: number[] = [];
      const response = await sortable(this.client).exec("UID SORT", [
        [atom("REVERSE"), atom("DATE")],
        atom("UTF-8"),
        ...criteria,
      ], {
        untagged: {
          SORT: async (untagged) => {
            collectNumbers(numbers, untagged);
          },
        },
      });
      if (typeof response?.next === "function") response.next();
      return numbers;
    } catch {
      return null;
    } finally {
      lock.release();
    }
  }

  async fetch(
    path: string,
    uids: number[],
    what: FetchWhat,
    changedSince?: string | null,
  ): Promise<ImapFetched[]> {
    if (uids.length === 0) return [];
    return this.fetchRange(path, uids.join(","), what, changedSince ?? null);
  }

  /** FLAGS across `1:*` with CHANGEDSINCE. UID and MODSEQ come back with the flags. Source stays off this read. */
  async fetchChangedSince(path: string, modseq: string): Promise<ImapFetched[]> {
    return this.fetchRange(path, "1:*", { flags: true }, modseq);
  }

  private async fetchRange(
    path: string,
    range: string,
    what: FetchWhat,
    changedSince: string | null,
  ): Promise<ImapFetched[]> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true });
    try {
      const query: {
        uid: boolean;
        flags: boolean;
        internalDate: boolean;
        size: boolean;
        source?: boolean;
        bodyStructure?: boolean;
        envelope?: boolean;
        headers?: string[];
        bodyParts?: Array<{ key: string; start: number; maxLength: number }>;
      } = {
        uid: true,
        flags: what.datesOnly === true ? what.flags === true : true,
        internalDate: true,
        size: true,
      };
      if (what.source) query.source = true;
      if (what.structure) query.bodyStructure = true;
      if (what.envelope) query.envelope = true;
      if (what.headers) query.headers = ["message-id", "in-reply-to", "references", "list-id", "x-cbm-draft-id"];
      if (what.preview) query.bodyParts = [{ key: "1", start: 0, maxLength: 400 }];
      const options = {
        uid: true as const,
        changedSince: changedSince ? BigInt(changedSince) : undefined,
      };
      const out: ImapFetched[] = [];
      for await (const row of this.client.fetch(range, query, options)) {
        const flags = [...(row.flags ?? [])];
        if (flags.some((flag) => flag.toLowerCase() === "\\deleted") && !what.flags) continue;
        const fetched: ImapFetched = {
          uid: row.uid,
          flags,
          internalDate: dateOf(row),
          size: row.size ?? row.source?.length ?? 0,
          modseq: row.modseq == null ? null : String(row.modseq),
        };
        if (what.source && row.source) fetched.source = Buffer.from(row.source);
        if (what.structure) {
          const attachments: ImapAttachment[] = [];
          walkStructure(row.bodyStructure, attachments);
          fetched.attachments = attachments;
          fetched.mixed = attachments.length > 0 || (row.bodyStructure?.type ?? "").toLowerCase().includes("mixed");
        }
        if (what.envelope && row.envelope) fetched.envelope = envelopeOf(row.envelope);
        if (what.headers) fetched.headers = headerFields(row.headers);
        if (what.preview) fetched.preview = previewText(partBytes(row.bodyParts, "1"));
        out.push(fetched);
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async vanished(path: string, modseq: string, uidValidity: string): Promise<number[] | null> {
    if (!this.caps.qresync) return null;
    const gone: number[] = [];
    const onExpunge = (event: { vanished?: boolean; uid?: number }): void => {
      if (event.vanished && event.uid) gone.push(event.uid);
    };
    this.client.on("expunge", onExpunge);
    try {
      const lock = await this.client.getMailboxLock(path, { changedSince: modseq, uidValidity });
      lock.release();
    } finally {
      this.client.off("expunge", onExpunge);
    }
    return gone;
  }

  async append(path: string, raw: Buffer, flags: string[]): Promise<{ uid: number; uidValidity: string }> {
    this.writeAttempts += 1;
    const result = await this.client.append(path, raw, flags);
    if (!result) throw new Error("APPEND failed");
    if (result.uid) {
      return { uid: result.uid, uidValidity: String(result.uidValidity ?? "0") };
    }
    const status = await this.status(path);
    return { uid: Math.max(1, status.uidNext - 1), uidValidity: status.uidValidity };
  }

  async createMailbox(path: string): Promise<void> {
    this.writeAttempts += 1;
    await this.client.mailboxCreate(path);
  }

  async copy(path: string, uids: number[], dest: string): Promise<Map<number, number>> {
    if (uids.length === 0) return new Map();
    this.writeAttempts += 1;
    const lock = await this.client.getMailboxLock(path);
    try {
      const result = await this.client.messageCopy(uids.join(","), dest, { uid: true });
      if (!result || !result.uidMap) throw new Error("COPY failed");
      return result.uidMap;
    } finally {
      lock.release();
    }
  }

  async move(path: string, uids: number[], dest: string): Promise<Map<number, number>> {
    if (uids.length === 0) return new Map();
    if (!this.caps.move) throw new ImapNoMove();
    this.writeAttempts += 1;
    const lock = await this.client.getMailboxLock(path);
    try {
      const result = await this.client.messageMove(uids.join(","), dest, { uid: true });
      if (result === false) throw new ImapNoMove();
      if (!result?.uidMap) throw new Error("MOVE failed");
      return result.uidMap;
    } finally {
      lock.release();
    }
  }

  async storeFlags(path: string, uids: number[], add: string[], remove: string[]): Promise<void> {
    if (uids.length === 0) return;
    this.writeAttempts += 1;
    const lock = await this.client.getMailboxLock(path);
    try {
      const range = uids.join(",");
      if (add.length > 0) await this.client.messageFlagsAdd(range, add, { uid: true });
      if (remove.length > 0) await this.client.messageFlagsRemove(range, remove, { uid: true });
    } finally {
      lock.release();
    }
  }

  async markDeleted(path: string, uids: number[]): Promise<void> {
    await this.storeFlags(path, uids, ["\\Deleted"], []);
  }

  async expunge(path: string, uids: number[]): Promise<"expunged" | "left-flagged"> {
    if (uids.length === 0) return "expunged";
    this.writeAttempts += 1;
    const lock = await this.client.getMailboxLock(path);
    try {
      if (this.caps.uidplus) {
        await this.client.messageDelete(uids.join(","), { uid: true });
        return "expunged";
      }
      const deleted = await this.client.search({ deleted: true }, { uid: true });
      const wanted = new Set(uids);
      const others = (Array.isArray(deleted) ? deleted : []).some((uid) => !wanted.has(uid));
      if (others) return "left-flagged";
      // messageDelete stores \Deleted on the range, then EXPUNGEs. Without UIDPLUS that EXPUNGE removes every \Deleted message, so the range is only these UIDs.
      await this.client.messageDelete(uids.join(","), { uid: true });
      return "expunged";
    } finally {
      lock.release();
    }
  }

  async logout(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

function hasCap(client: ImapFlow, name: string): boolean {
  const want = name.toUpperCase();
  for (const key of client.capabilities.keys()) {
    if (key.toUpperCase() === want) return true;
  }
  return false;
}

function toFlow(query: SearchQuery): SearchObject {
  const out: SearchObject = {};
  if (query.all) out.all = true;
  if (query.since) out.since = query.since;
  if (query.before) out.before = query.before;
  if (query.from) out.from = query.from;
  if (query.to) out.to = query.to;
  if (query.cc) out.cc = query.cc;
  if (query.subject) out.subject = query.subject;
  if (query.text) out.text = query.text;
  if (query.header) out.header = { [query.header.name]: query.header.value };
  if (query.seen !== undefined) out.seen = query.seen;
  if (query.flagged !== undefined) out.flagged = query.flagged;
  if (query.deleted !== undefined) out.deleted = query.deleted;
  if (query.uid) out.uid = query.uid;
  if (query.not) out.not = toFlow(query.not);
  if (query.or && query.or.length >= 2) out.or = query.or.map((part) => toFlow(part));
  return out;
}

function dateOf(row: FetchMessageObject): string {
  const value = row.internalDate;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

interface ImapAtom {
  type: string;
  value: string;
}

interface SortUntagged {
  numbers?: unknown[];
  attributes?: Array<{ value?: string }>;
}

interface SortResponse {
  next?: () => void;
}

function atom(value: string): ImapAtom {
  return { type: "ATOM", value };
}

function textAtom(value: string): ImapAtom {
  return { type: /[\s"()]/.test(value) ? "STRING" : "ATOM", value };
}

function sortable(client: ImapFlow): {
  exec: (command: string, attributes: unknown[], options: { untagged: Record<string, (untagged: SortUntagged) => Promise<void>> }) => Promise<SortResponse>;
} {
  return client as unknown as {
    exec: (command: string, attributes: unknown[], options: { untagged: Record<string, (untagged: SortUntagged) => Promise<void>> }) => Promise<SortResponse>;
  };
}

/** RFC 5256 criteria. `and` / `or` / `not` return null so the caller uses INTERNALDATE. */
function sortCriteria(query: SearchQuery): ImapAtom[] | null {
  if (query.and || query.or || query.not) return null;
  const atoms: ImapAtom[] = [];
  let saw = false;
  const mark = (name: string, value?: string): void => {
    atoms.push(atom(name));
    if (value !== undefined) atoms.push(textAtom(value));
    saw = true;
  };
  if (query.all) mark("ALL");
  if (query.since) mark("SINCE", imapDate(query.since));
  if (query.before) mark("BEFORE", imapDate(query.before));
  if (query.from) mark("FROM", query.from);
  if (query.to) mark("TO", query.to);
  if (query.cc) mark("CC", query.cc);
  if (query.subject) mark("SUBJECT", query.subject);
  if (query.text) mark("TEXT", query.text);
  if (query.header) {
    atoms.push(atom("HEADER"), textAtom(query.header.name), textAtom(query.header.value));
    saw = true;
  }
  if (query.seen === true) mark("SEEN");
  if (query.seen === false) mark("UNSEEN");
  if (query.flagged === true) mark("FLAGGED");
  if (query.flagged === false) mark("UNFLAGGED");
  if (query.deleted === true) mark("DELETED");
  if (query.uid) mark("UID", query.uid);
  if (!saw) atoms.push(atom("ALL"));
  if (query.deleted !== true) atoms.push(atom("NOT"), atom("DELETED"));
  return atoms;
}

function imapDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = match ? months[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new Error("bad imap date");
  return `${match[3]}-${month}-${match[1]}`;
}

function collectNumbers(out: number[], untagged: SortUntagged): void {
  const numbers = untagged.numbers;
  if (numbers) {
    for (const value of numbers) pushUid(out, value);
    return;
  }
  for (const attribute of untagged.attributes ?? []) pushUid(out, attribute.value);
}

function pushUid(out: number[], value: unknown): void {
  const uid = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(uid) && uid > 0) out.push(uid);
}

function envelopeOf(row: NonNullable<FetchMessageObject["envelope"]>): ImapEnvelope {
  let date: string | null = null;
  if (row.date instanceof Date && !Number.isNaN(row.date.getTime())) date = row.date.toISOString();
  else if (typeof row.date === "string" && row.date) {
    const parsed = new Date(row.date);
    if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString();
  }
  return {
    date,
    subject: row.subject ?? "",
    messageId: row.messageId ?? "",
    inReplyTo: row.inReplyTo ?? "",
    from: addressesOf(row.from),
    to: addressesOf(row.to),
    cc: addressesOf(row.cc),
    bcc: addressesOf(row.bcc),
    replyTo: addressesOf(row.replyTo),
  };
}

function addressesOf(list: Array<{ name?: string; address?: string }> | undefined): ImapAddress[] {
  const out: ImapAddress[] = [];
  for (const item of list ?? []) {
    if (!item.address) continue;
    out.push({ name: item.name ?? "", address: item.address });
  }
  return out;
}

function headerFields(value: FetchMessageObject["headers"]): ImapHeaderFields {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : "";
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const fields = new Map<string, string>();
  for (const line of unfolded.split("\n")) {
    const split = line.indexOf(":");
    if (split <= 0) continue;
    const name = line.slice(0, split).trim().toLowerCase();
    if (!fields.has(name)) fields.set(name, line.slice(split + 1).trim());
  }
  return {
    messageId: fields.get("message-id") ?? "",
    inReplyTo: fields.get("in-reply-to") ?? "",
    references: fields.get("references") ?? "",
    listId: fields.get("list-id") ?? "",
    draftId: fields.get("x-cbm-draft-id") ?? "",
  };
}

function partBytes(parts: FetchMessageObject["bodyParts"], key: string): Buffer | null {
  if (!parts) return null;
  if (parts instanceof Map) {
    const value = parts.get(key);
    return value ? Buffer.from(value) : null;
  }
  return null;
}

function previewText(bytes: Buffer | null): string {
  if (!bytes || bytes.length === 0) return "";
  return bytes.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 400);
}

function walkStructure(node: MessageStructureObject | undefined, out: ImapAttachment[]): void {
  if (!node) return;
  const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
  const disposition = (node.disposition ?? "").toLowerCase();
  if (filename && disposition !== "inline") {
    out.push({ filename, mimeType: node.type || "application/octet-stream", cid: node.id || "" });
  }
  for (const child of node.childNodes ?? []) walkStructure(child, out);
}
