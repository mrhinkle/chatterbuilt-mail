# Features

Every feature can be switched off in **Skills** (top bar), and its buttons disappear. The table at the end lists what each feature touches.

## Reading

**Inbox, Unread, Primary, Starred, Files.** These are Gmail searches. Type any Gmail query in the search box (`from:alex newer_than:7d`, `subject:invoice has:attachment`). Rows fill in their preview, date and unread dot as each thread loads.

**Summarize.** Two or three sentences on where the thread stands, then any asks of you as a list.

**Triage.** Sorts the visible threads into *reply* (a person is waiting on you), *read* and *skip*, with a short reason each. With Review on, it also suggests archives and folder moves. Those land in the review queue; nothing moves on its own.

**Ask your inbox.** Ask a question in plain English ("When is the venue walkthrough?").
- It writes the Gmail search and shows it to you, so you can edit and re-run.
- It reads the top five threads and answers with numbered sources.
- Click a source to open the thread.

## Replying

**One-click intents.** Say yes, Decline, Ask a question, Offer a call, Follow up later. Or type an instruction ("yes, but only if we can do it in December") and press Draft.

**3 options.** Three versions: best fit, shorter, and a polite no. If the thread doesn't need a reply (a newsletter, a receipt, an FYI), it says so instead of inventing one.

**Pre-draft.** Runs triage if needed, then writes the three options for up to eight threads marked *reply*, two at a time. Threads get a *drafted* tag. Nothing is saved to Gmail or sent.

**Per-recipient tone.** Before drafting, it reads up to three of your earlier sent emails to the same person and matches their register: greeting, length, formality, sign-off. Untick *Match how I write to this person* to skip it.

**Calendar times.** Tick *Offer open times from my calendar*, or press Offer a call.
- It reads the next seven days from Google Calendar and finds three open 30-minute slots inside your working hours, preferring around 10:00 and 2:00 on different days.
- It skips declined, cancelled and all-day events.
- Only the free times go to the model, never event names, people or locations.

**Pre-send check.** When you press Send, the AI rereads your reply against the thread and flags:
- questions or requests you didn't answer;
- names, dates, times, numbers or prices that don't match the thread;
- commitments you might not mean;
- attachments you mention (replies sent from here can't carry files);
- reply-all or wrong-recipient risk;
- tone that could land badly;
- typos.

It offers a corrected version you can take, or you can send anyway. If the check fails to run, you can still send. Turn it off in Skills if you prefer.

**Save to Gmail drafts** puts the reply in Gmail Drafts. **Send** always asks you to confirm.

## Following up

**Waiting.** A tab listing sent emails where you had the last word and nobody has answered after N days (3 by default; change it next to the tools). Oldest is listed first, with a *waiting 6d* tag.
- Open one and press **Nudge** for a short, friendly follow-up.
- Sending goes to the people you wrote to, threaded under your last message.
- **3 options** gives a nudge, a shorter nudge, and a graceful "happy to drop this."

## Organizing

**Move / Copy.** Move a thread into a folder (or create one), or forward a copy to another account you own. Moves can be undone.

**Unsubscribe.** Reads the sender's List-Unsubscribe header. It opens their unsubscribe page, or sends their unsubscribe email after you confirm. It can archive the thread afterward.

**Unsubscribe sweep.** Scans your inbox for bulk mail and groups it by sender with counts. Per sender you can:
- unsubscribe;
- **Archive all**, which takes up to 100 threads out of the inbox after a confirm click and can be undone.

**Review queue.** Every archive or move suggested by triage or rules waits here.
- Untick what you want left alone, then press **Apply selected**.
- Undo puts it all back.
- Whatever you untick teaches the app what not to suggest.

**Rules.** Rules come in two kinds:
- **Plain-English rules** ("receipts, invoices and payment confirmations", then move to Finance). AI matches them.
- **Sender rules**, which match an address or company domain exactly, with no AI involved.

Rules never act on their own. *Run rules* sends matches to Review. With *Check the inbox against my rules each time it loads* on, they run quietly whenever the inbox loads, and matches show up as a badge on Review.

**Suggested rules.** The app watches what you do by hand. Move or archive three emails from the same sender (or four from the same company) the same way, and it offers to make it a rule: *Add rule* or *Not now*. **Suggest rules from my history** asks the AI for broader patterns across your recent actions.

**Undo.** `z` or the Undo button on a toast reverses the last archive, move, star or review batch. Sent mail can't be unsent.

## Capturing

**Tasks.** Drag a thread or a single message onto **Tasks** in the top bar, press **→ Task**, or press `t`.
- The task gets the subject, sender, a link back to Gmail, and the message quoted.
- It works with any task app that has a claude.ai connector. See [connectors.md](connectors.md).

**Add to contacts.** Press **+ Contact** or `c`. Pick the person if the thread has several. Then:
- **Details from their emails.** It reads every email they've sent you (the current thread plus up to four more) for their signature: title, company, phone, website, location. It also picks up social profiles: LinkedIn, X, Bluesky, GitHub, Instagram.
- **How we met.** It finds your earliest thread with them and writes a one- or two-sentence note: month and year, who reached out, what it was about, who introduced you. It links that first thread.
- **Enrich with Clay** (optional). It looks them up in Clay and adds title, LinkedIn, social profiles, location and a work-history summary. This uses Clay credits and only runs when you press it.
- **Edit and save.** Every field is editable. If the person is already in your contacts, it warns you before you save a second entry. **Save** writes to your contacts app.
- **Copy as vCard** works with no contacts app at all.

## Learning and voice

**Voice.** Three ways to set how drafts sound:
- type or paste a voice prompt;
- **point to a prompt**: paste a Notion page link (the output of a voice trainer, a style guide, your brand voice page) and drafts follow it;
- **Train from my sent mail**: reads about a dozen of your recent sent emails and writes a voice guide for you to edit.

**Self-improving.** See [self-improving.md](self-improving.md).

## Control

**Skills.** Every feature with a description and how to use it, an on/off switch for each, keyboard shortcuts, safety notes, and links to these docs.

**Keyboard.**

| Key | Action |
|---|---|
| `j` / `k` | Next / previous thread |
| `e` | Archive |
| `s` | Star |
| `m` | Move |
| `t` | Task |
| `c` | Contact |
| `r` | Reply box |
| `/` | Search |
| `z` | Undo |
| `?` | Help |
| `⌘K` / `Ctrl K` | Command palette (every action, searchable) |

**Read-only.** One button in the top bar. While it's on, nothing can be sent, moved, labeled, drafted, filed or saved. Reading, summaries, triage, Ask and drafting on the page still work.

**Phones.** One pane at a time; dialogs become bottom sheets. Row actions move into the thread header on touch screens.

## What each feature touches

| Feature | Reads | Writes (only after your click) |
|---|---|---|
| Inbox, summaries, triage, Ask | Gmail | nothing |
| Drafting, 3 options, Pre-draft, pre-send check | Gmail; your sent mail to that person (tone); Calendar free/busy (times) | nothing until Save or Send |
| Send / Save draft / Nudge | | Gmail send or draft |
| Move, archive, star, review, sweep archive | Gmail labels | Gmail labels (undoable) |
| Unsubscribe | Gmail message headers | an email to the sender's unsubscribe address, if you choose that |
| Tasks | Gmail | your task app |
| Contacts | Gmail; your contacts app (duplicate check); Clay if you press it | your contacts app |
| Voice | Gmail sent mail (train); Notion page (pointer) | your browser only |
| Rules, lessons, feature switches | | your browser only, until you run the improve skill |
