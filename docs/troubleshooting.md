# Troubleshooting

| What you see | What to do |
|---|---|
| "Open this in claude.ai" | The page only reaches your connectors inside claude.ai. Open it from your artifacts list. |
| "Gmail couldn't finish that just now" | Usually it ran while claude.ai was asking you to allow Gmail for the page, or Gmail had a short hiccup. Allow it if asked, then press **Try again** (or Refresh). The page already retries a read once on its own when the error says that may work. It never retries a send, a move or a save, because a failure isn't proof it didn't happen. Check Sent or Drafts before trying a write again. |
| "Gmail isn't connected" or "Reconnect Gmail" | claude.ai Settings, Connectors: add or reconnect Gmail, then refresh the page. |
| "Not connected: Notion, Google Calendar…" toast | Those features need that connector. Reading mail still works. |
| "This page isn't allowed to use …" | Allow it in the artifact's Permissions menu, or ask Claude to republish with that tool declared. |
| Drafts don't sound like you | Settings → Voice → train from your sent mail, or point to your voice page. Then edit a few drafts before sending and press Learn now. |
| Calendar times never show up | Check that `calendar: true` is set and Google Calendar is connected, then turn on *Open times* under *Draft with* (or press Offer a call). |
| Tasks are saved but don't appear in your Notion view | Your view filters on properties the task didn't set. Ask Claude to add them to `CONFIG.tasks.input`. |
| "Already in Contacts" when they aren't | The duplicate check found their email somewhere in a search result. Save a second entry, or check the record it links to. |
| Clay fills nothing | Clay needs a full name and a company website (from their email domain, or the Website field for Gmail/Outlook addresses). Some people aren't in Clay. |
| Waiting is empty | Nothing you sent in the last few weeks has gone unanswered past the day setting. Try a lower number. |
| A send or save says "didn't answer in time" | It may still have gone through. Check Sent or Drafts in Gmail before trying again. |
| Lessons or rules vanished | They live in one browser. Use Copy for Claude and the improve skill to make them permanent. |
| The list stops at 25 | Scroll to the end of the list or press **Load older mail**. Gmail's connector doesn't hand back a next-page marker, so older pages are found by date; on a day with more than 50 threads in one search, a few from that day can be skipped. |
| Everything is greyed out | Read-only is on. Click the dark **Read-only on** button in the top bar to turn it off. |
| A context chip is red | That source failed or took over 15 seconds; hover for the reason. The rest of the panel still works. Press Refresh to try again. |
| The context panel mentions the wrong person or company | A search source is too loose. Ask Claude to tighten it: an exact email filter, a specific database, or the bare company name instead of the domain. |
| No "From your systems" section | `CONFIG.context` is empty, or Context is off in Settings → Skills. |
| Route suggests nothing | Nothing in the thread clearly called for it. Tick an action anyway and fill in the fields. |
| A snoozed thread didn't come back | The app brings it back the next time it opens, and the morning run each weekday. It's under the `CB/Snooze/<date>` label in Gmail meanwhile. |
| No *draft in Gmail* tag on a thread you drafted | Drafts are checked once a minute. Reload the inbox. |
| No context panel beside the thread | You may have hidden it: press **Context** at the right of the thread toolbar to bring it back. Below 1180 px wide, context sits at the top of the thread instead. If it's missing everywhere, turn Context, More context and Route on in Settings → Skills. |
| The thread list is gone | You hid it. Press **Show list** at the left of the thread title, or `[`, to bring it back. |
| The context is just one line | You folded it. Press **Show** on it, or `]`. |
| A pane is too narrow or too wide | Drag the grip beside it, or double-click the grip to reset it. **Reset pane sizes** in the command palette (⌘K) resets both. |
| The panel says there's no one to look up | The thread has nobody on it but you (a note to yourself, or a draft you sent yourself). There's no person to check your systems for. |
| More context says "Nothing relevant on the web" | The search found nothing about this person. Gmail and Outlook addresses have no company domain, so results are thinner. |
| More context failed | Read the message under the button. A web search connector may need connecting, or (through Composio) the search app may need an active connection inside Composio. |
| "Composio reported an error: No active connection for toolkit=…" | Connect that app inside Composio. See [composio.md](composio.md). |
| The morning run asked for approval and stopped | Its runs need automatic approval. Turn it on in the scheduled task's settings, if your organization allows it. |

Still stuck? Type **chatterbuilt-mail-feedback** in Claude. It writes up the issue with your version and setup, removes anything private, and files it when you say so. Or open one yourself at https://github.com/mrhinkle/chatterbuilt-mail/issues with what you clicked and the exact message you saw. Leave out email content.
