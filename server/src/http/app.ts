import { mkdtempSync, rmSync, writeFileSync, writeSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerValue } from "../auth.js";
import { publicOrigin } from "../auth/resource.js";
import { applyStoredClients } from "../auth/clients.js";
import type { DiscoverDeps } from "../auth/discover.js";
import type { PassphraseCost } from "../auth/passphrase.js";
import { MailAuth, wwwAuthenticate } from "../auth/service.js";
import { AuthStore } from "../auth/store.js";
import { isIanaZone, loadConfig, productionNeedsOwner, type Config, type Env } from "../config.js";
import { Logger, stdoutSink } from "../log.js";
import { createToolRegistry } from "../mcp/register.js";
import { FakeProvider } from "../providers/fake.js";
import { makeProvider } from "../providers/index.js";
import type { ImapHooks } from "../providers/imap-hooks.js";
import type { MailProvider } from "../providers/types.js";
import { ReadService } from "../reads/service.js";
import { WriteService } from "../writes/service.js";
import { migrate } from "../store/migrate.js";
import { Repo } from "../store/repo.js";
import { openSql, type Sql } from "../store/sql.js";
import { systemClock, type Clock } from "../sync/clock.js";
import { JobService } from "../sync/jobs.js";
import { SyncService } from "../sync/service.js";
import { SERVER_VERSION } from "../version.js";
import { handleApp } from "./app-page.js";
import { loopbackCertificate } from "./loopback-tls.js";
import { requestPath } from "./path.js";
import { routeHttp } from "./routes.js";
import type { LogSink } from "../log.js";

export interface Runtime {
  config: Config;
  logger: Logger;
  provider: MailProvider;
  store: Repo;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

export interface Running extends Runtime {
  url: string;
  /** Public certificate for this listener. Clients on loopback must trust it. */
  cert: string;
}

export interface ServerOptions {
  clock?: Clock;
  /** Share one database across listeners. The caller closes it. */
  sql?: Sql;
  /** Captures logs in tests. Production uses stdout. */
  logSink?: LogSink;
  /** Tests inject a provider. Production leaves this unset and uses MAIL_PROVIDER. */
  provider?: MailProvider;
  /** Test IMAP client, resolver, and SMTP. Production leaves this unset. */
  imap?: ImapHooks;
  /** Test hook for the setup claim race. Production leaves this unset. */
  beforeSetupClaim?: () => Promise<void>;
  /** Test DNS and HTTP for Other email. Production leaves this unset. */
  discover?: DiscoverDeps;
  /** Test-only scrypt cost for new passphrase hashes. Production leaves this unset. */
  passphraseCost?: PassphraseCost;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  logger: Logger,
  registry: ReturnType<typeof createToolRegistry>,
  auth: MailAuth,
): Promise<void> {
  if (requestPath(req) !== "/mcp") {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const header = req.headers.authorization;
  const headerValue = Array.isArray(header) ? header[0] : header;
  const presented = bearerValue(headerValue);
  const allowed = await auth.bearerOk(req, presented);
  if (!allowed) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    try {
      res.setHeader("www-authenticate", wwwAuthenticate(publicOrigin(req, config), presented.length > 0));
    } catch {
      /* A missing host still gets 401. The header needs an origin. */
    }
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }));
    return;
  }

  const mcp = new McpServer({ name: "chatterbuilt-mail", version: SERVER_VERSION });
  registry.mount(mcp);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    logger.info("mcp failed", { name: error instanceof Error ? error.name : "Error" });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      }));
    }
  }
}

export async function buildRuntime(env: Env = process.env, options: ServerOptions = {}): Promise<Runtime> {
  const config = loadConfig(env);
  const logger = new Logger(options.logSink ?? stdoutSink);
  logger.redact(config.ownerToken);
  logger.redact(config.encryptionKey.toString("base64"));
  if (config.cbmSecret) logger.redact(config.cbmSecret);
  if (config.logEncryptionOverride) logger.info("ENCRYPTION_KEY is set, so CBM_SECRET is not used for encryption");
  if (config.logOwnerTokenOverride) logger.info("OWNER_TOKEN is set, so CBM_SECRET is not used for the owner token");
  if (config.ownerPassphrase) logger.redact(config.ownerPassphrase);
  if (config.googleClientSecret) logger.redact(config.googleClientSecret);
  if (config.microsoftClientSecret) logger.redact(config.microsoftClientSecret);
  if (config.cronSecret) logger.redact(config.cronSecret);
  if (config.anthropicApiKey) logger.redact(config.anthropicApiKey);
  if (config.openrouterApiKey) logger.redact(config.openrouterApiKey);
  const ownsSql = !options.sql;
  const sql: Sql = options.sql ?? await openSql(config);
  await migrate(sql);
  const store = new Repo(sql);
  const authStore = new AuthStore(sql);
  productionNeedsOwner(config, (await authStore.ownerPassphraseHash()) !== null);
  if (config.ownerTimezoneDefaulted) {
    const storedZone = await authStore.ownerZone();
    if (storedZone && isIanaZone(storedZone)) {
      config.ownerTimezone = storedZone;
      config.ownerTimezoneDefaulted = false;
    }
  }
  await applyStoredClients(config, authStore, logger);
  const provider = options.provider ?? makeProvider({ config, store, logger, imap: options.imap });
  if (!options.provider && provider instanceof FakeProvider) {
    await provider.installDemo(store, config.encryptionKey, logger);
  }
  if (config.smokeImap) {
    await store.upsertAccount({ id: "imap_smoke", email: "ada@example.com", label: "IMAP", kind: "imap" }, 50);
  }
  const clock = options.clock ?? systemClock;
  const sync = new SyncService(config, store, provider, logger, clock);
  const jobs = new JobService(config, store, provider, logger, clock);
  const reads = new ReadService(config, store, provider, logger, sync, jobs, clock);
  const writes = new WriteService(store, provider, logger, config.mailMode);
  const auth = new MailAuth({
    config,
    store: authStore,
    repo: store,
    logger,
    clock,
    imap: options.imap,
    beforeSetupClaim: options.beforeSetupClaim,
    root: provider,
    discover: options.discover,
    ...(options.passphraseCost ? { passphraseCost: options.passphraseCost } : {}),
  });
  const registry = createToolRegistry(reads, writes, sync);
  await reads.indexAll();
  if (config.ownerTimezoneDefaulted) {
    logger.info("OWNER_TIMEZONE defaulting to UTC");
  }
  logger.info("ready", { mode: config.mailMode, provider: config.mailProvider, store: config.mailStore });
  return {
    config,
    logger,
    provider,
    store,
    handle: async (req, res) => {
      const path = requestPath(req);
      if (await auth.handle(req, res, path)) return;
      if (await handleApp(req, res, { config, logger, store, auth, registry })) return;
      const handled = await routeHttp(req, res, { config, store, sync, jobs, logger });
      if (handled) return;
      await handleMcp(req, res, config, logger, registry, auth);
    },
    close: async () => {
      if (ownsSql) await sql.close();
    },
  };
}

function advertisedUrl(host: string, port: number): string {
  const name = host.includes(":") ? `[${host}]` : host;
  return `https://${name}:${port}`;
}

export async function createServer(env: Env = process.env, options: ServerOptions = {}): Promise<Running> {
  const runtime = await buildRuntime(env, options);
  const tls = loopbackCertificate();
  const trustDir = mkdtempSync(join(tmpdir(), "cbm-mail-trust-"));
  const trustFile = join(trustDir, "cert.pem");
  writeFileSync(trustFile, tls.cert, { mode: 0o644 });
  const server = createHttpsServer({ cert: tls.cert, key: tls.key }, (req, res) => {
    void runtime.handle(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(runtime.config.port, runtime.config.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : runtime.config.port;
  const url = advertisedUrl(runtime.config.host, port);
  writeSync(1, `trust-file ${trustFile}\n`);
  writeSync(1, `listening ${url}\n`);
  let closed = false;
  return {
    ...runtime,
    url,
    cert: tls.cert,
    close: async () => {
      if (closed) return;
      closed = true;
      rmSync(trustDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          const code = error && "code" in error ? error.code : "";
          if (error && code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
      });
      await runtime.close();
    },
  };
}
