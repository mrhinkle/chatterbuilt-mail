import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig, productionNeedsOwner } from "./config.js";
import { openSeal, seal } from "./crypto/seal.js";

const key = randomBytes(32).toString("base64");

describe("loadConfig", () => {
  it("defaults to mirror and refuses a bad mode, a short key, or a missing token", () => {
    const config = loadConfig({ OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, NODE_ENV: "test" });
    expect(config.mailMode).toBe("mirror");
    expect(config.mailStore).toBe("pglite");
    expect(config.mailProvider).toBe("fake");
    expect(config.ownerTimezone).toBe("UTC");
    expect(config.ownerTimezoneDefaulted).toBe(true);
    expect(config.oauthRedirectHosts).toEqual(["claude.ai"]);
    expect(loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      NODE_ENV: "test",
      OAUTH_REDIRECT_HOSTS: " Claude.AI , example.com ",
    }).oauthRedirectHosts).toEqual(["claude.ai", "example.com"]);
    expect(() => loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      OAUTH_REDIRECT_HOSTS: "https://claude.ai",
    })).toThrow(/OAUTH_REDIRECT_HOSTS/);
    expect(() => loadConfig({ OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, MAIL_MODE: "both" })).toThrow(/MAIL_MODE/);
    expect(() => loadConfig({ OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: Buffer.from("short").toString("base64") })).toThrow(/32/);
    expect(() => loadConfig({ ENCRYPTION_KEY: key })).toThrow(/OWNER_TOKEN/);
    expect(() => loadConfig({ OWNER_TOKEN: "too-short", ENCRYPTION_KEY: key })).toThrow(/at least 32/);
    expect(() => loadConfig({ OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, HOST: "0.0.0.0" })).toThrow(/loopback/);
    expect(loadConfig({ OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, HOST: "" }).host).toBe("127.0.0.1");
  });

  it("refuses the demo store and the demo provider in production", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      MAIL_STORE: "pglite",
    })).toThrow(/pglite/);
    expect(() => loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "fake",
    })).toThrow(/fake/);
    expect(() => loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "gmail",
      MAIL_STORE: "pg",
    })).toThrow(/GOOGLE_CLIENT_ID/);
    const config = loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "gmail",
      MAIL_STORE: "pg",
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      OWNER_TIMEZONE: "UTC",
      PUBLIC_URL: "https://mail.example.com",
    });
    expect(config.mailProvider).toBe("gmail");
    expect(config.ownerTimezone).toBe("UTC");
    expect(config.ownerTimezoneDefaulted).toBe(false);
    expect(config.mailStore).toBe("pg");
    expect(config.gmailApiBase).toBe("https://gmail.googleapis.com");
    expect(config.googleTokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(config.googleAuthUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(config.publicUrl).toBe("https://mail.example.com");
    expect(config.trustProxy).toBe(false);
    expect(config.gmailTimeoutMs).toBe(20_000);
  });

  it("refuses a non-Google Gmail or token origin in production and allows it in tests", () => {
    const production = {
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "gmail",
      MAIL_STORE: "pg",
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      OWNER_TIMEZONE: "UTC",
      PUBLIC_URL: "https://mail.example.com",
    };
    expect(() => loadConfig({ ...production, PUBLIC_URL: "" })).toThrow(/PUBLIC_URL is required/);
    expect(() => loadConfig({ ...production, GMAIL_API_BASE: "https://gmail.googleapis.com.evil.example" })).toThrow(/GMAIL_API_BASE/);
    expect(() => loadConfig({ ...production, GMAIL_API_BASE: "http://gmail.googleapis.com" })).toThrow(/GMAIL_API_BASE/);
    expect(() => loadConfig({ ...production, GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com.evil.example/token" })).toThrow(/GOOGLE_TOKEN_URL/);
    expect(() => loadConfig({ ...production, GOOGLE_TOKEN_URL: "http://127.0.0.1:9/token" })).toThrow(/GOOGLE_TOKEN_URL/);
    expect(() => loadConfig({ ...production, GOOGLE_AUTH_URL: "https://accounts.google.com.evil.example/o/oauth2/v2/auth" })).toThrow(/GOOGLE_AUTH_URL/);
    expect(() => loadConfig({ ...production, GOOGLE_AUTH_URL: "http://accounts.google.com/o/oauth2/v2/auth" })).toThrow(/GOOGLE_AUTH_URL/);
    expect(() => loadConfig({ ...production, ANTHROPIC_API_BASE: "http://127.0.0.1:9" })).toThrow(/ANTHROPIC_API_BASE/);
    expect(() => loadConfig({ ...production, OPENROUTER_API_BASE: "https://openrouter.ai.evil.example" })).toThrow(/OPENROUTER_API_BASE/);
    expect(loadConfig({ ...production, ANTHROPIC_API_KEY: "sk-ant-test" }).anthropicApiBase).toBe("https://api.anthropic.com");
    expect(loadConfig({ ...production, ANTHROPIC_API_KEY: "sk-ant-test" }).sampleModel).toBeUndefined();
    expect(loadConfig({ ...production, SAMPLE_MODEL: " claude-haiku-5-5 " }).sampleModel).toBe("claude-haiku-5-5");
    expect(() => loadConfig({ ...production, SAMPLE_MODEL: "not a model" })).toThrow(/SAMPLE_MODEL/);
    expect(() => loadConfig({ ...production, PUBLIC_URL: "http://mail.example.com" })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...production, PUBLIC_URL: "https://mail.example.com/mcp" })).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ ...production, PUBLIC_URL: "https://mail.example.com" }).publicUrl).toBe("https://mail.example.com");
    expect(loadConfig({ ...production, VERCEL: "1" }).trustProxy).toBe(true);
    const locked = loadConfig({
      ...production,
      GMAIL_API_BASE: "https://gmail.googleapis.com",
      GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
    });
    expect(locked.gmailApiBase).toBe("https://gmail.googleapis.com");
    expect(locked.googleTokenUrl).toBe("https://oauth2.googleapis.com/token");
    const dev = loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      NODE_ENV: "test",
      GMAIL_API_BASE: "http://127.0.0.1:9",
      GOOGLE_TOKEN_URL: "http://127.0.0.1:9/token",
      GMAIL_TIMEOUT_MS: "250",
    });
    expect(dev.gmailApiBase).toBe("http://127.0.0.1:9");
    expect(dev.googleTokenUrl).toBe("http://127.0.0.1:9/token");
    expect(dev.gmailTimeoutMs).toBe(250);
    expect(() => loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      GMAIL_TIMEOUT_MS: "0",
    })).toThrow(/GMAIL_TIMEOUT_MS/);
    expect(() => loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      GMAIL_TIMEOUT_MS: "nope",
    })).toThrow(/GMAIL_TIMEOUT_MS/);
  });

  it("defaults the sync budget and rejects a bad integer or a slash in the label prefix", () => {
    const base = { OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, NODE_ENV: "test" };
    const config = loadConfig(base);
    expect(config.syncDays).toBe(30);
    expect(config.syncBudgetMs).toBe(20_000);
    expect(config.syncPageSize).toBe(20);
    expect(config.readSyncBudgetMs).toBe(3_000);
    expect(config.syncStaleMs).toBe(60_000);
    expect(config.labelPrefix).toBe("CB");
    expect(() => loadConfig({ ...base, SYNC_DAYS: "0" })).toThrow(/SYNC_DAYS/);
    expect(() => loadConfig({ ...base, SYNC_DAYS: "nope" })).toThrow(/SYNC_DAYS/);
    expect(() => loadConfig({ ...base, SYNC_BUDGET_MS: "0" })).toThrow(/SYNC_BUDGET_MS/);
    expect(() => loadConfig({ ...base, SYNC_PAGE_SIZE: "51" })).toThrow(/SYNC_PAGE_SIZE/);
    expect(() => loadConfig({ ...base, READ_SYNC_BUDGET_MS: "5001" })).toThrow(/READ_SYNC_BUDGET_MS/);
    expect(() => loadConfig({ ...base, SYNC_STALE_MS: "-1" })).toThrow(/SYNC_STALE_MS/);
    expect(loadConfig({ ...base, SYNC_STALE_MS: "0" }).syncStaleMs).toBe(0);
    expect(() => loadConfig({ ...base, LABEL_PREFIX: "CB/Snooze" })).toThrow(/LABEL_PREFIX/);
    expect(loadConfig({ ...base, LABEL_PREFIX: "Work_1" }).labelPrefix).toBe("Work_1");
  });

  it("requires an IANA OWNER_TIMEZONE for a real provider and refuses GMAIL_PUSH_JWKS in production", () => {
    const production = {
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "gmail",
      MAIL_STORE: "pg",
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      OWNER_TIMEZONE: "America/New_York",
      PUBLIC_URL: "https://mail.example.com",
    };
    expect(loadConfig(production).ownerTimezone).toBe("America/New_York");
    const unsetZone = loadConfig({ ...production, OWNER_TIMEZONE: "" });
    expect(unsetZone.ownerTimezone).toBe("UTC");
    expect(unsetZone.ownerTimezoneDefaulted).toBe(true);
    expect(() => loadConfig({ ...production, OWNER_TIMEZONE: "Mars/Olympus" })).toThrow(/IANA/);
    expect(() => loadConfig({ ...production, GMAIL_PUSH_JWKS: "{\"keys\":[]}" })).toThrow(/GMAIL_PUSH_JWKS/);
    const live = loadConfig({
      ...production,
      MAIL_PROVIDER: "live",
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(live.mailProvider).toBe("live");
    expect(live.googleClientId).toBeUndefined();
    const liveUnsetZone = loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      NODE_ENV: "test",
      MAIL_PROVIDER: "live",
    });
    expect(liveUnsetZone.ownerTimezone).toBe("UTC");
    expect(liveUnsetZone.ownerTimezoneDefaulted).toBe(true);
    expect(() => loadConfig({
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      NODE_ENV: "test",
      MAIL_PROVIDER: "nope",
    })).toThrow(/fake, gmail, imap, or live/);
    const dev = loadConfig({
      ...production,
      NODE_ENV: "test",
      MAIL_STORE: "pglite",
      GMAIL_PUSH_JWKS: "{\"keys\":[]}",
    });
    expect(dev.gmailPushJwks).toBe("{\"keys\":[]}");
    expect(dev.ownerTimezone).toBe("America/New_York");
  });

  it("picks Microsoft mode from the client id and secret, and pins production origins", () => {
    const base = { OWNER_TOKEN: "owner-token-at-least-32-characters", ENCRYPTION_KEY: key, NODE_ENV: "test" };
    expect(loadConfig(base).microsoftMode).toBe("off");
    expect(loadConfig(base).microsoftGraphBase).toBe("https://graph.microsoft.com");
    expect(loadConfig(base).microsoftTokenUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(loadConfig(base).microsoftAuthUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(loadConfig(base).microsoftDeviceUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/devicecode");
    expect(loadConfig({ ...base, MICROSOFT_CLIENT_ID: "app" }).microsoftMode).toBe("device");
    expect(loadConfig({ ...base, MICROSOFT_CLIENT_ID: "app", MICROSOFT_CLIENT_SECRET: "   " }).microsoftMode).toBe("device");
    expect(loadConfig({ ...base, MICROSOFT_CLIENT_ID: "app", MICROSOFT_CLIENT_SECRET: "secret" }).microsoftMode).toBe("confidential");
    expect(() => loadConfig({ ...base, MICROSOFT_CLIENT_SECRET: "secret" })).toThrow(/MICROSOFT_CLIENT_ID is required/);
    const local = loadConfig({
      ...base,
      MICROSOFT_CLIENT_ID: "app",
      MICROSOFT_GRAPH_BASE: "http://127.0.0.1:9",
      MICROSOFT_TOKEN_URL: "http://127.0.0.1:9/token",
      MICROSOFT_AUTH_URL: "http://127.0.0.1:9/authorize",
      MICROSOFT_DEVICE_URL: "http://127.0.0.1:9/devicecode",
    });
    expect(local.microsoftGraphBase).toBe("http://127.0.0.1:9");
    const production = {
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      MAIL_PROVIDER: "gmail",
      MAIL_STORE: "pg",
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      OWNER_TIMEZONE: "UTC",
      PUBLIC_URL: "https://mail.example.com",
      MICROSOFT_CLIENT_ID: "app",
    };
    expect(() => loadConfig({ ...production, MICROSOFT_GRAPH_BASE: "https://graph.microsoft.com.evil.example" })).toThrow(/MICROSOFT_GRAPH_BASE/);
    expect(() => loadConfig({ ...production, MICROSOFT_TOKEN_URL: "http://127.0.0.1:9/token" })).toThrow(/MICROSOFT_TOKEN_URL/);
    expect(() => loadConfig({ ...production, MICROSOFT_AUTH_URL: "https://login.microsoftonline.com.evil.example/authorize" })).toThrow(/MICROSOFT_AUTH_URL/);
    expect(() => loadConfig({ ...production, MICROSOFT_DEVICE_URL: "https://evil.example/devicecode" })).toThrow(/MICROSOFT_DEVICE_URL/);
    expect(loadConfig(production).microsoftMode).toBe("device");
  });

  it("derives keys from CBM_SECRET and lets an explicit key or token win", () => {
    const secret = "cbm-secret-at-least-32-characters-long";
    const derived = loadConfig({ CBM_SECRET: secret, NODE_ENV: "test" });
    expect(derived.encryptionKey).toHaveLength(32);
    expect(derived.ownerToken.length).toBeGreaterThanOrEqual(32);
    expect(derived.cbmSecret).toBe(secret);
    expect(derived.logEncryptionOverride).toBe(false);
    expect(derived.logOwnerTokenOverride).toBe(false);
    expect(derived.mailProvider).toBe("fake");
    const again = loadConfig({ CBM_SECRET: secret, NODE_ENV: "test" });
    expect(again.encryptionKey.equals(derived.encryptionKey)).toBe(true);
    expect(again.ownerToken).toBe(derived.ownerToken);

    const old = loadConfig({
      CBM_SECRET: secret,
      ENCRYPTION_KEY: key,
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      NODE_ENV: "test",
    });
    expect(old.encryptionKey.equals(Buffer.from(key, "base64"))).toBe(true);
    expect(openSeal(old.encryptionKey, seal(old.encryptionKey, "refresh-token"))).toBe("refresh-token");
    expect(old.ownerToken).toBe("owner-token-at-least-32-characters");
    expect(old.logEncryptionOverride).toBe(true);
    expect(old.logOwnerTokenOverride).toBe(true);

    const same = loadConfig({
      CBM_SECRET: secret,
      ENCRYPTION_KEY: derived.encryptionKey.toString("base64"),
      OWNER_TOKEN: derived.ownerToken,
      NODE_ENV: "test",
    });
    expect(same.logEncryptionOverride).toBe(false);
    expect(same.logOwnerTokenOverride).toBe(false);
    expect(() => loadConfig({ CBM_SECRET: "too-short", NODE_ENV: "test" })).toThrow(/CBM_SECRET must be at least 32/);
  });

  it("uses the Vercel production host and POSTGRES_URL, and defaults a production deploy", () => {
    const secret = "cbm-secret-at-least-32-characters-long";
    const vercel = loadConfig({
      CBM_SECRET: secret,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL: "mail.example.com",
      POSTGRES_URL: "postgres://localhost/neon",
    });
    expect(vercel.publicUrl).toBe("https://mail.example.com");
    expect(vercel.databaseUrl).toBe("postgres://localhost/neon");
    expect(vercel.mailStore).toBe("pg");
    expect(vercel.mailMode).toBe("mirror");
    expect(vercel.mailProvider).toBe("live");
    expect(vercel.trustProxy).toBe(true);
    const explicit = loadConfig({
      CBM_SECRET: secret,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL: "mail.example.com",
      PUBLIC_URL: "https://other.example.com",
      DATABASE_URL: "postgres://localhost/primary",
      POSTGRES_URL: "postgres://localhost/neon",
    });
    expect(explicit.publicUrl).toBe("https://other.example.com");
    expect(explicit.databaseUrl).toBe("postgres://localhost/primary");
    expect(() => loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      PUBLIC_URL: "https://mail.example.com",
    })).not.toThrow();
    const bare = loadConfig({
      NODE_ENV: "production",
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: key,
      DATABASE_URL: "postgres://localhost/mail",
      PUBLIC_URL: "https://mail.example.com",
    });
    expect(() => productionNeedsOwner(bare, false)).toThrow(/CBM_SECRET/);
    expect(() => productionNeedsOwner({ ...bare, ownerPassphrase: "correct horse" }, false)).not.toThrow();
    expect(() => productionNeedsOwner(bare, true)).not.toThrow();
    expect(() => productionNeedsOwner({ ...bare, nodeEnv: "test" }, false)).not.toThrow();
  });
});
