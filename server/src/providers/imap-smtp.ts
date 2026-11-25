import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

/** SMTP target. `host` is the pinned address. `servername` is the name on the certificate. */
export interface SmtpTarget {
  host: string;
  servername: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  password: string;
  timeoutMs: number;
  caPem?: string;
}

export interface SmtpEnvelope {
  from: string;
  to: string[];
}

function transport(target: SmtpTarget) {
  const tls: SMTPTransport.Options["tls"] = {
    rejectUnauthorized: true,
    servername: target.servername,
  };
  if (target.caPem) tls.ca = target.caPem;
  // `pool` is not on SMTPTransport.Options (`pool: true` selects the pool transport).
  // The value stays false at runtime so Nodemailer opens one connection and does not retry.
  const options: SMTPTransport.Options = {
    host: target.host,
    port: target.port,
    secure: target.secure,
    requireTLS: target.requireTLS,
    auth: { user: target.user, pass: target.password },
    logger: false,
    debug: false,
    connectionTimeout: target.timeoutMs,
    greetingTimeout: target.timeoutMs,
    socketTimeout: target.timeoutMs,
    tls,
  };
  return createTransport({ ...options, pool: false } as SMTPTransport.Options);
}

/** EHLO, AUTH, QUIT. Nodemailer verify does not send MAIL FROM. */
export async function verifySmtp(target: SmtpTarget): Promise<void> {
  const client = transport(target);
  try {
    await client.verify();
  } finally {
    client.close();
  }
}

/** One SMTP transaction. The caller does not call this again after a failure. */
export async function sendSmtp(target: SmtpTarget, raw: Buffer, envelope: SmtpEnvelope): Promise<void> {
  const client = transport(target);
  try {
    // Nodemailer 10 types the envelope as MimeNodeEnvelopeInput, which has a
    // string index signature. A fresh object satisfies that; the fields are the same.
    await client.sendMail({ raw, envelope: { from: envelope.from, to: envelope.to } });
  } finally {
    client.close();
  }
}
