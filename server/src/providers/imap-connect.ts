import { ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import type { Repo } from "../store/repo.js";
import type { ResolvedHooks } from "./imap-hooks.js";
import { ImapAuthError, type ImapTarget } from "./imap-session.js";
import { pinHost } from "./imap-ssrf.js";
import type { SmtpTarget } from "./imap-smtp.js";

const WRONG_PASSWORD = "The server said that password is wrong. iCloud, Yahoo and Fastmail need an app password, not your normal one.";

export interface ImapConnectFields {
  email: string;
  host: string;
  port: number;
  security: "tls" | "starttls";
  user: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  aliases: string[];
  /**
   * When false, the server already stores Sent, so this server does not append
   * a second copy. Omitted means true.
   */
  saveSent?: boolean;
}

/**
 * LOGIN and LIST, then SMTP EHLO, AUTH, and QUIT. The account is saved only
 * after both succeed. Neither probe sends mail.
 */
export async function connectImapAccount(input: {
  repo: Repo;
  key: Buffer;
  logger: Logger;
  allowPrivate: boolean;
  timeoutMs: number;
  hooks: ResolvedHooks;
  fields: ImapConnectFields;
  at: string;
}): Promise<string> {
  const fields = input.fields;
  if (fields.password.length >= 4) input.logger.redact(fields.password);
  const target = await imapTarget(fields, input);
  let session: Awaited<ReturnType<ResolvedHooks["open"]>>;
  try {
    session = await input.hooks.open(target);
  } catch (error) {
    throw plainError(error);
  }
  try {
    await session.list();
  } catch (error) {
    throw plainError(error);
  } finally {
    try {
      await session.logout();
    } catch {
      // A logout failure is not a failed login.
    }
  }
  const smtp = await smtpTarget(fields, input);
  try {
    await input.hooks.verifySmtp(smtp);
  } catch (error) {
    throw plainError(error);
  }
  return input.repo.connectImap({
    email: fields.email,
    host: fields.host,
    port: fields.port,
    security: fields.security,
    username: fields.user,
    password: fields.password,
    smtpHost: fields.smtpHost,
    smtpPort: fields.smtpPort,
    smtpSecurity: fields.smtpPort === 465 ? "tls" : "starttls",
    saveSent: fields.saveSent !== false,
    aliases: fields.aliases,
    key: input.key,
    at: input.at,
  });
}

async function imapTarget(fields: ImapConnectFields, input: {
  allowPrivate: boolean;
  timeoutMs: number;
  hooks: ResolvedHooks;
}): Promise<ImapTarget> {
  const host = await pinHost(fields.host, input.hooks.resolve, input.allowPrivate);
  const secure = fields.security === "tls";
  return {
    host,
    servername: fields.host,
    port: fields.port,
    secure,
    requireTLS: !secure,
    user: fields.user,
    password: fields.password,
    timeoutMs: input.timeoutMs,
    caPem: input.hooks.caPem,
  };
}

async function smtpTarget(fields: ImapConnectFields, input: {
  allowPrivate: boolean;
  timeoutMs: number;
  hooks: ResolvedHooks;
}): Promise<SmtpTarget> {
  const host = await pinHost(fields.smtpHost, input.hooks.resolve, input.allowPrivate);
  const secure = fields.smtpPort === 465;
  return {
    host,
    servername: fields.smtpHost,
    port: fields.smtpPort,
    secure,
    requireTLS: !secure,
    user: fields.user,
    password: fields.password,
    timeoutMs: input.timeoutMs,
    caPem: input.hooks.caPem,
  };
}

function plainError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof ImapAuthError) return new ToolError("tool_error", WRONG_PASSWORD);
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/auth|535|password|invalid credentials/i.test(text)) return new ToolError("tool_error", WRONG_PASSWORD);
  return new ToolError("tool_error", "The mail server did not accept that connection.");
}
