# Chatterbuilt Mail server

Lane 1d is sign-in and connecting Gmail. The page's tool names and shapes are in `CONTRACT.md`. `sync_now` is registered. `/mcp` accepts an OAuth access token or `OWNER_TOKEN`. A missing or bad token is 401 with `WWW-Authenticate: Bearer resource_metadata="…"`. The owner signs in at `/signin` with `OWNER_PASSPHRASE` and connects Gmail at `/connect/google`. An IMAP account connects at `POST /connect/imap` and its tool calls are served. Microsoft mail works when `MICROSOFT_CLIENT_ID` is set, at `/connect/microsoft`. Until that name is set, a Microsoft tool call says Microsoft sign-in is not set up.

`MAIL_MODE=mirror` (the default) serves reads from Postgres and fetches a missing thread body from the provider once. `MAIL_MODE=direct` reads the provider and stores only accounts, tokens, and the audit log. A write does the same: the provider first, then the store in `mirror`, and only an audit row in `direct`. A failed or timed-out provider call leaves the mail tables unchanged and is not retried. If the store or the audit log fails after the provider has accepted the write, the tool still returns success, and a failed store marks that thread for the next sync. Gmail and token fetches time out (default 20 seconds, `GMAIL_TIMEOUT_MS`). A read timeout is retried once. A write timeout is not. `MAIL_PROVIDER=fake` is the demo mailbox. `MAIL_PROVIDER=gmail` talks to Gmail's REST API with the owner's OAuth client. Tokens are read from the store. Boot does not backfill a Gmail mailbox. `sync_now` and `/api/cron/sync` do, for the last `SYNC_DAYS` (default 30), one `SYNC_BUDGET_MS` slice at a time (default 20 seconds), then the History API. An expired history id re-syncs. It does not skip. Direct mode's `sync_now` returns `direct mode does not sync` and writes no mail. The jobs table is written in both modes: a claimed row is the lock that makes a snooze or remind-me run once. An unfinished claim older than 10 minutes can be claimed again, because adding INBOX and UNREAD and removing the label is safe to repeat.

Due snoozes and remind-me labels (`CB/Snooze/YYYY-MM-DD` and `CB/Remind/YYYY-MM-DD`, same names as the page) run on `/api/cron/jobs` and `/api/cron/sync`, after a verified Gmail push to `/api/gmail/push`, and at the start of a read at most once every five minutes per account. A label dated today wakes at 06:00 in `OWNER_TIMEZONE`. An earlier date is already due. A past label that a search finds empty is not searched again. Cron wants `Authorization: Bearer` and `CRON_SECRET`. Push wants a Google OIDC token for `GMAIL_PUSH_AUDIENCE` and `GMAIL_PUSH_SERVICE_ACCOUNT`. Once that token checks out, a sync failure still answers 204. Cron and the next push catch up. `vercel.json` schedules both cron paths once a day (`0 13 * * *`) because Vercel Hobby runs cron once a day. On Pro, use `*/5 * * * *` for `/api/cron/sync` and `*/15 * * * *` for `/api/cron/jobs`. A read still runs a short incremental sync when the last one is over a minute old, so Hobby is not the only clock.

## Dev

`server/.npmrc` sets `include=dev` so `npm ci` still installs the typecheck, lint, and test tools when `NODE_ENV` is `production`. The server process itself still refuses PGlite and the demo provider in production.

From this directory, with Node 20 or newer:

```bash
export OWNER_TOKEN=dev-owner-token-at-least-32-characters
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export MAIL_STORE=pglite
export MAIL_MODE=mirror
export MAIL_PROVIDER=fake
export NODE_ENV=development
npm install
npm run dev
```

The process prints `listening https://127.0.0.1:<port>` and `trust-file <path>`. The certificate is generated for that process and is valid for localhost only. `POST /mcp` with `Authorization: Bearer $OWNER_TOKEN` is the Streamable HTTP MCP endpoint. A missing or wrong token is 401 and the `WWW-Authenticate` header names `/.well-known/oauth-protected-resource`. `OWNER_TOKEN` must be at least 32 characters. Set `OWNER_PASSPHRASE` to open `/signin` and `/connect/google` on this listener. `PUBLIC_URL` is required when `NODE_ENV=production`: an `https` origin with no path. When it is unset outside production, metadata uses the request host. Leave `GOOGLE_AUTH_URL` unset unless a test points it at a fake Google host. The dev listener refuses any `HOST` that is not loopback. Deployed traffic uses the Vercel function, which terminates TLS at the platform edge.

The dev listener is HTTPS on loopback with a certificate that exists only for that process. A later page harness has to trust the printed `trust-file`, or set Playwright `ignoreHTTPSErrors`.

Summaries, triage, and drafts on `/app` use `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. The key stays on the server. `SAMPLE_MODEL` is the one model id sent to whichever of those is configured. When it is unset, Anthropic uses `claude-haiku-5-5` and OpenRouter uses `anthropic/claude-haiku-5.5`. Leave `ANTHROPIC_API_BASE` and `OPENROUTER_API_BASE` unset in production. Production accepts only `https://api.anthropic.com` and `https://openrouter.ai`.

PGlite and `MAIL_PROVIDER=fake` refuse to start when `NODE_ENV=production`. Production Gmail needs `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_PASSPHRASE`, and `OWNER_TIMEZONE` (an IANA name, such as `America/New_York`). `OWNER_TIMEZONE` is required whenever `MAIL_PROVIDER` is not `fake`. When the provider is `fake` and the variable is unset, the server uses UTC and logs `OWNER_TIMEZONE defaulting to UTC` at startup. `PUBLIC_URL` is required in production. `OAUTH_REDIRECT_HOSTS` defaults to `claude.ai`. `VERCEL=1` or `TRUST_PROXY=1` trusts the forwarded host and proto. Leave `GMAIL_API_BASE`, `GOOGLE_TOKEN_URL`, `GOOGLE_AUTH_URL`, and `GMAIL_PUSH_JWKS` unset in production. When `NODE_ENV=production`, any other origin for those Google URLs is refused, and `GMAIL_PUSH_JWKS` is refused. Production verifies push tokens with Google's published keys. The connect flow and the runbook are in `docs/hosted.md`. `MAIL_PROVIDER=live` turns on Gmail, IMAP, and Microsoft together. Gmail works only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Without them, `/connect/google` says `Google sign-in is not set up.` and a Gmail tool call says the same. `MAIL_PROVIDER=gmail` still requires those two at startup, and that deployment can also store IMAP and Microsoft accounts. An IMAP tool call is served. Microsoft mail works when `MICROSOFT_CLIENT_ID` is set. The two setups, device code and the owner's own app, are in `docs/hosted.md`. Until that name is set, a Microsoft tool call says `Microsoft sign-in is not set up.` `list_accounts` adds `kind` and `capabilities` (`filters`, `sendAs`, and `labels` as `labels` or `folders`). IMAP reports `filters: false`, `sendAs: true`, and `labels: "folders"`. The page ignores `kind` and `capabilities`.

## Gate

From this directory:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

From the repo root:

```bash
node scripts/hosted/smoke.mjs
```

The smoke script starts `npm run dev` with the demo provider, then runs MCP `initialize`, `tools/list`, `search_threads`, `get_thread`, `create_draft`, `get_draft`, `delete_draft`, and `sync_now`. Tests use PGlite in-process. Gmail tests talk to an in-process fake HTTP server on loopback. They do not open a real network connection or a real mailbox.

## License

GNU Affero General Public License, version 3 only (AGPL-3.0-only). See [LICENSE](LICENSE). If you run a changed copy of this server for other people over a network, the AGPL asks you to offer them its source. The copyright holder also offers a commercial license. The rest of the repo (the page, skills and docs) is Apache-2.0.
