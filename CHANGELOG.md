# Changelog

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
