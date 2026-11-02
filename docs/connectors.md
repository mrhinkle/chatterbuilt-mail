# Connectors and permissions

The page reaches your apps only through your claude.ai connectors, using your own sign-in. When Claude publishes the page, it declares exactly which connector tools the page may call. The first time each one is used, claude.ai asks you to allow it, and you can review or revoke that in the artifact's Permissions menu.

## What each connector is for

| Connector | Needed for | Tools the page declares |
|---|---|---|
| Gmail | Everything | `search_threads`, `get_thread`, `get_message`, `create_draft`, `reply`, `send_message`, `label_thread`, `unlabel_thread`, `list_labels`, `create_label`, `forward` |
| Claude (built in) | Summaries, triage, drafts, checks, Ask, learning | declared as the `sample` capability, no connector |
| Google Calendar | Open times in replies | `list_events` |
| Notion | Notion tasks or contacts, voice page pointer, duplicate check | `notion-create-pages`, `notion-fetch`, `notion-search` (only the ones you use) |
| Clay | Enrich with Clay | `search-contacts-by-name`, `add-contact-data-points`, `get-task-context` |
| OpenRouter | Models other than Claude | `send-message` |
| Your task app or CRM | Tasks or contacts outside Notion | that app's create tool (see below) |

Declare only what your copy uses. The setup skill builds this list from your `CONFIG`.

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
| `{{background}}` | Work-history summary (Clay) |
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

The setup skill can create a Contacts database with those columns for you.

## Models

- Claude is the default and needs nothing extra.
- To add others, connect OpenRouter. The setup skill looks up the exact model slugs with OpenRouter's `list-models` and adds them to `CONFIG.models`.
- A model picker appears in the top bar when there's more than one model.
