import { resolveHost } from "./imap-ssrf.js";
import { openImapFlow } from "./imap-flow.js";
import type { ImapSession, ImapTarget } from "./imap-session.js";
import { sendSmtp, verifySmtp, type SmtpEnvelope, type SmtpTarget } from "./imap-smtp.js";

/** Test injection. Production leaves every field unset and uses ImapFlow 2.10.0 plus Nodemailer. */
export interface ImapHooks {
  open?: (target: ImapTarget) => Promise<ImapSession>;
  resolve?: (host: string) => Promise<string[]>;
  verifySmtp?: (target: SmtpTarget) => Promise<void>;
  sendRaw?: (target: SmtpTarget, raw: Buffer, envelope: SmtpEnvelope) => Promise<void>;
  /** Test-only trust anchor. Never read from a request. */
  caPem?: string;
}

export interface ResolvedHooks {
  open: (target: ImapTarget) => Promise<ImapSession>;
  resolve: (host: string) => Promise<string[]>;
  verifySmtp: (target: SmtpTarget) => Promise<void>;
  sendRaw: (target: SmtpTarget, raw: Buffer, envelope: SmtpEnvelope) => Promise<void>;
  caPem?: string;
}

export function resolveHooks(hooks: ImapHooks | undefined): ResolvedHooks {
  return {
    open: hooks?.open ?? openImapFlow,
    resolve: hooks?.resolve ?? resolveHost,
    verifySmtp: hooks?.verifySmtp ?? verifySmtp,
    sendRaw: hooks?.sendRaw ?? sendSmtp,
    caPem: hooks?.caPem,
  };
}
