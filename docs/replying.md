# Replying

Press a button or say what you want, and you get a reply in your voice that already knows what your systems know about the person. Before it goes, the **pre-send check** rereads it against the thread and your systems and flags what you missed.

![A draft in the reply box: "Yes to gold" with two times for a call](images/draft.webp)

*Screenshots use made-up data.*

## How to use it

1. Open a thread. The reply box is under the messages (on a phone, tap **Reply** in the bottom bar).
2. Press a button, or type what the reply should say and press **Draft**:
   - **Say yes:** warm, and specific about what happens next.
   - **Decline:** kind, without over-explaining.
   - **Ask a question:** doesn't commit; asks the one or two things you'd need to know.
   - **Offer a call:** suggests a short call, with your open times.
   - **Follow up later:** acknowledges it and says roughly when you'll come back to it.
   - **Your own words:** "yes, but only if we can do it in December."
3. Edit the draft. Your edits are how it learns ([self-improving.md](self-improving.md)).
4. Press **Send**. The pre-send check runs, then you confirm. Or press **Save draft** to put it in Gmail Drafts.

Under the draft, a line says what went into it, for example: *matched how you write to Dana Ruiz, used Meetings, Pipeline, Memory*.

## Draft with

The switches under the instruction box decide what the draft uses:

| Switch | What it adds | Default |
|---|---|---|
| **My tone with them** | Reads up to three of your earlier emails to this person and matches the greeting, length, formality and sign-off. | On |
| **Context** | The [context panel](context-panel.md)'s brief: open commitments, pipeline status, meetings. | On |
| **Open times** | Three open 30-minute slots from your calendar. | Off; **Offer a call** turns it on |
| **Web context** | The [More context](more-context.md) web lookup. It can be ticked only after you've pressed More context and it found something. Citations are stripped. | Off |

### Open times

![Offer a call: the draft offers Tuesday at 10:00 or Wednesday at 2:30, with Open times ticked](images/offer-call.webp)

- It reads the next seven days from Google Calendar and finds three open 30-minute slots inside your working hours (`CONFIG.workHours`), preferring around 10:00 and 2:00 on different days.
- It skips declined, cancelled and all-day events.
- Only the free times go to the AI, never event names, people or locations.

## 3 options

**3 options** writes three versions side by side: **Best fit**, **Shorter** and **Polite no**. Click one to load it into the reply box. If the thread doesn't need a reply (a newsletter, a receipt, an FYI), it says so instead of inventing one.

![3 options: Best fit, Shorter and Polite no above the reply box](images/options.webp)

On a thread where you had the last word, the three are follow-ups instead: **Friendly nudge**, **Shorter**, and **Close the loop**. See [following-up.md](following-up.md).

## Pre-draft

**Tools → Pre-draft** writes the three options for up to eight threads marked *reply*, two at a time, so they're ready when you open each one. It runs Triage first if you haven't. Threads get a **drafted** tag. Nothing is saved to Gmail or sent.

![The list after Pre-draft: Dana, Lee and Priya each tagged DRAFTED](images/predraft.webp)

For drafts that land in Gmail before you even open the app, use the [morning run](morning-run.md).

## The pre-send check

When you press **Send**, the AI rereads your reply against the thread and flags:

- questions or requests you didn't answer;
- names, dates, times, numbers or prices that don't match the thread;
- commitments you might not mean to make;
- an attachment you mention but haven't attached;
- reply-all or wrong-recipient risk, or something confidential going to the wrong person;
- tone that could land badly;
- typos, and breaks of your writing rules (`CONFIG.rules`).

With the context panel on, it also flags a reply that contradicts what your systems say, or that forgets a commitment in the brief. Here it catches the deck promised on the last call:

![The pre-send check: a MEDIUM flag that the reply doesn't mention the promised deck, with Send anyway and Use suggested version](images/presend.webp)

Then you choose:
- **Use suggested version** puts its rewrite in the reply box (it keeps your wording wherever it can), so you can read it over and press Send again;
- **Send anyway** sends what you wrote;
- **Cancel** goes back to editing.

If nothing is wrong, it says so and asks you to confirm. If the check can't run, you can still send. While it runs, **Send without checking** skips it. You can turn the check off in **Settings → Skills**.

## Everything else in the reply box

- **Snippets:** reusable text you insert at the cursor, with `{{firstName}}` and `{{myName}}`. See [voice.md](voice.md#snippets).
- **Attach:** files on a reply, a follow-up or a Gmail draft, up to 18 MB in total. For bigger files, share a Drive link.
- **Reply all:** off by default. The pre-send check warns when reply-all looks risky.
- **Remind me in N days:** if nobody answers by then, the thread comes back to your inbox. See [following-up.md](following-up.md).
- **Drafts waiting in Gmail:** when a thread already has a Gmail draft, a banner offers **Load it**. Sending then replaces that draft, so you don't end up with a stray copy.
- **Send** always asks you to confirm.

## What it touches

| Step | Reads | Writes | Sent to the AI |
|---|---|---|---|
| Drafting | the thread; your sent mail to this person (tone); the context brief; your calendar (open times only) | nothing | the thread, your voice and lessons, the brief, free time slots |
| Save draft | | a Gmail draft (`create_draft`) | |
| Send | | the reply (`reply`), or a new message threaded under your last one when you're following up (`send_message`) | the reply and thread, for the pre-send check |

Read-only mode blocks Save draft and Send. Nothing is sent without your confirmation.

## Related

- [Voice](voice.md): your voice prompt, per-recipient tone, snippets
- [The context panel](context-panel.md): where the brief comes from
- [Following up](following-up.md): Nudge, Waiting, Remind me
- [Self-improving](self-improving.md): how your edits become lessons
- [Morning run](morning-run.md): drafts in Gmail before you start
- [Features](features.md): every feature in one place
