# Mail tool contract

The page speaks claude.ai Gmail connector names. `gmailComposio()` (`chatterbuilt-mail.template.html`, `gmailComposio` at line 1540 and `gxOne` at line 1607) turns those calls into Composio tools and reshapes the answer back into the connector shape. **That reshaped shape is what the page reads.** The server exposes the same names, inputs and outputs. Composio's raw Gmail payloads are not this contract.

Lane 1c registers the read tools, the write tools, and `sync_now` over MCP. IMAP is served by this server. Microsoft mail works when `MICROSOFT_CLIENT_ID` is set. Until then, a Microsoft tool call says Microsoft sign-in is not set up. The browser page that connects an IMAP account is a later lane.

Every tool takes an optional `account` (the account id). The page still sends `acct` today (`gmailComposio` line 1560, `list_send_as` at line 5133). The server accepts `account` and, for this slice, `acct` as the same field. When both are absent, the call uses the first account. `list_accounts` ignores it.

`pageSize` defaults to 25 and is capped at 50. `pageToken` is opaque. A missing next page is `null`.

## Errors

The page decides what to show in `mcpCopy` (line 1263) and `isNotFound` (line 1262). A tool failure is an object the caller can read as `{ code, message }`. `message` is plain text, at most a short sentence. This slice uses these codes:

| code | when |
|---|---|
| `tool_error` | the tool ran and failed, including not found |
| `rate_limited` | the provider asked us to slow down |
| `needs_reauth` | the account must be connected again |
| `upstream_error` | the provider failed in a way that may be transient |

Not found (unknown thread, message or draft) uses `code: "tool_error"` and a `message` that contains `404` and `Requested entity was not found.` `isNotFound` treats that as gone mail, and ignores messages that also say account, connection, toolkit, or "no such tool".

Reads may try a transient provider failure one more time. A failure is transient only when the provider marks it so (`upstream_error` or `rate_limited` with retry). `needs_reauth` and not-found are not retried. Writes are never retried, at any layer. A read's retry helper is private to the read path.

## Message (what the page reads)

Built by `gxNorm` (line 1377). The page reads these fields (list row at line 1822, open thread at `fetchThread` line 2283, reply addressing at line 1686):

| field | read for |
|---|---|
| `id` | message id |
| `threadId` | which thread |
| `acct` | which account, when more than one is connected |
| `sender` | `Name <email>` or a bare address |
| `toRecipients` | array of the same address shape. Empty array when there are none |
| `ccRecipients` | same. Empty array when there are none |
| `replyTo` | same. Empty array when the header is absent |
| `inReplyTo` | the `In-Reply-To` header, or `""` |
| `date` | ISO-8601 |
| `subject` | string, may be `""` |
| `labelIds` | array of label ids (`INBOX`, `UNREAD`, `SENT`, `STARRED`, user ids) |
| `snippet` | short plain preview. HTML entities already decoded |
| `viewUrl` | link to the thread in the mail host |
| `attachments` | `{ id, filename, mimeType, cid }[]`. `cid` is `""` when the part is not inline |
| `plaintextBody` | present on a full message and on a full draft. Omitted on a summary row and on an ids-only hit |
| `htmlBody` | present only when the caller asked for full content and the message has HTML |
| `references` | present on a full message. The `References` header |

A summary row omits `plaintextBody`, `htmlBody`, and `approx`. Newest-message rows from this server are exact. `FULL_CONTENT` includes `htmlBody` when the message has one, and still includes `plaintextBody`. A message that was stored as HTML only still has `plaintextBody` (text taken from the HTML). The page also fills that in itself at line 2288 if `plaintextBody` is empty and `htmlBody` is set.

## Read tools (this slice)

### `search_threads`

Page calls: lines 1901, 1934, 2021, 3111, 3152, 3571, 3626, 3662, 3691, 4085, 4109, 4822, 5138.

Input:

| field | |
|---|---|
| `query` | Gmail search syntax. `""` is the inbox. |
| `pageSize` | number |
| `pageToken` | string, omit for the first page |
| `view` | `THREAD_VIEW_SUMMARY` (default) or `THREAD_VIEW_IDS_ONLY` |
| `account` | optional |

Output, summary (`gxOne` line 1618). The page reads `threads`, `threads[].id`, `threads[].acct`, `threads[].messageCount`, `threads[].messages[0]` (sender, subject, toRecipients, date, labelIds, snippet), `nextPageToken`, `resultCountEstimate` (lines 1822, 1903, 1936).

```json
{
  "threads": [
    {
      "id": "t1",
      "acct": "gmail_work",
      "messageCount": 1,
      "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#all/t1",
      "messages": [ { "id": "mt1", "threadId": "t1", "acct": "gmail_work", "sender": "Dana Ruiz <dana@acmerobotics.example>", "subject": "Sponsorship for the spring summit", "toRecipients": [], "ccRecipients": [], "replyTo": [], "inReplyTo": "", "date": "2026-11-04T12:00:00.000Z", "labelIds": ["INBOX", "UNREAD"], "snippet": "Hi Alex,", "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#all/t1", "attachments": [] } ]
    }
  ],
  "nextPageToken": null,
  "resultCountEstimate": 1
}
```

`messages` on a summary row holds the newest message that matched, not every message. `messageCount` is the number of stored messages on the thread.

Output, ids only (`gxOne` line 1614). The page reads `id`, `acct`, `snippet`.

```json
{
  "threads": [ { "id": "t1", "acct": "gmail_work", "snippet": "Hi Alex," } ],
  "nextPageToken": null,
  "resultCountEstimate": 1
}
```

The demo mailbox answers the same queries as `scripts/demo/fake.js` `search` (line 36) for the work account, and `gmailBridge` (line 112) for the personal account. Those queries are the ones the page suites use.

### `get_thread`

Page calls: lines 2285, 4912, 5140.

Input: `threadId` (required), `messageFormat` = `PLAIN_TEXT` (default) or `FULL_CONTENT`, `account` optional.

Output (`gxOne` line 1628). The page reads `id`, `messages`, and on each message the message fields above. Order is oldest first.

```json
{
  "id": "t1",
  "acct": "gmail_work",
  "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#all/t1",
  "messages": []
}
```

Unknown thread: not-found error (see Errors).

In `mirror`, a thread whose bodies are not stored yet is fetched from the provider once, stored, then served. The next read of that thread does not call the provider. In `direct`, every read calls the provider and does not store what it fetched, and does not read the mail tables.

`search_threads` asks the provider for one page of ids, then (for a summary view) the metadata of that page only. It does not list the mailbox thread by thread. In `mirror`, a hit that is not in the store yet has its metadata saved, so a later search still returns mail the provider already has. Rows are the provider's page.

A successful write calls the provider once. In `mirror`, it then stores that write's mail rows. In `direct`, it stores nothing but the audit row: no mail, labels, drafts, or filters. A failed or timed-out provider call stores nothing and is not retried. A read that times out is retried once. Once the provider has accepted a write, a store or audit failure is still a success. The audit row, when it can be written, is `ok`, and `store_failed` is set when the store update failed. That row also marks the thread so the next sync fetches it again. The tool does not report that failure. If the failure-path audit itself throws, the provider's error is what the caller still sees. The audit row and the logs never include a body, a subject, or an address's display name. Boot indexes the demo mailbox only. A Gmail mailbox is not backfilled at boot. A mirror read becomes fresh by syncing: when the last sync is older than a minute and the account is already past backfill, the read runs a short incremental sync first (at most a few seconds) and does not start a backfill. Gmail does that only when a history id is already stored. IMAP does it with no history id.

### `get_message`

Page calls: lines 2096, 3008, 3596. Always `messageFormat: "RAW"`.

Input: `messageId` (required), `messageFormat` = `RAW` (default for this server), `account` optional.

Output (`gxOne` line 1631). The page reads `id` and `raw` (base64url of the RFC822 message).

```json
{ "id": "mt5", "raw": "TGlzdC1VbnN1YnNjcmliZTogLi4u" }
```

`mt5` is the Weekly Byte message: the decoded raw contains `List-Unsubscribe`. `mt8` is the Cloudway invoice: the decoded raw is `multipart/mixed` with `CW-2026-1142.pdf`. Any other known message id returns a raw message built from that message. Unknown id: not-found error.

### `list_labels`

Page call: line 2885. The page keeps labels where `labelType === "USER"` and the name does not start with `[` (line 2886), and reads `labelId` and `name`.

Input: `account` optional.

Output (`gxOne` line 1637):

```json
{
  "labels": [
    { "labelId": "INBOX", "name": "INBOX", "labelType": "SYSTEM" },
    { "labelId": "L1", "name": "Finance", "labelType": "USER" }
  ]
}
```

`labelType` is `SYSTEM` or `USER`.

### `list_drafts`

Page calls: lines 4962, 4995, 5111.

Input: `pageSize`, `pageToken`, `view` = `DRAFT_VIEW_METADATA_ONLY` (default) or `DRAFT_VIEW_FULL`, `query` (optional, Gmail syntax; the native path passes `to:` at line 4994), `account` optional.

Metadata output. The page reads `id`, `threadId`, `messageId`, `acct`, `date`, `toRecipients`, `ccRecipients`, `viewUrl` (lines 4964, 4970, 5113). No body fields.

```json
{
  "drafts": [
    {
      "id": "d1",
      "threadId": "t2",
      "messageId": "md1",
      "acct": "gmail_work",
      "toRecipients": ["Lee Park <lee@venuehall.example>"],
      "ccRecipients": [],
      "date": "2026-11-04T14:00:00.000Z",
      "subject": "Re: Venue walkthrough",
      "snippet": "Hi Lee, Tuesday at 10 works.",
      "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#drafts"
    }
  ],
  "nextPageToken": null
}
```

`DRAFT_VIEW_FULL` adds `plaintextBody` and, when present, `htmlBody` and `attachments`, same as `get_draft`.

### `get_draft`

Page calls: lines 4992, 5315, 5326, 5413, 5435.

Input: `draftId` (required), `messageFormat` = `FULL` (default), `MINIMAL`, or `RAW`, `account` optional.

`FULL` returns the draft as a message plus the draft id. The page reads `id`, `threadId`, `messageId`, `subject`, `toRecipients`, `ccRecipients`, `plaintextBody`, `htmlBody`, `attachments`, `snippet`, `viewUrl` (lines 4982, 5008, 5042, 5315).

```json
{
  "id": "d1",
  "messageId": "md1",
  "threadId": "t2",
  "acct": "gmail_work",
  "subject": "Re: Venue walkthrough",
  "toRecipients": ["Lee Park <lee@venuehall.example>"],
  "ccRecipients": [],
  "bccRecipients": [],
  "date": "2026-11-04T14:00:00.000Z",
  "snippet": "Hi Lee, Tuesday at 10 works.",
  "plaintextBody": "Hi Lee,\n\nTuesday at 10 works. See you there.\n\nAlex",
  "htmlBody": "<div dir=\"ltr\">Hi Lee,<br><br>Tuesday at 10 works. See you there.<br><br>Alex</div>",
  "labelIds": ["DRAFT"],
  "attachments": [],
  "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#drafts"
}
```

`MINIMAL` is the same object without `plaintextBody` and `htmlBody` (the native fake deletes those at `fake.js` line 229).

`RAW` returns `{ "id": "d1", "raw": "<base64url>" }`. The page reads `raw` (line 5317).

Unknown draft: not-found error.

### `list_send_as`

Page calls: lines 5133, 5226.

Input: `account` optional.

Output (`gxOne` line 1639). The page reads `sendAs[].email`, `.signature`, `.isDefault`, `.isPrimary` (line 5135).

```json
{
  "sendAs": [
    {
      "email": "alex@riveralabs.example",
      "signature": "<table>…</table>",
      "isDefault": true,
      "isPrimary": true,
      "verified": true
    }
  ]
}
```

`email` is lowercase. `signature` is HTML or `""`. `verified` is true for the primary address, and for any address whose verification status is accepted. An IMAP account's list is the account address plus the aliases saved at connect.

### `list_accounts`

Not called by the page yet. Lane 2 uses it the way the page reads `CONFIG.gmail.accounts` today (template lines 1020 and 6258, `docs/connector-design.md`).

Input: none required.

Output:

```json
{
  "accounts": [
    {
      "id": "gmail_work",
      "email": "alex@riveralabs.example",
      "label": "Rivera Labs",
      "kind": "gmail",
      "color": "blue",
      "capabilities": { "filters": true, "sendAs": true, "labels": "labels" }
    },
    {
      "id": "gmail_personal",
      "email": "alex.rivera@mail.example",
      "label": "Personal",
      "kind": "gmail",
      "color": "red",
      "capabilities": { "filters": true, "sendAs": true, "labels": "labels" }
    }
  ]
}
```

`kind` is `gmail`, `imap`, or `microsoft`. `color` is omitted when the account has none. `capabilities.filters` is false for IMAP and true for Gmail and Microsoft. `capabilities.sendAs` is true for all three. For Microsoft that means this mailbox's own address only. `list_send_as` returns that one address. Sending as another mailbox is a `tool_error`: `Sending as another mailbox is not available for this account.` `capabilities.labels` is `folders` for IMAP and `labels` for Gmail and Microsoft. A fake mailbox reports the capabilities of the kind stored on the account. The page's picker reads `id`, `email`, `label`, and `color`. Hosted error text uses `kind`, and an IMAP account's provider name when that account carries one. `capabilities` decides which filters the account shows.

### `list_filters`

Not called by the page yet. Settings and the rules action will read it in a later slice.

Input: `account` optional.

Output:

```json
{
  "filters": [
    {
      "id": "f1",
      "account": "gmail_work",
      "criteria": { "from": "receipts@stripe.example", "to": "", "subject": "", "query": "", "hasAttachment": false },
      "action": { "addLabelIds": ["L1"], "removeLabelIds": ["INBOX"], "skipInbox": true }
    }
  ]
}
```

The demo mailbox has no filters, so the list is `{ "filters": [] }`.

### `search_contacts`

Not called by the page yet. This is people found in mail headers (From, To, Cc), not a Google Contacts book.

Input: `query` (name or email substring, required), `limit` (default 20, max 50), `account` optional.

Output:

```json
{
  "contacts": [
    { "name": "Dana Ruiz", "email": "dana@acmerobotics.example", "count": 2 }
  ]
}
```

`email` is lowercase. `count` is how many messages name that address. Sorted by `count`, then email. No match is `{ "contacts": [] }`.

In `mirror`, the count reads stored headers. In `direct`, it walks every thread's headers through the provider. Gmail refuses that full walk (`listThreadMeta` is not a page). Use `mirror`, or wait for Lane 1c, to search contacts on a Gmail account.

## Write tools (registered, except `sync_now`)

Inputs are what the page sends. Outputs are what `gxOne` returns and the page reads, if it reads anything.

### `create_label`

Page calls: lines 2936, 4780. Input: `displayName` (required), `account` optional.

Output (`gxOne` line 1642). The page finds the new folder by `name` on the next `list_labels`, and also accepts `{ labelId, name }` here:

```json
{ "labelId": "L9", "name": "Finance" }
```

### `label_thread` and `unlabel_thread`

Page calls: lines 1126 and 1127, through `threadOp`. The page does not call a tool named `update_message_labels`. That name in the spec is the Gmail operation these two tools perform.

Input: `threadId` (required), `labelIds` (array of label ids), `account` optional.

`label_thread` adds those ids. `unlabel_thread` removes them. The page does not read the body. Output is `{}`.

### `create_draft`

Page call: line 2802.

Input: `to` (string or array), `cc`, `bcc` (same), `subject`, `body` (plain text), `htmlBody` (optional), `replyToMessageId` (optional), `includeSignature` (boolean), `attachments` (optional; see below), `account` optional.

Output (`gxOne` line 1676). The page reads `id` when it keeps the draft:

```json
{ "id": "d9", "threadId": "t1", "viewUrl": "https://mail.google.com/mail/?authuser=alex%40riveralabs.example#drafts" }
```

`threadId` is `""` when the draft is not a reply. A reply keeps `In-Reply-To` and `References` from the message being answered.

### `update_draft`

Page call: line 5697.

Input: `draftId` (required), `to`, `cc`, `bcc`, `subject`, `body`, `htmlBody`, `threadId`, `attachments`, `account` optional.

The page does not read the body beyond success. Output: `{ "id": "<draftId>" }`.

An update replaces the body and recipients and **keeps** threading headers and any attachment not included again. (Composio drops both. This server must not.)

### `delete_draft`

Page calls: lines 5015, 5089, 5758, 5815.

Input: `draftId` (required), `account` optional.

Output: `{}`. Unknown draft: not-found error (the page treats that as already gone, line 5815).

### `send_message`

Page calls: lines 2817, 2820, 3079, 3616, 5083, 5811, 5831.

Input, one of:

- Send an existing draft: `draftId`, `account` optional. The page reads nothing on success. Output `{ "id", "threadId", "labelIds": ["SENT"] }` (native fake, `fake.js` line 236).
- New message or a reply sent as new mail: `to`, `cc`, `bcc`, `subject`, `body`, `htmlBody`, `fromEmail` (send-as address), `replyToMessageId`, `includeSignature`, `attachments`, `account`.

`fromEmail` sends as that alias and still threads when `replyToMessageId` is set (`In-Reply-To` and `References` stay). Output `{ "id", "threadId", "labelIds": ["SENT"] }`.

### `reply`

Page call: line 2821.

Input: `messageId` (required), `body`, `replyAll` (boolean), `cc`, `bcc`, `includeSignature`, `attachments`, `account` optional.

The page does not read the body. Output `{ "id", "threadId", "labelIds": ["SENT"] }`.

Reply-all addresses the sender (or `Reply-To`), the other To recipients, and Cc, and leaves the account's own addresses off those lists (`gxOne` lines 1686–1701). A message this account sent is answered to that message's To, and reply-all also keeps its Cc, on Gmail and on IMAP. A `cc` passed in replaces the default Cc list.

### `forward`

Page call: line 2957.

Input: `messageId` (required), `to` (array), `includeSignature`, `account` optional.

Output `{ "id", "threadId", "labelIds": ["SENT"] }`. The forwarded body quotes the original. The page does not read the return value.

### `create_filter`

Not called by the page yet. Lane 2 turns a rule's "skip the inbox" action into this.

Input: `criteria` (`from`, `to`, `subject`, `query`, `hasAttachment`), `action` (`addLabelIds`, `removeLabelIds`; `skipInbox: true` means `INBOX` is removed), `account` optional.

Output: the filter object from `list_filters`, including its new `id`.

### `delete_filter`

Input: `filterId` (required), `account` optional. Output: `{}`. Unknown filter: not-found error.

### `sync_now`

Registered. Not called by the page yet. Input: `{}`. This slice syncs every account, in `position` order.

`mirror` plus Gmail backfills the last `SYNC_DAYS` (default 30), then follows the History API. Each call stops at `SYNC_BUDGET_MS` (default 20 seconds) and resumes on the next call. A stopped call is `partial: true` and `synced: false`. An expired `historyId` runs one bounded re-sync in that call. A second expiry in the same call is `upstream_error` and is not a silent skip. `mirror` plus the demo provider touches `last_sync_at` and does not re-list the mailbox.

```json
{ "accounts": [ { "account": "gmail_work", "synced": true } ] }
```

```json
{ "accounts": [ { "account": "gmail_work", "synced": false, "partial": true } ] }
```

`direct` does not sync. Both accounts come back like this, and no mail row is written:

```json
{ "accounts": [ { "account": "gmail_work", "synced": false, "note": "direct mode does not sync" } ] }
```

Mirror plus IMAP backfills the last `SYNC_DAYS` across INBOX, the special folders, and user folders, then follows new UIDs, flag changes, and deletes under the same budget. A stopped call is `partial: true` and `synced: false`. Direct mode, including an IMAP account, returns `note: "direct mode does not sync"` and does not log in. An IMAP tool call is served. A Microsoft account with no `MICROSOFT_CLIENT_ID` returns `note: "sync is not available for this provider"`, and a tool call says `Microsoft sign-in is not set up.` When `MICROSOFT_CLIENT_ID` is set, mirror mode syncs that account with per-folder delta queries and a tool call hits Graph. If one account throws, that account comes back as `synced: false` with `note: "sync failed"` and `code` (a `ToolError` code, or `upstream_error`). A successful row omits `code`. The log line is the account id and the error name, and the other accounts still run. The error message is not logged. Undefined fields are omitted. No mail body is in this object.

## IMAP

An IMAP account uses the same tool names as Gmail. Folders stand in for labels. There is no setup page in this lane. Connecting is `POST /connect/imap`, described in `docs/hosted.md`.

### Folder names

`list_labels` returns system ids `INBOX`, `SENT`, `DRAFT`, `TRASH`, `SPAM`, `ARCHIVE`, `UNREAD`, `STARRED`, then one user row per real folder. A user row's `name` and `labelId` use `/` no matter what delimiter the server uses. The personal namespace prefix is stripped, so `INBOX.CB.Snooze.2026-11-07` on a `.` server is `CB/Snooze/2026-11-07`.

Special-use wins: `\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`. When the flag is absent, these names match. `INBOX` is only the INBOX folder.

| Label | Names when the flag is absent |
|---|---|
| SENT | Sent, Sent Messages, Sent Items, Sent Mail |
| TRASH | Deleted Messages, Deleted Items, Trash |
| SPAM | Junk, Junk E-mail, Spam, Bulk Mail |
| ARCHIVE | Archive, Archives |
| DRAFT | Draft, Drafts |

`UNREAD` is the absence of `\Seen`. `STARRED` is `\Flagged`. `IMPORTANT` is not a folder and not a flag. Adding or removing it changes nothing. `category:*` is not a folder either.

`create_label` creates that folder and any missing parents. `label_thread`, `unlabel_thread`, and `modify_thread` run per message. Flags change on every remaining copy. One folder replaced by another is MOVE. A pure add is COPY. A pure remove deletes that copy. With no MOVE capability the provider copies, flags `\Deleted`, then expunges. With no UIDPLUS, expunge runs only when no other message in that folder is already `\Deleted`. Otherwise the flag stays and reads hide `\Deleted`. The expunge names only the messages being removed. Zero folders left moves the message to Archive, creating `Archive` when it does not exist.

### Search

Search runs on the server in both modes. Mirror mode does not answer from the store. An empty query is the inbox. A query with no `in:` is searched in every selectable folder, the same set as `in:anywhere`. `OR`, parentheses, quotes, and a leading `-` work. A quote after an operator stays with that operator, and the quotes are not part of the value, so `subject:"two words"`, `from:"A B"`, and `-subject:"x y"` are one term each.

| Form | Answer |
|---|---|
| `from:` `to:` `cc:` `subject:` | IMAP FROM, TO, CC, SUBJECT. A quoted value is one phrase. |
| free text and quotes | IMAP TEXT. Words are AND. A quoted string is one phrase. |
| `in:inbox` `in:sent` `in:draft` `in:drafts` `in:trash` `in:spam` `in:archive` | that folder. `in:anywhere` is every folder except a `\Noselect` node. A folder's display name matches too. |
| `label:` | the folder whose display name equals the value, or whose page slug equals it (`/` and spaces become `-`, then lowercased), or whose role equals it. `label:cb-snooze-2026-11-07` and `label:"CB/Snooze/2026-11-07"` are the same folder. |
| `is:unread` `is:read` `is:starred` | UNSEEN, SEEN, FLAGGED |
| `newer_than:Nd` `older_than:Nd` `before:YYYY/MM/DD` | SINCE, BEFORE, BEFORE. `before:` also accepts `YYYY-MM-DD`. |
| `list:` | HEADER List-Id contains the value |
| `filename:` | not an IMAP SEARCH key. The other terms run (or ALL), then BODYSTRUCTURE is checked. Bound: 500 newest hits per folder. |
| `has:attachment` | the same bound, from BODYSTRUCTURE (a part with a filename, or `multipart/mixed`). |
| `category:` and `is:important` | match nothing. A negated one (`-category:promotions`) adds no constraint. |
| any other `word:` operator | match nothing. |

### What a list fetches

SEARCH returns the UIDs. One folder whose server supports SORT uses `UID SORT (REVERSE DATE)`. Otherwise the list FETCHes INTERNALDATE for those UIDs and sorts newest first. At most one page is turned into messages. 300 or fewer hits load headers for every hit, so the count is exact. A larger mailbox loads headers 40 at a time until the page is full. That fetch is FLAGS, ENVELOPE, BODYSTRUCTURE, and the header fields Message-ID, In-Reply-To, References, List-Id, and X-CBM-Draft-Id. The list does not fetch the full source.

A summary snippet is the stored snippet when mirror mode already has that message. Otherwise it is the first 140 characters of the first 400 bytes of body part 1, or the subject when that preview is empty. An ids-only row leaves the snippet empty. The ids-only hit still carries the message metadata into the mirror store, so a later `get_thread` can fetch the body.

### Ids

A message id and a thread id recover the RFC 5322 id with no process memory and no stored copy. The normalized Message-ID has the angle brackets removed and the rest lowercased.

| Id | Shape |
|---|---|
| message with a Message-ID | `m` plus base64url of the normalized Message-ID |
| thread | `t` plus base64url of the normalized root |
| message with no Message-ID | `h` plus the first 32 hex chars of SHA-256 of `fb`, the account id, Date, From, Subject, and size |
| thread with no Message-ID root | `k` plus the first 32 hex chars of SHA-256 of `thr`, the account id, and that same fallback |

The root is the first id in `References`, else `In-Reply-To`, else the message's own Message-ID. Subject is not a key. The same Message-ID in two folders is one message, so the id survives a move. `h` and `k` are the mark that the id is not reversible. No deployment has stored mail under the old hash ids, so those ids are not migrated.

### Opening an old message

`get_thread`, `get_message`, `reply`, `forward`, and a reply's In-Reply-To headers do not walk the mailbox when the id is reversible.

In mirror mode the list, the search, and the sync store each copy's folder, UIDVALIDITY, and UID. A later read FETCHes that UID when the UIDVALIDITY still matches. With no matching copy, a reversible message id is `UID SEARCH HEADER Message-ID` in every selectable folder. A reversible thread id is that search plus `HEADER References` and `HEADER In-Reply-To` for the root, at most 50 hits a folder. Full source is fetched only for those hits. When every folder has been searched and none match, the call is not found. It does not walk.

A hash id (`h` or `k`) has no Message-ID to search. The read FETCHes headers for the newest 200 UIDs in each selectable folder and stops at the first hit. It does not fetch source while looking. A message older than those 200 UIDs in every folder is not found. 200 is `HASH_WALK_UIDS`.

A hit older than `SYNC_DAYS` can be opened and answered when its Message-ID is known.

### Filters, send-as, drafts, and send

`list_filters` is `{ "filters": [] }`. `create_filter` and `delete_filter` throw `tool_error` with `Filters aren't available for this account type.` `capabilities.filters` stays false.

Send-as is the account address plus the aliases saved at connect. `capabilities.sendAs` is true. `capabilities.labels` is `folders`.

`create_draft` appends to Drafts with `\Draft` and `\Seen`, and sets `X-CBM-Draft-Id`. An update appends the new bytes and then deletes the old copy. The draft id stays. If that delete fails, the call still succeeds, the audit row is `ok` with `store_failed`, and a later read keeps the newest copy. A draft another client created has no `X-CBM-Draft-Id`. It is listed, and its id is that message's id (`m` plus the Message-ID, or the `h` hash when the header is missing).

Reply and a draft keep `In-Reply-To` and `References` from the message being answered. Send builds the message, then sends those bytes over SMTP once, then appends a copy to Sent. If that append fails after SMTP has accepted the message, the send still succeeds and is audited `store_failed`. `send_message` with `draftId` sends that draft and then deletes it.

### Sync

Mirror only. Direct mode returns `note: "direct mode does not sync"`. Backfill lists INBOX, the special folders, and user folders, searches the `SYNC_DAYS` window, and stores each message under the same budget and cursor as Gmail. Incremental sync, per folder, takes new UIDs, flag changes, and deletes. A UIDVALIDITY change re-syncs that folder from the window. Messages flagged `\Deleted` are not stored and not returned. A read's quick sync runs this incremental path once the phase is `incremental`. IMAP does not need a history id. Gmail and Microsoft still do.

## Microsoft

Graph is v1.0. Every Graph request sends `Prefer: IdType="ImmutableId"`, so a message id survives a move. Token requests do not send that header. The thread id is `conversationId`. `get_thread` asks `/me/messages` with `$filter=conversationId eq '{id}'` and follows `@odata.nextLink` while the link stays on the configured Graph origin, up to 50 pages. A link on another origin is refused and is not fetched. Draft listing follows the same rule. Search still returns one page and hands the next link back as `nextPageToken`. Some Graph versions say `conversationId` is not filterable. This server does not scan the mailbox when that filter is rejected. Well-known folder ids are cached per account, so one mailbox's archive id is not reused for another.

Sign-in is `/connect/microsoft`. A client secret present means the owner's own Entra web app (authorization code and PKCE). A client id and no secret means device code for the shared public client. Neither means Microsoft is off. The portal steps are in `docs/hosted.md`. Scopes are `offline_access openid email User.Read Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite`. The address is `mail` from `/me` when it is set, otherwise `userPrincipalName`.

| Page label | Graph |
|---|---|
| `INBOX` | well-known folder `inbox`. Removing it moves the message to `archive`. Adding it moves the message back. |
| `SENT` | `sentitems` |
| `DRAFT` | `drafts` |
| `TRASH` | `deleteditems` |
| `SPAM` | `junkemail` |
| archive | `archive`. There is no `ARCHIVE` label id. |
| `UNREAD` | `isRead` false |
| `STARRED` | `flag.flagStatus` `flagged` |
| `IMPORTANT` | `importance` `high` |

`IMPORTANT` is an approximation. Gmail's Important marker is Gmail's ranking. Outlook's `importance` is the value the sender set. Mail Gmail would call important is missed when the sender left it normal.

User labels are Outlook categories. A missing master category is created, then the message `categories` array is patched. Snooze adds the category `CB/Snooze/<date>` and moves the message out of the inbox. Wake moves it back, marks it unread, and removes the category.

Mail cannot combine `$search` and `$filter`. A query that needs both is answered from the store in mirror mode. In direct mode, one Graph call does the part Graph can do and the other predicate is applied to that page only. That page is not a full Gmail result. `category:primary`, `category:promotions`, `category:social`, `category:updates`, `category:forums`, and the same words with a leading `-`, are Gmail tabs. They have no Graph meaning. A query that is only those operators returns no threads, including `in:inbox category:primary`. A mixed query drops those words.

A reply draft uses `createReply`, so the conversation is kept, and the saved draft carries `In-Reply-To` and `References`. `reply` with `replyAll` false uses `createReply`. `replyAll` true uses `createReplyAll`. Empty recipient lists and an empty subject are left off that request, so Outlook's calculated recipients and `Re:` subject stay. A non-empty `cc` or `bcc` replaces that list. A follow-up sent with `send_message` and `replyToMessageId` uses `createReply` and the recipients on that call, including a follow-up to mail this account already sent. A new message is created as a draft and sent with `POST /me/messages/{id}/send`. `sendMail` and that draft send both return `202 Accepted` with an empty body. The 202 is acceptance. The immutable draft id is the message id. The server does not read Sent Items to decide success and does not substitute another message's id. An existing draft is sent with `POST /me/messages/{draftId}/send` once. Subject, body, and recipient fields the caller set are patched first, including an explicit empty subject, body, Cc, or Bcc, so a cleared recipient is removed before send. A field the caller omitted stays as saved. A reply still leaves an empty recipient list off `createReply` or `createReplyAll`. An attachment already on the draft stays there. A follow-up that sets `replyToMessageId` uses `createReply` so the conversation is kept. An attachment at or under 3 MB is inline. Above 3 MB and at or under 150 MB creates an upload session. The session URL is on `https://outlook.office.com` and is preauthenticated. The server does not rewrite it. Each `PUT` sends `Content-Type: application/octet-stream` and `Content-Range`, sends no `Authorization` header, does not follow a redirect, and is not retried. Chunks are 2 MB and always smaller than 4 MB. A `nextExpectedRanges` value that is not the next byte stops the upload. A URL on another origin, with userinfo, or on a port other than 443 is refused before any `PUT`. Above 150 MB is a `tool_error`: `This attachment is over the 150 MB limit.`

Filters are inbox rules. Skip-the-inbox moves to `archive`, and a label on that action applies the category. A criterion or action a rule cannot express is a `tool_error`: `This rule can't be expressed in Outlook.`

Mirror sync stores one `deltaLink` per well-known folder: inbox, sent items, drafts, deleted items, junk, and archive. Mail in a user folder is not mirrored. A folder page and a delta page are subsets of a conversation, including when the conversation spans folders or the list is paged. Microsoft sync upserts the messages on that page and does not delete the others. An `@removed` record is a message id. Graph uses `reason: deleted` both when a message is deleted and when it moves out of that folder. The mirror reads the message before it removes a row. A missing message is deleted and the conversation is recomputed. A message that is still in one of those six folders stays, and that message's labels come from the folder. A message whose parent folder is outside those six is removed from the mirror. Other messages in the conversation stay. A later empty delta does not restore a deleted message and does not drop a message that moved. The thread row goes away only when its last message is gone. `reason: changed` means the item was deleted and can be restored. Emptying Deleted Items reports `changed` on the `deleteditems` delta. The mirror reads that id once, `GET /me/messages/{id}?$select=id,parentFolderId,conversationId`, with ImmutableId and the read retry rules. A 404, or a parent folder outside the six, removes that message. A parent folder inside the six updates that message's labels and keeps it. A `410` / `syncStateNotFound` drops that folder's link and re-syncs that folder only. A second expiry in the same call is `upstream_error`. Messages already stored are kept. Direct mode stores no mail. A `429` or `503` with `Retry-After` retries a read once, and only when the wait fits the request budget. A write is never retried. `invalid_grant` on refresh is `needs_reauth` and does not look like an empty mailbox.

## Jobs

Snooze wake-ups and remind-me use the same label names as the page and the morning run. On IMAP those names are folders.

Read from `skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html` (not edited by this lane):

- Line 1009: `labelPrefix: "CB"`.
- Line 4776: `LP()` is `CONFIG.labelPrefix` or `"CB"`.
- Line 4788: snooze creates `LP()+"/Snooze/"+date` and removes `INBOX`.
- Line 4796: remind-me creates `LP()+"/Remind/"+date` and removes nothing.
- Lines 4816–4832: `wakeDue()` matches `^<prefix>/(Snooze|Remind)/YYYY-MM-DD`, skips a future date, searches `label:` plus the name with `/` and spaces turned into `-` and lowercased. Snooze adds `INBOX` and `UNREAD` and removes the label. Remind-me reads the thread, and if the newest message is the user's (`SENT`, or the sender is the account address) it adds `INBOX` and `UNREAD` and removes the label. Otherwise it only removes the label.

`skills/chatterbuilt-mail-morning/SKILL.md` lines 58–66 say the same: `<prefix>/Snooze/YYYY-MM-DD` and `<prefix>/Remind/YYYY-MM-DD`, search `label:<prefix>-snooze-YYYY-MM-DD`, bring a due thread back with `INBOX` and `UNREAD`.

A job is due when that date is today or earlier, UTC `YYYY-MM-DD`. The server runs due jobs at the start of every read, then on `GET` or `POST /api/cron/jobs` and `GET` or `POST /api/cron/sync` (sync runs jobs, then `sync_now`), and on `POST /api/gmail/push` (jobs, then a sync of that account). Cron requires `Authorization: Bearer <CRON_SECRET>`, compared in constant time. A missing secret is 401. When that cron walks every account, one account's failure is logged as `jobs failed` with the account id and the error name, and the other accounts still run. The error message is not logged. A read of one account still surfaces `needs_reauth`. Push requires a Pub/Sub OIDC token checked against Google's keys, `GMAIL_PUSH_AUDIENCE`, and `GMAIL_PUSH_SERVICE_ACCOUNT`. A bad token is 401 and runs nothing. The push body is not the history cursor. The sync still walks History from the stored id.

A due label is claimed once, with id `wake:<account>:<label>:<thread>`, by one `INSERT … ON CONFLICT DO NOTHING`. A read, a cron call, and a push that arrive together change that thread once. The claim row is written in `mirror` and in `direct`. That is the exactly-once lock. Direct mode still stores no mail, labels, drafts, or filters. Direct mode stores accounts, tokens, and the audit log. The jobs table is the exception, and only for that lock.

`server/vercel.json` schedules both cron paths daily (`0 13 * * *`), which is what Vercel Hobby allows. On Pro, `*/5 * * * *` for `/api/cron/sync` and `*/15 * * * *` for `/api/cron/jobs` are the schedules to use. A read also runs due jobs, and a short incremental sync when the last one is over a minute old, so a mailbox does not wait a full day for either.

## Attachments on writes

The page sends `{ filename, mimeType, content }` where `content` is base64 of the bytes (see `attPayload` callers at lines 2802 and 2817). A part already on a draft is `{ filename, mimeType, msgId, attId }` with no `content`. 25 MB per message is the ceiling. Inline parts keep their `Content-ID`.

## Demo mailbox

`FakeProvider` is seeded from `scripts/demo/fake.js` (the `T`, `PT`, `DRAFT_FULL`, labels and send-as blocks). People, addresses and bodies there are fictional. Two accounts:

| id | email | label | color |
|---|---|---|---|
| `gmail_work` | alex@riveralabs.example | Rivera Labs | blue |
| `gmail_personal` | alex.rivera@mail.example | Personal | red |

Work threads `t1`–`t8` are the inbox, in that order. `w1`, `s1`, `s2`, `s3`, `n1` are sent or notes, returned only for the queries `fake.js` `search` lists. Work drafts are `d1`, `d2`, `d3`. Work user labels are Finance `L1`, Sponsors `L2`, Meetup `L3`, Newsletters `L4`. Personal threads are `p1`, `p2`, `p3`. Personal user labels are Family `L1`, Bikes `L2`.
