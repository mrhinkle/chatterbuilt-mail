# Drafts

The **Drafts** tab is for going through your Gmail drafts one at a time: the ones the morning run left, the ones you worked out in chat, the ones you started and forgot. The list is a checklist, the editor is rich text, and every draft gets the same short review before it goes.

![The Drafts tab: drafts as a checklist on the left, one draft open in the rich-text editor with the message it answers and the review checklist](images/drafts.webp)

*Made-up data.*

## How to use it

1. Press **Drafts** in the tabs over the list. Every Gmail draft shows with who it's to, the subject and its first line, newest first. In All inboxes, each row carries its account.
2. Open one. The message it answers sits on top (fold it away if you don't need it), then To, Cc, Bcc and Subject, then the draft in a rich-text editor.
3. Edit it. The toolbar has **bold**, *italic*, underline, links and bulleted or numbered lists; Ctrl or ⌘ B, I and U work too. Pasted text comes in plain, so you don't drag in someone else's fonts.
4. **Revise** it if you like: Shorter, Warmer, More direct, Polish, or say what to change. It keeps every fact, name, date and link. **Undo** puts the old version back. A revision resets formatting.
5. Go through **Before you send**, or press **Check it for me** and the AI ticks what passes, with a short note on anything that doesn't.
6. **Save** writes your changes to the Gmail draft. **Send** asks once, naming everyone on it and how many checklist items aren't ticked, then sends the draft and opens the next one.
7. **Mark checked · next** moves on without sending. **← Previous** and **Next →** (or `j` and `k`) step through the list.

## The checklist

Two kinds of checking, both kept in this browser:

- **The list.** Tick a draft's box when you're happy with it. The header counts how many of your drafts are checked, with a progress bar, and **Hide checked** leaves only the ones still to do. A draft is checked automatically when every item on its review list is ticked, or when **Check it for me** finds nothing wrong.
- **Before you send**, for the open draft:
  - Answers everything they asked
  - Names, dates, times and numbers are right
  - Promises only what you mean to
  - The right people are on To, Cc and Bcc
  - The tone fits this person
  - No typos, and nothing it mentions is missing

Sending doesn't need every box ticked. The confirmation just tells you how many aren't.

## Good to know

- **Unsaved edits** are saved to the draft when you open another one or leave the tab. With read-only on, nothing is saved or sent.
- **Attachments:** a draft with attachments opens read-only here, because saving from the page would drop them. Edit and send it in Gmail (**Open in Gmail ↗**).
- **Emptying Cc or Bcc:** Gmail keeps a field's old value when it's saved empty, so to take everyone off Cc, do it in Gmail.
- **The quoted earlier messages** in a reply draft stay attached; the editor shows only your part.
- **Signature:** whatever signature is already in the draft stays as text you can see and edit. Saving from here doesn't add a second one.

## What it touches

| Step | Reads | Writes | Sent to the AI |
|---|---|---|---|
| The list | Gmail drafts (`list_drafts`, then `get_draft` for each subject) | nothing | nothing |
| Opening a draft | the draft (`get_draft`) and the thread it answers (`get_thread`) | nothing | nothing |
| Revise | | nothing until you Save | the draft and the message it answers |
| Check it for me | | nothing | the draft, its recipients and subject, the message it answers, your writing rules |
| Save | | the Gmail draft (`update_draft`) | |
| Send | | sends the draft (`send_message` with the draft) | |

Through Composio, the same steps use `GMAIL_LIST_DRAFTS`, `GMAIL_GET_DRAFT`, `GMAIL_UPDATE_DRAFT` and `GMAIL_SEND_DRAFT`. Turn the tab off in **Settings → Skills → Drafts**.

## Related

- [Replying](replying.md): drafting in the reply box, and **Load it** for a draft on an open thread
- [Morning run](morning-run.md): drafts waiting before you're up
- [Today](today.md): **Review drafts one at a time**
- [Settings and shortcuts](settings-and-shortcuts.md)
