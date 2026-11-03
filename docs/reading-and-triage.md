# Reading and triage

The thread list is your Gmail, with previews, unread dots and tags for drafts and waiting replies. **Triage** sorts it into what needs you, what's worth reading and what isn't, and **Ask** answers questions about your mail with sources.

![After Triage: Needs you, Worth reading and FYI, with a reason on each thread](images/triage.webp)

*Screenshots use made-up data.*

## The list

- **Tabs.** Inbox, Unread, Waiting, Drafts, Primary, Starred and Files. **Drafts** is its own view: every Gmail draft, one at a time, with a review checklist ([drafts.md](drafts.md)).
- **Pick several.** Hover a row and tick its box, Cmd/Ctrl-click, or press `x`; Shift-click picks a range. Then archive, move, mark read or star them all at once ([organizing.md](organizing.md#several-at-once)).
- **Each tab is a search.** Inbox, Unread, Primary, Starred and Files are Gmail searches (Files is `in:inbox has:attachment`). Waiting is different: it lists sent mail nobody has answered. See [following-up.md](following-up.md).
- **Hide the list.** On a computer, **Hide list** at the left of the thread title (or `[`) hides the list so the thread or Today gets the full width. **Show list** brings it back. The app remembers.
- **Resize the panes.** Drag the grip between the list and the thread, or between the thread and the context panel, to make either wider. Or click the grip and use the arrow keys: Shift moves farther, Home and End go to the smallest and largest. Double-click a grip to put it back. The app remembers your widths, and the thread never gets narrower than 380 px, so a wide list shrinks back on a small window. Phones show one pane at a time, so they have no grips.

  ![The context panel dragged wider, with its grip highlighted](images/resize.webp)


  ![The thread list hidden: the thread takes the full width, with the context panel still beside it](images/list-hidden.webp)

- **Search.** Type any Gmail query and press Enter: `from:dana newer_than:7d`, `subject:invoice has:attachment`.
- **Rows** fill in their preview, date and unread dot as each thread loads. Tags show **draft in Gmail** when a draft is waiting, and after Triage, **reply**, **read** or **skip** with a short reason.
- **Row buttons.** Each row has a small strip of icons: **Archive**, **Move**, **Route**, **Create task** and **Add contact**. It always shows on the open thread and appears on hover for the others, so you can file a thread without opening it. Archive and Move work in place; Route and Add contact open the thread first. You can also drag a row onto **Tasks** in the top bar.
- **Right-click a row** (or focus it and press Shift+F10 or the menu key) for every action in one menu: Open, Archive, Snooze, Move, Route, Create task, Add contact, Star or Unstar, Mark read or unread, Unsubscribe, and Open in Gmail.

  ![Right-click on a row: the menu of thread actions](images/row-menu.webp)

- **The thread header.** The subject takes at most two lines. On a narrow reading pane the thread buttons turn into icons on one line (hover for the name), and the chevron at the right of the subject hides them altogether. The context card's header folds it with a click.
- **More mail.** The list shows 25 at a time. Scroll to the end, or press **Load older mail**, for the next batch. The footer shows how many are loaded out of Gmail's estimate.
- **It updates, it doesn't reload.** **Refresh**, and the refresh after you archive, snooze, move or undo, fetches the newest page and merges it into the list on screen. New mail slides in at the top with a moment of highlight, threads that left the view drop out, and your scroll position, open thread and selection stay where they were. The list never changes on its own, though: every few minutes, and when you come back to the tab, it checks Gmail quietly, and if there's new mail the header shows **Updates available** (or **3 new · Update**). Click it, or **Refresh**, when you're ready.
- **Views come back at once.** Inbox, Unread, Primary, each account and each search keep their last list, so switching shows it straight away and refreshes behind it. The latest list is also kept for this browser session, so reopening the page shows your list before Gmail answers. If a refresh fails, the list stays as it was and a note says so.

## Triage

Press **Triage** next to the search box. The AI reads the first 40 threads in the view (sender, subject and preview) and marks each one:

- **reply:** a real person is likely waiting on you;
- **read:** worth reading, no reply expected (receipts to file, newsletters you chose, event logistics);
- **skip:** automated, promotional or notification noise.

The list then groups into **Needs you**, **Worth reading** and **FYI**, and each row gets a reason of a few words.

### A next step on every row

Sorting is half of it. Each triaged row also gets one button: the next step Triage thinks you'll take. Press it and it happens.

| The button says | What pressing it does |
|---|---|
| **Say yes**, **Decline**, **Ask a question**, **Offer a call**, **Follow up later**, **Nudge them** | Opens the thread and drafts that reply, using the hint Triage wrote (hover the button to read it). Nothing is sent. |
| **Create task** | Files it in your task app |
| **Hand off to …** or any custom action | Opens Route with that thread |
| **Snooze to Mon, Nov 9**, **Remind me Thu** | Snoozes it, or sets a reminder if nobody answers |
| **Unsubscribe…** | Opens the unsubscribe check |
| **Add contact** | Opens Add contact for the sender |
| **Star**, **Mark read**, **Archive**, **Move to Finance** | Does it, with Undo |

It only suggests what your copy can do: no task button without a task app, no Route action you haven't set up. It never suggests archiving, moving, unsubscribing or marking read a thread that needs your reply. The **×** next to a button dismisses it, and that counts as a correction (below).

![Triage: Needs you, Worth reading and FYI, each row with its next step, and one-click actions on the section headers](images/triage.webp)

### A whole section at once

The section headers have their own button:
- **Needs you → Pre-draft:** reply options for each one, up to 8. Nothing is saved or sent.
- **Worth reading → Mark N read.**
- **FYI → Clear N:** archives them, or files each in the folder Triage suggested. It asks once ("Yes, clear 4"), and one **Undo** puts them all back.

### Review still works

With Review on, the archive and move suggestions also wait in **Tools → Review**, so you can go through them as a list, and the badge on Tools counts them. Using a row's button or dismissing it takes that thread out of Review. See [organizing.md](organizing.md#review-and-undo).

Triage learns. When you untick a suggestion in Review or dismiss a row's button, that's recorded, and **Learn now** turns your corrections into lessons that steer the next Triage. See [self-improving.md](self-improving.md).

## Summarize

Open a thread and press **More → Summarize**. You get two or three sentences on where the thread stands, then anything asked of you as a list.

![A summary at the top of a thread: what Dana wants, then two asks](images/summarize.webp)

## Ask your inbox

Ask a question in plain English: "When is the venue walkthrough?"

- **Tools → Ask**, or the **Ask** switch inside the search box. With Ask on, Enter asks instead of searching.
- It writes a Gmail search from your question and shows it, so you can edit it and ask again.
- It reads the top five threads that search finds, then answers using only those, with numbered sources.
- Click a source to open the thread. If the threads don't answer it, it says so and suggests a better search.

![Ask your inbox: the question, the Gmail search it wrote, an answer with [1], and the source](images/ask.webp)

The Ask switch in the search box:

![The search box with Ask switched on](images/ask-mode.webp)

## Links and attachments

- **Links** in a message are clickable and open in a new browser tab.
- **Attachments** show as buttons under the message. Click one to open it right here:
  - PDFs show page by page (up to 30 pages);
  - images show full size;
  - text files (TXT, CSV, JSON, Markdown, calendar invites) show as text;
  - anything else gets **Save**, which asks before it downloads, and **Open in Gmail**.

![A PDF invoice open in the attachment viewer, with Save and Open in Gmail](images/attachment.webp)

The viewer reads the message's source through the same Gmail read the page already uses, so nothing new is connected and nothing is sent to the AI. PDFs are drawn with pdf.js, loaded from cdnjs the first time you open one.

## Formatted view

Messages open formatted: their own layout, colors, fonts, links, headings, lists and tables. The thread shows as text for a moment, then the formatted version replaces it. **More → Formatted view** switches to plain text and back, and the page remembers your choice.

![A newsletter in Formatted view, with headings, a link and a table](images/formatted.webp)

- Each message renders in its own sealed-off box, so its styles and the page's never mix.
- Scripts, style sheets, forms and `javascript:` links are removed before anything shows. Only safe inline styles are kept.
- Pictures can't load inside the artifact, so each shows as a box of its real size with its description. Tracking pixels (images with no size) show nothing.
- Links open in a new tab, and quoted history folds under **Earlier messages**.
- A message sent as plain text stays plain text.

## What it touches

| Feature | Reads | Writes | Sent to the AI |
|---|---|---|---|
| The list and search | Gmail (`search_threads`, `get_thread`) | nothing | nothing |
| Triage | the list you already loaded, your Gmail folder names, your Route action names | nothing until you press a row's button or a section's (archive, move and Clear come with Undo) | sender, subject and preview of up to 40 threads |
| Summarize | the open thread | nothing | the thread |
| Ask | Gmail search results | nothing | your question, then the top five threads |
| Formatted view | the open thread's HTML (`get_thread`, full content) | nothing | nothing |
| Opening an attachment | the message source (`get_message`, raw) | nothing (Save asks before downloading) | nothing |

Opening a thread doesn't mark it read. **More → Mark read** does.

## Related

- [Today](today.md): what to do first
- [The context panel](context-panel.md): what your systems know about the person, beside every thread
- [Replying](replying.md): drafts, 3 options, Pre-draft and the pre-send check
- [Organizing](organizing.md): Review, rules, move, unsubscribe
- [Settings and shortcuts](settings-and-shortcuts.md): keyboard shortcuts and the command palette
- [Features](features.md): every feature in one place
