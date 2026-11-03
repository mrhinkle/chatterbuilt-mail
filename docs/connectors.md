# Connectors and permissions

Chatterbuilt Mail works with the connectors you already have: claude.ai's native connectors, MCP servers that come with your Claude plugins, and [Composio](composio.md) if you use it. When you set it up, Claude looks at what you've connected, sorts it by feature, and asks which to turn on. Gmail is the only one you need.

The page reaches your apps only through those connectors, using your own sign-in. When Claude publishes the page, it declares exactly which connector tools the page may call. The first time each one is used, claude.ai asks you to allow it, and you can review or revoke that in the artifact's Permissions menu.

## What each connector is for

| Connector | Needed for | Tools the page declares |
|---|---|---|
| Gmail | Everything | `search_threads`, `get_thread`, `get_message`, `create_draft`, `reply`, `send_message`, `label_thread`, `unlabel_thread`, `list_labels`, `create_label`, `forward`, `list_drafts`, `delete_draft` |
| Claude (built in) | Summaries, triage, drafts, checks, Ask, context, Route, learning | declared as the `sample` capability, no connector |
| Google Calendar | Open times in replies; meetings with this person (context) | `list_events`; `search_events` for context |
| Notion | Notion tasks or contacts, voice page pointer, duplicate check, notes and pipeline lookups (context) | `notion-create-pages`, `notion-fetch`, `notion-search` (only the ones you use) |
| Clay | Enrich with Clay | `search-contacts-by-name`, `add-contact-data-points`, `get-task-context` |
| Another enrichment app | Enrich with Apollo, People Data Labs, ZoomInfo, Lusha… (`CONFIG.enrich`) | its person-lookup tool |
| Composio | Google Contacts (`contacts: { book: "google" }`), or Gmail and other apps through Composio | `COMPOSIO_MULTI_EXECUTE_TOOL` |
| Slack | **Message someone in Slack** in Route (`slack: true`), or a custom handoff | `slack_search_users`, `slack_search_channels`, `slack_send_message_draft` |
| OpenRouter | Models other than Claude | `send-message` |
| Your task app or CRM | Tasks or contacts outside Notion | that app's create tool (see below) |
| Any read tool | Context sources | each source's tool (see [Context sources](#context-sources)) |
| Any write tool | Route actions | each action's tool (see [Route actions](#route-actions)) |
| A web search tool | More context | each lookup's tool (see [More context](#more-context-web-lookups)) |

Declare only what your copy uses. The setup skill builds this list from your `CONFIG`.

## Apps that work, by feature

Any connector with the right kind of tool works: the setup skill reads its tool schema and wires the exact arguments. These are some of the native connectors in the claude.ai connector directory (as listed on November 2, 2026) for each feature. Add one in claude.ai Settings, Connectors, then ask Claude to turn the feature on.

| Feature | What it needs | Native connectors that fit |
|---|---|---|
| Open times in replies | a calendar | Google Calendar, Microsoft 365 (Outlook calendar) |
| Context: meetings with this person | meeting notes or transcripts | Fireflies, Granola, Fathom, tl;dv, Circleback, Zoom, Webex |
| Context: notes, pipeline, memory | search over notes or records | Notion, Evernote, Roam Research, Google Drive, your CRM |
| Tasks | a create-task tool | Asana, Todoist, ClickUp, monday.com, TickTick, MeisterTask, Notion |
| Contacts | a create-contact or create-record tool | Google Contacts (through Composio; the default for Gmail), HubSpot, Attio, Salesflare, Zoho CRM, Bigin, Nutshell, Notion |
| Enrich a contact | person or company lookup | Clay, Apollo.io, Lusha, ZoomInfo, Crustdata; People Data Labs through Composio |
| Route: hand a thread off | a send or draft-message tool | Slack (built in as **Message someone in Slack**), RingCentral |
| More context (web lookups) | web search that returns links | Exa, Parallel Search, AWS Web Search |
| Other models | an LLM gateway | OpenRouter |

**MCP servers from your plugins.** If a Claude plugin you use bundles an MCP server, the page can use it the same way. Remote servers show up as connectors. A local server (one that runs on your computer) only answers when the page is open in the Claude desktop app with that plugin running.

**If you use Composio.** Composio is optional. If it's already connected in your claude.ai, setup offers it too: context sources, tasks, contacts, Route actions and More context all accept `server: "Composio"` with the `COMPOSIO_MULTI_EXECUTE_TOOL` tool, and it can run several Gmail accounts in one copy ([composio.md](composio.md)). The page unwraps Composio's replies and shows its errors.

## Tested connectors

These were checked live, read-only, against a real account while building the hub features (November 2026). The shapes the page relies on came from those calls.

| Connector | Used for | Notes |
|---|---|---|
| Gmail | everything | The summary view of `search_threads` has no date, labels or snippet; the page fills those in from `get_thread`. `list_drafts` (full view) returns each draft's `threadId`. |
| Google Calendar | context, open times | `search_events` with a name or email address finds meetings with that person. |
| Fireflies | context | `fireflies_get_transcripts` with `participants: ["{{email}}"]` returns that person's meetings, with action items. |
| Notion | context, tasks, contacts | Search by the bare company name (`acme`), not the domain (`acme.com`). Domain searches return noise. |
| Cortex (memory) | context | `cortex_who_is` returns `No entity…` for unknown people, which the page treats as empty. |
| Beehiiv | context | `list_subscriptions` filtered by email shows whether they read your newsletter. |
| Slack | Route | `slack_send_message_draft` puts a draft in your Slack, so a handoff still needs your send in Slack. |

Write tools (send, labels, tasks, contacts, Slack drafts) and Clay were never called as a test, by design. Your first real use is the test.

## Context sources

`CONFIG.context` is a list of read-only lookups the page runs, all at once, when you open a thread. Each entry is one connector tool:

```js
context: [
  { label: "Meetings", server: "Fireflies", tool: "fireflies_get_transcripts",
    input: { participants: ["{{email}}"], limit: 3, format: "json" } },
  { label: "Calendar", server: "Google Calendar", tool: "search_events",
    input: { query: "{{who}}", pageSize: 5 } },
  { label: "Pipeline", server: "Notion", tool: "notion-search",
    input: { query: "{{orgOrEmail}}", data_source_url: "collection://YOUR-PIPELINE-ID", page_size: 3 } },
  { label: "Memory", server: "Cortex", tool: "cortex_who_is", input: { name: "{{who}}" } }
]
```

These are the argument names those connectors took in November 2026. Connectors change, so the setup skill reads each one's schema and writes the exact names for your copy.

**Placeholders for context:**

| Placeholder | What it fills in |
|---|---|
| `{{email}}` | The other person's address (the sender, or who you wrote to if you had the last word) |
| `{{name}}` | Their name, if the address has one |
| `{{who}}` | Name if known, otherwise email |
| `{{domain}}` | Their email domain |
| `{{org}}` | The company part of the domain (`acme` from `jo@mail.acme.example`); empty for Gmail, Outlook and other free mail |
| `{{orgOrEmail}}` | `{{org}}`, or the email when there's no company |
| `{{subject}}` | Thread subject without Re:/Fwd: |
| `{{today}}` | Today, YYYY-MM-DD |
| `{{since90}}` | 90 days ago, YYYY-MM-DD |

**How results are used:**
- Each source has 15 seconds. A slow or failing one shows as a red chip and the rest carry on.
- Empty results show as grey chips and aren't sent to the AI. Empty means `[]`, `{}`, "No results", "No entity", or an object whose lists are all empty, like `{ "transcripts": [], "total": 0 }`.
- The rest are trimmed (long text cut, calendar links, meeting URLs, HTML bodies and similar dropped) and sent to the AI, which writes the card. It's told to ignore matches that aren't about this person, their company or the thread, never to merge a lookalike match into this person, and to say what's missing when the reply needs something no source has. More in [context-panel.md](context-panel.md).
- Results are cached for five minutes. **Refresh** on the card runs them again.

**Rules for context sources:**
- **Read-only tools only.** Never put a create, update, send or delete tool here. Context runs on every thread you open.
- Prefer filters that are exact (an email address, a participant list) over free-text search.
- Six to eight sources is plenty. Each adds a call per thread.

## More context (web lookups)

`CONFIG.lookup` lists the search calls **More context** makes. Any connector that searches the public web and returns results with a URL and a title or snippet works: Exa, Perplexity, Tavily, Firecrawl, SerpApi, or a Composio or Zapier action that wraps one. The page finds the results in whatever shape comes back, keeps up to ten, and asks the model for a short cited briefing.

```js
lookup: [
  { label: "Web: person", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
    input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{personQuery}}", limit: 5 } }], sync_response_to_workbench: false } },
  { label: "Web: company", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", needs: ["companyQuery"],
    input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{companyQuery}}", limit: 5 } }], sync_response_to_workbench: false } }
]
```

| Placeholder | What it fills in |
|---|---|
| `{{personQuery}}` | The name in quotes plus the company (`"Dana Ruiz" acme`), or the email address when there's no name |
| `{{companyQuery}}` | Company and domain plus "company news" (`acme acme.io company news`); empty for Gmail, Outlook and other free mail |
| `{{name}}`, `{{org}}`, `{{domain}}`, `{{email}}` | As for context sources |

**Things to know:**
- **Cost.** Each press runs each entry once. Search providers charge per search or per result; Firecrawl used 2 credits for a 3-result search when tested. Results are cached for an hour. Each lookup gets 45 seconds (context sources get 15).
- **Privacy.** The person's name, company and domain go to the search provider. Nothing from the email itself does.
- **Composio.** Declaring `COMPOSIO_MULTI_EXECUTE_TOOL` lets the page call any action your Composio account can run, though it only calls the search you configure. A connector that only searches (Exa, Perplexity or Tavily's own) keeps the page's permissions narrower.
- The results are untrusted text from the web. The prompt tells the model to treat them as data, and they only reach a draft when you switch on **Web context**.

## Route actions

Route always offers a task (when tasks are set up), a contact, snooze and remind-me. `CONFIG.actions` adds any other connector tool:

```js
actions: [
  { key: "handoff", label: "Hand off to my assistant in Slack",
    server: "Slack", tool: "slack_send_message_draft",
    input: { channel_id: "U0123456789", message: "{{handoff}}\n\n{{url}}" },
    ai: { handoff: "Two or three sentences telling my assistant what to do with this email, with names and dates" },
    when: "Scheduling, logistics, invoices or anything my assistant usually handles" }
]
```

| Field | What it is |
|---|---|
| `key` | A short unique name |
| `label` | What Route shows |
| `server`, `tool`, `input` | The connector call, as for tasks |
| `ai` | Fields the AI writes, with a line on what each should say. They become placeholders in `input` (`{{handoff}}` above), and you can edit them before applying. |
| `when` | When the action fits. The AI only suggests it when this matches. |

`input` can use every [context placeholder](#context-sources), every `ai` field, and `{{url}}` (link to the thread in Gmail), `{{from}}`, `{{fromEmail}}`.

Route sees the raw context records as well as the card, so an action can use an ID from a lookup (a pipeline row, a CRM contact) when the AI is told to fill it in an `ai` field.

Prefer tools that leave a draft or a note for you to finish over ones that act on other people directly. A Slack draft, a CRM note or a task is safe to apply in one click. A sent Slack message isn't something Undo can take back.

## Any task manager

Tasks aren't tied to Notion. `CONFIG.tasks` names one connector tool and gives its arguments as a template. When you file a task, the page fills in the placeholders and calls that tool.

```js
tasks: {
  label: "Notion",                 // shown in the toast: "Task created in Notion"
  server: "Notion",                // the connector's display name in claude.ai
  tool: "notion-create-pages",     // the connector's create tool
  input: {                         // the tool's arguments, with placeholders
    parent: { type: "data_source_id", data_source_id: "YOUR-DATA-SOURCE-ID" },
    pages: [{ properties: { "Task": "{{title}}", "Email": "{{fromEmail}}", "userDefined:URL": "{{url}}", "Notes": "{{notes}}" }, content: "{{body}}" }],
    allow_async: false
  }
}
```

**Placeholders for tasks:**

| Placeholder | What it fills in |
|---|---|
| `{{title}}` | Subject without Re:/Fwd: |
| `{{subject}}` | Raw subject |
| `{{from}}` | Sender as written |
| `{{fromName}}` | Sender name |
| `{{fromEmail}}` | Sender address |
| `{{date}}` | Local date and time |
| `{{dateISO}}` | Date as YYYY-MM-DD |
| `{{today}}` | Today as YYYY-MM-DD |
| `{{url}}` | Link to the message in Gmail |
| `{{excerpt}}` | Up to 1,500 characters of the message |
| `{{notes}}` | One line: "Email from … · date" |
| `{{body}}` | Markdown: header, quoted message, Gmail link |
| `{{text}}` | Plain-text version of `body` |

**How placeholders are filled:**
- A value that is only a placeholder, like `"{{url}}"`, is left out of the call when it's empty. That way an empty URL never breaks a required format.
- Text with placeholders inside it, like `"From {{fromName}}"`, is filled as a string.

**To use Asana, Basecamp, Linear, Todoist or anything else:**
1. Add that app's connector in claude.ai.
2. Tell Claude: *"Run chatterbuilt-mail-setup and file my tasks in Asana, in the Inbox project."*

The skill then:
- reads the connector's create tool and its exact argument names;
- looks up IDs such as workspace or project;
- writes `CONFIG.tasks`;
- adds that tool to the page's permissions;
- republishes.

It never creates a test task. Your first real one is the test.

Each app's tool names and arguments differ, so the skill reads them from the connector rather than guessing. As an illustration only, an Asana-style task looks like this. The tool and field names here are placeholders, not real ones.

```js
tasks: { label: "Asana", server: "Asana", tool: "<the connector's create-task tool>",
  input: { name: "{{title}}", notes: "{{text}}", projects: ["<project id>"] } }
```

**Notion tip.** If your task list is a filtered view, set every property that view filters on in `input`. For example, an Inbox view that only shows rows with Inbox ticked, a Priority, and a status of To Do. Otherwise tasks are saved but won't show up there.

## Any contacts app or CRM

`CONFIG.contacts` works the same way, with an optional duplicate check.

**Placeholders for contacts:**

| Placeholder | What it fills in |
|---|---|
| `{{name}}` | Name |
| `{{email}}` | Email address |
| `{{company}}` | Company |
| `{{title}}` | Job title |
| `{{phone}}` | Phone |
| `{{location}}` | Location |
| `{{website}}` | Website |
| `{{linkedin}}` | LinkedIn profile URL |
| `{{x}}` | X profile URL |
| `{{bluesky}}` | Bluesky profile URL |
| `{{github}}` | GitHub profile URL |
| `{{instagram}}` | Instagram profile URL |
| `{{met}}` | The how-we-met note |
| `{{firstContact}}` | Date of your first email together, YYYY-MM-DD |
| `{{background}}` | Work-history summary, from your enrichment app |
| `{{notes}}` | Your notes |
| `{{source}}` | `"Chatterbuilt Mail"` |
| `{{content}}` | Markdown with links to the first thread and the current thread |

```js
contacts: {
  label: "HubSpot", server: "HubSpot", tool: "<the connector's create-contact tool>",
  input: { /* that tool's fields, using the placeholders above */ },
  dupCheck: { server: "HubSpot", tool: "<a search tool>", input: { query: "{{email}}" } }   // optional
}
```

The duplicate check passes if the person's email appears anywhere in the search result. If it does, the page warns you before you save a second entry.

For Notion there's a shorter form that maps column names. The page builds the call and the duplicate check itself:

```js
contacts: { dataSourceId: "…", nameProp: "Name", emailProp: "Email", companyProp: "Company", titleProp: "Title",
  phoneProp: "Phone", linkedinProp: "LinkedIn", xProp: "X", blueskyProp: "Bluesky", githubProp: "GitHub",
  instagramProp: "Instagram", websiteProp: "Website", locationProp: "Location", metProp: "How we met",
  firstContactProp: "First contact", notesProp: "Notes", backgroundProp: "Background", extra: { "Source": "Chatterbuilt Mail" } }
```

The setup skill can create a Contacts database with those columns for you, or add the ones your database is missing (only after you say yes).

**Google Contacts** has its own short form, `contacts: { book: "google" }`. It goes through Composio's Google Contacts toolkit (`GOOGLECONTACTS_SEARCH_CONTACTS` for the duplicate check and Cc suggestions, `GOOGLECONTACTS_CREATE_CONTACT` to save). Fields Google doesn't have become custom fields: How we met, Background and "Added by". First contact is a dated event, Notes go in the Notes field, and profiles are labeled links. With several Gmail accounts through Composio, `accounts[i].contacts` names each account's own Google Contacts connection. When Gmail goes through Composio and `contacts` isn't set, this is the default. Composio has no ready-made sign-in for Google Contacts (as of November 2, 2026): connect it by adding your own Google OAuth client for Google Contacts in Composio's dashboard.

**Enrichment apps other than Clay** use `CONFIG.enrich`, the same adapter shape with `{{email}}`, `{{name}}`, `{{domain}}`, `{{company}}` and `{{linkedin}}`:

```js
enrich: { label: "Apollo", server: "Apollo.io", tool: "<its person-enrichment tool>", input: { email: "{{email}}" } }
```

Whatever comes back, the AI maps it to title, company, location, profiles and Background, and fills only fields that are still empty.

## Models

- Claude is the default and needs nothing extra. The page calls it without naming a model or tier, so Claude's interface picks the model; it never asks for a bigger one by name.
- To add others, connect OpenRouter. The setup skill looks up the exact model slugs with OpenRouter's `list-models` and adds them to `CONFIG.models`.
- A model picker appears in **Settings** when there's more than one model. Add other models only if you want them; most people don't need any.
