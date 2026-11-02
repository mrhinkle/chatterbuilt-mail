# Safety and privacy

## Nothing happens without a click

- **Sending.** Send always shows a confirmation. With the pre-send check on, that confirmation includes the check's findings. Forwarding and unsubscribe-by-email confirm too.
- **Moving.** Archives and folder moves you suggest by hand happen on your click and can be undone. Moves suggested by AI (triage, rules) wait in **Review** until you apply them.
- **Rules.** Rules never act on their own, even when they check new mail automatically. Matches go to Review.
- **Pre-drafts.** These stay on the page. Nothing goes to Gmail until you save or send.
- **Sweep.** Archive all needs a second click to confirm. It is capped at 100 threads and can be undone.
- **Read-only mode** blocks every send, label change, draft, forward, task and contact at the code level. Every call that could change something is refused while it's on.

## What goes where

- **Your connectors, your sign-in.** The page calls Gmail, Calendar, Notion, Clay, your task app and OpenRouter through your claude.ai connectors. It never sees a password or token.
- **The model.**
  - With Claude selected, prompts go to Claude through claude.ai.
  - With an OpenRouter model selected, prompts go to that provider through OpenRouter, under OpenRouter's and the provider's terms.
  - Prompts contain the thread you're working on, plus:
    - your earlier emails to that person, when tone matching is on;
    - free time slots, when calendar times are on;
    - signature text, for contacts;
    - a few sent emails, when you train your voice.
- **Calendar.** Only open time slots reach the model. Event names, people, locations and notes never leave the page.
- **Clay.** Clay is called only when you press Enrich with Clay, and it uses your Clay credits.
- **Your browser.** Voice edits, rules, lessons and switches are stored in that browser's local storage for this artifact. Clearing site data clears them. Copy for Claude is the backup.
- **Sharing.** The artifact is private to you. If you share it, the other person uses their own connectors and sees their own mail, never yours. Your browser-stored lessons don't travel with the link.

## Forks and memory files

- Your email memory file describes how you work. If it holds anything personal, keep it in a **private** repo or a private cloud folder.
- A GitHub fork of a public repo is public. See [getting-started.md](getting-started.md) for making a private copy.

## Known limits

- Replies sent from the page can't carry attachments. The pre-send check warns you when your reply mentions one.
- One Gmail connector reaches one mailbox. "Copy to account" forwards a message as a new email; it isn't a label-for-label copy.
- One-click unsubscribe (the POST kind) can't be sent from a web page, so the page opens the sender's own unsubscribe page instead.
