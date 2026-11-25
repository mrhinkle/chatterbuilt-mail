import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { bearerMatches, secretEqual, sha256 } from "../auth.js";
import { hashPassphrase, verifyPassphrase, type PassphraseCost } from "./passphrase.js";
import { isIanaZone, type Config } from "../config.js";
import { installSavedClient } from "../providers/index.js";
import type { MailProvider } from "../providers/types.js";
import { googleClientIdOk, microsoftClientIdOk, oauthSecretOk } from "./clients.js";
import { discover, liveDiscoverDeps, type DiscoverDeps, type DiscoverOutcome } from "./discover.js";
import { openSeal, seal } from "../crypto/seal.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../log.js";
import { connectImapAccount, type ImapConnectFields } from "../providers/imap-connect.js";
import type { ImapHooks } from "../providers/imap-hooks.js";
import { resolveHooks } from "../providers/imap-hooks.js";
import type { Repo } from "../store/repo.js";
import type { Clock } from "../sync/clock.js";
import { DEVICE_BLOCKED_MESSAGE, formBody, tenantBlockedDeviceCode } from "../providers/microsoft.js";
import {
  connectedPage,
  connectHubPage,
  consentPage,
  type OtherMailForm,
  messagePage,
  microsoftConnectedPage,
  microsoftDevicePage,
  microsoftStartPage,
  setupPage,
  signInFirstPage,
  signInPage,
  signedInPage,
} from "./pages.js";
import { PAGE_STYLE_CSP } from "./style.js";
import {
  ACCESS_TTL_MS,
  CIMD_MAX_BYTES,
  CIMD_TIMEOUT_MS,
  CODE_TTL_MS,
  GOOGLE_SCOPES,
  GOOGLE_STATE_TTL_MS,
  MAIL_SCOPE,
  MICROSOFT_SCOPES,
  PASSPHRASE_GLOBAL_LIMIT,
  PASSPHRASE_IP_LIMIT,
  PASSPHRASE_WINDOW_MS,
  REGISTER_PER_HOUR,
  REGISTER_TOTAL,
  REGISTER_WINDOW_MS,
  REFRESH_TTL_MS,
  SESSION_TTL_MS,
  canonicalResource,
  clientIp,
  headerValue,
  iso,
  metadataUrl,
  publicOrigin,
  sameResource,
} from "./resource.js";
import {
  AuthStore,
  type ClientRecord,
  type PendingAuth,
  type SessionRecord,
} from "./store.js";

const BODY_CAP = 16_384;
const COOKIE = "cbm_owner";
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const PROTECTED = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

export interface AuthDeps {
  config: Config;
  store: AuthStore;
  repo: Repo;
  logger: Logger;
  clock: Clock;
  /** Test IMAP and SMTP. Production leaves this unset. */
  imap?: ImapHooks;
  /** Test hook, after the secret check and before the claim insert. */
  beforeSetupClaim?: () => Promise<void>;
  /** The running provider. A saved client is installed here without a restart. */
  root: MailProvider;
  /** Test DNS and HTTP for Other email. Production leaves this unset. */
  discover?: DiscoverDeps;
  /**
   * Test-only scrypt cost for new hashes. Production leaves this unset.
   * Verify always uses the parameters stored with the hash.
   */
  passphraseCost?: PassphraseCost;
}

const IMAP_CONNECT_PER_HOUR = 10;
const DISCOVER_PER_HOUR = 20;
const IMAP_CONNECT_WINDOW_MS = 60 * 60 * 1000;

export class MailAuth {
  constructor(private readonly deps: AuthDeps) {}

  async bearerOk(req: IncomingMessage, token: string): Promise<boolean> {
    if (token.length > 0 && token.length <= 4096 && bearerMatches(`Bearer ${token}`, this.deps.config.ownerToken)) {
      return true;
    }
    if (!token || token.length > 4096) return false;
    const origin = this.origin(req);
    if (!origin) return false;
    const row = await this.deps.store.access(sha256(token));
    if (!row || row.revokedAt) return false;
    if (row.expiresAt <= iso(this.deps.clock.now())) return false;
    return sameResource(row.resource, canonicalResource(origin));
  }

  /** The signed-in owner session, or null. The token itself stays in the cookie. */
  async ownerSession(req: IncomingMessage): Promise<{ csrf: string; hash: string } | null> {
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) return null;
    return { csrf: loaded.row.csrf, hash: loaded.hash };
  }

  /** One sample call against the shared store. False when this session is over the limit. */
  async allowSample(sessionHash: string, nowMs: number, windowMs: number, limit: number): Promise<boolean> {
    return this.deps.store.allowSample(sessionHash, nowMs, windowMs, limit);
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!this.owns(path)) return false;
    try {
      await this.dispatch(req, res, path);
    } catch (error) {
      this.deps.logger.info("auth failed", { name: error instanceof Error ? error.name : "Error" });
      if (!res.headersSent) sendJson(res, 500, { error: "server_error" });
    }
    return true;
  }

  private owns(path: string): boolean {
    return PROTECTED.has(path)
      || path === "/.well-known/oauth-authorization-server"
      || path === "/authorize"
      || path === "/token"
      || path === "/register"
      || path === "/signin"
      || path === "/setup"
      || path === "/connect"
      || path === "/connect/google/client"
      || path === "/connect/google"
      || path === "/connect/google/callback"
      || path === "/connect/google/disconnect"
      || path === "/connect/imap"
      || path === "/connect/other"
      || path === "/connect/microsoft/client"
      || path === "/connect/microsoft"
      || path === "/connect/microsoft/callback"
      || path === "/connect/microsoft/device/status"
      || path === "/connect/microsoft/disconnect";
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (PROTECTED.has(path)) return this.protectedResource(req, res);
    if (path === "/.well-known/oauth-authorization-server") return this.authorizationServer(req, res);
    if (path === "/authorize") return this.authorize(req, res);
    if (path === "/token") return this.token(req, res);
    if (path === "/register") return this.register(req, res);
    if (path === "/signin") return this.signIn(req, res);
    if (path === "/setup") return this.setup(req, res);
    if (path === "/connect") return this.connectHub(req, res);
    if (path === "/connect/google/client") return this.saveGoogleClient(req, res);
    if (path === "/connect/google") return this.connectStart(req, res);
    if (path === "/connect/google/callback") return this.connectCallback(req, res);
    if (path === "/connect/google/disconnect") return this.disconnect(req, res);
    if (path === "/connect/imap") return this.connectImap(req, res);
    if (path === "/connect/other") return this.connectOther(req, res);
    if (path === "/connect/microsoft/client") return this.saveMicrosoftClient(req, res);
    if (path === "/connect/microsoft") return this.microsoftStart(req, res);
    if (path === "/connect/microsoft/callback") return this.microsoftCallback(req, res);
    if (path === "/connect/microsoft/device/status") return this.microsoftDeviceStatus(req, res);
    if (path === "/connect/microsoft/disconnect") return this.microsoftDisconnect(req, res);
  }

  /** Login and LIST, then SMTP AUTH. The row is written only after both succeed. */
  private async connectImap(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." });
    const session = await this.ownerSession(req);
    if (!session) return sendJson(res, 401, { error: "Sign in first." });
    const csrf = headerValue(req, "x-cbm-csrf");
    if (!csrf || !secretEqual(csrf, session.csrf)) {
      return sendJson(res, 403, { error: "The page token does not match. Reload and try again." });
    }
    if (!(await this.imapUnderLimit(session.hash))) {
      req.resume();
      return sendJson(res, 429, { error: "Too many tries. Wait an hour and try again." });
    }
    const body = await readBody(req);
    if (body === null) return sendJson(res, 400, { error: "That connection form is not valid." });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: "That connection form is not valid." });
    }
    const fields = imapForm(parsed);
    if (!fields) return sendJson(res, 400, { error: "That connection form is not valid." });
    const at = iso(this.deps.clock.now());
    try {
      const id = await connectImapAccount({
        repo: this.deps.repo,
        key: this.deps.config.encryptionKey,
        logger: this.deps.logger,
        allowPrivate: this.deps.config.imapAllowPrivateHosts,
        timeoutMs: this.deps.config.gmailTimeoutMs,
        hooks: resolveHooks(this.deps.imap),
        fields,
        at,
      });
      this.deps.logger.info("imap connected", { account: id });
      sendJson(res, 200, { account: id });
    } catch (error) {
      const message = error instanceof ToolError ? error.message : "The mail server did not accept that connection.";
      sendJson(res, 400, { error: message });
    }
  }

  private origin(req: IncomingMessage): string | null {
    try {
      return publicOrigin(req, this.deps.config).replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  private ownerHome(): string {
    return signedInPage(this.deps.config.microsoftMode !== "off");
  }

  private protectedResource(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method_not_allowed" });
    const origin = this.origin(req);
    if (!origin) return sendJson(res, 400, { error: "invalid_request" });
    sendJson(res, 200, {
      resource: canonicalResource(origin),
      authorization_servers: [origin],
      scopes_supported: [MAIL_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Chatterbuilt Mail",
    }, { cors: true });
  }

  private authorizationServer(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method_not_allowed" });
    const origin = this.origin(req);
    if (!origin) return sendJson(res, 400, { error: "invalid_request" });
    sendJson(res, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: [MAIL_SCOPE],
    }, { cors: true });
  }

  private async authorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET") return this.authorizeGet(req, res);
    if (req.method === "POST") return this.authorizePost(req, res);
    sendJson(res, 405, { error: "method_not_allowed" });
  }

  private async authorizeGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = this.origin(req);
    if (!origin) return sendJson(res, 400, { error: "invalid_request", error_description: "The client or redirect is not valid." });
    const query = queryOf(req);
    const clientId = query.get("client_id") ?? "";
    const redirectUri = query.get("redirect_uri") ?? "";
    const client = clientId ? await this.resolveClient(clientId) : null;
    if (!client || !redirectUri || !client.redirectUris.includes(redirectUri) || !this.redirectOk(redirectUri) || !this.clientHostOk(client.clientId)) {
      return sendJson(res, 400, { error: "invalid_request", error_description: "The client or redirect is not valid." });
    }
    const resource = canonicalResource(origin);
    const fail = (error: string): void => {
      redirect(res, errorRedirect(redirectUri, error, query.get("state"), origin));
    };
    if ((query.get("response_type") ?? "") !== "code") return fail("unsupported_response_type");
    const method = query.get("code_challenge_method");
    const challenge = query.get("code_challenge") ?? "";
    if (method !== "S256" || !challenge) return fail("invalid_request");
    const scopeRaw = query.get("scope");
    if (scopeRaw !== null && scopeRaw !== "" && !scopeIsMail(scopeRaw)) return fail("invalid_scope");
    const requested = query.get("resource");
    if (!requested || !sameResource(requested, resource)) return fail("invalid_target");
    const pending: PendingAuth = {
      clientId: client.clientId,
      redirectUri,
      codeChallenge: challenge,
      resource,
      scope: MAIL_SCOPE,
      clientName: htmlText(client.clientName),
      ...(query.get("state") ? { state: query.get("state") as string } : {}),
    };
    const loaded = await this.loadSession(req);
    const session = loaded ?? await this.freshSession(pending);
    session.row.pending = pending;
    await this.deps.store.saveSession(session.hash, session.row);
    if (!loaded) setCookie(res, session.token);
    if (session.row.authenticated) {
      const page = this.consentBody(session.row.csrf, client.clientName, redirectUri, client.clientId);
      sendHtml(res, page.status, page.html);
    } else sendHtml(res, 200, signInPage(session.row.csrf));
  }

  private async authorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = this.origin(req);
    const loaded = await this.loadSession(req);
    if (!origin || !loaded) return sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
    const body = await readBody(req);
    if (body === null) return sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
    const form = new URLSearchParams(body);
    const decision = form.get("decision");
    if (decision) return this.decide(res, origin, loaded, form, decision);
    return this.acceptPassphrase(req, res, loaded, form, async (session) => {
      if (!session.row.pending) {
        sendHtml(res, 200, this.ownerHome(), session.token);
        return;
      }
      const page = this.consentBody(session.row.csrf, session.row.pending.clientName, session.row.pending.redirectUri, session.row.pending.clientId);
      sendHtml(res, page.status, page.html, session.token);
    });
  }

  private async decide(
    res: ServerResponse,
    origin: string,
    loaded: LoadedSession,
    form: URLSearchParams,
    decision: string,
  ): Promise<void> {
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf) || !loaded.row.authenticated || !loaded.row.pending) {
      sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
      return;
    }
    const pending = loaded.row.pending;
    loaded.row.pending = null;
    await this.deps.store.saveSession(loaded.hash, loaded.row);
    if (!this.redirectOk(pending.redirectUri) || !this.clientHostOk(pending.clientId)) {
      sendHtml(res, 400, messagePage("Connection refused", "This app is not allowed to come back to that address."));
      return;
    }
    if (decision !== "allow") {
      redirect(res, errorRedirect(pending.redirectUri, "access_denied", pending.state, origin));
      return;
    }
    const code = randomToken();
    this.note(code);
    const at = iso(this.deps.clock.now());
    await this.deps.store.saveCode(sha256(code), {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      scope: pending.scope,
      expiresAt: iso(this.deps.clock.now() + CODE_TTL_MS),
    });
    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", code);
    if (pending.state) target.searchParams.set("state", pending.state);
    target.searchParams.set("iss", origin);
    this.deps.logger.info("authorization allowed", { at });
    redirect(res, target.toString());
  }

  private async signIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET") {
      const next = appReturn(queryOf(req).get("next"));
      const loaded = await this.loadSession(req);
      if (loaded?.row.authenticated) {
        if (next) {
          redirect(res, next);
          return;
        }
        sendHtml(res, 200, this.ownerHome());
        return;
      }
      const session = loaded ?? await this.freshSession(null);
      if (!loaded) {
        await this.deps.store.saveSession(session.hash, session.row);
        setCookie(res, session.token);
      }
      const wait = await this.lockoutCopy(req, "ip:", "global");
      sendHtml(res, 200, signInPage(session.row.csrf, undefined, next ?? undefined, wait));
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded) return sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
    const body = await readBody(req);
    if (body === null) return sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
    const form = new URLSearchParams(body);
    await this.acceptPassphrase(req, res, loaded, form, () => {
      const next = appReturn(form.get("next"));
      if (next) {
        redirect(res, next);
        return;
      }
      sendHtml(res, 200, this.ownerHome());
    });
  }

  private async acceptPassphrase(
    req: IncomingMessage,
    res: ServerResponse,
    loaded: LoadedSession,
    form: URLSearchParams,
    done: (session: LoadedSession) => void | Promise<void>,
  ): Promise<void> {
    const submitted = form.get("passphrase") ?? "";
    if (submitted.length >= 4 && submitted.length <= 512) this.note(submitted);
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Sign in", "This form has expired."));
      return;
    }
    const now = this.deps.clock.now();
    const ip = clientIp(req, this.deps.config.trustProxy);
    const ipCount = await this.deps.store.failureCount(`ip:${ip}`, now, PASSPHRASE_WINDOW_MS);
    const globalCount = await this.deps.store.failureCount("global", now, PASSPHRASE_WINDOW_MS);
    if (ipCount >= PASSPHRASE_IP_LIMIT || globalCount >= PASSPHRASE_GLOBAL_LIMIT) {
      const wait = await this.lockoutCopy(req, "ip:", "global") ?? "Too many tries. Wait and then type the passphrase again.";
      sendHtml(res, 429, signInPage(loaded.row.csrf, undefined, appReturn(form.get("next")) ?? undefined, wait));
      return;
    }
    const expected = this.deps.config.ownerPassphrase;
    const stored = expected ? null : await this.deps.store.ownerPassphraseHash();
    const matches = expected
      ? secretEqual(submitted, expected)
      : stored !== null && await verifyPassphrase(submitted, stored, (message) => {
        this.deps.logger.info(message);
      });
    if (!matches) {
      await this.deps.store.bumpFailure(`ip:${ip}`, now, PASSPHRASE_WINDOW_MS);
      await this.deps.store.bumpFailure("global", now, PASSPHRASE_WINDOW_MS);
      this.deps.logger.info("sign-in refused");
      sendHtml(res, 401, signInPage(loaded.row.csrf, "That passphrase is not right.", appReturn(form.get("next")) ?? undefined));
      return;
    }
    const rotated = await this.rotate(loaded);
    setCookie(res, rotated.token);
    await done(rotated);
  }

  /** One claim, while no passphrase exists in the env or the store. */
  private async setup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (await this.ownerConfigured()) {
      sendHtml(res, 404, messagePage("Setup is closed", "This server already has an owner. Sign in."));
      return;
    }
    const expected = this.deps.config.cbmSecret;
    if (!expected) {
      sendHtml(res, 404, messagePage("Setup is closed", "Set CBM_SECRET before opening this page."));
      return;
    }
    if (req.method === "GET") {
      const loaded = await this.loadSession(req);
      const session = loaded ?? await this.freshSession(null);
      if (!loaded) setCookie(res, session.token);
      const page = this.setupForm(session.row.csrf);
      sendHtml(res, 200, page.html, undefined, page.csp);
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded) return sendHtml(res, 400, messagePage("Set up this mail server", "This form has expired."));
    const body = await readBody(req);
    if (body === null) return sendHtml(res, 400, messagePage("Set up this mail server", "This form has expired."));
    const form = new URLSearchParams(body);
    const submittedSecret = form.get("secret") ?? "";
    const passphrase = form.get("passphrase") ?? "";
    const confirm = form.get("confirm") ?? "";
    if (submittedSecret.length >= 4) this.note(submittedSecret);
    if (passphrase.length >= 4 && passphrase.length <= 512) this.note(passphrase);
    if (confirm.length >= 4 && confirm.length <= 512) this.note(confirm);
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Set up this mail server", "This form has expired."));
      return;
    }
    const now = this.deps.clock.now();
    const ip = clientIp(req, this.deps.config.trustProxy);
    const ipCount = await this.deps.store.failureCount(`setup:${ip}`, now, PASSPHRASE_WINDOW_MS);
    const globalCount = await this.deps.store.failureCount("setup:global", now, PASSPHRASE_WINDOW_MS);
    if (ipCount >= PASSPHRASE_IP_LIMIT || globalCount >= PASSPHRASE_GLOBAL_LIMIT) {
      const wait = await this.lockoutCopy(req, "setup:", "setup:global") ?? "Too many tries. Wait and then type the setup secret again.";
      sendHtml(res, 429, messagePage("Too many tries", wait));
      return;
    }
    if (!secretEqual(submittedSecret, expected)) {
      await this.deps.store.bumpFailure(`setup:${ip}`, now, PASSPHRASE_WINDOW_MS);
      await this.deps.store.bumpFailure("setup:global", now, PASSPHRASE_WINDOW_MS);
      this.deps.logger.info("setup refused");
      const page = this.setupForm(loaded.row.csrf, "That setup secret is not right.", "secret");
      sendHtml(res, 401, page.html, undefined, page.csp);
      return;
    }
    if (confirm !== passphrase) {
      const page = this.setupForm(loaded.row.csrf, "The two passphrases don't match. Type them again.", "confirm");
      sendHtml(res, 400, page.html, undefined, page.csp);
      return;
    }
    if (passphrase.length < 12 || passphrase.length > 512) {
      const why = passphrase.length > 512 ? "Use at most 512 characters." : "Use at least 12 characters.";
      const page = this.setupForm(loaded.row.csrf, why, "passphrase");
      sendHtml(res, 400, page.html, undefined, page.csp);
      return;
    }
    const submittedZone = (form.get("timezone") ?? "").trim();
    const zone = this.deps.config.ownerTimezoneDefaulted && isIanaZone(submittedZone) ? submittedZone : null;
    if (this.deps.beforeSetupClaim) await this.deps.beforeSetupClaim();
    const won = await this.deps.store.claimOwner(await hashPassphrase(passphrase, this.deps.passphraseCost), zone, iso(now));
    if (!won) {
      this.deps.logger.info("setup lost the claim");
      sendHtml(res, 409, messagePage("Setup is closed", "Someone else finished setup. Sign in with the passphrase that was saved."));
      return;
    }
    if (zone) {
      this.deps.config.ownerTimezone = zone;
      this.deps.config.ownerTimezoneDefaulted = false;
    }
    this.deps.logger.info("setup claimed");
    const rotated = await this.rotate(loaded);
    setCookie(res, rotated.token);
    redirect(res, "/connect");
  }

  private async ownerConfigured(): Promise<boolean> {
    if (this.deps.config.ownerPassphrase) return true;
    return (await this.deps.store.ownerPassphraseHash()) !== null;
  }

  private setupForm(csrf: string, error?: string, invalid?: "secret" | "passphrase" | "confirm"): { html: string; csp: string } {
    const nonce = randomToken(16);
    return {
      html: setupPage(csrf, error, nonce, !this.deps.config.cronSecret, invalid),
      csp: `script-src 'nonce-${nonce}'`,
    };
  }

  /** Plain wait copy. Does not say which bucket tripped. */
  private async lockoutCopy(req: IncomingMessage, ipPrefix: string, globalBucket: string): Promise<string | undefined> {
    const now = this.deps.clock.now();
    const ip = clientIp(req, this.deps.config.trustProxy);
    const ipBucket = `${ipPrefix}${ip}`;
    const ipCount = await this.deps.store.failureCount(ipBucket, now, PASSPHRASE_WINDOW_MS);
    const globalCount = await this.deps.store.failureCount(globalBucket, now, PASSPHRASE_WINDOW_MS);
    if (ipCount < PASSPHRASE_IP_LIMIT && globalCount < PASSPHRASE_GLOBAL_LIMIT) return undefined;
    const ipLeft = await this.deps.store.failureWindowRemaining(ipBucket, now, PASSPHRASE_WINDOW_MS);
    const globalLeft = await this.deps.store.failureWindowRemaining(globalBucket, now, PASSPHRASE_WINDOW_MS);
    const left = Math.max(ipLeft, globalLeft);
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    if (minutes === 1) return "Too many tries. Wait about a minute, then try again.";
    return `Too many tries. Wait about ${minutes} minutes, then try again.`;
  }

  /** The three connect cards. The owner session is required. */
  private async connectHub(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    const origin = this.origin(req);
    const loaded = await this.loadSession(req);
    if (!origin || !loaded?.row.authenticated) {
      sendHtml(res, 401, signInFirstPage("a mailbox"));
      return;
    }
    const page = await this.connectForm(loaded.row.csrf, origin);
    sendHtml(res, 200, page.html, undefined, page.csp);
  }

  private async saveGoogleClient(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const posted = await this.ownerPost(req, res);
    if (!posted) return;
    const secret = posted.form.get("client_secret") ?? "";
    if (secret.length >= 4) this.note(secret);
    if (this.deps.config.googleClientFromEnv) {
      await this.sendConnect(res, posted, 409, "This host already has a Google client.");
      return;
    }
    const clientId = (posted.form.get("client_id") ?? "").trim();
    if (!googleClientIdOk(clientId) || !oauthSecretOk(secret)) {
      await this.sendConnect(res, posted, 400, "That Google client is not valid. The client ID ends in .apps.googleusercontent.com.");
      return;
    }
    const at = iso(this.deps.clock.now());
    await this.deps.store.saveProviderClient("google", clientId, seal(this.deps.config.encryptionKey, secret), at);
    this.deps.config.googleClientId = clientId;
    this.deps.config.googleClientSecret = secret;
    installSavedClient(this.deps.root, this.deps.config, this.deps.repo, this.deps.logger, "gmail");
    this.deps.logger.info("google client saved");
    redirect(res, "/connect");
  }

  private async saveMicrosoftClient(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const posted = await this.ownerPost(req, res);
    if (!posted) return;
    const secret = (posted.form.get("client_secret") ?? "").trim();
    if (secret.length >= 4) this.note(secret);
    if (this.deps.config.microsoftClientFromEnv) {
      await this.sendConnect(res, posted, 409, "This host already has a Microsoft client.");
      return;
    }
    const clientId = (posted.form.get("client_id") ?? "").trim();
    if (!microsoftClientIdOk(clientId) || (secret.length > 0 && !oauthSecretOk(secret))) {
      await this.sendConnect(res, posted, 400, "That Microsoft client is not valid. The client ID is the application id from Entra.");
      return;
    }
    const at = iso(this.deps.clock.now());
    const sealed = secret ? seal(this.deps.config.encryptionKey, secret) : null;
    await this.deps.store.saveProviderClient("microsoft", clientId, sealed, at);
    this.deps.config.microsoftClientId = clientId;
    this.deps.config.microsoftClientSecret = secret || undefined;
    this.deps.config.microsoftMode = secret ? "confidential" : "device";
    installSavedClient(this.deps.root, this.deps.config, this.deps.repo, this.deps.logger, "microsoft");
    this.deps.logger.info("microsoft client saved");
    redirect(res, "/connect");
  }

  private async sendConnect(res: ServerResponse, posted: OwnerPost, status: number, error: string): Promise<void> {
    const page = await this.connectForm(posted.loaded.row.csrf, posted.origin, error);
    sendHtml(res, status, page.html, undefined, page.csp);
  }

  /** A signed-in POST with a matching CSRF token. The secret stays out of the reply. */
  private async ownerPost(req: IncomingMessage, res: ServerResponse): Promise<OwnerPost | null> {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return null;
    }
    const origin = this.origin(req);
    const loaded = await this.loadSession(req);
    if (!origin || !loaded?.row.authenticated) {
      sendHtml(res, 401, signInFirstPage("a mailbox"));
      return null;
    }
    const body = await readBody(req);
    if (body === null) {
      sendHtml(res, 400, messagePage("Connect a mailbox", "This form has expired."));
      return null;
    }
    const form = new URLSearchParams(body);
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Connect a mailbox", "This form has expired."));
      return null;
    }
    return { loaded, form, origin };
  }

  private async connectForm(csrf: string, origin: string, error?: string, other?: OtherMailForm): Promise<{ html: string; csp: string }> {
    const nonce = randomToken(16);
    const config = this.deps.config;
    const googleReady = Boolean(config.googleClientId && config.googleClientSecret);
    const microsoftReady = Boolean(config.microsoftClientId);
    const accounts = await this.deps.repo.listAccounts();
    return {
      html: connectHubPage({
        csrf,
        origin,
        googleReady,
        googleSaved: googleReady && !config.googleClientFromEnv,
        microsoftReady,
        microsoftDevice: microsoftReady && !config.microsoftClientSecret,
        microsoftSaved: microsoftReady && !config.microsoftClientFromEnv,
        error,
        nonce,
        other,
        accounts: accounts.map((item) => ({ id: item.id, email: item.email, kind: item.kind })),
      }),
      csp: `script-src 'nonce-${nonce}'`,
    };
  }

  /** Find settings, or connect with the same read-only IMAP and SMTP check as /connect/imap. */
  private async connectOther(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const posted = await this.ownerPost(req, res);
    if (!posted) return;
    const action = posted.form.get("action") ?? "";
    const draft = otherFromForm(posted.form);
    const password = posted.form.get("password") ?? "";
    if (password.length >= 4) this.note(password);
    if (action !== "find" && action !== "connect") {
      await this.sendOther(res, posted, 400, "That form is not valid.", draft);
      return;
    }
    if (!draft.email.includes("@") || draft.email.length > 320) {
      await this.sendOther(res, posted, 400, "Type the mailbox address.", draft);
      return;
    }
    const typedHosts = draft.host.length > 0 && draft.smtpHost.length > 0;
    if (action === "connect" && typedHosts) {
      await this.finishOther(res, posted, password, draft);
      return;
    }
    if (!(await this.discoverAllowed(posted.loaded.hash))) {
      await this.sendOther(res, posted, 429, "Too many lookups. Wait an hour and try again.", draft);
      return;
    }
    const outcome = await discover(draft.email, this.discoverDeps());
    const view = otherFromOutcome(draft.email, outcome, draft);
    if (action === "find" || outcome.kind !== "settings") {
      const status = action === "connect" && outcome.kind === "miss" ? 400 : 200;
      await this.sendOther(res, posted, status, "", view);
      return;
    }
    await this.finishOther(res, posted, password, view);
  }

  private async finishOther(res: ServerResponse, posted: OwnerPost, password: string, draft: OtherMailForm): Promise<void> {
    if (!password) {
      await this.sendOther(res, posted, 400, "Type the app password.", draft);
      return;
    }
    const fields = otherFields(draft, password);
    if (!fields) {
      await this.sendOther(res, posted, 400, "That connection form is not valid.", draft);
      return;
    }
    if (!(await this.imapUnderLimit(posted.loaded.hash))) {
      await this.sendOther(res, posted, 429, "Too many tries. Wait an hour and try again.", draft);
      return;
    }
    try {
      const id = await connectImapAccount({
        repo: this.deps.repo,
        key: this.deps.config.encryptionKey,
        logger: this.deps.logger,
        allowPrivate: this.deps.config.imapAllowPrivateHosts,
        timeoutMs: this.deps.config.gmailTimeoutMs,
        hooks: resolveHooks(this.deps.imap),
        fields,
        at: iso(this.deps.clock.now()),
      });
      this.deps.logger.info("imap connected", { account: id });
      sendHtml(res, 200, messagePage("Mailbox connected", `This server will use ${draft.email}. Nothing has been copied yet.`));
    } catch (error) {
      const message = error instanceof ToolError ? error.message : "The mail server did not accept that connection.";
      await this.sendOther(res, posted, 400, message, draft);
    }
  }

  private async sendOther(res: ServerResponse, posted: OwnerPost, status: number, note: string, draft: OtherMailForm): Promise<void> {
    const other = note ? { ...draft, note } : draft;
    const page = await this.connectForm(posted.loaded.row.csrf, posted.origin, undefined, other);
    sendHtml(res, status, page.html, undefined, page.csp);
  }

  private discoverDeps(): DiscoverDeps {
    return this.deps.discover ?? liveDiscoverDeps(this.deps.config.gmailTimeoutMs, this.deps.config.imapAllowPrivateHosts);
  }

  private async discoverAllowed(sessionHash: string): Promise<boolean> {
    return this.deps.store.allowSample(`discover:${sessionHash}`, this.deps.clock.now(), IMAP_CONNECT_WINDOW_MS, DISCOVER_PER_HOUR);
  }

  private async imapUnderLimit(sessionHash: string): Promise<boolean> {
    const at = iso(this.deps.clock.now());
    await this.deps.repo.recordImapConnectAttempt(sessionHash, at);
    const since = iso(this.deps.clock.now() - IMAP_CONNECT_WINDOW_MS);
    const count = await this.deps.repo.countImapConnectAttempts(sessionHash, since);
    return count <= IMAP_CONNECT_PER_HOUR;
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const body = await readBody(req);
    if (body === null) return sendJson(res, 400, { error: "invalid_client_metadata" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: "invalid_client_metadata" });
    }
    const result = OAuthClientMetadataSchema.safeParse(parsed);
    if (!result.success) return sendJson(res, 400, { error: "invalid_client_metadata" });
    const meta = result.data;
    if (meta.redirect_uris.length === 0) return sendJson(res, 400, { error: "invalid_client_metadata" });
    if (meta.redirect_uris.some((uri) => !this.redirectOk(uri))) {
      return sendJson(res, 400, { error: "invalid_client_metadata" });
    }
    if (meta.grant_types && meta.grant_types.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) {
      return sendJson(res, 400, { error: "invalid_client_metadata" });
    }
    if (meta.response_types && meta.response_types.some((kind) => kind !== "code")) {
      return sendJson(res, 400, { error: "invalid_client_metadata" });
    }
    const method = (meta.token_endpoint_auth_method ?? "none") as string;
    if (method !== "none" && method !== "client_secret_basic" && method !== "client_secret_post") {
      return sendJson(res, 400, { error: "invalid_client_metadata" });
    }
    const registered = await this.deps.store.registrationLoad(iso(this.deps.clock.now() - REGISTER_WINDOW_MS));
    if (registered.recent >= REGISTER_PER_HOUR || registered.total >= REGISTER_TOTAL) {
      return sendJson(res, 429, { error: "rate_limited" });
    }
    const clientId = `c_${randomToken(24)}`;
    let secret: string | undefined;
    let secretHash: string | null = null;
    if (method !== "none") {
      secret = randomToken();
      this.note(secret);
      secretHash = sha256(secret);
    }
    const at = iso(this.deps.clock.now());
    await this.deps.store.saveClient({
      clientId,
      secretHash,
      redirectUris: [...meta.redirect_uris],
      clientName: htmlText(meta.client_name ?? ""),
      authMethod: method,
    }, at);
    sendJson(res, 201, {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: meta.client_name ?? "",
      redirect_uris: meta.redirect_uris,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return sendJson(res, 405, { error: "unsupported_grant_type" });
    const origin = this.origin(req);
    if (!origin) return sendJson(res, 400, { error: "invalid_request" });
    const type = headerValue(req, "content-type");
    if (type.includes("application/json")) return sendJson(res, 400, { error: "invalid_request" });
    const body = await readBody(req);
    if (body === null) return sendJson(res, 400, { error: "invalid_request" });
    const form = new URLSearchParams(body);
    const presentedSecret = form.get("client_secret");
    if (presentedSecret) this.note(presentedSecret);
    const basic = basicClient(headerValue(req, "authorization"));
    if (basic?.secret) this.note(basic.secret);
    const clientId = basic?.id || form.get("client_id") || "";
    if (basic?.id && form.get("client_id") && basic.id !== form.get("client_id")) {
      return sendJson(res, 401, { error: "invalid_client" });
    }
    const client = clientId ? await this.resolveClient(clientId) : null;
    if (!client || !this.clientSecretOk(client, form, basic)) {
      return sendJson(res, 401, { error: "invalid_client" });
    }
    const grant = form.get("grant_type") ?? "";
    if (grant === "authorization_code") return this.exchangeCode(res, origin, client, form);
    if (grant === "refresh_token") return this.exchangeRefresh(res, origin, client, form);
    sendJson(res, 400, { error: "unsupported_grant_type" });
  }

  private clientSecretOk(client: ClientRecord, form: URLSearchParams, basic: { id: string; secret: string } | null): boolean {
    if (client.authMethod === "none") return true;
    if (!client.secretHash) return false;
    if (client.authMethod === "client_secret_basic") {
      return Boolean(basic && basic.id === client.clientId && secretEqual(sha256(basic.secret), client.secretHash));
    }
    const secret = form.get("client_secret") ?? "";
    return secretEqual(sha256(secret), client.secretHash);
  }

  private async exchangeCode(res: ServerResponse, origin: string, client: ClientRecord, form: URLSearchParams): Promise<void> {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    if (code) this.note(code);
    if (verifier) this.note(verifier);
    const at = iso(this.deps.clock.now());
    const codeHash = code ? sha256(code) : "";
    const row = codeHash ? await this.deps.store.takeCode(codeHash, at) : null;
    if (!row) {
      await this.revokeReusedCode(codeHash, at);
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    const resource = canonicalResource(origin);
    const requested = form.get("resource") ?? "";
    if (row.expiresAt <= at || row.clientId !== client.clientId) {
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    if (form.get("redirect_uri") !== row.redirectUri) return sendJson(res, 400, { error: "invalid_grant" });
    if (!requested || !sameResource(requested, resource) || !sameResource(requested, row.resource)) {
      return sendJson(res, 400, { error: "invalid_target" });
    }
    if (!pkce(verifier, row.codeChallenge)) return sendJson(res, 400, { error: "invalid_grant" });
    const family = randomToken(16);
    await this.deps.store.rememberCodeFamily(codeHash, family);
    await this.issueTokens(res, client.clientId, row.resource, row.scope, family);
  }

  private async revokeReusedCode(codeHash: string, at: string): Promise<void> {
    if (!codeHash) return;
    const family = await this.deps.store.codeFamily(codeHash);
    if (!family) return;
    await this.deps.store.revokeFamily(family, at);
    this.deps.logger.info("code reuse revoked");
  }

  private async exchangeRefresh(res: ServerResponse, origin: string, client: ClientRecord, form: URLSearchParams): Promise<void> {
    const token = form.get("refresh_token") ?? "";
    if (token) this.note(token);
    const at = iso(this.deps.clock.now());
    const resource = canonicalResource(origin);
    const requested = form.get("resource") ?? "";
    const claimed = token ? await this.deps.store.takeRefresh(sha256(token), at) : null;
    if (!claimed) {
      const existing = token ? await this.deps.store.refreshRow(sha256(token)) : null;
      if (existing && (existing.usedAt || existing.revokedAt)) {
        await this.deps.store.revokeFamily(existing.familyId, at);
        this.deps.logger.info("refresh reuse revoked");
      }
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    if (claimed.clientId !== client.clientId) return sendJson(res, 400, { error: "invalid_grant" });
    if (!requested || !sameResource(requested, resource) || !sameResource(requested, claimed.resource)) {
      return sendJson(res, 400, { error: "invalid_target" });
    }
    await this.issueTokens(res, client.clientId, claimed.resource, claimed.scope, claimed.familyId);
  }

  private async issueTokens(res: ServerResponse, clientId: string, resource: string, scope: string, familyId: string | null): Promise<void> {
    const now = this.deps.clock.now();
    const family = familyId ?? randomToken(16);
    const access = randomToken();
    const refresh = randomToken();
    this.note(access);
    this.note(refresh);
    await this.deps.store.saveAccess(sha256(access), {
      familyId: family,
      clientId,
      resource,
      scope,
      expiresAt: iso(now + ACCESS_TTL_MS),
    });
    await this.deps.store.saveRefresh(sha256(refresh), {
      familyId: family,
      clientId,
      resource,
      scope,
      expiresAt: iso(now + REFRESH_TTL_MS),
    });
    this.deps.logger.info("token issued");
    sendJson(res, 200, {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refresh,
      scope,
    });
  }

  private async connectStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    const origin = this.origin(req);
    const loaded = await this.loadSession(req);
    if (!origin || !loaded?.row.authenticated) {
      this.deps.logger.info("connect refused", { reason: "no_session" });
      sendHtml(res, 401, signInFirstPage());
      return;
    }
    if (!this.deps.config.googleClientId || !this.deps.config.googleClientSecret) {
      sendHtml(res, 400, messagePage("Connect Gmail", "Google sign-in is not set up."));
      return;
    }
    const verifier = randomToken(32);
    const state = randomToken();
    this.note(verifier);
    this.note(state);
    const at = this.deps.clock.now();
    await this.deps.store.saveGoogle(
      sha256(state),
      loaded.hash,
      seal(this.deps.config.encryptionKey, verifier),
      iso(at + GOOGLE_STATE_TTL_MS),
    );
    const target = new URL(this.deps.config.googleAuthUrl);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("client_id", this.deps.config.googleClientId);
    target.searchParams.set("redirect_uri", `${origin}/connect/google/callback`);
    target.searchParams.set("scope", GOOGLE_SCOPES);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", s256(verifier));
    target.searchParams.set("code_challenge_method", "S256");
    target.searchParams.set("access_type", "offline");
    target.searchParams.set("prompt", "consent");
    redirect(res, target.toString());
  }

  private async connectCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      this.deps.logger.info("connect refused", { reason: "no_session" });
      sendHtml(res, 401, signInFirstPage());
      return;
    }
    const query = queryOf(req);
    const state = query.get("state") ?? "";
    const code = query.get("code") ?? "";
    if (state) this.note(state);
    if (code) this.note(code);
    const at = iso(this.deps.clock.now());
    const sealed = state ? await this.deps.store.takeGoogle(sha256(state), loaded.hash, at) : null;
    if (!sealed) {
      this.deps.logger.info("connect refused", { reason: "bad_state" });
      sendHtml(res, 400, messagePage("Connect Gmail", "This connection link is not valid."));
      return;
    }
    if (!code) {
      this.deps.logger.info("connect refused", { reason: "bad_state" });
      sendHtml(res, 400, messagePage("Connect Gmail", "This connection link is not valid."));
      return;
    }
    if (!(await this.deps.store.takeGoogleCode(sha256(code), at))) {
      this.deps.logger.info("connect refused", { reason: "reused_code" });
      sendHtml(res, 400, messagePage("Connect Gmail", "This Google code was already used."));
      return;
    }
    let verifier = "";
    try {
      verifier = openSeal(this.deps.config.encryptionKey, sealed);
    } catch {
      this.deps.logger.info("connect refused", { reason: "bad_state" });
      sendHtml(res, 400, messagePage("Connect Gmail", "This connection link is not valid."));
      return;
    }
    this.note(verifier);
    const origin = this.origin(req);
    if (!origin) {
      sendHtml(res, 400, messagePage("Connect Gmail", "Google sign-in did not complete. Nothing was saved."));
      return;
    }
    const tokens = await this.googleToken(code, verifier, `${origin}/connect/google/callback`);
    if (!tokens) {
      this.deps.logger.info("connect refused", { reason: "token_failed" });
      sendHtml(res, 400, messagePage("Connect Gmail", "Google sign-in did not complete. Nothing was saved."));
      return;
    }
    if (!tokens.refreshToken) {
      this.deps.logger.info("connect refused", { reason: "no_refresh" });
      sendHtml(res, 400, messagePage("Connect Gmail", "Google did not return a refresh token. Nothing was saved."));
      return;
    }
    const email = await this.googleEmail(tokens.accessToken);
    if (!email) {
      this.deps.logger.info("connect refused", { reason: "no_profile" });
      sendHtml(res, 400, messagePage("Connect Gmail", "Google did not return an address. Nothing was saved."));
      return;
    }
    const accountId = await this.deps.repo.connectGmail(email, JSON.stringify({
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: this.deps.clock.now() + tokens.expiresIn * 1000,
    }), this.deps.config.encryptionKey, at);
    try {
      await this.deps.repo.appendAudit({
        accountId,
        tool: "connect_google",
        targetIds: [],
        outcome: "ok",
        at,
      });
    } catch {
      this.deps.logger.info("connect audit failed", { account: accountId });
    }
    this.deps.logger.info("gmail connected", { account: accountId });
    sendHtml(res, 200, connectedPage(formToken(loaded.row.csrf), htmlText(email), htmlText(accountId)));
  }

  private async microsoftStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      this.deps.logger.info("connect refused", { reason: "no_session" });
      sendHtml(res, 401, signInFirstPage("Microsoft"));
      return;
    }
    const mode = this.deps.config.microsoftMode;
    if (mode === "off") {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in is not set up."));
      return;
    }
    if (mode === "confidential") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
      await this.microsoftRedirect(req, res, loaded);
      return;
    }
    if (req.method === "GET") {
      const row = await this.deps.store.deviceForSession(loaded.hash);
      const now = iso(this.deps.clock.now());
      const link = row ? httpsVerificationUri(row.verificationUri) : null;
      if (row && !row.usedAt && row.expiresAt > now && link) {
        this.sendDevicePage(res, row.userCode, link, row.intervalSeconds);
        return;
      }
      sendHtml(res, 200, microsoftStartPage(formToken(loaded.row.csrf)));
      return;
    }
    const body = await readBody(req);
    if (body === null || !secretEqual(new URLSearchParams(body).get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "This form has expired."));
      return;
    }
    await this.microsoftDeviceBegin(res, loaded);
  }

  private async microsoftRedirect(req: IncomingMessage, res: ServerResponse, loaded: LoadedSession): Promise<void> {
    const origin = this.origin(req);
    const clientId = this.deps.config.microsoftClientId ?? "";
    if (!origin || !clientId || !this.deps.config.microsoftClientSecret) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in is not set up."));
      return;
    }
    const verifier = randomToken(32);
    const state = randomToken();
    this.note(verifier);
    this.note(state);
    const at = this.deps.clock.now();
    await this.deps.store.saveMicrosoft(
      sha256(state),
      loaded.hash,
      seal(this.deps.config.encryptionKey, verifier),
      iso(at + GOOGLE_STATE_TTL_MS),
    );
    const target = new URL(this.deps.config.microsoftAuthUrl);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("response_mode", "query");
    target.searchParams.set("client_id", clientId);
    target.searchParams.set("redirect_uri", `${origin}/connect/microsoft/callback`);
    target.searchParams.set("scope", MICROSOFT_SCOPES);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", s256(verifier));
    target.searchParams.set("code_challenge_method", "S256");
    target.searchParams.set("prompt", "select_account");
    redirect(res, target.toString());
  }

  private async microsoftDeviceBegin(res: ServerResponse, loaded: LoadedSession): Promise<void> {
    const clientId = this.deps.config.microsoftClientId ?? "";
    const url = this.deps.config.microsoftDeviceUrl;
    if (!clientId || !deviceUrlAllowed(url, this.deps.config.nodeEnv)) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in did not start. Nothing was saved."));
      return;
    }
    const posted = await this.microsoftPost(url, new URLSearchParams({ client_id: clientId, scope: MICROSOFT_SCOPES }));
    if (!posted) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in did not start. Nothing was saved."));
      return;
    }
    const error = textField(posted.json, "error");
    const description = textField(posted.json, "error_description");
    if (tenantBlockedDeviceCode(error, description)) {
      sendHtml(res, 400, messagePage("Connect Microsoft", DEVICE_BLOCKED_MESSAGE));
      return;
    }
    const deviceCode = textField(posted.json, "device_code");
    const userCode = textField(posted.json, "user_code");
    const verificationUri = httpsVerificationUri(textField(posted.json, "verification_uri") ?? "");
    const expiresIn = numberField(posted.json, "expires_in");
    const interval = numberField(posted.json, "interval");
    if (deviceCode) this.note(deviceCode);
    if (userCode) this.note(userCode);
    if (!posted.ok || !deviceCode || !userCode || !verificationUri || expiresIn === null || interval === null || interval < 1) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in did not start. Nothing was saved."));
      return;
    }
    const at = this.deps.clock.now();
    await this.deps.store.saveDevice({
      sessionHash: loaded.hash,
      deviceCodeSealed: seal(this.deps.config.encryptionKey, deviceCode),
      userCode,
      verificationUri,
      expiresAt: iso(at + expiresIn * 1000),
      intervalSeconds: interval,
    });
    this.sendDevicePage(res, userCode, verificationUri, interval);
  }

  private sendDevicePage(res: ServerResponse, userCode: string, verificationUri: string, intervalSeconds: number): void {
    const nonce = randomToken(16);
    sendHtml(
      res,
      200,
      microsoftDevicePage(userCode, verificationUri, intervalSeconds, nonce),
      undefined,
      `script-src 'nonce-${nonce}'; connect-src 'self'`,
    );
  }

  private async microsoftDeviceStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      sendJson(res, 401, { status: "error", message: "Sign in first." });
      return;
    }
    if (this.deps.config.microsoftMode !== "device") {
      sendJson(res, 200, { status: "error", message: "Microsoft sign-in is not set up." });
      return;
    }
    const row = await this.deps.store.deviceForSession(loaded.hash);
    const nowMs = this.deps.clock.now();
    const now = iso(nowMs);
    if (!row || row.usedAt) {
      sendJson(res, 200, { status: "error", message: "That code is not for this sign-in." });
      return;
    }
    if (row.expiresAt <= now) {
      sendJson(res, 200, { status: "error", message: "That code expired. Start again." });
      return;
    }
    if (row.lastPollAt) {
      const last = Date.parse(row.lastPollAt);
      if (Number.isFinite(last) && nowMs < last + row.intervalSeconds * 1000) {
        sendJson(res, 200, { status: "pending", interval: row.intervalSeconds });
        return;
      }
    }
    const claimed = await this.deps.store.claimDevicePoll(loaded.hash, row.lastPollAt, now);
    if (!claimed) {
      sendJson(res, 200, { status: "pending", interval: row.intervalSeconds });
      return;
    }
    let deviceCode = "";
    try {
      deviceCode = openSeal(this.deps.config.encryptionKey, row.deviceCodeSealed);
    } catch {
      await this.deps.store.deleteDevice(loaded.hash);
      sendJson(res, 200, { status: "error", message: "That code is not for this sign-in." });
      return;
    }
    this.note(deviceCode);
    const clientId = this.deps.config.microsoftClientId ?? "";
    const polled = await this.microsoftPost(this.deps.config.microsoftTokenUrl, formBody({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode,
    }));
    if (!polled) {
      sendJson(res, 200, { status: "error", message: "Microsoft sign-in did not finish. Nothing was saved." });
      return;
    }
    const error = textField(polled.json, "error");
    const description = textField(polled.json, "error_description");
    if (error === "authorization_pending") {
      sendJson(res, 200, { status: "pending", interval: row.intervalSeconds });
      return;
    }
    if (error === "slow_down") {
      const interval = await this.deps.store.bumpDeviceInterval(loaded.hash, iso(this.deps.clock.now()));
      sendJson(res, 200, { status: "pending", interval });
      return;
    }
    if (error === "authorization_declined" || error === "expired_token" || error === "bad_verification_code") {
      await this.deps.store.deleteDevice(loaded.hash);
      sendJson(res, 200, { status: "error", message: deviceEndMessage(error) });
      return;
    }
    if (tenantBlockedDeviceCode(error, description)) {
      await this.deps.store.deleteDevice(loaded.hash);
      sendJson(res, 200, { status: "error", message: DEVICE_BLOCKED_MESSAGE });
      return;
    }
    const accessToken = textField(polled.json, "access_token");
    const refreshToken = textField(polled.json, "refresh_token");
    const expiresIn = numberField(polled.json, "expires_in") ?? 3600;
    if (accessToken) this.note(accessToken);
    if (refreshToken) this.note(refreshToken);
    if (!polled.ok || !accessToken || !refreshToken) {
      sendJson(res, 200, { status: "error", message: "Microsoft sign-in did not finish. Nothing was saved." });
      return;
    }
    await this.deps.store.deleteDevice(loaded.hash);
    const email = await this.microsoftEmail(accessToken);
    if (!email) {
      sendJson(res, 200, { status: "error", message: "Microsoft did not return an address. Nothing was saved." });
      return;
    }
    const at = iso(this.deps.clock.now());
    const accountId = await this.deps.repo.connectMicrosoft(email, JSON.stringify({
      refreshToken,
      accessToken,
      expiresAt: this.deps.clock.now() + expiresIn * 1000,
    }), this.deps.config.encryptionKey, at);
    try {
      await this.deps.repo.appendAudit({ accountId, tool: "connect_microsoft", targetIds: [], outcome: "ok", at });
    } catch {
      this.deps.logger.info("connect audit failed", { account: accountId });
    }
    this.deps.logger.info("microsoft connected", { account: accountId });
    sendJson(res, 200, { status: "done" });
  }

  private async microsoftCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      this.deps.logger.info("connect refused", { reason: "no_session" });
      sendHtml(res, 401, signInFirstPage("Microsoft"));
      return;
    }
    if (this.deps.config.microsoftMode !== "confidential") {
      sendHtml(res, 400, messagePage("Connect Microsoft", "This connection link is not valid."));
      return;
    }
    const query = queryOf(req);
    const state = query.get("state") ?? "";
    const code = query.get("code") ?? "";
    if (state) this.note(state);
    if (code) this.note(code);
    const at = iso(this.deps.clock.now());
    const sealed = state ? await this.deps.store.takeMicrosoft(sha256(state), loaded.hash, at) : null;
    if (!sealed || !code || !(await this.deps.store.takeMicrosoftCode(sha256(code), at))) {
      this.deps.logger.info("connect refused", { reason: "bad_state" });
      sendHtml(res, 400, messagePage("Connect Microsoft", "This connection link is not valid."));
      return;
    }
    let verifier = "";
    try {
      verifier = openSeal(this.deps.config.encryptionKey, sealed);
    } catch {
      sendHtml(res, 400, messagePage("Connect Microsoft", "This connection link is not valid."));
      return;
    }
    this.note(verifier);
    const origin = this.origin(req);
    const clientId = this.deps.config.microsoftClientId ?? "";
    const secret = this.deps.config.microsoftClientSecret;
    if (!origin || !clientId || !secret) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in did not complete. Nothing was saved."));
      return;
    }
    const posted = await this.microsoftPost(this.deps.config.microsoftTokenUrl, formBody({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: `${origin}/connect/microsoft/callback`,
      code_verifier: verifier,
    }, secret));
    const accessToken = posted ? textField(posted.json, "access_token") : "";
    const refreshToken = posted ? textField(posted.json, "refresh_token") : "";
    const expiresIn = posted ? numberField(posted.json, "expires_in") ?? 3600 : 3600;
    if (accessToken) this.note(accessToken);
    if (refreshToken) this.note(refreshToken);
    if (!posted?.ok || !accessToken || !refreshToken) {
      this.deps.logger.info("connect refused", { reason: "token_failed" });
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft sign-in did not complete. Nothing was saved."));
      return;
    }
    const email = await this.microsoftEmail(accessToken);
    if (!email) {
      sendHtml(res, 400, messagePage("Connect Microsoft", "Microsoft did not return an address. Nothing was saved."));
      return;
    }
    const accountId = await this.deps.repo.connectMicrosoft(email, JSON.stringify({
      refreshToken,
      accessToken,
      expiresAt: this.deps.clock.now() + expiresIn * 1000,
    }), this.deps.config.encryptionKey, at);
    try {
      await this.deps.repo.appendAudit({ accountId, tool: "connect_microsoft", targetIds: [], outcome: "ok", at });
    } catch {
      this.deps.logger.info("connect audit failed", { account: accountId });
    }
    this.deps.logger.info("microsoft connected", { account: accountId });
    sendHtml(res, 200, microsoftConnectedPage(formToken(loaded.row.csrf), htmlText(email), htmlText(accountId)));
  }

  private async microsoftDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      sendHtml(res, 401, signInFirstPage("Microsoft"));
      return;
    }
    const body = await readBody(req);
    if (body === null) return sendHtml(res, 400, messagePage("Disconnect", "This form has expired."));
    const form = new URLSearchParams(body);
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Disconnect", "This form has expired."));
      return;
    }
    const accountId = form.get("account") ?? "";
    const accounts = await this.deps.repo.listAccounts();
    const account = accounts.find((item) => item.id === accountId && item.kind === "microsoft");
    const removed = account ? await this.deps.repo.disconnectAccount(accountId) : false;
    if (!removed) {
      sendHtml(res, 400, messagePage("Disconnect", "That account is not connected."));
      return;
    }
    const at = iso(this.deps.clock.now());
    try {
      await this.deps.repo.appendAudit({ accountId, tool: "disconnect_microsoft", targetIds: [], outcome: "ok", at });
    } catch {
      this.deps.logger.info("disconnect audit failed", { account: accountId });
    }
    sendHtml(res, 200, messagePage("Disconnected", "Microsoft is disconnected. The saved token and the copied mail for that account are gone."));
  }

  private async microsoftPost(url: string, body: URLSearchParams): Promise<{ ok: boolean; json: Record<string, unknown> } | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(this.deps.config.gmailTimeoutMs),
      });
    } catch {
      return null;
    }
    const text = await readLimited(response, BODY_CAP);
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return { ok: response.ok, json: parsed as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  private async microsoftEmail(accessToken: string): Promise<string | null> {
    const base = this.deps.config.microsoftGraphBase.endsWith("/")
      ? this.deps.config.microsoftGraphBase
      : `${this.deps.config.microsoftGraphBase}/`;
    let url: string;
    try {
      const target = new URL("v1.0/me", base);
      target.searchParams.set("$select", "mail,userPrincipalName");
      url = target.toString();
    } catch {
      return null;
    }
    if (!sameOrigin(url, this.deps.config.microsoftGraphBase)) return null;
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "error",
        headers: {
          authorization: `Bearer ${accessToken}`,
          prefer: 'IdType="ImmutableId"',
        },
        signal: AbortSignal.timeout(this.deps.config.gmailTimeoutMs),
      });
    } catch {
      return null;
    }
    const text = await readLimited(response, BODY_CAP);
    if (text === null || !response.ok) return null;
    try {
      const parsed = JSON.parse(text) as { mail?: unknown; userPrincipalName?: unknown };
      const mail = typeof parsed.mail === "string" && parsed.mail.includes("@") ? parsed.mail : "";
      const upn = typeof parsed.userPrincipalName === "string" && parsed.userPrincipalName.includes("@") ? parsed.userPrincipalName : "";
      return mail || upn || null;
    } catch {
      return null;
    }
  }

  private async disconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
    const loaded = await this.loadSession(req);
    if (!loaded?.row.authenticated) {
      sendHtml(res, 401, signInFirstPage());
      return;
    }
    const body = await readBody(req);
    if (body === null) return sendHtml(res, 400, messagePage("Disconnect", "This form has expired."));
    const form = new URLSearchParams(body);
    if (!secretEqual(form.get("csrf") ?? "", loaded.row.csrf)) {
      sendHtml(res, 400, messagePage("Disconnect", "This form has expired."));
      return;
    }
    const accountId = form.get("account") ?? "";
    const removed = accountId ? await this.deps.repo.disconnectAccount(accountId) : false;
    if (!removed) {
      sendHtml(res, 400, messagePage("Disconnect", "That account is not connected."));
      return;
    }
    const at = iso(this.deps.clock.now());
    try {
      await this.deps.repo.appendAudit({
        accountId,
        tool: "disconnect_google",
        targetIds: [],
        outcome: "ok",
        at,
      });
    } catch {
      this.deps.logger.info("disconnect audit failed", { account: accountId });
    }
    sendHtml(res, 200, messagePage("Disconnected", "Gmail is disconnected. The saved token and the copied mail for that account are gone."));
  }

  private async googleToken(code: string, verifier: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number } | null> {
    const url = this.deps.config.googleTokenUrl;
    if (!sameOrigin(url, url)) return null;
    const clientId = this.deps.config.googleClientId ?? "";
    const clientSecret = this.deps.config.googleClientSecret ?? "";
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(this.deps.config.gmailTimeoutMs),
      });
    } catch {
      return null;
    }
    const text = await readLimited(response, BODY_CAP);
    if (text === null || !response.ok) return null;
    let parsed: { refresh_token?: unknown; access_token?: unknown; expires_in?: unknown };
    try {
      parsed = JSON.parse(text) as { refresh_token?: unknown; access_token?: unknown; expires_in?: unknown };
    } catch {
      return null;
    }
    const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
    const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    if (accessToken) this.note(accessToken);
    if (refreshToken) this.note(refreshToken);
    const expiresIn = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 3600;
    if (!accessToken) return null;
    return { refreshToken, accessToken, expiresIn };
  }

  private async googleEmail(accessToken: string): Promise<string | null> {
    const base = this.deps.config.gmailApiBase.endsWith("/") ? this.deps.config.gmailApiBase : `${this.deps.config.gmailApiBase}/`;
    let url: string;
    try {
      url = new URL("gmail/v1/users/me/profile", base).toString();
    } catch {
      return null;
    }
    if (!sameOrigin(url, this.deps.config.gmailApiBase)) return null;
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "error",
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(this.deps.config.gmailTimeoutMs),
      });
    } catch {
      return null;
    }
    const text = await readLimited(response, BODY_CAP);
    if (text === null || !response.ok) return null;
    try {
      const parsed = JSON.parse(text) as { emailAddress?: unknown };
      return typeof parsed.emailAddress === "string" && parsed.emailAddress.includes("@") ? parsed.emailAddress : null;
    } catch {
      return null;
    }
  }

  private async resolveClient(clientId: string): Promise<ClientRecord | null> {
    if (metadataClientUrl(clientId, this.deps.config.nodeEnv)) return this.fetchClient(clientId);
    if (isHttpUrl(clientId)) return null;
    return this.deps.store.client(clientId);
  }

  /** Fetches a Client ID Metadata Document. The URL is the client_id, checked before the request leaves the process. */
  private async fetchClient(clientId: string): Promise<ClientRecord | null> {
    const target = metadataClientUrl(clientId, this.deps.config.nodeEnv);
    if (!target || !this.hostOk(target.hostname) || !(await metadataHostAllowed(target, this.deps.config.nodeEnv))) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    const href = target.href;
    let response: Response;
    try {
      response = await fetch(href, { redirect: "error", signal: AbortSignal.timeout(CIMD_TIMEOUT_MS) });
    } catch {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    if (!response.ok) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    const text = await readLimited(response, CIMD_MAX_BYTES);
    if (text === null) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    if (!raw || typeof raw !== "object") return null;
    const documentId = (raw as { client_id?: unknown }).client_id;
    if (documentId !== clientId) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    const parsed = OAuthClientMetadataSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.client_name || parsed.data.redirect_uris.length === 0) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    if (parsed.data.redirect_uris.some((uri) => !this.redirectOk(uri))) {
      this.deps.logger.info("client metadata refused");
      return null;
    }
    return {
      clientId,
      secretHash: null,
      redirectUris: [...parsed.data.redirect_uris],
      clientName: htmlText(parsed.data.client_name),
      authMethod: "none",
    };
  }

  private async loadSession(req: IncomingMessage): Promise<LoadedSession | null> {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const hash = sha256(token);
    const row = await this.deps.store.session(hash);
    if (!row) return null;
    if (row.expiresAt <= iso(this.deps.clock.now())) {
      await this.deps.store.deleteSession(hash);
      return null;
    }
    return { token, hash, row };
  }

  private async freshSession(pending: PendingAuth | null): Promise<LoadedSession> {
    const token = randomToken();
    const now = iso(this.deps.clock.now());
    const row: SessionRecord = {
      csrf: randomToken(24),
      authenticated: false,
      pending,
      expiresAt: iso(this.deps.clock.now() + SESSION_TTL_MS),
      createdAt: now,
    };
    await this.deps.store.saveSession(sha256(token), row);
    return { token, hash: sha256(token), row };
  }

  private async rotate(loaded: LoadedSession): Promise<LoadedSession> {
    const token = randomToken();
    const row: SessionRecord = {
      ...loaded.row,
      csrf: randomToken(24),
      authenticated: true,
      expiresAt: iso(this.deps.clock.now() + SESSION_TTL_MS),
    };
    const hash = sha256(token);
    await this.deps.store.saveSession(hash, row);
    await this.deps.store.deleteSession(loaded.hash);
    return { token, hash, row };
  }

  private note(value: string): void {
    if (value.length >= 4) this.deps.logger.redact(value);
  }

  private redirectOk(value: string): boolean {
    return redirectAllowed(value, this.deps.config.nodeEnv, this.deps.config.oauthRedirectHosts);
  }

  private hostOk(hostname: string): boolean {
    return hostListed(hostname, this.deps.config.nodeEnv, this.deps.config.oauthRedirectHosts);
  }

  /** A registered client id is not a URL. A metadata client id's host must be allowed. */
  private clientHostOk(clientId: string): boolean {
    if (!isHttpUrl(clientId)) return true;
    const url = metadataClientUrl(clientId, this.deps.config.nodeEnv);
    if (!url) return false;
    return this.hostOk(url.hostname);
  }

  private consentBody(csrf: string, clientName: string, redirectUri: string, clientId: string): { status: number; html: string } {
    if (!this.redirectOk(redirectUri) || !this.clientHostOk(clientId)) {
      return {
        status: 400,
        html: messagePage("Connection refused", "This app is not allowed to come back to that address."),
      };
    }
    let redirectHost = "";
    try {
      redirectHost = new URL(redirectUri).hostname;
    } catch {
      return {
        status: 400,
        html: messagePage("Connection refused", "This app is not allowed to come back to that address."),
      };
    }
    const meta = metadataClientUrl(clientId, this.deps.config.nodeEnv);
    return {
      status: 200,
      html: consentPage(formToken(csrf), htmlText(clientName), redirectHost, meta ? meta.hostname : undefined),
    };
  }
}

interface LoadedSession {
  token: string;
  hash: string;
  row: SessionRecord;
}

interface OwnerPost {
  loaded: LoadedSession;
  form: URLSearchParams;
  origin: string;
}

export function wwwAuthenticate(origin: string, presented: boolean): string {
  const base = `Bearer resource_metadata="${metadataUrl(origin)}", scope="${MAIL_SCOPE}"`;
  return presented ? `${base}, error="invalid_token"` : base;
}

function textField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function numberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deviceEndMessage(error: string): string {
  if (error === "authorization_declined") return "Microsoft sign-in was declined.";
  if (error === "expired_token") return "That code expired. Start again.";
  return "That code was not accepted. Start again.";
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function pkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  return secretEqual(s256(verifier), challenge);
}

function scopeIsMail(value: string): boolean {
  const parts = value.split(" ").filter(Boolean);
  return parts.length > 0 && parts.every((part) => part === MAIL_SCOPE);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopback(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":")) {
    if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function htmlText(value: string): string {
  return value.replace(/[<>&"'`]/g, "").trim().slice(0, 200);
}

/** A verification link is an https URL with no userinfo. Anything else is not shown. */
function httpsVerificationUri(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function formToken(value: string): string {
  const match = /^([A-Za-z0-9_-]{16,128})$/.exec(value);
  return match?.[1] ?? "";
}

async function metadataHostAllowed(target: URL, nodeEnv: string): Promise<boolean> {
  if (isLoopback(target.hostname)) return nodeEnv !== "production";
  if (isPrivateHost(target.hostname)) return false;
  let records: Array<{ address: string }>;
  try {
    records = await lookup(target.hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return records.length > 0 && records.every((row) => {
    const address = row.address.toLowerCase().startsWith("::ffff:") ? row.address.slice(7) : row.address;
    if (nodeEnv !== "production" && isLoopback(address)) return true;
    return !isPrivateHost(address);
  });
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function metadataClientUrl(value: string, nodeEnv: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname || url.pathname === "/") return null;
  if (url.protocol === "https:") {
    if (nodeEnv === "production" && isPrivateHost(url.hostname)) return null;
    return url;
  }
  if (url.protocol === "http:" && nodeEnv !== "production" && isLoopback(url.hostname)) return url;
  return null;
}

function hostListed(hostname: string, nodeEnv: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hosts.includes(host)) return true;
  return nodeEnv !== "production" && isLoopback(host);
}

export function redirectAllowed(value: string, nodeEnv: string, hosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const schemeOk = url.protocol === "https:"
    || (url.protocol === "http:" && nodeEnv !== "production" && isLoopback(url.hostname));
  if (!schemeOk) return false;
  return hostListed(url.hostname, nodeEnv, hosts);
}

function sameOrigin(target: string, allowed: string): boolean {
  try {
    return new URL(target).origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}

/** Device-code start posts only to the pinned login host. Tests may use loopback. */
function deviceUrlAllowed(url: string, nodeEnv: string): boolean {
  if (sameOrigin(url, "https://login.microsoftonline.com")) return true;
  if (nodeEnv === "production") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && isLoopback(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function errorRedirect(redirectUri: string, error: string, state: string | null | undefined, issuer: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

/** The only return path sign-in will follow. Anything else is ignored. */
function appReturn(value: string | null): "/app" | null {
  return value === "/app" ? "/app" : null;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  const raw = req.url ?? "/";
  const index = raw.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : raw.slice(index + 1));
}

function readCookie(req: IncomingMessage, name: string): string {
  const raw = headerValue(req, "cookie");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
}

function basicClient(header: string): { id: string; secret: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)$/.exec(header.trim());
  if (!match || !match[1]) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index < 0) return null;
  return { id: safeDecode(decoded.slice(0, index)), secret: safeDecode(decoded.slice(index + 1)) };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function otherFromForm(form: URLSearchParams): OtherMailForm {
  const security = form.get("security") === "starttls" ? "starttls" : form.get("security") === "tls" ? "tls" : "";
  return {
    email: (form.get("email") ?? "").trim(),
    host: (form.get("host") ?? "").trim(),
    port: (form.get("port") ?? "").trim(),
    security,
    user: (form.get("user") ?? "").trim(),
    smtpHost: (form.get("smtpHost") ?? "").trim(),
    smtpPort: (form.get("smtpPort") ?? "").trim(),
    helpUrl: "",
    helpLabel: "",
    note: "",
    discoveredHost: (form.get("discoveredHost") ?? "").trim(),
    discoveredSmtp: (form.get("discoveredSmtp") ?? "").trim(),
    serverKeepsSent: form.get("serverKeepsSent") === "1",
  };
}

function otherFromOutcome(email: string, outcome: DiscoverOutcome, typed: OtherMailForm): OtherMailForm {
  if (outcome.kind === "settings") {
    const settings = outcome.settings;
    return {
      email,
      host: settings.imapHost,
      port: String(settings.imapPort),
      security: settings.imapSecurity,
      user: email,
      smtpHost: settings.smtpHost,
      smtpPort: String(settings.smtpPort),
      helpUrl: settings.helpUrl ?? "",
      helpLabel: settings.helpLabel ?? "",
      note: settings.note ?? "",
      discoveredHost: settings.imapHost,
      discoveredSmtp: settings.smtpHost,
      serverKeepsSent: settings.serverKeepsSent,
      provider: settings.provider,
    };
  }
  if (outcome.kind === "stop") {
    return { ...typed, email, host: "", port: "", smtpHost: "", smtpPort: "", user: "", note: outcome.message, helpUrl: outcome.helpUrl, helpLabel: outcome.helpLabel, discoveredHost: "", discoveredSmtp: "", serverKeepsSent: false };
  }
  if (outcome.kind === "card") {
    return { ...typed, email, host: "", port: "", smtpHost: "", smtpPort: "", user: "", note: outcome.message, helpUrl: "", helpLabel: "", discoveredHost: "", discoveredSmtp: "", serverKeepsSent: false };
  }
  return { ...typed, email, note: outcome.message, helpUrl: "", helpLabel: "" };
}

/** Advanced values win. saveSent stays true unless those values are the ones discovery just filled. */
function otherFields(draft: OtherMailForm, password: string): ImapConnectFields | null {
  const security = draft.security === "starttls" ? "starttls" : draft.security === "tls" ? "tls" : null;
  const port = portField(draft.port);
  const smtpPort = portField(draft.smtpPort);
  const user = draft.user || draft.email;
  if (!security || port === null || smtpPort === null || !password) return null;
  if (!mailHostOk(draft.host) || !mailHostOk(draft.smtpHost) || !user || user.length > 320) return null;
  const same = draft.discoveredHost.length > 0 && draft.host === draft.discoveredHost && draft.smtpHost === draft.discoveredSmtp;
  return {
    email: draft.email,
    host: draft.host,
    port,
    security,
    user,
    password,
    smtpHost: draft.smtpHost,
    smtpPort,
    aliases: [],
    saveSent: same && draft.serverKeepsSent ? false : true,
  };
}

function mailHostOk(value: string): boolean {
  if (!value || value.length > 253 || value.includes("..") || value.startsWith(".") || value.endsWith(".")) return false;
  return /^[A-Za-z0-9.-]+$/.test(value) && !/[\s/\\]/.test(value);
}

/** The connect form. A bad field is a null, never a half-filled account. */
function imapForm(value: unknown): ImapConnectFields | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const email = trimmedText(body.email);
  const host = trimmedText(body.host);
  const user = trimmedText(body.user);
  const password = trimmedText(body.password) || trimmedText(body.appPassword);
  const smtpHost = trimmedText(body.smtpHost);
  const security = body.security;
  const port = portField(body.port);
  const smtpPort = portField(body.smtpPort);
  if (!email.includes("@") || email.length > 320) return null;
  if (!host || host.length > 253 || !user || user.length > 320 || !password || !smtpHost || smtpHost.length > 253) return null;
  if (security !== "tls" && security !== "starttls") return null;
  if (port === null || smtpPort === null) return null;
  const aliases = aliasList(body.aliases);
  if (!aliases) return null;
  const saveSent = body.saveSent === false || body.saveSent === "false" ? false : true;
  return { email, host, port, security, user, password, smtpHost, smtpPort, aliases, saveSent };
}

function trimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function portField(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  const port = typeof value === "number" ? value : typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function aliasList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const aliases: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const alias = item.trim();
    if (!alias.includes("@") || alias.length > 320) return null;
    aliases.push(alias);
  }
  return aliases;
}

function readBody(req: IncomingMessage): Promise<string | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > BODY_CAP) {
    req.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > BODY_CAP) {
        finish(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function readLimited(response: Response, max: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text) > max ? null : text;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const buf = Buffer.from(step.value);
    total += buf.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function setCookie(res: ServerResponse, token: string): void {
  res.setHeader("set-cookie", `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function sendHtml(res: ServerResponse, status: number, html: string, cookie?: string, cspExtra?: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  const extra = cspExtra ? `${cspExtra}; ${PAGE_STYLE_CSP}; ` : `${PAGE_STYLE_CSP}; `;
  res.setHeader("content-security-policy", `default-src 'none'; ${extra}form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  if (cookie) setCookie(res, cookie);
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown, options: { cors?: boolean } = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (options.cors) {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "*");
  }
  res.end(JSON.stringify(body));
}

function noContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("cache-control", "no-store");
  res.end();
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.end();
}

