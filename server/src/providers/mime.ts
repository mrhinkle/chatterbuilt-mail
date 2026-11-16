import { simpleParser, type ParsedMail } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { Attachment } from "./types.js";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
  cid?: string;
}

export interface MimeDraft {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  /** Angle-bracket message id. MailComposer sends these bytes and does not invent another. */
  messageId?: string;
  headers?: Record<string, string>;
  attachments?: MimeAttachment[];
}

export interface MimeBuildOptions {
  /**
   * Keep the Bcc header in the bytes. MailComposer drops it unless this is set
   * on the compiled message. SMTP DATA leaves it off. Gmail raw and saved copies turn it on.
   */
  keepBcc?: boolean;
  /** Both copies of one send pass the same Date so the wire and the saved copy match. */
  date?: Date;
}

/** nodemailer MailComposer builds the RFC 5322 message. It does not send and it does not retry. */
export async function buildMime(input: MimeDraft, options?: MimeBuildOptions): Promise<{ raw: string; rfc822: Buffer }> {
  const composer = new MailComposer({
    from: input.from,
    to: input.to.length > 0 ? input.to : undefined,
    cc: input.cc.length > 0 ? input.cc : undefined,
    bcc: input.bcc.length > 0 ? input.bcc : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references || undefined,
    messageId: input.messageId || undefined,
    date: options?.date,
    headers: input.headers,
    attachments: (input.attachments ?? []).map((item) => ({
      filename: item.filename,
      contentType: item.mimeType,
      content: item.content,
      cid: item.cid || undefined,
    })),
  });
  const message = composer.compile();
  message.keepBcc = options?.keepBcc === true;
  const rfc822 = await message.build();
  return { raw: rfc822.toString("base64url"), rfc822 };
}

/** mailparser reads a message. Callers pass bytes from Gmail or from MailComposer. */
export async function parseMime(rfc822: Buffer | string): Promise<ParsedMail> {
  return simpleParser(rfc822);
}

export function referencesText(value: ParsedMail["references"]): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(" ") : value;
}

export function headerText(value: ParsedMail["inReplyTo"]): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(" ") : value;
}

export function parsedAttachments(parsed: ParsedMail): Attachment[] {
  return parsed.attachments.map((item, index) => ({
    id: item.contentId || `att${index}`,
    filename: item.filename || "attachment",
    mimeType: item.contentType || "application/octet-stream",
    cid: item.cid || item.contentId || "",
  }));
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
