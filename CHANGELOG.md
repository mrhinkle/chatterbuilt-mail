# Changelog

## 0.8.1 (2026-11-04)

### Added
- **Send a draft from another address or account.** With Gmail through Composio, the draft editor has a **From** menu with every address on every connected account, its own picked. Pick another and Send goes out from there as a new email with what's in the editor, then deletes the draft from its own account so it can't go out twice. A reply sent that way isn't inside the thread, and the note under From says so first. The other address's Gmail signature goes on instead of the draft's. A draft with files can't switch accounts yet, and Apply plan won't send a draft that's set to another address from its own.

### Fixed
- **Settings → Speed keeps the last few timings across a reload.** Timings are saved a moment after they come in; a reload in that moment lost them. They're now saved as the page goes away too.
- **The Drafts tab no longer shows the last thread's reply box.** Switching to Drafts with a thread open left that thread's actions, reply box and Send on screen under "drafts to review".

## 0.8.0 (2026-11-04)

### Added
- **Open mail at once.** A copy of each thread you open, and of the next few in the list, is kept in this browser, so opening it again, or moving on with `j`, doesn't wait on Gmail. A copy is only used while it has the newest message the list shows for that thread, so new mail is never hidden behind an old copy; a copy over a minute old opens at once and is then checked quietly, and a message that came in since appears (or, if you've started a reply, a note says so). Anything you change on a thread drops its copy. Up to 300 threads, none older than 14 days. On by default; switch it off in Settings → Skills.
- **Load ahead.** After the list loads, and each time you open a thread, the next few threads load in the background, two at a time, while the page is in view. Settings → Speed sets how far: off, 3, 5 (the default) or 10. Through the claude.ai Gmail connector the list's first lines already fetch each thread, and those fetches are kept now too.
- **Background refresh fills the cache.** The list's quiet check every few minutes now loads the new and changed threads it finds, so **Update** opens them at once.
- **Context briefs are kept and built ahead.** A brief is kept for 12 hours as long as no newer message comes in (for a draft, as long as the draft is unchanged), and the next thread's brief is built while you read this one, so it's there when you get to it (Settings → Speed → Get the next one ready, which also covers drafts). Each brief made ahead is an AI call made a step early; turn the switch off if you skip a lot. A kept brief more than five minutes old says when it was checked. A brief also finishes if you move on before it's done, instead of spinning when you come back.
- **Drafts open at once too.** In the Drafts tab the top drafts load ahead when the list opens, and the next few each time you open one (they used to load one at a time, in memory, for three minutes). A kept draft is used only while it's the version Gmail has, since each save gives a draft a new version; saving or sending drops it. The very next draft also gets its context brief and its *Check it for me* checklist ahead, so Next opens with the editor, the brief and the checklist all there. Checklist results are kept per version of a draft, so reopening one, even after a reload, doesn't ask again.
- **The list survives closing the page.** With Open mail at once on, the last list of each view is kept for three days (it used to last only for the session), so the page opens on it and then brings it up to date.
- **Settings → Speed** shows how many threads are kept and how much room they take, with **Load ahead**, **Get the next one ready** and **Clear kept mail**. Opening a thread from a copy is timed separately, as *Open a thread (kept copy)*.

## 0.7.10 (2026-11-04)

### Fixed
- **The bottom bars stay put.** With the reply box open, the bar with **Save draft** and **Send** is pinned to the bottom at every width. It used to pin only on a wide screen, so in the Claude app's side pane or on a phone it sat at the end of a long thread, off the screen. On a narrow screen it rides just above the thread's action bar (Archive, Snooze, Route, Reply, More), and both stay on screen.
- **The action bar no longer disappears while you type.** In a narrow window on a computer, such as the Claude app's side pane, it used to hide whenever the reply box had focus, and sometimes stayed hidden after. Now it hides only on a touch screen, while the keyboard is up.
- **Send, Skip and Delete stay readable on the selected draft row.** They were dark on the selected row's blue.

## 0.7.9 (2026-11-04)

### Added
- **Batch review in the Drafts tab.** Every row has Send, Skip and Delete. Mark the pile from the list, then **Apply plan** asks once (who the sends go to, which drafts go) and sends the marked drafts one at a time, in list order, with the deletes after the sends. Each leaves the list as it goes. If one fails the run stops there and says what went through before it; a write is never retried. The plan is kept in this browser, Skip is the checkbox, and Clear plan unmarks everything.
- **Flags on draft rows.** *No recipient*, *Empty* (nothing written, or only a signature), *[TK] to fill in* and *Duplicate* (same people, same subject as another draft). A draft that can't be sent as it is has Send switched off, with the reason.

## 0.7.8 (2026-11-04)

### Added
- **Attachments on drafts.** A draft with files opens editable (it used to be read-only here): its files sit under the sheet, each with an ×, and the paperclip in the toolbar adds more, up to 18 MB a save. Gmail drops a draft's attachments unless every save sends them all again, so Save sends the ones you kept and the ones you added; if the draft's files can't be read, Save stays off rather than lose them. Pictures inside the email, such as a signature's logo, stay in place. Through Composio, Save copies each file from the draft into Composio's store and uploads new ones through its workbench, so nothing passes through the browser; Composio can't carry a picture inside the text, so the editor says so first and **Save without them** goes ahead with it taken out. The page now declares `COMPOSIO_REMOTE_WORKBENCH` when Gmail goes through Composio.
- **Tell Claude what to change.** The one-line Revise field is now a prompt box under the editor: type what to change in your own words and press Enter (Shift+Enter for a new line), or use the Quick chips. The rewrite keeps links, bold and lists instead of resetting the formatting, and a plain-text answer is laid out as paragraphs. Select a passage first and only that passage is rewritten, with the rest sent along for context; a **Selected text only** chip shows while that's on. Undo steps back through every revision, not just the last.

### Fixed
- **Drafts in All inboxes are in date order.** Through Composio the list of drafts comes without dates, one account after another, so a draft saved this morning in the second account sat under yesterday's drafts from the first. Once each draft's details are in, the list is put in order, newest first.

## 0.7.7 (2026-11-04)

### Added
- **Settings → Speed.** How long things take in this browser: opening a thread, opening a draft and loading the list, then every kind of call, slowest total first, with how many times, the typical (middle) time, the slow (1 in 10) time and the slowest. Each Gmail call is timed end to end and, through Composio, so is each step inside it, so you can see where the seconds go. **Copy for Claude** copies it as text. Only names and times are kept, in this browser.

## 0.7.6 (2026-11-04)

### Changed
- **Threads open with one fetch.** In the formatted view (the default) a thread used to be fetched twice, once as text and again for the formatted copy; through Composio that was the same request both times. It now comes with its HTML in one call, and a message sent as HTML only gets its text from the HTML.
- **Drafts open faster.** A draft and the thread it answers are fetched at the same time instead of one after the other, and while you're on one draft the next loads in the background, so **Next** opens at once. A copy loaded ahead is used for up to three minutes.

## 0.7.5 (2026-11-03)

### Changed
- **The draft editor shows the email as it will look.** One white sheet: your text in its own fonts and colors, your signature right under it, and the earlier messages folded at the bottom. The toolbar is icons (undo, redo, bold, italic, underline, strikethrough, link, lists, clear formatting) that light up for what's on where the cursor is, and an empty draft says *Write your message…*. It used to be a text box with word buttons and the signature in a separate box below.

### Fixed
- **A draft started in Outlook opened blank, and saving it would have dropped its signature.** Outlook (and Apple Mail, Thunderbird, Yahoo) mark signatures and quoted history differently from Gmail, and the editor knew only Gmail's markers. It now finds all of them and keeps them on Save.
- **Large drafts through Composio came without their HTML.** When a draft was too big to come back inline, the page read a trimmed copy without the HTML part, so the editor had only plain text to show (for a signature-only draft, nothing). Opening a draft now always asks for the HTML.

## 0.7.4 (2026-11-03)

### Fixed
- **Long threads open faster in the formatted view.** Only the messages on show are cleaned and rendered; an older, collapsed message is formatted when you open it. Cleaning every message's HTML up front was the slow part on threads with long quoted history.
- **Screen readers hear "Updates available".** A status line, read out once when the news changes, says how many new threads arrived and that Update is in the header.

## 0.7.3 (2026-11-03)

### Added
- **Delete a draft.** The draft editor in the Drafts tab has **Delete**. It asks first, naming the draft and saying it's permanent (Gmail keeps no copy of a deleted draft), then deletes it with one call and opens the next draft. If Gmail doesn't answer, it says the draft may already be gone and to check before deleting again: a failed delete is never retried. Read-only blocks it. Composio uses `GMAIL_DELETE_DRAFT` on the account that holds the draft.

### Fixed
- **The bar with Send is back under a folded reply box.** 0.7.1 hid the bar when the reply box was folded, and the box remembers being folded, so on most threads the bar with Snippets, Reply all, Remind me, Save draft and Send was gone. It now shows whenever a thread is open. Using it while the box is folded opens the box and scrolls to its note or the send confirmation.

From a code review of 0.7.1 to 0.7.3:
- **Sending or deleting a draft holds the editor until Gmail answers.** The other draft buttons wait, and another draft can't open, so a slow answer can't land on the draft you moved to (and take your unsaved edits with it).
- **A held or doubled Enter can't answer Send or Delete.** Delete's question puts the keyboard on Cancel, and both ignore key repeats and a key press in the first half second.
- **Formatted mail can't load anything from elsewhere.** Styles that could fetch an image through CSS escapes, comments or `image-set()` are removed, and so are SVG and MathML with everything inside them (their text used to show). Quoted history folds once instead of once per level.
- **New messages show formatted.** A message that arrived after you first opened a thread, your own reply included, showed as plain text in a formatted thread. Switching to plain text keeps links clickable.
- **Through Composio, draft writes go to the draft's own account,** and switching accounts saves an open draft's edits and closes it.
- **Your own reply updates the list right away,** instead of turning on Updates available later.
- **Today's drafts card** no longer waits for ever when the inbox fails to load, and no longer shows the last account's drafts after you switch.
- Deleting a draft Gmail says is already gone counts as deleted. "Gmail can't find this" shows only for Gmail errors, not for other connectors or a missing account. The Delete button is red (it showed grey). Notes in the draft editor and toasts are announced to screen readers.

## 0.7.2 (2026-11-03)

### Changed
- **Messages open formatted.** A message shows with its own layout, colors, fonts, links and tables, in a sealed-off box so its styles and the page's never mix. Scripts, style sheets, forms and tracking pixels are removed, and pictures show as boxes of their real size. The thread shows as text for a moment, then the formatted version replaces it. **More → Formatted view** switches to plain text and back, and the choice is remembered. It used to be plain text unless you switched it on, every thread.
- **The context panel opens and closes with a click.** Click its header (or Hide) and it closes to a slim **Context** strip at the edge; click the strip to open it. `]` still does both. The Context button in the thread toolbar is gone.
- The context card at the top of a thread (narrow screens, phones, Drafts) no longer has a purple edge.
- **You decide when the list updates.** Every few minutes, and when you come back to the tab, the list checks Gmail quietly. It no longer changes on its own: new mail shows **Updates available** (or **3 new · Update**) in the header, and the list updates when you click it or Refresh. Loading the page, switching views and your own archive, snooze and move still update it right away.
- **Drafts on Today counts every draft.** The card used to count only drafts on threads in the view you were on (four in Unread, say). It now lists every draft in Gmail, all accounts in All inboxes, with who each is to and its subject wrapped in full instead of cut off. Click one to open it in the Drafts tab.

### Fixed
- **Threads from your other accounts open after a reload.** In All inboxes, the list that comes back from this session's saved copy (0.6.9) didn't remember which account each thread was in, so opening one asked the default account and Gmail answered 404. The saved copy now brings that back, the row's own account is used if it's still unknown, and if an account says a thread isn't there the page looks for it in your other accounts (reads only).
- **"Can't find this thread" in plain words.** When Gmail can't find a thread (deleted or moved since the list loaded), the reader says so with a **Refresh the list** button, instead of showing Gmail's raw error.

## 0.7.1 (2026-11-03)

### Fixed
- **The bar with Send stays on screen.** With the reply box open, the thread and the reply scroll as one page, and the bar with Snippets, Reply all, Remind me, Save draft and Send now stays pinned to the bottom of the pane. It used to sit below the last message, so on a long thread it was off screen. The reply box remembers being open, so this hit every thread once you'd opened it.
- **Hide closes the context panel.** On a wide screen, **Hide** used to move the whole brief to the top of the thread, so the panel seemed not to close. Now the thread gets the full width and **Context** in the toolbar (or `]`) brings the panel back. Narrow screens and the Drafts tab still show the brief in the page, since they have nowhere else to put it.

## 0.7.0 (2026-11-03)

### Changed
- **New mark.** Chatterbuilt Mail now uses the Chatterbuilt Blockwork mark, unchanged, with an envelope flap on the node that talks: the first of the Chatterbuilt product marks (one white icon, on that node only). It replaces the blue chat icon in the app header and heads the README. The SVG is `docs/images/chatterbuilt-mail-mark.svg`.

### Fixed
- An in-place refresh no longer keeps rows from before when you hadn't paged into older mail, so Load older mail in All inboxes stays in date order with no repeats.

## 0.6.9 (2026-11-03)

### New
- **Then: follow-ups that run after a reply sends.** A line in the reply box takes plain words ("Slack Christine to book the room", "add a task to send the deck Friday"). Send lists the steps in the confirmation, and they run once the reply has gone, through the same actions as Route: your task app, Remind me, a Slack draft (never sent) or a custom action.
- **A list that updates instead of reloading.** Refresh, and the refresh after archive, snooze, move or undo, merges the newest page into the list on screen: new mail slides in on top, threads that left drop out, and your place, open thread and selection stay. Each view keeps its last list so switching is instant, the list survives a reload for the browser session, it checks quietly every few minutes, and a failed refresh leaves the list alone.

### Changed
- **The signature preview looks like the signature.** It renders your signature's own HTML (tables, colors, fonts, links), kept apart from the page's styles. Pictures show as boxes of their real size, since the page can't load outside images. The preview no longer scrolls inside itself.
- After a send, the summary of what happened ("Sent; task added") also shows as a toast, since the reply box resets.

## 0.6.8 (2026-11-03)

### Changed
- **The reply box is an expandable section.** A **Reply** header (with who it's to) opens and closes it with a click anywhere on it. Open, it opens all the way: the thread and the reply scroll together as one page instead of the thread shrinking into its own small scrolling frame, and the text box grows with what you write instead of scrolling inside itself. Folded, it's docked under the thread as before.

## 0.6.7 (2026-11-03)

### New
- **Your HTML signature, pulled from Gmail.** Through Composio it's read from Gmail's settings for each account (`GMAIL_LIST_SEND_AS`, read-only), using the From address's own signature when it has one. With the Gmail connector, which has no settings tool, it comes from the newest message you sent that carries one.
- **Insert signature in Drafts.** A toolbar button adds your signature to a draft that has none (one from the morning run or from chat, say), or swaps an old signature for your current one. **Remove** takes it off. It shows formatted under the editor and goes on when you save.
- **From: pick the address a reply goes from.** With Gmail through Composio, a menu over the recipients lists every connected account and every alias set up under Gmail's "Send mail as". The thread's own address replies in the thread as before; any other address sends it as a new email ("Re:" and the subject) from there, on that account, since no tool can reply inside a thread from another account or alias. The page says so before you send. Save draft works from another account; an alias can send but not save a draft. The Gmail connector has one account, so it shows no menu.
- **Signature on or off for a reply.** The line under the reply box is now a **Signature** switch with **Show**, which previews the signature that will go on. Switch it off to leave it off one message.

### Fixed
- Composio's draft update drops a reply's `In-Reply-To` and `References` headers, so a reply draft saved through Composio can land as a new conversation for the other person. The Drafts editor now says so on reply drafts before you save, and the send confirmation says so after. There's no Composio tool that keeps those headers; the docs say to edit reply drafts in Gmail when threading matters.

## 0.6.6 (2026-11-03)

### New
- **Check it for me runs on its own** the first time a draft opens in the Drafts tab, after the context brief loads, and now reads what your systems know about the person too, so it can catch a draft that forgets a commitment. A line under the checklist says what it reads and that it never changes the draft. Your own ticks are left alone.
- **The context panel in Drafts.** The open draft gets the same brief as a thread: from its thread for a reply, or from the person it's to for a new email. More context and Route stay with threads.
- **Address fields in Drafts.** To, Cc and Bcc are chips with suggestions from your threads and, once connected, your address book, the same as Cc and Bcc on a reply.
- **Contacts set up from the dialog.** When no address book is connected (or the one you picked isn't connected yet), Add contact asks where you keep contacts (Google Contacts, Outlook, Notion, HubSpot or something else), remembers the answer, and **Set it up in Claude ↗** opens a new Claude chat with the setup request already written. **Copy the request** is there too. **Change address book…** reopens it later. **Set up enrichment ↗** opens a new chat the same way.

### Fixed
- A draft saved as HTML only (Gmail stores many drafts as a single HTML part, and Composio also returns that HTML as the message text) showed its tags, entities like `&#x27;` and its signature's table markup in the editor. It now shows as formatted text, and list rows, previews and replies get its text, not its markup.
- **Signatures stay as they are in Drafts.** The editor used to flatten a signature's table and images into a run-on line of `[Website]` links, and saving would have kept it that way. The signature now sits under the editor as it is, stays out of edits, revisions and the check, and goes back on untouched when you save.
- **Check it for me flags what's worth fixing.** It used to fail items it couldn't verify and wording you chose, so on a real draft it could flag all six. Now it fails only concrete problems (an unanswered question, a wrong date, a stray promise, a missing person, a tone that would land badly, a typo); anything it can't confirm stays ticked with a note.
- In the Drafts tab with nothing open, the desk said "Drafts waiting in Gmail: 0" from Today. It now counts the drafts left to review, with **Start with the first one**.
- The check's result and the send confirmation now show in the bar beside Save and Send, not below it.
- The Drafts action bar (Previous, Next, Save, Send) was see-through and sat a little above the bottom of the pane, so the checklist showed behind and below it. It's solid now and sits on the edge.

## 0.6.5 (2026-11-03)

### New
- **A Drafts tab.** Every Gmail draft in one list that doubles as a checklist: tick each one as you review it, with a count, a progress bar and **Hide checked**. Open a draft and it sits under the message it answers, with To, Cc, Bcc and Subject, in a **rich-text editor** (bold, italic, underline, links, bulleted and numbered lists). **Revise** (Shorter, Warmer, More direct, Polish, or your own words) with Undo. A **Before you send** checklist (answers what they asked, facts right, no stray promises, right people, tone, typos) you tick yourself, or **Check it for me** ticks what passes and notes the rest. **Save** writes back to the Gmail draft, **Send** asks once and moves to the next, **Mark checked · next** skips ahead. Unsaved edits are saved when you move on. Drafts with attachments open read-only so nothing gets dropped. Today links to it. Works on both Gmail paths (`get_draft` and `update_draft` for the Gmail connector; `GMAIL_UPDATE_DRAFT` and `GMAIL_SEND_DRAFT` through Composio).
- **Select several threads.** Tick a row's box (it appears on hover), Cmd/Ctrl-click, press `x`, or Shift-click for a range. A bar over the list archives, moves to a folder, marks read or stars them all at once, with one Undo. **Select** is in the right-click menu too.

### Changed
- **Flat rows.** List rows are square, with a hairline between them. Account rows in All inboxes keep their light tint but lose the colored edge.
- Setup declares `get_draft` and `update_draft` for the Gmail connector.

## 0.6.4 (2026-11-02)

### New
- **Triage hands you the next step.** Every triaged row gets one button for what you'll most likely do next: a reply type (Say yes, Decline, Ask a question, Offer a call, Follow up later, Nudge them), Create task, a Route action, Snooze or Remind me on a date, Unsubscribe, Add contact, Star, Mark read, Archive or Move to a folder. Reply buttons open the thread and draft with Triage's hint; nothing is sent. It only offers what your copy can do, and never archives, moves or unsubscribes a thread that needs your reply. **×** dismisses a suggestion and counts as a correction for **Learn now**. Section headers add **Pre-draft**, **Mark N read** and **Clear N** (archive the FYI section, or file each thread where Triage suggested, with one Undo). Archive and move suggestions still wait in Review.
- **Cc and Bcc.** Add people to a reply, follow-up or draft, with suggestions from your threads and your address book. The send confirmation and the pre-send check name everyone on Cc and Bcc, and reply-all keeps the people already on Cc. Works on both Gmail paths.
- **Contacts go to your mail account's address book.** `contacts: { book: "google" }` saves to Google Contacts through Composio, with How we met and Background as custom fields, the first email together as a dated First contact event, Notes in the Notes field and labeled profile links. With several Gmail accounts, each saves into its own. It's the default when Gmail runs through Composio. Composio has no ready-made sign-in for Google Contacts, so it needs your own Google OAuth client in Composio once; until then the dialog offers setup and Copy as vCard instead of a Save that would fail.
- **Enrich with any app.** `CONFIG.enrich` adds **Enrich with Apollo** (or People Data Labs, ZoomInfo, Lusha, anything with a person lookup) beside Clay; the AI maps its answer to the contact fields.
- **Setup requests from the page.** When enrichment or an address book isn't set up, the button copies a ready-made request to paste into a chat with Claude, which runs setup and republishes your copy.
- **Message someone in Slack**, built into Route with `slack: true`: name a person or #channel, and it leaves a draft in Slack with a link to the email. It never sends.
- **Custom actions in your own words.** **Add a custom action…** at the bottom of Route copies a description ("hand off scheduling to Sam in Slack") for Claude to set up.
- **The contact-cleanup skill** completes the address book you already have, in bulk and without the app: How we met, First contact, Background and missing job details from your mail and an enrichment app, missing fields added after you say yes, and likely duplicates flagged. It writes only after you approve the list and never deletes a contact.

### Changed
- **A square grid.** Flat panes on hairline borders, small corners and no drop shadows. Floating menus and dialogs keep a light shadow.
- **The model comes from where the page runs.** In Claude the page never names a model or tier, so Claude's interface decides. Setup no longer adds other models unless you ask for one by name.
- **Getting started** leads with "Claude does all the work," adds a **Fork it** path for changing the code, and fixes the duplicate Path 3. The setup skill defaults contacts to the mail account's address book, offers to add missing fields (only after a yes), and sets up enrichment and Slack.

## 0.6.3 (2026-11-02)

Fixes from beta testing: installs were heavier than they needed to be.

### Changed
- **A first install is Gmail and Claude only.** The setup skill starts from a new starter CONFIG (`examples/config.example.js`) with no other apps, asks only who you are and how you write, and lists what you can add later (calendar times, tasks, contacts, context, Route, More context, other models). Every connector the page declares is one more thing claude.ai asks you to allow, so nothing is declared until you turn it on. The old filled-in example is `examples/config.full.example.js`.
- **No Composio unless you ask for it.** The install prompts and docs used to suggest Composio for everything except Gmail. They now use claude.ai's native connectors, and Composio is an option for apps without a native connector or for several Gmail accounts in one copy.
- **No repo needed, and no commits to this one.** Your settings live in your published artifact; "change it later" reads them from there. `my/` and `memory/EMAIL-MEMORY.md` are git-ignored, and the setup and improve skills commit them only in a private repo you own (with `git add -f`). The docs no longer recommend forking: forks of a public repo are public. Path 1 in getting-started is now "just install it."
- The install guide says what you'll be asked to allow, and where your settings live.
- **Setup shows what you have and lets you pick.** It lists your connected apps (claude.ai's native connectors, MCP servers from your Claude plugins, and Composio only if you already use it), sorts them by feature (calendar, tasks, contacts, context, Route, web lookups, other models), and turns on only what you choose. Apps you name that aren't connected get a one-click suggestion from the connector directory. `docs/connectors.md` lists native connectors that fit each feature.

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
