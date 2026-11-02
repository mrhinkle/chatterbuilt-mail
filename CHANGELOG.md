# Changelog

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
