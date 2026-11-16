import type { Config } from "../config.js";
import type { Logger } from "../log.js";
import type { Repo } from "../store/repo.js";
import { FakeProvider } from "./fake.js";
import { GmailProvider } from "./gmail.js";
import { ImapProvider, type ImapRuntime } from "./imap.js";
import type { ImapHooks } from "./imap-hooks.js";
import { MicrosoftProvider } from "./microsoft.js";
import { ProviderRouter, type RoutedKind } from "./router.js";
import type { MailProvider } from "./types.js";

export interface ProviderDeps {
  config: Config;
  store: Repo;
  logger: Logger;
  imap?: ImapHooks;
}

export function makeProvider(deps: ProviderDeps): MailProvider {
  if (deps.config.mailProvider === "fake") return new FakeProvider();
  if (deps.config.mailProvider === "imap") return imapProvider(deps);
  if (deps.config.mailProvider === "gmail" || deps.config.mailProvider === "live") {
    return new ProviderRouter(deps.store, liveSlots(deps));
  }
  throw new Error("MAIL_PROVIDER must be fake, gmail, imap, or live");
}

function imapProvider(deps: ProviderDeps): ImapProvider {
  const runtime: ImapRuntime = {
    store: deps.store,
    key: deps.config.encryptionKey,
    logger: deps.logger,
    mailMode: deps.config.mailMode,
    allowPrivateHosts: deps.config.imapAllowPrivateHosts,
    timeoutMs: deps.config.gmailTimeoutMs,
    syncDays: deps.config.syncDays,
    hooks: deps.imap,
  };
  return new ImapProvider(runtime);
}

function liveSlots(deps: ProviderDeps): Map<RoutedKind, MailProvider> {
  const slots = new Map<RoutedKind, MailProvider>();
  slots.set("imap", imapProvider(deps));
  if (deps.config.microsoftClientId) {
    slots.set("microsoft", new MicrosoftProvider({
      store: deps.store,
      key: deps.config.encryptionKey,
      clientId: deps.config.microsoftClientId,
      clientSecret: deps.config.microsoftClientSecret,
      graphBase: deps.config.microsoftGraphBase,
      tokenUrl: deps.config.microsoftTokenUrl,
      timeoutMs: deps.config.gmailTimeoutMs,
      logger: deps.logger,
      mailMode: deps.config.mailMode,
      syncDays: deps.config.syncDays,
      pageSize: deps.config.syncPageSize,
    }));
  }
  if (deps.config.googleClientId && deps.config.googleClientSecret) {
    slots.set("gmail", new GmailProvider({
      store: deps.store,
      key: deps.config.encryptionKey,
      clientId: deps.config.googleClientId,
      clientSecret: deps.config.googleClientSecret,
      apiBase: deps.config.gmailApiBase,
      tokenUrl: deps.config.googleTokenUrl,
      timeoutMs: deps.config.gmailTimeoutMs,
      logger: deps.logger,
    }));
  }
  return slots;
}

/** Points a running router at a client saved from /connect. An env client is left as it was. */
export function installSavedClient(root: MailProvider, config: Config, store: Repo, logger: Logger, kind: "gmail" | "microsoft"): void {
  if (!(root instanceof ProviderRouter)) return;
  if (kind === "gmail") {
    const clientId = config.googleClientId;
    const clientSecret = config.googleClientSecret;
    if (!clientId || !clientSecret) return;
    const existing = root.providerFor({ kind: "gmail" });
    if (existing instanceof GmailProvider) {
      existing.useClient(clientId, clientSecret);
      return;
    }
    root.install("gmail", new GmailProvider({
      store,
      key: config.encryptionKey,
      clientId,
      clientSecret,
      apiBase: config.gmailApiBase,
      tokenUrl: config.googleTokenUrl,
      timeoutMs: config.gmailTimeoutMs,
      logger,
    }));
    return;
  }
  const clientId = config.microsoftClientId;
  if (!clientId) return;
  const existing = root.providerFor({ kind: "microsoft" });
  if (existing instanceof MicrosoftProvider) {
    existing.useClient(clientId, config.microsoftClientSecret);
    return;
  }
  root.install("microsoft", new MicrosoftProvider({
    store,
    key: config.encryptionKey,
    clientId,
    clientSecret: config.microsoftClientSecret,
    graphBase: config.microsoftGraphBase,
    tokenUrl: config.microsoftTokenUrl,
    timeoutMs: config.gmailTimeoutMs,
    logger,
    mailMode: config.mailMode,
    syncDays: config.syncDays,
    pageSize: config.syncPageSize,
  }));
}
