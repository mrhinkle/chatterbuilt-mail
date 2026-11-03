# Tasks and contacts

Turn an email into a task in your task app, or a person into a contact, in one step from the thread. Both work with any app that has a claude.ai connector, or through Composio.

![A task filed from the thread: the Tasks drop zone shows "filed", and a notice links to the new task](images/task.webp)

*Made-up data: Alex Rivera at Rivera Labs, filing a task from Dana Ruiz's email.*

## Tasks

### How to use it

Any of these files the open thread as a task:
- press **Task** above the thread;
- press `t`;
- click **Tasks** in the top bar;
- drag a thread from the list onto **Tasks** in the top bar. You can also drag a single message by its header, to file that message instead of the newest one.

The drop zone lights up while you drag, shows *filing…*, then *filed ✓*. A notice names the task and, when your task app hands back a link, adds **Open**.

### What gets filed

The task's title is the email's subject without Re: or Fwd:. What else goes in depends on how your copy maps the fields, but these are available:

| Value | What it is |
|---|---|
| `{{title}}` | Subject without Re:/Fwd: |
| `{{from}}`, `{{fromName}}`, `{{fromEmail}}` | The sender |
| `{{date}}`, `{{dateISO}}`, `{{today}}` | When it was sent, and today |
| `{{url}}` | A link back to the message in Gmail |
| `{{excerpt}}` | The message without quoted history, up to 1,500 characters |
| `{{body}}` | From, subject and date, the message quoted, and an Open in Gmail link (Markdown) |
| `{{text}}` | The same as plain text |
| `{{notes}}` | "Email from … · date" |

From **Route**, the AI writes a better title, starting with a verb ("Send Dana the sponsor deck and gold terms"), and you can edit it before applying. See [Route and next steps](route-and-next-steps.md).

If tasks aren't set up, Task tells you to ask Claude to run `chatterbuilt-mail-setup` and name your task app.

## Contacts: the whole picture of a person

![Add contact: job, company and links from their signature and Apollo; how you met from your first thread; background from their work history; your notes; saving to Google Contacts](images/contact.webp)

An address book entry usually stops at a name and an email. **Add contact** fills in the rest from what you already have, so the next time their name comes up you know who they are, how you met and what matters to them. **[Watch it (25 seconds)](media/add-contact.mp4)**, made-up data.

### How to use it

Press **Contact** above the thread, or `c`. If several people are on the thread, pick one from **Who**. The dialog fills itself in while you watch:

- **From their emails.** It reads the emails they've sent you (this thread plus up to four more) for their signature: name, title, company, phone, website, location. Social links are picked up by pattern: LinkedIn, X, Bluesky, GitHub, Instagram. A note says how many fields it filled and from how many emails. **Look again in their emails** reruns it.
- **How we met.** It finds your earliest thread together and writes a one- or two-sentence note: month and year, who reached out, what it was about, and who introduced you. **First thread together** links that thread, and its date is saved as **First contact**.
- **Background.** Two or three sentences on their work history and what they focus on now, from your enrichment app.
- **Notes.** Yours: what you want to remember next time.
- **Enrich.** **Enrich with Clay**, or with whichever app you set up (Apollo, People Data Labs, ZoomInfo, Lusha…), looks the person up and fills title, company, location, profiles and Background. It runs only when you press it and uses credits in that app. If no enrichment app is set up, **Set up enrichment ↗** opens a new Claude chat with the setup request already written; Claude sets it up and republishes your copy. (**Copy request** is there if you'd rather paste it yourself.)
- **Already there?** The dialog checks your address book and warns when the email is already on file, links the record, and asks before saving a second entry.

![The bottom of Add contact: how you met, the first thread together, background, notes and Save to Google Contacts](images/contact-story.webp)

Every field is editable. Fields are only filled when empty, so your edits stay. Press **Save to** *your address book*, or **Copy as vCard** to paste it anywhere.

No-reply and notification addresses aren't offered as people to add.

### Where contacts go

By default, the address book that comes with your mail account. For Gmail that's **Google Contacts**, reached through [Composio](composio.md)'s Google Contacts toolkit, because claude.ai has no Google Contacts connector of its own. With several Gmail accounts, each one can save into its own Google Contacts.

**One-time setup for Google Contacts.** Composio doesn't offer a ready-made sign-in for Google Contacts (checked November 2, 2026), so connecting it means adding your own Google OAuth client in Composio's dashboard under Google Contacts. The setup skill walks you through it. Until it's connected, the dialog says so and offers **Copy as vCard**, which Google Contacts can import, instead of a Save button that would fail.

Google Contacts has no fields for how you met or a background, so they're added as **custom fields** on each contact. The first email together becomes a dated **First contact** event, your notes go in the **Notes** field, and LinkedIn, X and GitHub become labeled links. Nothing needs setting up in Google first.

You can pick any other address book or CRM instead: Notion, HubSpot, Airtable, Outlook contacts, anything with a connector. If it's missing fields such as How we met or Background, setup lists them and offers to add them, and only adds them after you say yes.

**Setting it up from the dialog.** If no address book is connected, or the one you picked isn't connected yet, Add contact asks **Where do you keep your contacts?** Pick Google Contacts, Outlook, Notion, HubSpot or something else (then name it). The app remembers your answer, and **Set it up in Claude ↗** opens a new Claude chat with the right setup request already written: Claude connects it, adds any missing fields after you say yes, and republishes your copy. **Copy the request** does the same by paste. Already set up and want to switch? **Change address book…** at the bottom of the dialog brings the question back.

### Clean up the address book you already have

The **contact-cleanup** skill does the same thing in bulk, with or without Chatterbuilt Mail. Say *"clean up my contacts"* and it audits your address book, fills How we met, First contact, Background and the missing job details from your mail and your enrichment app, adds fields the book doesn't have, and flags likely duplicates. It shows you every proposed change and writes nothing until you approve the list. It never deletes a contact.

<p><img src="images/phone-contact.webp" alt="Add contact on a phone, as a bottom sheet" width="260"></p>

On a phone, Add to contacts is under **More** and opens as a sheet.

## Any task app or CRM

Both use the same adapter shape in `CONFIG.tasks` and `CONFIG.contacts`: a connector, a tool, and its arguments with `{{placeholders}}`. That covers Notion, Asana, Basecamp, Linear, Todoist, HubSpot and anything else with a create tool. The setup skill reads the connector's own schema and writes the exact field names. Contacts can add a `dupCheck` search for the duplicate warning. Google Contacts has a short form, `contacts: { book: "google" }`, and enrichment apps other than Clay go in `CONFIG.enrich` ([configuration.md](configuration.md#contacts-and-enrichment)).

- Placeholders and examples: [connectors.md](connectors.md#any-task-manager) and [connectors.md](connectors.md#any-contacts-app-or-crm)
- Running them through one connector: [composio.md](composio.md)

## What it touches

- **Tasks call:** your task app's create tool (`CONFIG.tasks`), plus Gmail `get_thread` when you drag a thread that isn't open.
- **Contacts call:** Gmail `search_threads` and `get_thread` to read their emails and find your first thread; the AI to read the signature and write how you met; your address book's search (duplicate check, Cc suggestions) and create tool; your enrichment app only when you press Enrich.
- **Writes:** one task or one contact, only when you file or save.
- **Read-only mode** greys out Task and Contact and blocks filing and saving. Contact still opens: reading their emails, filling the form and Copy as vCard still work, and a note at the top says saving is off.
- **Turn them off:** Settings → Skills → **Tasks** or **Add to contacts**.

## Related

- [Route and next steps](route-and-next-steps.md): tasks and contacts as suggested actions
- [The context panel](context-panel.md)
- [Settings and shortcuts](settings-and-shortcuts.md): `t`, `c` and the command palette
- [Phone](phone.md)
- [Connectors](connectors.md) · [Composio](composio.md) · [Configuration](configuration.md)
- [Safety and privacy](safety-and-privacy.md) · [Troubleshooting](troubleshooting.md) · [Features](features.md)
