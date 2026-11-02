# Troubleshooting

| What you see | What to do |
|---|---|
| "Open this in claude.ai" | The page only reaches your connectors inside claude.ai. Open it from your artifacts list. |
| "Gmail isn't connected" or "Reconnect Gmail" | claude.ai Settings, Connectors: add or reconnect Gmail, then refresh the page. |
| "Not connected: Notion, Google Calendar…" toast | Those features need that connector. Reading mail still works. |
| "This page isn't allowed to use …" | Allow it in the artifact's Permissions menu, or ask Claude to republish with that tool declared. |
| Drafts don't sound like you | Voice → train from your sent mail, or point to your voice page. Then edit a few drafts before sending and press Learn now. |
| Calendar times never show up | Check that `calendar: true` is set and Google Calendar is connected, then tick *Offer open times* (or press Offer a call). |
| Tasks are saved but don't appear in your Notion view | Your view filters on properties the task didn't set. Ask Claude to add them to `CONFIG.tasks.input`. |
| "Already in Contacts" when they aren't | The duplicate check found their email somewhere in a search result. Save a second entry, or check the record it links to. |
| Clay fills nothing | Clay needs a full name and a company website (from their email domain, or the Website field for Gmail/Outlook addresses). Some people aren't in Clay. |
| Waiting is empty | Nothing you sent in the last few weeks has gone unanswered past the day setting. Try a lower number. |
| A send or save says "didn't answer in time" | It may still have gone through. Check Sent or Drafts in Gmail before trying again. |
| Lessons or rules vanished | They live in one browser. Use Copy for Claude and the improve skill to make them permanent. |
| Everything is greyed out | Read-only is on. Click it in the top bar to turn it off. |

Still stuck? Open an issue at https://github.com/mrhinkle/chatterbuilt-mail/issues with what you clicked and the exact message you saw. Leave out email content.
