import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { resolveMx } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { pinHost, resolveHost } from "../providers/imap-ssrf.js";

/**
 * Mail settings for an address, looked up on the server.
 *
 * ISPDB is https://autoconfig.thunderbird.net/v1.1/<domain> (the domain only).
 * Mozilla, "Thunderbird Autoconfiguration", and thunderbird/autoconfig README.
 * Read 2026-11-05. The autoconfig steps before it are the two https URLs on that
 * page. This module never requests http.
 *
 * Preset servers and app-password pages, read 2026-11-05:
 * - Apple: imap.mail.me.com:993, smtp.mail.me.com:587. https://support.apple.com/en-us/102525
 *   App passwords: https://support.apple.com/en-us/102654
 * - Yahoo: imap.mail.yahoo.com:993, smtp.mail.yahoo.com:465. https://help.yahoo.com/kb/pop-imap-access-sln4075.html
 *   App passwords: https://help.yahoo.com/kb/learn-generate-third-party-passwords-sln15241.html
 * - AOL: imap.aol.com:993, smtp.aol.com:465. https://help.aol.com/articles/how-do-i-use-other-email-applications-to-send-and-receive-my-aol-mail
 *   App passwords: https://help.aol.com/articles/create-and-manage-app-password
 * - Fastmail: imap.fastmail.com:993, smtp.fastmail.com:465. https://www.fastmail.help/hc/en-us/articles/1500000279921-IMAP-POP-and-SMTP
 *   App passwords: https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords
 * - Zoho: https://www.zoho.com/mail/help/imap-access.html
 *   Personal imap.zoho.com / smtp.zoho.com:465. Paid custom domains imappro.zoho.com / smtppro.zoho.com.
 *   App passwords: https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html
 * - GMX Germany: imap.gmx.net:993, mail.gmx.net:587. https://hilfe.gmx.net/pop-imap/imap/imap-serverdaten.html
 *   App passwords: https://hilfe.gmx.net/account/logindaten/app-passwort.html
 * - GMX.com and mail.com servers: Thunderbird ISPDB v1.1 (gmx.com, mail.com), read 2026-11-05.
 *   mail.com app passwords: https://support.mail.com/security/2fa/application-specific-passwords.html
 * - Proton has no public IMAP. Bridge: https://proton.me/support/imap-smtp-and-pop3-setup
 */

const BODY_CAP = 64 * 1024;
const MAX_REDIRECTS = 3;

export const DISCOVER_MISS = "No mail server was found for that address. Type the IMAP and SMTP hosts from your mail provider's help page.";
export const GOOGLE_CARD = "This is a Google mailbox. Use Sign in with Google.";
export const MICROSOFT_CARD = "This is a Microsoft mailbox. Use Sign in with Microsoft.";
export const PROTON_STOP = "Proton Mail needs the Proton Mail Bridge app on this computer. This server cannot sign in to Proton directly.";

/** A mail-oriented public-suffix subset. Not the full public suffix list. */
const MULTI_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "or.jp",
  "com.br", "co.nz", "com.mx", "co.za", "com.tr", "co.in", "com.sg", "com.hk", "co.kr",
]);

export interface DiscoveredSettings {
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "starttls";
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
  /** True when that server already stores the sent copy. Connect then sets saveSent false. */
  serverKeepsSent: boolean;
  helpUrl: string | null;
  helpLabel: string | null;
  note: string | null;
  source: "preset" | "mx" | "autoconfig" | "ispdb" | "guess";
}

export type DiscoverOutcome =
  | { kind: "settings"; settings: DiscoveredSettings }
  | { kind: "card"; provider: "google" | "microsoft"; message: string }
  | { kind: "stop"; message: string; helpUrl: string; helpLabel: string }
  | { kind: "miss"; message: string };

export interface DiscoverFetch {
  url: string;
  /** The address pinHost chose. The socket uses this, not a later lookup. */
  address: string;
  timeoutMs: number;
}

export interface DiscoverProbe {
  host: string;
  address: string;
  port: number;
  timeoutMs: number;
}

export interface DiscoverResponse {
  status: number;
  body: string;
  location: string | null;
}

export interface DiscoverDeps {
  resolve: (host: string) => Promise<string[]>;
  /** Does not follow redirects and does not look the host up again. */
  fetch: (input: DiscoverFetch) => Promise<DiscoverResponse>;
  probe: (input: DiscoverProbe) => Promise<boolean>;
  mx: (domain: string) => Promise<string[]>;
  timeoutMs: number;
  allowPrivate: boolean;
}

interface Preset {
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "starttls";
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
  serverKeepsSent: boolean;
  helpUrl: string;
  helpLabel: string;
  note: string | null;
}

const ICLOUD: Preset = {
  provider: "icloud",
  imapHost: "imap.mail.me.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.mail.me.com",
  smtpPort: 587,
  smtpSecurity: "starttls",
  serverKeepsSent: true,
  helpUrl: "https://support.apple.com/en-us/102654",
  helpLabel: "Apple's app-specific passwords",
  note: "If sign-in fails, try the name before the @ as the username.",
};

const YAHOO: Preset = {
  provider: "yahoo",
  imapHost: "imap.mail.yahoo.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.mail.yahoo.com",
  smtpPort: 465,
  smtpSecurity: "tls",
  serverKeepsSent: true,
  helpUrl: "https://help.yahoo.com/kb/learn-generate-third-party-passwords-sln15241.html",
  helpLabel: "Yahoo's app passwords",
  note: null,
};

const AOL: Preset = {
  provider: "aol",
  imapHost: "imap.aol.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.aol.com",
  smtpPort: 465,
  smtpSecurity: "tls",
  serverKeepsSent: true,
  helpUrl: "https://help.aol.com/articles/create-and-manage-app-password",
  helpLabel: "AOL's app passwords",
  note: null,
};

const FASTMAIL: Preset = {
  provider: "fastmail",
  imapHost: "imap.fastmail.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.fastmail.com",
  smtpPort: 465,
  smtpSecurity: "tls",
  serverKeepsSent: true,
  helpUrl: "https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords",
  helpLabel: "Fastmail's app passwords",
  note: "A Fastmail Basic plan has no IMAP.",
};

const ZOHO: Preset = {
  provider: "zoho",
  imapHost: "imap.zoho.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.zoho.com",
  smtpPort: 465,
  smtpSecurity: "tls",
  serverKeepsSent: true,
  helpUrl: "https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html",
  helpLabel: "Zoho's app passwords",
  note: null,
};

const ZOHO_PRO: Preset = {
  ...ZOHO,
  imapHost: "imappro.zoho.com",
  smtpHost: "smtppro.zoho.com",
  note: "If sign-in fails, try imap.zoho.com and smtp.zoho.com.",
};

const GMX_COM: Preset = {
  provider: "gmx",
  imapHost: "imap.gmx.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "mail.gmx.com",
  smtpPort: 587,
  smtpSecurity: "starttls",
  serverKeepsSent: true,
  helpUrl: "https://hilfe.gmx.net/account/logindaten/app-passwort.html",
  helpLabel: "GMX app passwords",
  note: null,
};

const GMX_NET: Preset = {
  ...GMX_COM,
  imapHost: "imap.gmx.net",
  smtpHost: "mail.gmx.net",
};

const MAIL_COM: Preset = {
  provider: "mail.com",
  imapHost: "imap.mail.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.mail.com",
  smtpPort: 465,
  smtpSecurity: "tls",
  serverKeepsSent: true,
  helpUrl: "https://support.mail.com/security/2fa/application-specific-passwords.html",
  helpLabel: "mail.com app passwords",
  note: "IMAP on mail.com is a Premium feature.",
};

export async function discover(email: string, deps: DiscoverDeps): Promise<DiscoverOutcome> {
  const parsed = splitEmail(email);
  if (!parsed) return { kind: "miss", message: DISCOVER_MISS };
  const direct = matchDomain(parsed.domain);
  if (direct) return outcomeOf(direct, "preset");
  const fromAutoconfig = await readRemote(deps, autoconfigUrl(parsed.email, parsed.domain));
  if (fromAutoconfig) return settingsOf(fromAutoconfig, "autoconfig");
  const fromWellKnown = await readRemote(deps, wellKnownUrl(parsed.domain));
  if (fromWellKnown) return settingsOf(fromWellKnown, "autoconfig");
  const fromIspdb = await readRemote(deps, ispdbUrl(parsed.domain));
  if (fromIspdb) return settingsOf(fromIspdb, "ispdb");
  const exchanges = await withTimeout(deps.mx(parsed.domain), deps.timeoutMs, [] as string[]);
  for (const host of exchanges) {
    const viaMx = matchMx(host) ?? matchDomain(registrableDomain(host));
    if (viaMx) return outcomeOf(viaMx, "mx");
    const domain = registrableDomain(host);
    if (domain === parsed.domain || isPublicSuffix(domain)) continue;
    const fromMxIspdb = await readRemote(deps, ispdbUrl(domain));
    if (fromMxIspdb) return settingsOf(fromMxIspdb, "ispdb");
  }
  const guessed = await guess(parsed.domain, deps);
  if (guessed) return settingsOf(guessed, "guess");
  return { kind: "miss", message: DISCOVER_MISS };
}

/** Production lookups. Tests pass their own deps and do not call this. */
export function liveDiscoverDeps(timeoutMs: number, allowPrivate: boolean): DiscoverDeps {
  return {
    resolve: resolveHost,
    fetch: liveFetch,
    probe: liveProbe,
    mx: (domain) => liveMx(domain, timeoutMs),
    timeoutMs,
    allowPrivate,
  };
}

type Hit = { kind: "preset"; preset: Preset } | { kind: "card"; provider: "google" | "microsoft" } | { kind: "stop" };

function outcomeOf(hit: Hit, source: "preset" | "mx"): DiscoverOutcome {
  if (hit.kind === "card") {
    return hit.provider === "google"
      ? { kind: "card", provider: "google", message: GOOGLE_CARD }
      : { kind: "card", provider: "microsoft", message: MICROSOFT_CARD };
  }
  if (hit.kind === "stop") {
    return {
      kind: "stop",
      message: PROTON_STOP,
      helpUrl: "https://proton.me/support/imap-smtp-and-pop3-setup",
      helpLabel: "Proton Mail Bridge",
    };
  }
  return {
    kind: "settings",
    settings: {
      ...hit.preset,
      source,
    },
  };
}

function settingsOf(servers: XmlServers, source: DiscoveredSettings["source"]): DiscoverOutcome {
  return {
    kind: "settings",
    settings: {
      provider: "imap",
      imapHost: servers.imapHost,
      imapPort: servers.imapPort,
      imapSecurity: servers.imapSecurity,
      smtpHost: servers.smtpHost,
      smtpPort: servers.smtpPort,
      smtpSecurity: servers.smtpSecurity,
      serverKeepsSent: false,
      helpUrl: null,
      helpLabel: null,
      note: null,
      source,
    },
  };
}

function matchDomain(domain: string): Hit | null {
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") return { kind: "preset", preset: ICLOUD };
  if (domain === "ymail.com" || domain === "rocketmail.com" || labeled(domain, "yahoo")) return { kind: "preset", preset: YAHOO };
  if (domain === "aim.com" || labeled(domain, "aol")) return { kind: "preset", preset: AOL };
  if (domain === "fastmail.fm" || labeled(domain, "fastmail")) return { kind: "preset", preset: FASTMAIL };
  if (domain === "zoho.com" || domain === "zohomail.com" || domain === "zoho.eu" || domain === "zohomail.eu") {
    return { kind: "preset", preset: ZOHO };
  }
  if (domain === "mail.com") return { kind: "preset", preset: MAIL_COM };
  if (gmxNet(domain)) return { kind: "preset", preset: GMX_NET };
  if (labeled(domain, "gmx") || domain === "gmx.com") return { kind: "preset", preset: GMX_COM };
  if (domain === "proton.me" || domain === "protonmail.com" || domain === "pm.me" || domain === "protonmail.ch" || domain === "proton.ch") {
    return { kind: "stop" };
  }
  if (domain === "gmail.com" || domain === "googlemail.com" || domain === "google.com") return { kind: "card", provider: "google" };
  if (domain === "msn.com" || labeled(domain, "outlook") || labeled(domain, "hotmail") || labeled(domain, "live")) {
    return { kind: "card", provider: "microsoft" };
  }
  return null;
}

/** Known MX suffixes, on the full host, before the name is reduced to a registrable domain. */
function matchMx(host: string): Hit | null {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "messagingengine.com" || name.endsWith(".messagingengine.com")) return { kind: "preset", preset: FASTMAIL };
  if (endsWithDomain(name, "zoho.com") || endsWithDomain(name, "zohomail.com") || endsWithDomain(name, "zoho.eu")) {
    return { kind: "preset", preset: ZOHO_PRO };
  }
  if (name === "google.com" || name === "googlemail.com" || name.endsWith(".google.com") || name.endsWith(".googlemail.com")) {
    return { kind: "card", provider: "google" };
  }
  if (name === "mail.protection.outlook.com" || name.endsWith(".mail.protection.outlook.com")) {
    return { kind: "card", provider: "microsoft" };
  }
  return null;
}

function endsWithDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function gmxNet(domain: string): boolean {
  return domain === "gmx.net" || domain === "gmx.de" || domain === "gmx.at" || domain === "gmx.ch";
}

/** label.com, label.fr, or label.co.uk. Not notlabel.com and not label.evil.com. */
function labeled(domain: string, label: string): boolean {
  if (domain === `${label}.com`) return true;
  const prefix = `${label}.`;
  if (!domain.startsWith(prefix)) return false;
  const rest = domain.slice(prefix.length);
  return /^[a-z]{2}$/.test(rest) || MULTI_SUFFIXES.has(rest);
}

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

function isPublicSuffix(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return !name.includes(".") || MULTI_SUFFIXES.has(name);
}

function splitEmail(email: string): { email: string; domain: string } | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@") || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1).replace(/\.$/, "");
  if (!hostOk(domain)) return null;
  return { email: trimmed, domain };
}

function autoconfigUrl(email: string, domain: string): string {
  return `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`;
}

function wellKnownUrl(domain: string): string {
  return `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`;
}

function ispdbUrl(domain: string): string {
  return `https://autoconfig.thunderbird.net/v1.1/${domain}`;
}

interface XmlServers {
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "starttls";
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
}

async function readRemote(deps: DiscoverDeps, start: string): Promise<XmlServers | null> {
  const body = await fetchConfig(deps, start);
  if (!body) return null;
  return readConfig(body);
}

async function fetchConfig(deps: DiscoverDeps, start: string): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let address: string;
    try {
      address = await pinHost(url.hostname, (host) => withTimeout(deps.resolve(host), deps.timeoutMs, []), deps.allowPrivate);
    } catch {
      return null;
    }
    const response = await withTimeout(
      deps.fetch({ url: url.toString(), address, timeoutMs: deps.timeoutMs }),
      deps.timeoutMs,
      { status: 0, body: "", location: null },
    );
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || hop === MAX_REDIRECTS) return null;
      let next: URL;
      try {
        next = new URL(response.location, url);
      } catch {
        return null;
      }
      if (next.protocol !== "https:" || next.username || next.password) return null;
      if (next.hostname !== url.hostname) next.search = "";
      current = next.toString();
      continue;
    }
    if (response.status !== 200) return null;
    if (Buffer.byteLength(response.body) > BODY_CAP) return null;
    return response.body;
  }
  return null;
}

function readConfig(body: string): XmlServers | null {
  if (Buffer.byteLength(body) > BODY_CAP) return null;
  if (/<!DOCTYPE|<!ENTITY|\bSYSTEM\b|\bPUBLIC\b/i.test(body)) return null;
  const incoming = firstServer(body, "incomingServer", "imap");
  const outgoing = firstServer(body, "outgoingServer", "smtp");
  if (!incoming || !outgoing) return null;
  return {
    imapHost: incoming.host,
    imapPort: incoming.port,
    imapSecurity: incoming.security,
    smtpHost: outgoing.host,
    smtpPort: outgoing.port,
    smtpSecurity: outgoing.security,
  };
}

function firstServer(xml: string, tag: string, type: string): { host: string; port: number; security: "tls" | "starttls" } | null {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    if (attr(attrs, "type").toLowerCase() !== type) continue;
    const security = socketSecurity(textOf(inner, "socketType"));
    const host = textOf(inner, "hostname");
    const port = portOf(textOf(inner, "port"));
    if (!security || !host || port === null || !hostOk(host)) continue;
    return { host, port, security };
  }
  return null;
}

function socketSecurity(value: string | null): "tls" | "starttls" | null {
  if (!value) return null;
  if (value.toUpperCase() === "SSL") return "tls";
  if (value.toUpperCase() === "STARTTLS") return "starttls";
  return null;
}

function textOf(block: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!match?.[1]) return null;
  return decodeXml(match[1].trim());
}

function attr(block: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(block);
  return (match?.[2] ?? match?.[3] ?? "").trim();
}

/** The five predefined entities only. A leftover & is rejected. */
function decodeXml(value: string): string | null {
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) return null;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function portOf(value: string | null): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function hostOk(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value.includes("..") || value.startsWith(".") || value.endsWith(".")) return false;
  return /^[a-z0-9.-]+$/i.test(value) && value.includes(".");
}

async function guess(domain: string, deps: DiscoverDeps): Promise<XmlServers | null> {
  let imapHost: string | null = null;
  for (const host of [`imap.${domain}`, `mail.${domain}`]) {
    if (await probed(deps, host, 993)) {
      imapHost = host;
      break;
    }
  }
  if (!imapHost) return null;
  for (const host of [`smtp.${domain}`, `mail.${domain}`]) {
    if (await probed(deps, host, 465)) {
      return { imapHost, imapPort: 993, imapSecurity: "tls", smtpHost: host, smtpPort: 465, smtpSecurity: "tls" };
    }
    if (await probed(deps, host, 587)) {
      return { imapHost, imapPort: 993, imapSecurity: "tls", smtpHost: host, smtpPort: 587, smtpSecurity: "starttls" };
    }
  }
  return null;
}

async function probed(deps: DiscoverDeps, host: string, port: number): Promise<boolean> {
  let address: string;
  try {
    address = await pinHost(host, (name) => withTimeout(deps.resolve(name), deps.timeoutMs, []), deps.allowPrivate);
  } catch {
    return false;
  }
  return withTimeout(deps.probe({ host, address, port, timeoutMs: deps.timeoutMs }), deps.timeoutMs, false);
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function liveFetch(input: DiscoverFetch): Promise<DiscoverResponse> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return Promise.resolve({ status: 0, body: "", location: null });
  }
  if (url.protocol !== "https:") return Promise.resolve({ status: 0, body: "", location: null });
  const port = url.port ? Number(url.port) : 443;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DiscoverResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = httpsRequest({
      host: input.address,
      servername: url.hostname,
      port,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: { host: url.hostname, accept: "application/xml, text/xml, */*" },
      timeout: input.timeoutMs,
      rejectUnauthorized: true,
    }, (res) => {
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const chunks: Buffer[] = [];
      let total = 0;
      let oversized = false;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > BODY_CAP) {
          oversized = true;
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (oversized) finish({ status: 0, body: "", location: null });
        else finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), location });
      });
      res.on("error", () => finish({ status: 0, body: "", location: null }));
    });
    req.on("timeout", () => {
      req.destroy();
      finish({ status: 0, body: "", location: null });
    });
    req.on("error", () => finish({ status: 0, body: "", location: null }));
    req.end();
  });
}

/** 465 and 993 are implicit TLS. 587 speaks SMTP first, then STARTTLS. No mail is sent. */
function liveProbe(input: DiscoverProbe): Promise<boolean> {
  if (input.port === 587) return probeStartTls(input);
  return probeTls(input);
}

function probeTls(input: DiscoverProbe): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const socket = tlsConnect({
      host: input.address,
      servername: input.host,
      port: input.port,
      rejectUnauthorized: true,
      timeout: input.timeoutMs,
    }, () => {
      socket.end();
      finish(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      finish(false);
    });
    socket.on("error", () => finish(false));
  });
}

function probeStartTls(input: DiscoverProbe): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const socket = netConnect({ host: input.address, port: input.port, timeout: input.timeoutMs });
    let buf = "";
    const take = (ready: (text: string) => boolean, then: (text: string) => void) => {
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("latin1");
        if (buf.length > 8192) {
          socket.off("data", onData);
          socket.destroy();
          finish(false);
          return;
        }
        if (ready(buf)) {
          socket.off("data", onData);
          const text = buf;
          buf = "";
          then(text);
        }
      };
      socket.on("data", onData);
    };
    socket.on("timeout", () => {
      socket.destroy();
      finish(false);
    });
    socket.on("error", () => finish(false));
    socket.on("connect", () => {
      take((text) => text.includes("\n"), () => {
        socket.write("EHLO chatterbuilt-mail\r\n");
        take((text) => /^250 /m.test(text), () => {
          socket.write("STARTTLS\r\n");
          take((text) => text.includes("\n"), (line) => {
            if (!line.startsWith("220")) {
              socket.destroy();
              finish(false);
              return;
            }
            const secure = tlsConnect({ socket, servername: input.host, rejectUnauthorized: true }, () => {
              secure.end();
              finish(true);
            });
            secure.on("error", () => finish(false));
          });
        });
      });
    });
  });
}

function liveMx(domain: string, timeoutMs: number): Promise<string[]> {
  return withTimeout(resolveMx(domain).then((rows) => rows
    .slice()
    .sort((left, right) => left.priority - right.priority)
    .map((row) => row.exchange.replace(/\.$/, "").toLowerCase())
    .filter((host) => host.length > 0)), timeoutMs, []);
}
