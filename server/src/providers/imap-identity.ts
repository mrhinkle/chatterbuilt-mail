import { createHash } from "node:crypto";
import type { ParsedMail } from "mailparser";
import type { Attachment, MailMessage } from "./types.js";
import { headerText, parsedAttachments, referencesText } from "./mime.js";

export function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

export function firstReference(references: string): string {
  const match = /<[^>]+>|[^\s<>]+/.exec(references.trim());
  return match ? normalizeMessageId(match[0]) : "";
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

export function fallbackIdentity(date: string, from: string, subject: string, size: number): string {
  return [date, from, subject, String(size)].join("\n");
}

/** base64url of the normalized Message-ID. The local id is this, with a one-letter prefix. */
function encodeRfc(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeRfc(payload: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const text = Buffer.from(payload, "base64url").toString("utf8");
  if (!text || text.includes("\u0000") || encodeRfc(text) !== payload) return null;
  return text;
}

/**
 * Reversible message id: `m` plus base64url of the normalized Message-ID.
 * No Message-ID: `h` plus a hash, so a later read can tell it is not reversible.
 * The same Message-ID in two folders is one message, and a move does not change it.
 */
export function imapMessageId(accountId: string, header: string | null | undefined, fallback: string): string {
  const normalized = header ? normalizeMessageId(header) : "";
  if (normalized) return `m${encodeRfc(normalized)}`;
  return `h${digest(["fb", accountId, fallback])}`;
}

/**
 * Reversible thread id: `t` plus base64url of the root Message-ID.
 * Root is the first References id, else In-Reply-To, else this message's own id.
 * No Message-ID anywhere: `k` plus a hash. Subject is not a key.
 */
export function imapThreadId(accountId: string, references: string, inReplyTo: string, ownHeader: string | null | undefined, fallback: string): string {
  const own = ownHeader ? normalizeMessageId(ownHeader) : "";
  const root = firstReference(references) || normalizeMessageId(inReplyTo) || own;
  if (root) return `t${encodeRfc(root)}`;
  return `k${digest(["thr", accountId, fallback])}`;
}

/** The RFC 5322 id inside a reversible message id, or null when the id is a hash or unknown. */
export function rfcFromMessageId(localId: string): string | null {
  if (!localId.startsWith("m")) return null;
  return decodeRfc(localId.slice(1));
}

/** The root Message-ID inside a reversible thread id, or null when the id is a hash or unknown. */
export function rfcFromThreadId(localId: string): string | null {
  if (!localId.startsWith("t")) return null;
  return decodeRfc(localId.slice(1));
}

export function isHashMessageId(localId: string): boolean {
  return /^h[0-9a-f]{32}$/.test(localId);
}

export function isHashThreadId(localId: string): boolean {
  return /^k[0-9a-f]{32}$/.test(localId);
}

export interface RfcLookup {
  kind: "message" | "thread";
  rfc: string;
}

/** Message-ID recovered from the local id. A message id wins over a thread id. */
export function rfcLookup(wanted: { messageId?: string; threadId?: string }): RfcLookup | null {
  if (wanted.messageId) {
    const rfc = rfcFromMessageId(wanted.messageId);
    return rfc ? { kind: "message", rfc } : null;
  }
  if (wanted.threadId) {
    const rfc = rfcFromThreadId(wanted.threadId);
    return rfc ? { kind: "thread", rfc } : null;
  }
  return null;
}

/** True only for a hash id. Those are the reads that still walk. */
export function needsHashWalk(wanted: { messageId?: string; threadId?: string }): boolean {
  if (wanted.messageId) return isHashMessageId(wanted.messageId);
  if (wanted.threadId) return isHashThreadId(wanted.threadId);
  return false;
}

export interface Interpreted {
  message: MailMessage;
  messageIdHeader: string;
  draftKey: string | null;
}

export function interpretParsed(
  accountId: string,
  parsed: ParsedMail,
  raw: Buffer,
  labelIds: string[],
  internalDate: string,
): Interpreted {
  const from = parsed.from?.text ?? "";
  const subject = parsed.subject ?? "";
  const date = parsed.date ? parsed.date.toISOString() : internalDate;
  const identityFrom = addressTexts(parsed.from).join(", ");
  const fallback = fallbackIdentity(date, identityFrom, subject, raw.length);
  const own = parsed.messageId ?? "";
  const references = referencesText(parsed.references);
  const inReplyTo = headerText(parsed.inReplyTo);
  const id = imapMessageId(accountId, own, fallback);
  const threadId = imapThreadId(accountId, references, inReplyTo, own, fallback);
  const text = typeof parsed.text === "string" ? parsed.text : null;
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const snippet = (text || subject || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const draftHeader = parsed.headers.get("x-cbm-draft-id");
  const draftKey = typeof draftHeader === "string" && draftHeader.trim() ? draftHeader.trim() : null;
  const message: MailMessage = {
    id,
    threadId,
    position: 0,
    sender: from,
    toRecipients: addressTexts(parsed.to),
    ccRecipients: addressTexts(parsed.cc),
    bccRecipients: addressTexts(parsed.bcc),
    replyTo: addressTexts(parsed.replyTo),
    inReplyTo,
    references,
    subject,
    date,
    labelIds,
    snippet,
    plaintextBody: text,
    htmlBody: html,
    attachments: parsedAttachments(parsed),
    raw: raw.toString("base64url"),
    viewUrl: "",
    bodyFetched: true,
  };
  return { message, messageIdHeader: own ? normalizeMessageId(own) : "", draftKey };
}

function addressTexts(value: ParsedMail["to"]): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    for (const entry of item.value) {
      if (!entry.address) continue;
      out.push(entry.name ? `${entry.name} <${entry.address}>` : entry.address);
    }
  }
  return out;
}

export function attachmentNames(items: Attachment[]): string[] {
  return items.map((item) => item.filename);
}
