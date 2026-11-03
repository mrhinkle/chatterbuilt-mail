# Drafts

The **Drafts** tab is for going through your Gmail drafts one at a time: the ones the morning run left, the ones you worked out in chat, the ones you started and forgot. The list is a checklist, the editor is rich text, and every draft gets the same short review before it goes.

![The Drafts tab: drafts as a checklist on the left, one draft open in the rich-text editor with the message it answers and the review checklist](images/drafts.webp)

*Made-up data.*

## How to use it

1. Press **Drafts** in the tabs over the list. Every Gmail draft shows with who it's to, the subject and its first line, newest first. In All inboxes, each row carries its account. With none open, the desk says how many are left to review, and **Start with the first one** opens it.
2. Open one. The message it answers sits on top (fold it away if you don't need it), then To, Cc, Bcc and Subject, then the draft in a rich-text editor. The **context panel** on the right shows what your systems know about the person it's to, the same brief you get beside a thread.
   - **To, Cc and Bcc** are address fields: start typing a name and pick from the people in your threads and, once one is connected, your address book (Google Contacts, for example). Enter, Tab or a comma adds someone; × removes them.
3. Edit it. The toolbar has **bold**, *italic*, underline, links and bulleted or numbered lists; Ctrl or ⌘ B, I and U work too. Pasted text comes in plain, so you don't drag in someone else's fonts.
4. **Revise** it if you like: Shorter, Warmer, More direct, Polish, or say what to change. It keeps every fact, name, date and link. **Undo** puts the old version back. A revision resets formatting.
5. Look at **Before you send**. **Check it for me** has usually already run (see below): what passes is ticked, and anything that doesn't has a short note saying what to fix.
6. **Save** writes your changes to the Gmail draft. **Send** asks once, naming everyone on it and how many checklist items aren't ticked, then sends the draft and opens the next one.
7. **Mark checked · next** moves on without sending. **← Previous** and **Next →** (or `j` and `k`) step through the list.

## Check it for me

This is the part worth slowing down for. Every draft gets a second read before it goes, and you don't have to remember to ask for it.

- **When it runs:** on its own the first time you open a draft, right after the context panel loads. Press **Check it for me** again after you edit, or any time you like.
- **What it reads:** the draft, who it's going to (To, Cc and Bcc) and the subject; the message it answers; what your systems know about this person (the context brief: meetings, open commitments, the pipeline); and your writing rules.
- **What it checks:** the six items below. Each one comes back ticked, or unticked with a note of at most 15 words saying what's wrong: "Doesn't answer her question about the fee", "Says Tuesday; she offered Wednesday", "You promised the deck on the last call; it isn't mentioned".
- **What it flags:** only problems you'd want to fix before sending. Something it can't confirm from what it has (whether a slot is free, say) stays ticked, with a note if it matters. Wording you plainly chose isn't marked down, and your signature isn't judged. A check that flags everything gets ignored, so it doesn't.
- **What it does with the result:** ticks and notes, nothing else. It never rewrites the draft, never sends, never saves. The count of things to look at shows in the bar beside Save and Send. If everything passes, the draft is marked checked in the list. If you've already ticked an item yourself, the automatic run leaves your tick alone.
- **What it sends to the AI:** the draft and its recipients, the message it answers, the context brief and your rules. Nothing else from your mailbox.

![Check it for me: five items ticked and one flagged with a note, with the count in the bar by Save and Send](images/drafts-check.webp)

It's the same idea as the [pre-send check](replying.md#the-pre-send-check) on a reply, laid out as a checklist so you can see exactly what was checked.

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
- **Signature:** the signature in the draft stays exactly as it is, tables, images and links included. It shows under the editor, stays out of edits, revisions and the check, and goes back on when you save. Saving from here doesn't add a second one.
- **Insert signature** (in the editor's toolbar) adds the signature you set in Gmail to a draft that has none, such as one written by the morning run or in chat, or swaps an old signature for your current one. It uses the draft's account, and the From address's own signature when it has one. **Remove** takes it off. Nothing changes in Gmail until you **Save**. If no signature is set in Gmail, it says where to add one.

  ![Insert signature: your Gmail signature under the draft, kept as it is, with Remove](images/drafts-signature.webp)

- **Replies saved through Composio lose their threading headers.** Composio's draft update rewrites the message without `In-Reply-To` and `References`. Gmail still keeps the draft in your thread, but the other person's mail app may show it as a new conversation. On a reply draft the editor says so before you save. If threading matters, make your edits in Gmail; sending an unsaved draft from here is fine. The Gmail connector doesn't have this problem.

## What it touches

| Step | Reads | Writes | Sent to the AI |
|---|---|---|---|
| The list | Gmail drafts (`list_drafts`, then `get_draft` for each subject) | nothing | nothing |
| Opening a draft | the draft (`get_draft`) and the thread it answers (`get_thread`) | nothing | nothing |
| Revise | | nothing until you Save | the draft and the message it answers |
| Check it for me | | nothing | the draft, its recipients and subject, the message it answers, the context brief, your writing rules |
| Context panel | your context sources, for the person the draft is to | nothing | what those sources return, to write the brief |
| To, Cc and Bcc suggestions | the threads you've loaded; your address book's search, when one is connected | nothing | nothing |
| Insert signature | your signature from Gmail (`GMAIL_LIST_SEND_AS` through Composio; your newest signed sent message with the Gmail connector) | nothing until you Save | nothing |
| Save | | the Gmail draft (`update_draft`) | |
| Send | | sends the draft (`send_message` with the draft) | |

Through Composio, the same steps use `GMAIL_LIST_DRAFTS`, `GMAIL_GET_DRAFT`, `GMAIL_LIST_SEND_AS`, `GMAIL_UPDATE_DRAFT` and `GMAIL_SEND_DRAFT`. Turn the tab off in **Settings → Skills → Drafts**.

## Related

- [Replying](replying.md): drafting in the reply box, and **Load it** for a draft on an open thread
- [Morning run](morning-run.md): drafts waiting before you're up
- [Today](today.md): **Review drafts one at a time**
- [Settings and shortcuts](settings-and-shortcuts.md)
