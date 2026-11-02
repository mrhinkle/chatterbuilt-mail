# Connect everything through Composio

Chatterbuilt Mail reaches your apps through claude.ai connectors. You can add a native connector for each app (Notion, Slack, Asana, Fireflies…), or add **one** connector, [Composio](https://composio.dev), and reach hundreds of apps through it.

**Suggested if you don't want to manage a stack of native connectors.** You connect each app once inside Composio, and Chatterbuilt Mail sees all of them through a single claude.ai connector.

## What stays native

| Part | Connector | Why |
|---|---|---|
| Your mailbox | **Gmail** (native claude.ai connector) | The page is built around its tools: search, threads, drafts, labels, send. |
| Drafting, triage, checks | **Claude** (built in) | No connector needed. |
| Everything else | **Composio**, or native connectors, or a mix | Context sources, tasks, contacts, Route actions, More context. |

## Native connectors or Composio?

| | Native connectors | Composio |
|---|---|---|
| Setup | One claude.ai connector per app | One claude.ai connector, then connect apps inside Composio |
| Apps | Those with a claude.ai connector | Hundreds, including web search (Firecrawl, Exa, Tavily, Perplexity) |
| Permissions the page holds | Exactly the tools it uses, app by app | One tool, `COMPOSIO_MULTI_EXECUTE_TOOL`, which can run any action on any app you've connected in Composio |
| Errors | Each connector's own | Composio reports failures inside a successful response; the page unwraps them and shows the real message ("No active connection for toolkit=asana") |
| Cost | Your apps' own plans | Composio's plan, plus any per-call cost of the apps it calls (web search credits, for example) |

The one real tradeoff is the permission. With native connectors, the page can only call the tools you declared. With Composio, the page only *calls* the actions in your CONFIG, but the permission it holds is wider. The artifact is private to you, and read-only mode still blocks every change the page makes, but if that breadth bothers you, use native connectors for anything that writes and Composio for lookups.

## How it looks in CONFIG

Every connector setting in Chatterbuilt Mail is the same shape: `{ server, tool, input }`. Through Composio, `server` is `"Composio"`, `tool` is `"COMPOSIO_MULTI_EXECUTE_TOOL"`, and `input` names the Composio action and its arguments. Placeholders work the same way.

These action names and arguments were read from Composio in November 2026. The setup skill looks them up again for your account, since they change.

**A context source** (read-only):

```js
context: [
  { label: "Notion", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
    input: { tools: [{ tool_slug: "NOTION_SEARCH_NOTION_PAGE", arguments: { query: "{{orgOrEmail}}", page_size: 5 } }], sync_response_to_workbench: false } }
]
```

**Tasks in Asana:**

```js
tasks: { label: "Asana", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
  input: { tools: [{ tool_slug: "ASANA_CREATE_A_TASK", arguments: { data: { name: "{{title}}", notes: "{{text}}", projects: ["<project id>"] } } }], sync_response_to_workbench: false } }
```

**A Route action** (a Slack handoff):

```js
actions: [
  { key: "handoff", label: "Hand off to Sam in Slack", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
    input: { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "<user or channel id>", markdown_text: "{{handoff}}\n\n{{url}}" } }], sync_response_to_workbench: false },
    ai: { handoff: "A short Slack message asking Sam to handle this email" },
    when: "Scheduling, invoices or logistics" }
]
```

Note: Composio's `SLACK_SEND_MESSAGE` **sends** the message; it doesn't leave a draft the way the native Slack connector's draft tool does. You still approve it in Route first.

**More context** (web lookups):

```js
lookup: [
  { label: "Web: person", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
    input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{personQuery}}", limit: 5 } }], sync_response_to_workbench: false } },
  { label: "Web: company", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", needs: ["companyQuery"],
    input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{companyQuery}}", limit: 5 } }], sync_response_to_workbench: false } }
]
```

A Firecrawl search returning 3 results used 2 Firecrawl credits when tested.

## Set it up

1. In claude.ai, add the **Gmail** connector and the **Composio** connector (Settings, Connectors).
2. In Composio, connect the apps you want: your task app, notes, CRM, Slack, a web search tool.
3. Ask Claude to set up Chatterbuilt Mail and say you'd like to use Composio (the [starter prompt](install.md#claude) has a line for it). The setup skill:
   - finds each action with Composio's tool search and reads its exact arguments;
   - checks that each app has an active connection in Composio, and tells you which to connect if not;
   - writes CONFIG and declares `COMPOSIO_MULTI_EXECUTE_TOOL` in the page's permissions;
   - makes one read-only call per context source to check the results, and never runs a write as a test.

The first time the page calls Composio, claude.ai asks you to allow it.

## What the page does with Composio's replies

Composio wraps each action's result: `{ successful, data: { results: [{ response: { successful, data, error } }] } }`. The page:
- hands the inner `data` to the rest of the app, so an empty search shows as a grey "nothing found" chip and isn't sent to the model;
- turns a failed inner call into an error you see ("Composio reported an error: No active connection for toolkit=asana"), so a task is never reported as filed when it wasn't.

## Troubleshooting

| What you see | What to do |
|---|---|
| "No active connection for toolkit=…" | Connect that app inside Composio, then try again. |
| "This page isn't allowed to use COMPOSIO_MULTI_EXECUTE_TOOL" | Allow it in the artifact's Permissions menu, or ask Claude to republish with it declared. |
| A Composio source is always grey | It's returning nothing. Check the action and its arguments with Claude; Notion search, for example, matches titles, not page text. |
