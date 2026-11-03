# Changelog

## 0.6.2 (2026-11-02)

### New
- **Act on a thread from the list.** Each row has a small strip of icons (Archive, Move, Route, Create task, Add contact): always on the open thread, on hover for the rest. Right-click a row, or press Shift+F10 or the menu key, for a menu with every action: Open, Archive, Snooze, Move, Route, Create task, Add contact, Star, Mark read or unread, Unsubscribe and Open in Gmail. Archive, star and read work in place without opening the thread.
- **A Reply menu instead of a row of buttons.** Say yes, Decline, Ask a question, Offer a call, Follow up later, Nudge, Three options, Write it myself and Insert a snippet sit in one menu beside the instruction box.
- **Revise the draft you have.** With a draft in the box, type what to change and press **Revise** (or use Shorter, Warmer, More direct, Polish), and it rewrites that draft instead of starting over. **Undo** steps back through the last ten versions.
- **Work on it in chat.** **More → Work on it in chat** copies a pointer to the thread for a Claude chat. Claude saves the reply as a Gmail draft in the thread, and the page offers **Load it** the next time you open the thread (it now checks for new drafts each time).

### Changed
- **The reply box folds to one line** (Reply menu, instruction, Draft) until you use it, so the message and its context get the room. The chevron opens or folds it by hand, and the app remembers.
- **A compact thread header.** The subject takes at most two lines, the thread buttons become icons on one line when the reading pane is narrow, and a chevron hides them. Clicking the context card's header folds it.
- The hover buttons that sat over the row's date are gone; the new strip sits at the bottom of the row.

## 0.6.1 (2026-11-02)

### Fixed
- **Gmail through Composio showed an empty inbox.** Composio sends back only a preview when a reply runs past about 8K tokens and saves the full reply in its sandbox. The page asked for 50 messages a page (about 9K tokens), so every inbox came back as a preview, which the page read as no mail. Lists now come 25 messages at a time, and any reply Composio still saves to its sandbox (long threads, big drafts, attachments) is read from that file with `COMPOSIO_REMOTE_BASH_TOOL`: one fixed `jq` command that keeps the fields the page uses, read back in pieces. The setup skill declares that tool alongside `COMPOSIO_MULTI_EXECUTE_TOOL`.
- **Lists could stay stale after a change on the Gmail connector.** Clearing the cache after an archive, move or refresh failed silently, so the list could show the old threads until the cache timed out.
- **Rules with a folder matched it by label id first.** Label ids are per account, so in another account the same id can be a different folder. Rules match by folder name first now.
- Mail between your own accounts counts as yours (for Waiting, contacts and replies), and thread messages through Composio are shown oldest first.

### New
- **All inboxes.** With two or more Gmail accounts through Composio, the page opens on one list that merges them, newest first, and the account menu gains **All inboxes** (also **Show All inboxes** in the command palette). Each row names its account. Chips over the list turn an account off and on. Replies, drafts, moves, archives and snoozes go through the account the thread belongs to, with its signature; folders show by name across accounts, and moving into a folder an account doesn't have creates it there. A message in two of your mailboxes shows once. `start: "first"` opens on the first account instead.
- **Account colors.** `color` on each account (`blue`, `red`, `green`, `amber`, `purple`, `teal`, `pink`, `gray` or a `#hex`) tints its rows in All inboxes. **Settings → Accounts** changes them in the page, and Copy for Claude carries them into your copy through chatterbuilt-mail-improve.

## 0.6.0 (2026-11-02)

### New
- **Several Gmail accounts in one copy, through Composio.** Set `CONFIG.gmail` to `{ via: "composio", accounts: [...] }` and the address under the app name becomes an account menu (and **Switch to …** in the command palette). The list, labels, drafts, Today and Waiting reload for each account. Every feature works through Composio except attaching files to a reply, which is hidden for now. The page translates its Gmail calls into Composio's Gmail tools (`gmailComposio()` in the template), so the rest of the app is unchanged, and claude.ai's Gmail connector stays the default.
- **Open attachments in the page.** Attachments are buttons now. PDFs show page by page (pdf.js from cdnjs), images full size, and text files as text. Anything else gets **Save** (it asks before downloading) and **Open in Gmail**. Nothing from the file goes to the AI.
- **Clickable links.** Web addresses in messages are links that open in a new browser tab.
- **Your Gmail signature on everything you send.** Replies, drafts and forwards ask Gmail to add the signature you set in Gmail, so it keeps its formatting, links and images. A line under the reply box says so. Each account uses its own. Switch it off under Skills, **Gmail signature**.

### Changed
- The setup skill declares the `downloads` capability (for Save) and, with Gmail through Composio, `Composio` instead of `Gmail`.
- The morning run handles Gmail through Composio, one account at a time.
- Screenshots and the demo video are retaken; new ones show an attachment open and a second account.

## 0.5.4 (2026-11-02)

### New
- **Resizable panes.** Drag the grip between the thread list and the thread, or between the thread and the context panel. Click a grip and the arrow keys work too (Shift for bigger steps, Home and End for the limits). Double-click a grip, or run **Reset pane sizes** from the command palette, to go back to the default. Widths are remembered in this browser. The thread keeps at least 380 px, so a wide list shrinks on a smaller window and grows back on a bigger one. Phones still show one pane at a time.

## 0.5.3 (2026-11-02)

### Fixed
- **Half the screen sat empty on tablets and large phones.** Between 600 and 860 px wide (an iPad in portrait, say), an open thread was squeezed into a 400 px column with empty space beside it. The page applied the three-column "side panel" layout at any width; it now does that only on wide screens, and the phone layout is always one column. This had been there since 0.4.0.
- **A brief line with two sources showed one as raw text,** like "[Sponsor pipeline] Contacts". Every source tag at the end of a line is now a chip.

## 0.5.2 (2026-11-02)

### Changed
- **The pane controls have words now, not just icons.** The context panel has a **Context** header with a **Hide** button, the thread list button says **Hide list** / **Show list**, and the toolbar button that brings the panel back says **Context**. The icon-only versions were easy to miss.

## 0.5.1 (2026-11-02)

### New
- **Close and reopen every pane.** The thread list hides with a button at the left of the thread title (or `[`), on any screen wider than a phone. The context card at the top of a thread folds to one line with **Hide**, which helps most on phones. `]` shows or hides context: the side panel on wide screens, the card everywhere else. The command palette has both, and the app remembers each choice.

## 0.5.0 (2026-11-02)

### New
- **`chatterbuilt-mail-feedback` skill.** Type it in Claude and it turns a bug or an idea into a GitHub issue: it gathers the error, your version and your setup, removes anything private, shows you the issue and files it when you say so. It also checks on issues you've filed. Bug and idea templates are in `.github/ISSUE_TEMPLATE/`.
- **Hide or show the context panel.** A button in the panel's corner hides it (context moves to the top of the thread); **Panel** in the thread toolbar brings it back. The choice is remembered.
- **Version number** in Settings → Skills, stamped at build time from `plugin.json`.
- **CONTRIBUTING.md**, including how to add another email platform.
- **A new README.**

### Fixed
- **"Gmail call failed (upstream_error)" on Today.** Reads now retry once when the connector says a retry may work, for example when the call ran while claude.ai's "allow Gmail" prompt was open. Writes never retry. The message is now plain English, and a failed inbox load has a **Try again** button.
- **Drafts check pulled about a megabyte on every load.** It listed your last 50 drafts with full bodies. It now lists them without bodies and fetches only the open thread's draft text.
- **The right panel sat blank.** It showed nothing while a thread loaded, and nothing at all on a thread with no one but you. It now says what it's doing.

## 0.4.4 (2026-11-02)

### Fixed
- **Sweep missed HTML-only unsubscribe links.** The sweep's Unsubscribe now checks the formatted email too, the same places **More → Unsubscribe** looks. Both use one shared lookup.
- **Read-only didn't grey out Snooze, Route or Contact.** They're greyed now on desktop, in the phone's action bar and in More, and so are the snooze and remind-me choices. Route and Contact still open, for suggestions and Copy as vCard, and say at the top that saving is off.

## 0.4.3 (2026-11-02)

### New
- **A guide for every feature area, with screenshots:** [Today](docs/today.md), [Reading and triage](docs/reading-and-triage.md), [More context](docs/more-context.md), [Route and next steps](docs/route-and-next-steps.md), [Replying](docs/replying.md), [Voice](docs/voice.md), [Following up](docs/following-up.md), [Organizing](docs/organizing.md), [Tasks and contacts](docs/tasks-and-contacts.md), [Settings and shortcuts](docs/settings-and-shortcuts.md) and [Phone](docs/phone.md). Each one says what the feature reads, writes and sends to the AI.
- **45 screenshots** (made-up data) across the docs, and a full gallery in [docs/demo.md](docs/demo.md). Screenshots are WebP, about a third the size of PNG.
- `scripts/demo/screenshots.js` recaptures every screenshot; `scripts/demo/fake.js` holds the shared made-up data for it and the video.

### Fixed
- **Empty context results showed as "found something."** A source that returned an object with only empty lists, like a meeting-notes search with `{ "transcripts": [] }`, got a purple chip instead of a grey one. Empty now covers any object whose lists are all empty.

### Docs
- features.md now matches the code on Undo (also star, mark read, snooze and sweep Archive all), rule actions (star and mark read too), rules checking the inbox by default, the five-action minimum for suggested rules, the Waiting window, the sweep's unsubscribe sources, the full keyboard list and when the Model picker shows.

## 0.4.2 (2026-11-02)

### New
- **[docs/context-panel.md](docs/context-panel.md):** the context panel explained as the core of the app, with two worked examples, how it works, how to get good briefs, and a sourced comparison with Superhuman Go, Shortwave and Fyxer.

### Changed
- The context brief now never merges a lookalike match (a different company or person with the same name) into the person you're replying to, and says what's missing when the reply needs something no source has.

## 0.4.1 (2026-11-02)

### New
- **Composio support.** Context sources, tasks, contacts, Route actions and More context can all run through one Composio connector. The page unwraps Composio's replies, so empty results show as "nothing found", and a failed action shows Composio's error instead of reporting success.
- **Docs:** [composio.md](docs/composio.md), a docs index ([docs/README.md](docs/README.md)), updated starter prompts with a Composio option and a short version, and troubleshooting for the panel, More context and Composio.
- **Screenshots and a demo video** ([docs/demo.md](docs/demo.md)), made with made-up data, and `scripts/demo/record.js` to record your own.

## 0.4.0 (2026-11-02)

The interface from the wireframes.

### New
- **Context panel.** On wide screens (1180 px and up) context moves beside the thread: who it is, what your systems know, More context and Next steps. Narrower screens keep it at the top of the thread, and resizing moves it.
- **More context.** A web lookup on the person and their company through any search connector (`CONFIG.lookup`), only when you press it. It returns a short briefing where every line links to its sources, kept apart from your own systems' context. **Web context** under *Draft with* puts it in a draft, off by default.
- **Next steps.** Route's suggestions in the panel; Review and apply opens Route already filled in.
- **Today.** When no thread is open: drafts waiting in Gmail, what needs you, Review, Waiting, and your next meeting (shown on the page only).
- **Triage sections.** After Triage the list groups into Needs you, Worth reading and FYI.
- **Ask in the search box.** Switch on Ask to ask a question instead of searching.
- **Phone tab bar and action bar.** Today, Inbox, Waiting and Tools at the bottom of the list; Archive, Snooze, Route, Reply and More at the bottom of a thread. The bar hides while you type.

### Changed
- Summarize moved into More, so the thread toolbar fits beside the panel.

### Fixed
- Menus opened from two buttons (Tools, More) no longer get two sets of listeners, which made arrow keys skip items and could run a proxied action twice.

## 0.3.3 (2026-11-02)

### Fixed
- **Unsubscribe always ends in a button that does it.** The panel leads with one primary action: **Unsubscribe** (opens the sender's page), **Unsubscribe by email** (you confirm first), or, when the message has no unsubscribe option, **Archive** and **Archive and add a rule for this sender**. The archive-afterward checkbox only shows when there is something to unsubscribe from.
- **Finds more unsubscribe links.** Besides the List-Unsubscribe header, it now looks for a link next to words like "unsubscribe" or "manage preferences" in the text, then for an "Unsubscribe" link in the formatted message. Marketing platforms that hide the link behind tracking URLs (Eloqua and similar) are covered.

## 0.3.2 (2026-11-02)

### Fixed
- **Paging past 25 threads.** Gmail's connector doesn't return a next-page token, so the list stopped at 25. Older pages now load by date (the search runs again with `before:` the oldest day shown, and repeats are dropped). Scroll to the end or press **Load older mail**. The sweep, Archive all and "how we met" lookups use the same paging, so they're no longer capped at the newest 50.
- **Long lists in dialogs on phones.** The Review list (and other long dialog lists) was squeezed to fit the sheet and cut off, so items past the fold couldn't be reached. Dialogs now scroll, and Apply stays pinned at the bottom of Review and Route.

## 0.3.1 (2026-11-02)

### Changed
- **Cleaner navigation**, based on Apple's toolbar guidance and Nielsen Norman Group research (see [features.md, Layout](docs/features.md#layout)):
  - The thread toolbar went from twelve equal buttons in two rows to three labeled groups: Archive, Snooze, Move; Route, Task, Contact, Summarize; and **More** (Star, Mark read, Unsubscribe, Formatted view, Open in Gmail). Buttons have icons as well as labels.
  - Review, Pre-draft, Rules, Sweep and Ask moved into a **Tools** menu next to Triage, with a Review count badge. The search box submits on Enter.
  - Voice, Skills, Read-only and Model moved into **Settings**. A dark **Read-only on** button shows in the top bar whenever read-only is on.
  - The reply box has *Draft with* switches, Snippets and Attach next to the reply, and **Send** on the trailing edge.
  - Phones: Archive, Snooze, Route and More above a thread; menus open as bottom sheets with a Close button; notices show at the top so they don't cover Send; the header fits on one line.

## 0.3.0 (2026-11-02)

The hub release: Chatterbuilt Mail now connects each thread to the rest of your systems, and works while you're away.

### New
- **Context card.** When you open a thread, it checks every read-only source in `CONFIG.context` (meeting notes, calendar, tasks, a pipeline, contacts, newsletter lists, a memory system) in parallel. It writes a short, source-tagged briefing: who they are to you, open commitments, the last and next meeting, pipeline status. Drafts and the pre-send check use it.
- **Route.** The AI suggests where a thread should go, with the text written: a task, a contact, snooze, remind-me, or any connector action in `CONFIG.actions` (for example a Slack handoff draft). You edit and approve.
- **Morning run.** New `chatterbuilt-mail-morning` skill for a weekday scheduled task. It wakes snoozes, checks reminders, drafts replies into Gmail with context, lists who owes you, and pushes a summary. It can only create drafts and change its own `CB/` labels.
- **Snooze and remind-me-if-no-reply**, stored as plain Gmail labels (`CB/Snooze/YYYY-MM-DD`, `CB/Remind/YYYY-MM-DD`). The app and the morning run bring threads back.
- **Drafts waiting in Gmail.** Threads with a Gmail draft are tagged. Load it in one click; sending removes the old draft.
- **Snippets** with `{{firstName}}` and `{{myName}}`.
- **Attachments** on replies, follow-ups and drafts, up to 18 MB.
- **Formatted view.** Sanitized HTML, with images, scripts, styles and forms stripped and quoted history folded.
- Keyboard: `o` for Route, `b` for Snooze.
- **Install with a prompt.** [install.md](docs/install.md) has copy-paste setup prompts for Claude (full app) and ChatGPT (the same triage approach as project instructions and a scheduled task), with a table of what works where.
- Docs: [why.md](docs/why.md) (what people want from AI email and don't get), [morning-run.md](docs/morning-run.md), context sources, Route actions and tested connectors in [connectors.md](docs/connectors.md).

### Changed
- The pre-send check now flags replies that contradict your systems, and warns when a reply mentions an attachment you haven't added.
- The Gmail manifest adds `list_drafts` and `delete_draft`. Republish existing copies so their permissions include them.
- "Copy for Claude" now exports snippets, and keeps the sender on sender rules (it was dropped before). The improve skill folds both in.
- Rows fill in dates and unread state from the full thread, because Gmail's summary view has neither.


## 0.2.0 (2026-11-02)

### New
- **Glass interface.** Floating frosted panes, system typography, segmented tabs, unread dots, and a phone layout with bottom-sheet dialogs. The header links to this repo.
- **Waiting on reply.** Sent mail nobody has answered after N days, with a one-click Nudge.
- **Per-recipient tone.** Drafts match how you've written to that person before.
- **Review queue with undo.** Triage and rules suggest archives and moves; nothing changes until you apply them.
- **Three options and Pre-draft.** Best fit, shorter, and a polite no. It skips threads that don't need a reply.
- **Pre-send check.** Rereads your reply against the thread before it goes out and offers a fixed version.
- **Plain-English and sender rules.** Rules are suggested from what you do by hand, and can check new mail each time the inbox loads. Matches go to Review.
- **Unsubscribe sweep.** Groups bulk senders, then unsubscribe or archive all.
- **Ask your inbox.** Plain-English questions answered with numbered sources.
- **Calendar-aware replies.** Offers three open slots. Only free times reach the model.
- **Add to contacts.** Details from signatures, social handles from every email they've sent, Clay enrichment, and a note on how you first met.
- **Any task manager or CRM.** Tasks and contacts work through any connector's create tool (`CONFIG.tasks`, `CONFIG.contacts`).
- **Voice panel.** Paste a prompt, point to a Notion page, or train one from sent mail.
- **Self-improving.** Lessons from your draft edits and turned-down suggestions. A new `chatterbuilt-mail-improve` skill makes them permanent.
- **Skills picker.** Every feature with how-to and an on/off switch.
- **Keyboard shortcuts and ⌘K command palette.**
- **Read-only mode.**

### Changed
- Label changes now use thread-level Gmail tools (`label_thread`, `unlabel_thread`). Republish existing copies so their permissions include them.
- Complete documentation in `docs/`. Fork-and-memory and Google Drive or OneDrive setup paths. `scripts/build.py`. `memory/EMAIL-MEMORY.example.md`.

## 0.1.0 (2026-10-31)
- First release: inbox with previews, summaries, triage, drafts in your voice, move, copy to another account, unsubscribe, drag to Notion tasks, and Claude or OpenRouter models.
