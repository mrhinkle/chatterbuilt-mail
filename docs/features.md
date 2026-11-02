# Features

Every feature can be switched off in **Settings → Skills**, and its buttons disappear. The table at the end lists what each feature touches.

## Where things are

The layout follows a few common rules: keep the actions you use most visible, with labels; put occasional ones one click away in a labeled menu; and never go deeper than that. See [Layout](#layout) for the reasoning.

| Place | What's there |
|---|---|
| Top bar | **Tasks** drop zone, **Commands** (⌘K), **Settings** (Voice, Skills, Read-only, Model, shortcuts, docs), connection status. A dark **Read-only on** button appears while read-only is on. |
| Thread list | Tabs (Inbox, Unread, Waiting, Primary, Starred, Files), the search box (press Enter), **Triage**, and **Tools** (Review, Pre-draft, Rules, Sweep, Ask). A badge on Tools counts what's waiting in Review. |
| Above a thread | **Archive, Snooze, Move**, then **Route, Task, Contact, Summarize**, then **More** (Star, Mark read, Unsubscribe, Formatted view, Open in Gmail). |
| Reply box | Reply buttons, your own instruction, **Draft with** switches (My tone with them, Context, Open times), the reply, then Snippets, Attach, Reply all, Remind me, **Save draft** and **Send**. |

## Reading

**Inbox, Unread, Primary, Starred, Files.** These are Gmail searches. Type any Gmail query in the search box and press Enter (`from:alex newer_than:7d`, `subject:invoice has:attachment`). Rows fill in their preview, date and unread dot as each thread loads. The list shows 25 at a time; scroll to the end, or press **Load older mail**, for the next batch.

**Summarize.** Two or three sentences on where the thread stands, then any asks of you as a list.

**Triage.** Sorts the visible threads into *reply* (a person is waiting on you), *read* and *skip*, with a short reason each. With Review on, it also suggests archives and folder moves. Those land in the review queue; nothing moves on its own.

**Ask your inbox.** **Tools → Ask**. Ask a question in plain English ("When is the venue walkthrough?").
- It writes the Gmail search and shows it to you, so you can edit and re-run.
- It reads the top five threads and answers with numbered sources.
- Click a source to open the thread.

**Formatted view.** **More → Formatted view** above the thread shows a message with its links, lists and tables. Scripts, styles, forms, images (including tracking pixels) and `javascript:` links are stripped first, links open in a new tab, and quoted history folds away. Plain text is the default.

## Connecting your systems

This is what sets Chatterbuilt Mail apart from email clients with AI added: each thread is checked against the rest of your systems, and routed back out to them. Why it matters: [why.md](why.md).

**Context.** When you open a thread, a card above the messages checks every system in `CONFIG.context` for that person and topic, all at once:
- meeting notes (Fireflies, Zoom, Notion meeting notes);
- calendar (past and upcoming meetings);
- tasks and notes;
- a sales or sponsor pipeline;
- contacts or CRM;
- newsletter subscriber lists;
- your memory system.

The AI keeps only what matters for the reply, two to seven lines, each tagged with its source: who they are to you, open commitments either way (especially action items assigned to you), the last and next meeting, pipeline status. Chips under the card show which systems found something, came back empty, or failed. Lookups are read-only, cached for five minutes, and time out after 15 seconds each so one slow system never holds up the rest.

Drafts and the pre-send check use the card. Turn off **Context** under *Draft with* in the reply box to leave it out of a draft.

**Route.** Press **Route** above the thread (or `o`). The AI reads the thread and the context card and suggests where the thread should go, with the text already written:
- a task in your task app, with a title starting with a verb;
- a contact, which opens Add to contacts;
- snooze until a date, or remind me if nobody replies;
- any action you add in `CONFIG.actions`: a Slack handoff to an assistant, a CRM note, a pipeline update, a ticket. See [connectors.md](connectors.md#route-actions).

Suggested actions are ticked. Edit any field, untick what you don't want, then **Apply selected**. Each action shows *done* or the reason it failed. Nothing runs until you apply, and read-only mode blocks it.

## Replying

**One-click intents.** Say yes, Decline, Ask a question, Offer a call, Follow up later. Or type an instruction ("yes, but only if we can do it in December") and press Draft.

**3 options.** Three versions: best fit, shorter, and a polite no. If the thread doesn't need a reply (a newsletter, a receipt, an FYI), it says so instead of inventing one.

**Pre-draft.** **Tools → Pre-draft**. Runs triage if needed, then writes the three options for up to eight threads marked *reply*, two at a time. Threads get a *drafted* tag. Nothing is saved to Gmail or sent.

**Per-recipient tone.** Before drafting, it reads up to three of your earlier sent emails to the same person and matches their register: greeting, length, formality, sign-off. Turn off *My tone with them* under *Draft with* to skip it.

**Calendar times.** Turn on *Open times* under *Draft with*, or press Offer a call.
- It reads the next seven days from Google Calendar and finds three open 30-minute slots inside your working hours, preferring around 10:00 and 2:00 on different days.
- It skips declined, cancelled and all-day events.
- Only the free times go to the model, never event names, people or locations.

**Pre-send check.** When you press Send, the AI rereads your reply against the thread and flags:
- questions or requests you didn't answer;
- names, dates, times, numbers or prices that don't match the thread;
- commitments you might not mean;
- an attachment you mention but haven't attached;
- reply-all or wrong-recipient risk;
- tone that could land badly;
- typos.

With the context card on, it also flags a reply that contradicts what your systems say: a meeting date that doesn't match your calendar, or a promise from the last call that the reply forgets.

It offers a corrected version you can take, or you can send anyway. If the check fails to run, you can still send. Turn it off in Skills if you prefer.

**Snippets.** Reusable text you insert at the cursor. `{{firstName}}` becomes the other person's first name and `{{myName}}` your sign-off. Start with the ones in `CONFIG.snippets`; add or delete them in the Snippets panel. Changes are saved in your browser until the improve skill writes them into your copy.

**Attachments.** **Attach** adds files to a reply, a follow-up or a Gmail draft, up to 18 MB in total. For bigger files, share a Drive link.

**Drafts waiting in Gmail.** Threads that already have a Gmail draft (written by the [morning run](morning-run.md), or by you in Gmail) show a *draft in Gmail* tag. Open one and press **Load it** to put it in the reply box. When you send, the old Gmail draft is removed so you don't end up with a stray copy.

**Save draft** puts the reply in Gmail Drafts. **Send** always asks you to confirm.

## Following up

**Waiting.** A tab listing sent emails where you had the last word and nobody has answered after N days (3 by default; change it above the list while the Waiting tab is open). Oldest is listed first, with a *waiting 6d* tag.
- Open one and press **Nudge** for a short, friendly follow-up.
- Sending goes to the people you wrote to, threaded under your last message.
- **3 options** gives a nudge, a shorter nudge, and a graceful "happy to drop this."

**Snooze.** Press **Snooze** above the thread (or `b`) and pick tomorrow, in two days, next Monday, in a week, in two weeks, or a date. The thread leaves the inbox and comes back, unread, that morning. Undo works.

**Remind me if no reply.** Tick *Remind me in N days if no reply* under the reply box before you send, or pick it in the Snooze panel. If nobody has answered by that morning, the thread comes back to your inbox. If they have, the reminder quietly clears.

Both are plain Gmail labels (`CB/Snooze/2026-11-05`, `CB/Remind/2026-11-05`), so you can see them in Gmail and nothing is stored anywhere else. The app checks for due ones each time it opens, and so does the morning run. The `CB/` labels are hidden from the Move folder list.

**Morning run.** A Claude scheduled task that triages each weekday morning, writes reply drafts into Gmail with context from your systems, and pushes a summary to your phone. See [morning-run.md](morning-run.md).

## Organizing

**Move and copy.** **Move** above the thread (or `m`). Move a thread into a folder (or create one), or forward a copy to another account you own. Moves can be undone.

**Unsubscribe.** Reads the sender's List-Unsubscribe header. It opens their unsubscribe page, or sends their unsubscribe email after you confirm. It can archive the thread afterward.

**Unsubscribe sweep.** **Tools → Sweep**. Scans your inbox for bulk mail and groups it by sender with counts. Per sender you can:
- unsubscribe;
- **Archive all**, which takes up to 100 threads out of the inbox after a confirm click and can be undone.

**Review queue.** **Tools → Review**. Every archive or move suggested by triage or rules waits here.
- Untick what you want left alone, then press **Apply selected**.
- Undo puts it all back.
- Whatever you untick teaches the app what not to suggest.

**Rules.** Rules come in two kinds:
- **Plain-English rules** ("receipts, invoices and payment confirmations", then move to Finance). AI matches them.
- **Sender rules**, which match an address or company domain exactly, with no AI involved.

Rules never act on their own. *Run rules* sends matches to Review. With *Check the inbox against my rules each time it loads* on, they run quietly whenever the inbox loads, and matches show up as a badge on Tools and Review.

**Suggested rules.** The app watches what you do by hand. Move or archive three emails from the same sender (or four from the same company) the same way, and it offers to make it a rule: *Add rule* or *Not now*. **Suggest rules from my history** asks the AI for broader patterns across your recent actions.

**Undo.** `z` or the Undo button on a toast reverses the last archive, move, star or review batch. Sent mail can't be unsent.

## Capturing

**Tasks.** Drag a thread or a single message onto **Tasks** in the top bar, press **Task** above the thread, or press `t`.
- The task gets the subject, sender, a link back to Gmail, and the message quoted.
- It works with any task app that has a claude.ai connector. See [connectors.md](connectors.md).

**Add to contacts.** Press **Contact** above the thread, or `c`. Pick the person if the thread has several. Then:
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
| `o` | Route |
| `b` | Snooze or remind |
| `r` | Reply box |
| `/` | Search |
| `z` | Undo |
| `?` | Help |
| `⌘K` / `Ctrl K` | Command palette (every action, searchable) |

**Read-only.** A switch in **Settings**. While it's on, a dark **Read-only on** button shows in the top bar; click it to turn read-only off. While it's on, nothing can be sent, moved, labeled, drafted, filed or saved. Reading, summaries, triage, Ask and drafting on the page still work.

**Phones.** One pane at a time. Above a thread you get Archive, Snooze, Route and More; Move, Task, Contact and Summarize move into More. Menus and dialogs open as bottom sheets with a Close button, and notices show at the top so they never cover Send.

## Layout

Why it's arranged this way, and the guidance behind it:

- **Fewer, grouped actions.** Apple's toolbar guidance: don't overcrowd, group by function and frequency, aim for no more than three groups, and put less important actions in a More menu [1]. The thread toolbar went from twelve equal buttons in two rows to three groups: organize, connect, More.
- **One click deep, no deeper.** Progressive disclosure works when the first screen has what people use most and the rest sits one clearly labeled step away; more than two levels gets people lost [2]. Tools, More and Settings are each one menu, with no submenus.
- **Labels on everything.** Icons alone are ambiguous, and hover-only labels don't work on touch screens, so every toolbar icon has a visible text label [3].
- **Menus say what they hold.** Hidden navigation is found less often, so each menu button has a specific name and a down arrow ("Tools", "Settings", "More") [4]. A split button would have been wrong here: its menu should hold variations of the button's own action, and the Tools items aren't variations of Search [5].
- **One primary action.** Send is the only filled button in the reply box, on the trailing edge [1]. Route gets a light accent because it's what makes this a hub.
- **Thumb reach on phones.** About half of phone use is one-handed [6], so phone menus open as bottom sheets and every item is at least 44 px tall. Bottom sheets get a visible Close button because people miss drag handles [7].
- **Keyboard and ⌘K for speed.** Every action keeps its shortcut, and the command palette lists them, the way Superhuman teaches shortcuts [8].

Sources:
1. [Apple Human Interface Guidelines: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
2. [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
3. [Nielsen Norman Group: Icon Usability](https://www.nngroup.com/articles/icon-usability/)
4. [Nielsen Norman Group: Beyond the Hamburger, desktop navigation](https://www.nngroup.com/articles/find-navigation-desktop-not-hamburger/)
5. [Nielsen Norman Group: Split Buttons](https://www.nngroup.com/articles/split-buttons/)
6. [Smashing Magazine: The Thumb Zone](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users)
7. [Nielsen Norman Group: Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)
8. [Superhuman design guide (Blake Crosley)](https://blakecrosley.com/guides/design/superhuman)

## What each feature touches

| Feature | Reads | Writes (only after your click) |
|---|---|---|
| Inbox, summaries, triage, Ask, formatted view | Gmail | nothing |
| Context | every system in `CONFIG.context`, read-only | nothing |
| Drafting, 3 options, Pre-draft, pre-send check | Gmail; your sent mail to that person (tone); Calendar free/busy (times); the context card | nothing until Save or Send |
| Send / Save draft / Nudge / attachments | | Gmail send or draft; removes a loaded Gmail draft after sending |
| Route | Gmail; the context card | whatever you tick: your task app, contacts, Gmail labels, or a `CONFIG.actions` tool |
| Snooze, remind-me | Gmail labels | Gmail labels under `CB/` (undoable) |
| Morning run | Gmail; every system in `CONFIG.context`, read-only | Gmail drafts and `CB/` labels only |
| Snippets | | your browser only |
| Move, archive, star, review, sweep archive | Gmail labels | Gmail labels (undoable) |
| Unsubscribe | Gmail message headers | an email to the sender's unsubscribe address, if you choose that |
| Tasks | Gmail | your task app |
| Contacts | Gmail; your contacts app (duplicate check); Clay if you press it | your contacts app |
| Voice | Gmail sent mail (train); Notion page (pointer) | your browser only |
| Rules, lessons, feature switches | | your browser only, until you run the improve skill |
