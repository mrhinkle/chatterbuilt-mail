# Design: the Chatterbuilt Mail connector

*Status: proposed, November 2026. Nothing here is built yet.*

One small server that each person deploys for themselves and adds to Claude as a connector. It reads and sends their mail: Gmail through the Gmail API, anything else through IMAP and SMTP. The page talks to it with the same tools it already uses for claude.ai's Gmail connector, so the page barely changes.

## Why

Three reasons, in order:

1. **Mail that isn't Gmail.** Chatterbuilt Mail is for other people too, and plenty of them are on Outlook, iCloud, Fastmail or their company's own server. Today the page only reaches Gmail, through claude.ai's Gmail connector or through Composio.
2. **Speed.** Through Composio, every Gmail call takes an extra hop: page → claude.ai → Composio → Gmail. A reply too large for Composio to return directly is saved to a file in its sandbox, and the page reads it back in 30 KB pieces, one call each. Our own server answers each user action in one call, with just the fields the page reads. **Settings → Speed** (0.7.7) measures where the time goes today; use it before and after.
3. **Fidelity.** Composio's draft update drops a reply's threading headers (`In-Reply-To`, `References`) and its attachments unless they're sent again. Our server keeps both.

## What the person gets

1. Click **Deploy to Vercel** on the repo. It makes their own copy of the server in their own Vercel account.
2. Add their mail accounts on the server's setup page (below).
3. In claude.ai, add the server's URL as a custom connector and sign in once with their passphrase.
4. In their copy of Chatterbuilt Mail, set `CONFIG.gmail.via = "chatterbuilt"`.

Nothing about their mail touches Chatterbuilt's servers. Their passwords and tokens live in their Vercel project and nowhere else.

## How Claude connects to it

claude.ai connects to custom connectors that use either no sign-in or OAuth with Dynamic Client Registration (the 3/26 auth spec). It doesn't accept a static API key, client ID or client secret ([Anthropic: building custom connectors](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)). It speaks both Streamable HTTP and SSE; we use Streamable HTTP.

A mail server with no sign-in would let anyone with the URL read the mail, so the server runs its own small OAuth server:

- Dynamic Client Registration, so claude.ai can register itself.
- One owner. The sign-in page asks for a passphrase set in the `OWNER_PASSPHRASE` environment variable, compared in constant time and rate-limited.
- Short-lived access tokens plus refresh tokens, stored hashed in the person's own database (Postgres or a key-value store in their Vercel project).
- A **Sign out everywhere** button on the setup page that revokes every token.

**To check:** Anthropic's help article said custom connectors weren't on the mobile apps yet ([same article](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)). It may be out of date. Confirm on a phone before promising phone support for this path.

## Mail accounts

One server can hold several accounts, as Composio does today. Each tool takes an optional `acct`, and `list_accounts` returns `{ id, email, label, kind }` for each.

| Kind | How it reaches the mail | What the person sets up |
|---|---|---|
| `gmail` | Gmail API (REST) | A Google Cloud OAuth client, then **Connect Google** on the setup page, which stores a refresh token |
| `imap` | IMAP to read, SMTP to send | Host, port, user name and an app password, entered on the setup page |

**Google's catch.** An OAuth app whose consent screen is in *Testing* gets refresh tokens that expire after 7 days ([Google](https://developers.google.com/health/setup?hl=en)). That's fine for trying it and useless day to day. Two ways out:

- **Google Workspace accounts:** set the consent screen to *Internal*, so it's only for that organization's users and doesn't need Google's review. *(Confirm Internal apps keep refresh tokens past 7 days before relying on it.)*
- **Personal Gmail:** use the `imap` kind with an app password instead. That needs 2-Step Verification on the account ([Smtpedia](https://smtpedia.com/gmail-email-settings-pop3-imap-and-smtp/)). Gmail's password-only sign-in for mail apps ended in 2024 ([Brown University IT](https://ithelp.brown.edu/kb/articles/pdf/less-secure-apps-lsa-deprecation-what-you-need-to-know)). Workspace admins can turn IMAP off for their users.

Gmail over IMAP still has threads, labels and Gmail's search syntax through Gmail's IMAP extensions (`X-GM-THRID`, `X-GM-LABELS`, `X-GM-RAW`). *(Confirm ImapFlow exposes them.)*

**Secrets.** The setup page encrypts each app password and refresh token with a key from the `ACCOUNT_KEY` environment variable before storing it. Nobody pastes a password into Claude, ever: the setup page is the only place a password goes.

## Tools

The same names, inputs and outputs as claude.ai's Gmail connector, which the page already calls on its native path, plus `acct` and three extras. These are every Gmail tool the page calls today, with how many places call each:

| Tool | Calls in the page | Notes |
|---|---|---|
| `search_threads` | 13 | Gmail search syntax. IMAP turns the common operators (`from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `newer_than:`, `in:`) into IMAP SEARCH, or `X-GM-RAW` on Gmail. |
| `get_thread` | 4 | `PLAIN_TEXT` or `FULL_CONTENT`. With full content, a message sent as HTML only comes back with its text too. |
| `send_message` | 5 | New mail, a reply as new mail from another address, or a saved draft (`draftId`). |
| `get_message` | 3 | `RAW` for the attachment viewer and unsubscribe. |
| `list_drafts` / `get_draft` | 3 / 3 | IMAP: the Drafts folder (found by its `\Drafts` special-use flag). |
| `create_draft` / `update_draft` / `delete_draft` | 2 / 1 / 2 | Updates keep threading headers and existing attachments on the server, so the page doesn't send files back and forth. |
| `reply` / `forward` | 1 / 1 | |
| `label_thread` / `unlabel_thread` / `list_labels` / `create_label` | 1 / 1 / 1 / 2 | IMAP without Gmail: labels are folders; `INBOX` removed = archive (move to Archive). |
| `list_send_as` | 2 | Addresses and signatures. Gmail: send-as settings. IMAP: what the setup page lists. |
| `list_accounts` | new | For the account picker and All inboxes. |
| `get_attachment` | new | One attachment by id, base64. |

**Attachments** go in and out as base64, as with claude.ai's Gmail connector, up to 25 MB per message. Inline images (a signature's logo) are kept as inline parts.

**Writes never retry**, on the server or in the page. A failed write may still have run.

## What changes in the page

- `CONFIG.gmail = { via: "chatterbuilt", server: "<connector name>" }` sends Gmail calls to the connector by name on the native path. `gmailComposio()` and its large-reply reader aren't used.
- Account picker, colors and All inboxes come from `list_accounts`, the way they come from `CONFIG.gmail.accounts` for Composio today.
- Attachments: the Drafts editor and the reply box use the same attachment code on every path (in progress for 0.7.8).
- The fake inbox (`scripts/demo/fake.js`) answers the new tools, and the test suites run on this path too.

## Speed targets

Measured with **Settings → Speed**, against today's Composio numbers on the same mailbox:

- Opening a thread, opening a draft, loading the list: **one call each**, no sandbox reads.
- No reply larger than the page needs: text and HTML for the open thread; summaries for the list.
- IMAP: keep a logged-in connection per account between requests where the host allows it. Logging in on every request (a new TLS connection plus `LOGIN`) is the slow part of IMAP. *(Measure on Vercel before choosing a host; if every request is a cold start, use a small always-on host for IMAP accounts.)*

## Building blocks

- **[ImapFlow](https://www.npmjs.com/package/imapflow)**: IMAP client for Node.js, MIT license, by Postal Systems.
- **Nodemailer** for SMTP, and a MIME parser (postal-mime or mailparser) for raw messages. *(Check each license before adding it.)*
- **MCP TypeScript SDK** for the server and its OAuth helpers.
- **Gmail API** over plain `fetch`, to keep dependencies small.
- **Worth reading, not copying:** [email-mcp](https://lobehub.com/mcp/codefuturist-email-mcp) (IMAP and SMTP with threading and drafts; LGPL-3.0, so its code doesn't go into this Apache-2.0 repo) and [mailbox / pim](https://glama.ai/mcp/servers/davidvornholt/mailbox) (MIT; drafts but no sending).

## Phases

| Phase | What | Done when |
|---|---|---|
| 0 | Measure | Settings → Speed has a day of numbers from Composio (shipped in 0.7.7) |
| 1 | Server, OAuth to Claude, Gmail API reads (`list_accounts`, `search_threads`, `get_thread`, `list_labels`) | The list and threads load in the page through the connector |
| 2 | Gmail writes: drafts, send, reply, labels, attachments | Every suite passes on the connector path with the fake; one real draft to yourself checked by hand |
| 3 | IMAP and SMTP accounts | The same suites pass against a test IMAP server |
| 4 | Setup page, Deploy to Vercel, docs | Someone who isn't us sets it up from the docs alone |

## Open questions

- **License.** This repo is Apache-2.0. Chatterbuilt's open core plan is AGPL-3.0 with a commercial option. Which does the connector use?
- **Phones.** Confirm custom connectors work in the Claude phone apps (see above).
- **Hosting IMAP.** Vercel functions, or a small always-on host for IMAP accounts (see Speed targets).
