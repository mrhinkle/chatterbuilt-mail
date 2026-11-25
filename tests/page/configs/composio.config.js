  const CONFIG = {
    ownerName: "Alex",
    ownEmail: "alex@example.com",
    about: "Alex runs partnerships at Example Co.",
    voice: "Warm, brief.",
    rules: "",
    signoff: "Alex",
    defaultModel: "claude",
    models: [],
    notion: null,
    copyTargets: [],
    searchExample: "from:jordan newer_than:7d",
    tasks: { label: "Asana", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
      input: { tools: [{ tool_slug: "ASANA_CREATE_A_TASK", arguments: { data: { name: "{{title}}", notes: "{{text}}", projects: ["1200000000000001"] } } }], sync_response_to_workbench: false } },
    contacts: null,
    clay: false,
    calendar: false,
    workHours: [9, 17],
    waitingDays: 3,
    readOnly: false,
    voiceSource: "",
    lessons: "",
    mailRules: [],
    features: {},
    context: [
      { label: "Notion", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "NOTION_SEARCH_NOTION_PAGE", arguments: { query: "{{who}}", page_size: 5 } }], sync_response_to_workbench: false } },
      { label: "Notion (company)", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "NOTION_SEARCH_NOTION_PAGE", arguments: { query: "{{orgOrEmail}}", page_size: 5 } }], sync_response_to_workbench: false } }
    ],
    actions: [
      { key: "handoff", label: "Hand off to Sam in Slack", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
        input: { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "U00000000", markdown_text: "{{handoff}}\n\n{{url}}" } }], sync_response_to_workbench: false },
        ai: { handoff: "A short Slack message asking Sam to handle this email" }, when: "Scheduling or logistics" }
    ],
    lookup: [
      { label: "Web: person", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{personQuery}}", limit: 5 } }], sync_response_to_workbench: false } }
    ],
    snippets: [],
    labelPrefix: "CB",
    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
