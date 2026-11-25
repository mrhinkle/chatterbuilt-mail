import { hkdfSync } from "node:crypto";

export type MailMode = "mirror" | "direct";
export type MailStoreKind = "pglite" | "pg";
export type MailProviderKind = "fake" | "gmail" | "imap" | "live";
/** A secret selects the owner's Entra app. A client id alone selects device code. */
export type MicrosoftMode = "off" | "device" | "confidential";

export interface Config {
  ownerToken: string;
  ownerPassphrase?: string;
  encryptionKey: Buffer;
  mailMode: MailMode;
  mailStore: MailStoreKind;
  databaseUrl?: string;
  mailProvider: MailProviderKind;
  host: string;
  port: number;
  nodeEnv: string;
  googleClientId?: string;
  googleClientSecret?: string;
  /** True when both Google client values came from the environment. A saved client does not override them. */
  googleClientFromEnv: boolean;
  gmailApiBase: string;
  googleTokenUrl: string;
  gmailTimeoutMs: number;
  syncDays: number;
  syncBudgetMs: number;
  syncPageSize: number;
  readSyncBudgetMs: number;
  syncStaleMs: number;
  cronSecret?: string;
  labelPrefix: string;
  gmailPushAudience?: string;
  gmailPushServiceAccount?: string;
  gmailPushJwks?: string;
  gmailPubsubTopic?: string;
  /** IANA zone. Snooze labels use this zone, and a label dated today wakes at 06:00. */
  ownerTimezone: string;
  /** True when MAIL_PROVIDER=fake omitted OWNER_TIMEZONE and the server is using UTC. */
  ownerTimezoneDefaulted: boolean;
  /** Public https origin. Tokens and metadata use it when set. */
  publicUrl?: string;
  /** Google's authorization endpoint. Tests point this at the fake server. */
  googleAuthUrl: string;
  /** off: no client id. device: shared public client. confidential: the owner's own Entra app. */
  microsoftMode: MicrosoftMode;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  /** True when MICROSOFT_CLIENT_ID came from the environment. A saved client does not override it. */
  microsoftClientFromEnv: boolean;
  microsoftGraphBase: string;
  microsoftTokenUrl: string;
  microsoftAuthUrl: string;
  microsoftDeviceUrl: string;
  /** Trust X-Forwarded-Host and X-Forwarded-For. Set by VERCEL=1 or TRUST_PROXY=1. */
  trustProxy: boolean;
  /** Hosts that may receive an authorization code. Default is claude.ai. */
  oauthRedirectHosts: string[];
  /** The owner's model key. Never sent to the browser. Absent means sampling is off. */
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  anthropicApiBase: string;
  openrouterApiBase: string;
  /**
   * Model id sent to whichever provider is configured.
   * Unset means the provider default in sample.ts.
   */
  sampleModel?: string;
  /** Private and loopback mail hosts. Refused in production. Metadata hosts stay refused. */
  imapAllowPrivateHosts: boolean;
  /** Seeds an IMAP-kind row for the smoke check. Refused in production. */
  smokeImap: boolean;
  /** Set when the process was given CBM_SECRET. Used to claim /setup. Never log it. */
  cbmSecret?: string;
  /** ENCRYPTION_KEY is set and is not the key CBM_SECRET would derive. */
  logEncryptionOverride: boolean;
  /** OWNER_TOKEN is set and is not the token CBM_SECRET would derive. */
  logOwnerTokenOverride: boolean;
}

export type Env = Record<string, string | undefined>;

const GMAIL_ORIGIN = "https://gmail.googleapis.com";
const GOOGLE_TOKEN_ORIGIN = "https://oauth2.googleapis.com";
const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const OPENROUTER_ORIGIN = "https://openrouter.ai";
const DEFAULT_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_GMAIL_TIMEOUT_MS = 20_000;
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const LOGIN_ORIGIN = "https://login.microsoftonline.com";
const DEFAULT_GRAPH = GRAPH_ORIGIN;
const DEFAULT_MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEFAULT_MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const DEFAULT_MS_DEVICE = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";

function googleOrigin(value: string, expected: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must use origin ${expected} when NODE_ENV is production`);
  }
  if (url.origin !== expected) {
    throw new Error(`${name} must use origin ${expected} when NODE_ENV is production`);
  }
}

function gmailTimeoutMs(env: Env): number {
  const raw = env.GMAIL_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_GMAIL_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) throw new Error("GMAIL_TIMEOUT_MS must be an integer number of milliseconds");
  const value = Number(raw);
  if (value < 1 || value > 120_000) throw new Error("GMAIL_TIMEOUT_MS must be from 1 to 120000");
  return value;
}

function intEnv(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name} must be from ${min} to ${max}`);
  return value;
}

export function isIanaZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function ownerTimezone(env: Env): { zone: string; defaulted: boolean } {
  const raw = env.OWNER_TIMEZONE;
  if (raw === undefined || raw === "") return { zone: "UTC", defaulted: true };
  if (!isIanaZone(raw)) throw new Error("OWNER_TIMEZONE must be an IANA time zone");
  return { zone: raw, defaulted: false };
}

function labelPrefix(env: Env): string {
  const raw = env.LABEL_PREFIX;
  if (raw === undefined || raw === "") return "CB";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/.test(raw)) {
    throw new Error("LABEL_PREFIX must be letters, numbers, underscores, or hyphens");
  }
  return raw;
}

const DEFAULT_REDIRECT_HOSTS = ["claude.ai"];

function oauthRedirectHosts(env: Env): string[] {
  const raw = env.OAUTH_REDIRECT_HOSTS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_REDIRECT_HOSTS;
  const hosts = raw.split(",").map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
  if (hosts.length === 0) return DEFAULT_REDIRECT_HOSTS;
  const hostName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  for (const host of hosts) {
    if (!hostName.test(host) && !ipv4.test(host)) {
      throw new Error("OAUTH_REDIRECT_HOSTS must be a comma-separated list of host names");
    }
  }
  return hosts;
}

function httpsOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_URL must be an https origin");
  }
  const barePath = url.pathname === "/" || url.pathname === "";
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !barePath) {
    throw new Error("PUBLIC_URL must be an https origin with no path");
  }
  return url.origin;
}

/**
 * PUBLIC_URL wins. On Vercel, an unset PUBLIC_URL uses VERCEL_PROJECT_PRODUCTION_URL,
 * which has no scheme. https://vercel.com/docs/environment-variables/system-environment-variables
 */
function publicUrl(env: Env, nodeEnv: string): string | undefined {
  const raw = env.PUBLIC_URL?.trim();
  if (raw) return httpsOrigin(raw);
  if (env.VERCEL === "1") {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (host) return httpsOrigin(host.includes("://") ? host : `https://${host}`);
  }
  if (nodeEnv === "production") throw new Error("PUBLIC_URL is required when NODE_ENV is production");
  return undefined;
}

const INFO_ENCRYPTION = "chatterbuilt-mail encryption key";
const INFO_OWNER_TOKEN = "chatterbuilt-mail owner token";
/** Public HKDF salt. Not a secret. Info strings separate the two outputs. */
const HKDF_SALT = "chatterbuilt-mail";

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, info, 32));
}

function secretValue(env: Env): string | undefined {
  const value = trimmedEnv(env, "CBM_SECRET");
  if (!value) return undefined;
  if (value.length < 32) throw new Error("CBM_SECRET must be at least 32 characters");
  return value;
}

function encryptionMaterial(env: Env, secret: string | undefined): { key: Buffer; override: boolean } {
  if (env.ENCRYPTION_KEY) {
    const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
    const override = secret !== undefined && !key.equals(derive(secret, INFO_ENCRYPTION));
    return { key, override };
  }
  if (!secret) throw new Error("ENCRYPTION_KEY or CBM_SECRET is required");
  return { key: derive(secret, INFO_ENCRYPTION), override: false };
}

function ownerTokenMaterial(env: Env, secret: string | undefined): { token: string; override: boolean } {
  if (env.OWNER_TOKEN) {
    if (env.OWNER_TOKEN.length < 32) throw new Error("OWNER_TOKEN must be at least 32 characters");
    const derived = secret === undefined ? undefined : derive(secret, INFO_OWNER_TOKEN).toString("base64");
    return { token: env.OWNER_TOKEN, override: derived !== undefined && env.OWNER_TOKEN !== derived };
  }
  if (!secret) throw new Error("OWNER_TOKEN or CBM_SECRET is required");
  return { token: derive(secret, INFO_OWNER_TOKEN).toString("base64"), override: false };
}

/**
 * DATABASE_URL wins. POSTGRES_URL is the legacy name the Vercel-managed Neon
 * integration still provides for Vercel Postgres templates.
 * https://neon.com/docs/guides/vercel-managed-integration
 */
function databaseUrlOf(env: Env): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  return undefined;
}

/** Production needs CBM_SECRET, or a passphrase in the env or the store. */
export function productionNeedsOwner(config: Config, storedPassphrase: boolean): void {
  if (config.nodeEnv !== "production") return;
  if (config.cbmSecret || config.ownerPassphrase || storedPassphrase) return;
  throw new Error("Set CBM_SECRET to at least 32 characters, or set OWNER_PASSPHRASE, before starting in production.");
}

function optionalEnv(env: Env, name: string): string | undefined {
  const value = env[name];
  return value ? value : undefined;
}

/** Blank and whitespace-only values are absent. A secret of spaces does not turn on confidential mode. */
function trimmedEnv(env: Env, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** One model id for whichever sampling provider is configured. */
function sampleModel(env: Env): string | undefined {
  const raw = env.SAMPLE_MODEL;
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  if (value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) {
    throw new Error("SAMPLE_MODEL must be a model id");
  }
  return value;
}

/**
 * Fail closed. Production refuses the in-process database and the demo provider.
 * An unknown mode, store, or provider is an error, not a silent default.
 */
export function loadConfig(env: Env): Config {
  const secret = secretValue(env);
  const token = ownerTokenMaterial(env, secret);
  const sealed = encryptionMaterial(env, secret);
  const ownerToken = token.token;
  const encryptionKey = sealed.key;

  const nodeEnv = env.NODE_ENV ?? "development";
  const mode = env.MAIL_MODE ?? "mirror";
  if (mode !== "mirror" && mode !== "direct") {
    throw new Error("MAIL_MODE must be mirror or direct");
  }

  const databaseUrl = databaseUrlOf(env);
  const hasDatabase = Boolean(databaseUrl);
  const storeRaw = env.MAIL_STORE ?? (hasDatabase ? "pg" : "pglite");
  if (storeRaw !== "pglite" && storeRaw !== "pg") {
    throw new Error("MAIL_STORE must be pglite or pg");
  }
  if (storeRaw === "pglite" && nodeEnv === "production") {
    throw new Error("MAIL_STORE=pglite is not allowed when NODE_ENV is production");
  }
  if (storeRaw === "pg" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when MAIL_STORE is pg");
  }
  if (!env.MAIL_STORE && !databaseUrl && nodeEnv === "production") {
    throw new Error("DATABASE_URL is required when NODE_ENV is production");
  }

  const providerRaw = env.MAIL_PROVIDER ?? (nodeEnv === "production" ? "live" : "fake");
  if (providerRaw !== "fake" && providerRaw !== "gmail" && providerRaw !== "imap" && providerRaw !== "live") {
    throw new Error("MAIL_PROVIDER must be fake, gmail, imap, or live");
  }
  if (nodeEnv === "production" && providerRaw === "fake") {
    throw new Error("MAIL_PROVIDER=fake is not allowed when NODE_ENV is production");
  }
  if (providerRaw === "gmail" && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when MAIL_PROVIDER is gmail");
  }

  const port = env.PORT === undefined || env.PORT === "" ? 8787 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535");
  }

  const host = env.HOST === undefined || env.HOST === "" ? "127.0.0.1" : env.HOST;
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("HOST must be a loopback address. This listener's certificate is for localhost only.");
  }

  const gmailApiBase = env.GMAIL_API_BASE || GMAIL_ORIGIN;
  const googleTokenUrl = env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const googleAuthUrl = env.GOOGLE_AUTH_URL || DEFAULT_GOOGLE_AUTH;
  if (nodeEnv === "production") {
    googleOrigin(gmailApiBase, GMAIL_ORIGIN, "GMAIL_API_BASE");
    googleOrigin(googleTokenUrl, GOOGLE_TOKEN_ORIGIN, "GOOGLE_TOKEN_URL");
    googleOrigin(googleAuthUrl, GOOGLE_AUTH_ORIGIN, "GOOGLE_AUTH_URL");
    if (env.GMAIL_PUSH_JWKS) {
      throw new Error("GMAIL_PUSH_JWKS is not allowed when NODE_ENV is production");
    }
    if (env.IMAP_ALLOW_PRIVATE_HOSTS) {
      throw new Error("IMAP_ALLOW_PRIVATE_HOSTS is not allowed when NODE_ENV is production");
    }
    if (env.CBM_SMOKE_IMAP) {
      throw new Error("CBM_SMOKE_IMAP is not allowed when NODE_ENV is production");
    }
  }
  const microsoftClientId = trimmedEnv(env, "MICROSOFT_CLIENT_ID");
  const microsoftClientSecret = trimmedEnv(env, "MICROSOFT_CLIENT_SECRET");
  if (microsoftClientSecret && !microsoftClientId) {
    throw new Error("MICROSOFT_CLIENT_ID is required when MICROSOFT_CLIENT_SECRET is set");
  }
  const microsoftMode: MicrosoftMode = microsoftClientSecret ? "confidential" : microsoftClientId ? "device" : "off";
  const microsoftGraphBase = env.MICROSOFT_GRAPH_BASE || DEFAULT_GRAPH;
  const microsoftTokenUrl = env.MICROSOFT_TOKEN_URL || DEFAULT_MS_TOKEN;
  const microsoftAuthUrl = env.MICROSOFT_AUTH_URL || DEFAULT_MS_AUTH;
  const microsoftDeviceUrl = env.MICROSOFT_DEVICE_URL || DEFAULT_MS_DEVICE;
  if (nodeEnv === "production") {
    googleOrigin(microsoftGraphBase, GRAPH_ORIGIN, "MICROSOFT_GRAPH_BASE");
    googleOrigin(microsoftTokenUrl, LOGIN_ORIGIN, "MICROSOFT_TOKEN_URL");
    googleOrigin(microsoftAuthUrl, LOGIN_ORIGIN, "MICROSOFT_AUTH_URL");
    googleOrigin(microsoftDeviceUrl, LOGIN_ORIGIN, "MICROSOFT_DEVICE_URL");
  }

  const published = publicUrl(env, nodeEnv);
  const zone = ownerTimezone(env);
  const anthropicApiBase = env.ANTHROPIC_API_BASE || ANTHROPIC_ORIGIN;
  const openrouterApiBase = env.OPENROUTER_API_BASE || OPENROUTER_ORIGIN;
  if (nodeEnv === "production") {
    googleOrigin(anthropicApiBase, ANTHROPIC_ORIGIN, "ANTHROPIC_API_BASE");
    googleOrigin(openrouterApiBase, OPENROUTER_ORIGIN, "OPENROUTER_API_BASE");
  }

  return {
    ownerToken,
    ownerPassphrase: env.OWNER_PASSPHRASE || undefined,
    encryptionKey,
    mailMode: mode,
    mailStore: storeRaw,
    databaseUrl,
    mailProvider: providerRaw,
    host,
    port,
    nodeEnv,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    googleClientFromEnv: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    gmailApiBase,
    googleTokenUrl,
    gmailTimeoutMs: gmailTimeoutMs(env),
    syncDays: intEnv(env, "SYNC_DAYS", 30, 1, 3650),
    syncBudgetMs: intEnv(env, "SYNC_BUDGET_MS", 20_000, 1, 120_000),
    syncPageSize: intEnv(env, "SYNC_PAGE_SIZE", 20, 1, 50),
    readSyncBudgetMs: intEnv(env, "READ_SYNC_BUDGET_MS", 3_000, 1, 5_000),
    syncStaleMs: intEnv(env, "SYNC_STALE_MS", 60_000, 0, 86_400_000),
    cronSecret: optionalEnv(env, "CRON_SECRET"),
    labelPrefix: labelPrefix(env),
    gmailPushAudience: optionalEnv(env, "GMAIL_PUSH_AUDIENCE"),
    gmailPushServiceAccount: optionalEnv(env, "GMAIL_PUSH_SERVICE_ACCOUNT"),
    gmailPushJwks: optionalEnv(env, "GMAIL_PUSH_JWKS"),
    gmailPubsubTopic: optionalEnv(env, "GMAIL_PUBSUB_TOPIC"),
    ownerTimezone: zone.zone,
    ownerTimezoneDefaulted: zone.defaulted,
    publicUrl: published,
    googleAuthUrl,
    microsoftMode,
    microsoftClientId,
    microsoftClientSecret,
    microsoftClientFromEnv: Boolean(microsoftClientId),
    microsoftGraphBase,
    microsoftTokenUrl,
    microsoftAuthUrl,
    microsoftDeviceUrl,
    trustProxy: env.TRUST_PROXY === "1" || env.VERCEL === "1",
    oauthRedirectHosts: oauthRedirectHosts(env),
    anthropicApiKey: optionalEnv(env, "ANTHROPIC_API_KEY"),
    openrouterApiKey: optionalEnv(env, "OPENROUTER_API_KEY"),
    anthropicApiBase,
    openrouterApiBase,
    sampleModel: sampleModel(env),
    imapAllowPrivateHosts: nodeEnv !== "production" && env.IMAP_ALLOW_PRIVATE_HOSTS === "1",
    smokeImap: nodeEnv !== "production" && env.CBM_SMOKE_IMAP === "1",
    cbmSecret: secret,
    logEncryptionOverride: sealed.override,
    logOwnerTokenOverride: token.override,
  };
}
