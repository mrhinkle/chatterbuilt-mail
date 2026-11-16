import { simpleParser, type ParsedMail } from "mailparser";
import { headerText, referencesText } from "./mime.js";
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
  SearchQuery,
} from "./imap-session.js";
import { ImapNoMove } from "./imap-session.js";

interface MemMessage {
  uid: number;
  flags: Set<string>;
  internalDate: string;
  raw: Buffer;
  modseq: bigint;
}

interface MemFolder {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  noSelect: boolean;
  uidValidity: number;
  uidNext: number;
  highestModseq: bigint;
  messages: Map<number, MemMessage>;
}

export interface MemoryFlavor {
  move: boolean;
  uidplus: boolean;
  condstore: boolean;
  qresync: boolean;
  specialUse: boolean;
  prefix: string;
  delimiter: string;
  folders: Array<{ name: string; specialUse?: string }>;
}

export const FLAVORS: Record<"full" | "minimal" | "dotted" | "icloud" | "yahoo" | "outlook", MemoryFlavor> = {
  full: {
    move: true, uidplus: true, condstore: true, qresync: true, specialUse: true, prefix: "", delimiter: "/",
    folders: [
      { name: "Drafts", specialUse: "\\Drafts" },
      { name: "Sent", specialUse: "\\Sent" },
      { name: "Trash", specialUse: "\\Trash" },
      { name: "Junk", specialUse: "\\Junk" },
      { name: "Archive", specialUse: "\\Archive" },
    ],
  },
  minimal: {
    move: false, uidplus: false, condstore: false, qresync: false, specialUse: false, prefix: "", delimiter: "/",
    folders: [
      { name: "Drafts" },
      { name: "Sent Messages" },
      { name: "Deleted Messages" },
      { name: "Junk" },
    ],
  },
  dotted: {
    move: false, uidplus: true, condstore: false, qresync: false, specialUse: false, prefix: "INBOX.", delimiter: ".",
    folders: [
      { name: "Drafts" },
      { name: "Sent" },
      { name: "Trash" },
      { name: "Spam" },
    ],
  },
  icloud: {
    move: true, uidplus: true, condstore: true, qresync: false, specialUse: false, prefix: "", delimiter: "/",
    folders: [
      { name: "Drafts" },
      { name: "Sent Messages" },
      { name: "Deleted Messages" },
      { name: "Junk" },
      { name: "Archive" },
    ],
  },
  yahoo: {
    move: true, uidplus: true, condstore: false, qresync: false, specialUse: false, prefix: "", delimiter: "/",
    folders: [
      { name: "Draft" },
      { name: "Sent" },
      { name: "Trash" },
      { name: "Bulk Mail" },
      { name: "Archive" },
    ],
  },
  outlook: {
    move: true, uidplus: true, condstore: true, qresync: false, specialUse: false, prefix: "", delimiter: "/",
    folders: [
      { name: "Drafts" },
      { name: "Sent Items" },
      { name: "Deleted Items" },
      { name: "Junk E-mail" },
      { name: "Archive" },
    ],
  },
};

/**
 * In-process mailbox with the same folder, UID, flag, and capability rules the provider uses.
 * A second client (appendExternal and the other *External methods) does not count as a provider write.
 */
export class MemoryMailbox {
  readonly caps: ImapCaps;
  readonly namespace: ImapNamespace;
  writeAttempts = 0;
  /** Bytes and rows a FETCH returned. Full source is counted only when the caller asked for it. */
  readonly fetchStats = { bytes: 0, items: 0, sourceMessages: 0, headerMessages: 0 };
  failWrite: Error | null = null;
  failRead: Error | null = null;
  /** How many more reads throw `failRead`. A write never consumes this. */
  readFaultsLeft = 0;
  /** Next writes. `null` lets that write through. Empties before `failWrite`. */
  writeQueue: Array<Error | null> = [];
  private readonly folders = new Map<string, MemFolder>();
  private modseq = 1n;

  constructor(flavor: MemoryFlavor) {
    this.caps = {
      move: flavor.move,
      uidplus: flavor.uidplus,
      condstore: flavor.condstore,
      qresync: flavor.qresync,
      specialUse: flavor.specialUse,
      sort: false,
    };
    this.namespace = { prefix: flavor.prefix, delimiter: flavor.delimiter };
    this.addFolder("INBOX", "INBOX", null);
    for (const folder of flavor.folders) {
      const path = `${flavor.prefix}${folder.name}`;
      this.addFolder(path, folder.name, flavor.specialUse ? folder.specialUse ?? null : null);
    }
  }

  open(): MemorySession {
    return new MemorySession(this);
  }

  failNextWrite(error: Error = new Error("write failed")): void {
    this.failWrite = error;
  }

  failNextRead(error: Error = new Error("connection reset")): void {
    this.failRead = error;
    this.readFaultsLeft = 1;
  }

  failReads(count: number, error: Error = new Error("connection reset")): void {
    this.failRead = error;
    this.readFaultsLeft = count;
  }

  queueWrites(faults: Array<Error | null>): void {
    this.writeQueue = faults.slice();
  }

  appendExternal(path: string, raw: Buffer, flags: string[] = [], internalDate?: string): number {
    return this.appendInto(this.folder(path), raw, flags, internalDate);
  }

  setFlagsExternal(path: string, uid: number, flags: string[]): void {
    const message = this.folder(path).messages.get(uid);
    if (!message) return;
    message.flags = new Set(flags);
    this.bump(this.folder(path), message);
  }

  deleteExternal(path: string, uid: number): void {
    const folder = this.folder(path);
    const message = folder.messages.get(uid);
    if (!message) return;
    folder.messages.delete(uid);
    this.bump(folder);
    rememberGone(folder, uid, this.modseq);
  }

  recreateFolder(path: string): void {
    const folder = this.folder(path);
    folder.uidValidity += 1;
    folder.uidNext = 1;
    folder.messages.clear();
    this.bump(folder);
  }

  private addFolder(path: string, name: string, specialUse: string | null): MemFolder {
    const existing = this.folders.get(path);
    if (existing) return existing;
    const folder: MemFolder = {
      path,
      name,
      delimiter: this.namespace.delimiter,
      specialUse,
      noSelect: false,
      uidValidity: 1,
      uidNext: 1,
      highestModseq: this.modseq,
      messages: new Map(),
    };
    this.folders.set(path, folder);
    return folder;
  }

  list(): ImapListed[] {
    return [...this.folders.values()].map((folder) => ({
      path: folder.path,
      name: folder.name,
      delimiter: folder.delimiter,
      specialUse: this.caps.specialUse ? folder.specialUse : null,
      flags: folder.noSelect ? ["\\Noselect"] : [],
      noSelect: folder.noSelect,
    }));
  }

  status(path: string): ImapStatus {
    const folder = this.folder(path);
    return {
      uidValidity: String(folder.uidValidity),
      uidNext: folder.uidNext,
      highestModseq: this.caps.condstore ? String(folder.highestModseq) : null,
      exists: [...folder.messages.values()].filter((message) => !message.flags.has("\\Deleted")).length,
    };
  }

  create(path: string): void {
    const prefix = this.namespace.prefix;
    const rest = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const names = rest.split(this.namespace.delimiter).filter(Boolean);
    let walking = "";
    for (const name of names) {
      walking = walking === ""
        ? `${prefix}${name}`
        : `${walking}${this.namespace.delimiter}${name}`;
      if (!this.folders.has(walking)) this.addFolder(walking, name, null);
    }
  }

  search(path: string, query: SearchQuery): number[] {
    const folder = this.folder(path);
    const hits: number[] = [];
    for (const message of folder.messages.values()) {
      if (query.deleted !== true && message.flags.has("\\Deleted")) continue;
      if (matches(message, query)) hits.push(message.uid);
    }
    return hits.sort((a, b) => a - b);
  }

  fetch(path: string, uids: number[], what: FetchWhat, changedSince?: string | null): ImapFetched[] {
    if (uids.length === 0) return [];
    const folder = this.folder(path);
    const since = changedSince ? BigInt(changedSince) : null;
    const wanted = new Set(uids);
    const out: ImapFetched[] = [];
    for (const message of folder.messages.values()) {
      if (!wanted.has(message.uid)) continue;
      if (message.flags.has("\\Deleted") && !what.flags) continue;
      if (since !== null && message.modseq <= since) continue;
      const row: ImapFetched = {
        uid: message.uid,
        flags: what.datesOnly && !what.flags ? [] : [...message.flags],
        internalDate: message.internalDate,
        size: message.raw.length,
        modseq: this.caps.condstore ? String(message.modseq) : null,
      };
      if (what.source) row.source = Buffer.from(message.raw);
      this.noteFetch(what, message.raw.length);
      out.push(row);
    }
    return out.sort((a, b) => a.uid - b.uid);
  }

  /** The stored bytes. This does not count as a FETCH. */
  rawOf(path: string, uid: number): Buffer | null {
    const message = this.folder(path).messages.get(uid);
    return message ? Buffer.from(message.raw) : null;
  }

  /** Every message with MODSEQ above `modseq`. Flags only; an empty UID list on `fetch` stays empty. */
  fetchChangedSince(path: string, modseq: string): ImapFetched[] {
    const uids = [...this.folder(path).messages.keys()];
    return this.fetch(path, uids, { flags: true }, modseq);
  }

  async decorate(row: ImapFetched, raw: Buffer, what: FetchWhat): Promise<void> {
    if (!what.structure && !what.envelope && !what.headers && !what.preview) return;
    const parsed = await simpleParser(raw);
    if (what.structure) {
      const attachments = structureOf(parsed);
      row.attachments = attachments;
      row.mixed = attachments.length > 0 || String(parsed.headers.get("content-type") ?? "").toLowerCase().includes("multipart/mixed");
    }
    if (what.envelope) row.envelope = envelopeOf(parsed, row.internalDate);
    if (what.headers) row.headers = headerFields(parsed);
    if (what.preview) row.preview = bodyPreview(raw, typeof parsed.text === "string" ? parsed.text : "");
  }

  vanished(path: string, modseq: string, uidValidity: string): number[] | null {
    if (!this.caps.qresync) return null;
    const folder = this.folder(path);
    if (String(folder.uidValidity) !== uidValidity) {
      return [...folder.messages.values()].map((message) => message.uid);
    }
    const since = BigInt(modseq);
    const gone: number[] = [];
    for (const message of folder.messages.values()) {
      if (message.flags.has("\\Deleted") && message.modseq > since) gone.push(message.uid);
    }
    for (const uid of folderGone(folder, since)) gone.push(uid);
    return gone;
  }

  append(path: string, raw: Buffer, flags: string[]): { uid: number; uidValidity: string } {
    const folder = this.folder(path);
    const uid = this.appendInto(folder, raw, flags);
    return { uid, uidValidity: String(folder.uidValidity) };
  }

  copy(path: string, uids: number[], dest: string): Map<number, number> {
    const source = this.folder(path);
    const target = this.folder(dest);
    const map = new Map<number, number>();
    for (const uid of uids) {
      const message = source.messages.get(uid);
      if (!message || message.flags.has("\\Deleted")) continue;
      const next = this.appendInto(target, message.raw, [...message.flags], message.internalDate);
      map.set(uid, next);
    }
    return map;
  }

  move(path: string, uids: number[], dest: string): Map<number, number> {
    const map = this.copy(path, uids, dest);
    const source = this.folder(path);
    for (const uid of map.keys()) source.messages.delete(uid);
    this.bump(source);
    return map;
  }

  storeFlags(path: string, uids: number[], add: string[], remove: string[]): void {
    const folder = this.folder(path);
    const drop = new Set(remove.map((flag) => flag.toLowerCase()));
    for (const uid of uids) {
      const message = folder.messages.get(uid);
      if (!message) continue;
      for (const flag of [...message.flags]) {
        if (drop.has(flag.toLowerCase())) message.flags.delete(flag);
      }
      for (const flag of add) message.flags.add(flag);
      this.bump(folder, message);
    }
  }

  markDeleted(path: string, uids: number[]): void {
    this.storeFlags(path, uids, ["\\Deleted"], []);
  }

  expunge(path: string, uids: number[]): "expunged" | "left-flagged" {
    const folder = this.folder(path);
    const wanted = new Set(uids);
    if (!this.caps.uidplus) {
      for (const message of folder.messages.values()) {
        if (message.flags.has("\\Deleted") && !wanted.has(message.uid)) return "left-flagged";
      }
    }
    for (const uid of uids) {
      const message = folder.messages.get(uid);
      if (message?.flags.has("\\Deleted")) {
        folder.messages.delete(uid);
        rememberGone(folder, uid, this.modseq);
      }
    }
    this.bump(folder);
    return "expunged";
  }

  private folder(path: string): MemFolder {
    const found = this.folders.get(path);
    if (!found) throw new Error(`mailbox ${path} does not exist`);
    return found;
  }

  private appendInto(folder: MemFolder, raw: Buffer, flags: string[], internalDate?: string): number {
    const uid = folder.uidNext;
    folder.uidNext += 1;
    const message: MemMessage = {
      uid,
      flags: new Set(flags),
      internalDate: internalDate || dateOf(raw) || new Date().toISOString(),
      raw: Buffer.from(raw),
      modseq: 0n,
    };
    folder.messages.set(uid, message);
    this.bump(folder, message);
    return uid;
  }

  private noteFetch(what: FetchWhat, rawBytes: number): void {
    this.fetchStats.items += 1;
    if (what.source) {
      this.fetchStats.bytes += rawBytes;
      this.fetchStats.sourceMessages += 1;
      return;
    }
    if (what.headers || what.envelope) this.fetchStats.headerMessages += 1;
    let bytes = 48 + 24;
    if (what.flags) bytes += 16;
    if (what.envelope) bytes += 180;
    if (what.headers) bytes += 220;
    if (what.structure) bytes += 80;
    if (what.preview) bytes += 400;
    this.fetchStats.bytes += bytes;
  }

  private bump(folder: MemFolder, message?: MemMessage): void {
    this.modseq += 1n;
    folder.highestModseq = this.modseq;
    if (message) message.modseq = this.modseq;
  }
}

const goneUids = new WeakMap<MemFolder, Array<{ uid: number; modseq: bigint }>>();

function rememberGone(folder: MemFolder, uid: number, modseq: bigint): void {
  const list = goneUids.get(folder) ?? [];
  list.push({ uid, modseq });
  goneUids.set(folder, list);
}

function folderGone(folder: MemFolder, since: bigint): number[] {
  return (goneUids.get(folder) ?? []).filter((item) => item.modseq > since).map((item) => item.uid);
}

function dateOf(raw: Buffer): string | null {
  const match = /(?:^|\n)Date:\s*([^\r\n]+)/i.exec(raw.toString("utf8"));
  if (!match?.[1]) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function matches(message: MemMessage, query: SearchQuery): boolean {
  if (query.and) return query.and.every((part) => matches(message, part));
  if (query.or) return query.or.some((part) => matches(message, part));
  if (query.not) return !matches(message, query.not);
  if (query.all) return true;
  const text = message.raw.toString("utf8");
  if (query.since && message.internalDate.slice(0, 10) < query.since) return false;
  if (query.before && message.internalDate.slice(0, 10) >= query.before) return false;
  if (query.from && !headerIncludes(text, "from", query.from)) return false;
  if (query.to && !headerIncludes(text, "to", query.to)) return false;
  if (query.cc && !headerIncludes(text, "cc", query.cc)) return false;
  if (query.subject && !headerIncludes(text, "subject", query.subject)) return false;
  if (query.text && !text.toLowerCase().includes(query.text.toLowerCase())) return false;
  if (query.header && !headerIncludes(text, query.header.name, query.header.value)) return false;
  if (query.seen === true && !message.flags.has("\\Seen")) return false;
  if (query.seen === false && message.flags.has("\\Seen")) return false;
  if (query.flagged === true && !message.flags.has("\\Flagged")) return false;
  if (query.flagged === false && message.flags.has("\\Flagged")) return false;
  if (query.deleted === true && !message.flags.has("\\Deleted")) return false;
  if (query.deleted === false && message.flags.has("\\Deleted")) return false;
  if (query.uid && !uidIn(message.uid, query.uid)) return false;
  const keys = Object.keys(query).filter((key) => query[key as keyof SearchQuery] !== undefined);
  if (keys.length === 0) return true;
  return true;
}

function headerIncludes(raw: string, name: string, value: string): boolean {
  const match = new RegExp(`(?:^|\\n)${name}:\\s*([^\\n]+)`, "i").exec(raw);
  return Boolean(match?.[1]?.toLowerCase().includes(value.toLowerCase()));
}

function structureOf(parsed: ParsedMail): ImapAttachment[] {
  const out: ImapAttachment[] = [];
  for (const item of parsed.attachments) {
    const disposition = (item.contentDisposition || "").toLowerCase();
    const filename = item.filename || "";
    if (!filename || disposition === "inline") continue;
    out.push({
      filename,
      mimeType: item.contentType || "application/octet-stream",
      cid: item.cid || item.contentId || "",
    });
  }
  return out;
}

function envelopeOf(parsed: ParsedMail, internalDate: string): ImapEnvelope {
  return {
    date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : internalDate,
    subject: parsed.subject ?? "",
    messageId: parsed.messageId ?? "",
    inReplyTo: headerText(parsed.inReplyTo),
    from: addressesOf(parsed.from),
    to: addressesOf(parsed.to),
    cc: addressesOf(parsed.cc),
    bcc: addressesOf(parsed.bcc),
    replyTo: addressesOf(parsed.replyTo),
  };
}

function addressesOf(value: ParsedMail["to"]): ImapAddress[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: ImapAddress[] = [];
  for (const item of list) {
    for (const entry of item.value) {
      if (!entry.address) continue;
      out.push({ name: entry.name ?? "", address: entry.address });
    }
  }
  return out;
}

function headerFields(parsed: ParsedMail): ImapHeaderFields {
  const draft = parsed.headers.get("x-cbm-draft-id");
  const listId = parsed.headers.get("list-id");
  return {
    messageId: parsed.messageId ?? "",
    inReplyTo: headerText(parsed.inReplyTo),
    references: referencesText(parsed.references),
    listId: typeof listId === "string" ? listId : "",
    draftId: typeof draft === "string" ? draft : "",
  };
}

function bodyPreview(raw: Buffer, text: string): string {
  const source = text.trim() ? text : rawBody(raw);
  return source.replace(/\s+/g, " ").trim().slice(0, 400);
}

function rawBody(raw: Buffer): string {
  const text = raw.toString("utf8");
  const split = text.search(/\r?\n\r?\n/);
  if (split < 0) return text;
  return text.slice(split).replace(/^(\r?\n)+/, "");
}

function uidIn(uid: number, range: string): boolean {
  if (range.endsWith(":*")) {
    const start = Number(range.slice(0, -2));
    return uid >= start;
  }
  return range.split(",").some((part) => Number(part) === uid);
}

export class MemorySession implements ImapSession {
  readonly caps: ImapCaps;
  constructor(private readonly box: MemoryMailbox) {
    this.caps = box.caps;
  }

  get writeAttempts(): number {
    return this.box.writeAttempts;
  }

  async list(): Promise<ImapListed[]> {
    await this.read();
    return this.box.list();
  }

  async namespace(): Promise<ImapNamespace> {
    await this.read();
    return this.box.namespace;
  }

  async status(path: string): Promise<ImapStatus> {
    await this.read();
    return this.box.status(path);
  }

  async search(path: string, query: SearchQuery): Promise<number[]> {
    await this.read();
    return this.box.search(path, query);
  }

  async sortByDate(_path: string, _query: SearchQuery): Promise<number[] | null> {
    return null;
  }

  async fetch(path: string, uids: number[], what: FetchWhat, changedSince?: string | null): Promise<ImapFetched[]> {
    await this.read();
    const rows = this.box.fetch(path, uids, what, changedSince);
    if (what.structure || what.envelope || what.headers || what.preview) {
      for (const row of rows) {
        const raw = this.box.rawOf(path, row.uid);
        if (raw) await this.box.decorate(row, raw, what);
      }
    }
    return rows;
  }

  async fetchChangedSince(path: string, modseq: string): Promise<ImapFetched[]> {
    await this.read();
    return this.box.fetchChangedSince(path, modseq);
  }

  async vanished(path: string, modseq: string, uidValidity: string): Promise<number[] | null> {
    await this.read();
    return this.box.vanished(path, modseq, uidValidity);
  }

  async append(path: string, raw: Buffer, flags: string[]): Promise<{ uid: number; uidValidity: string }> {
    return this.write(() => this.box.append(path, raw, flags));
  }

  async createMailbox(path: string): Promise<void> {
    await this.write(() => this.box.create(path));
  }

  async copy(path: string, uids: number[], dest: string): Promise<Map<number, number>> {
    return this.write(() => this.box.copy(path, uids, dest));
  }

  async move(path: string, uids: number[], dest: string): Promise<Map<number, number>> {
    if (!this.caps.move) throw new ImapNoMove();
    return this.write(() => this.box.move(path, uids, dest));
  }

  async storeFlags(path: string, uids: number[], add: string[], remove: string[]): Promise<void> {
    await this.write(() => this.box.storeFlags(path, uids, add, remove));
  }

  async markDeleted(path: string, uids: number[]): Promise<void> {
    await this.write(() => this.box.markDeleted(path, uids));
  }

  async expunge(path: string, uids: number[]): Promise<"expunged" | "left-flagged"> {
    return this.write(() => this.box.expunge(path, uids));
  }

  async logout(): Promise<void> {}

  private async read(): Promise<void> {
    if (this.box.readFaultsLeft <= 0 || !this.box.failRead) return;
    this.box.readFaultsLeft -= 1;
    const error = this.box.failRead;
    if (this.box.readFaultsLeft === 0) this.box.failRead = null;
    throw error;
  }

  private async write<T>(fn: () => T): Promise<T> {
    this.box.writeAttempts += 1;
    if (this.box.writeQueue.length > 0) {
      const fault = this.box.writeQueue.shift() ?? null;
      if (fault) throw fault;
      return fn();
    }
    if (this.box.failWrite) {
      const error = this.box.failWrite;
      this.box.failWrite = null;
      throw error;
    }
    return fn();
  }
}
