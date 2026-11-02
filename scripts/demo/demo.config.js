  const CONFIG = {
    ownerName: "Alex Rivera",
    ownEmail: "alex@riveralabs.example",
    about: "Alex runs partnerships at Rivera Labs and hosts a monthly AI meetup.",
    voice: "Warm, brief, a little dry. Short paragraphs.",
    rules: "US spelling. No exclamation points.",
    signoff: "Alex",
    defaultModel: "claude",
    models: [],
    notion: null,
    copyTargets: [],
    searchExample: "from:dana newer_than:7d",
    tasks: { label: "Asana", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "ASANA_CREATE_A_TASK", arguments: { data: { name: "{{title}}", notes: "{{text}}" } } }], sync_response_to_workbench: false } },
    contacts: null,
    clay: false,
    calendar: true,
    workHours: [9, 17],
    waitingDays: 3,
    readOnly: false,
    voiceSource: "",
    lessons: "",
    mailRules: [],
    features: {},
    context: [
      { label: "Meetings", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "MEETINGS", arguments: { email: "{{email}}" } }] } },
      { label: "Calendar", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "CALENDAR", arguments: { q: "{{who}}" } }] } },
      { label: "Notes", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "NOTES", arguments: { q: "{{who}}" } }] } },
      { label: "Pipeline", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "PIPELINE", arguments: { q: "{{orgOrEmail}}" } }] } },
      { label: "Memory", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "MEMORY", arguments: { q: "{{who}}" } }] } }
    ],
    actions: [
      { key: "handoff", label: "Hand off to Sam in Slack", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "U0DEMO", markdown_text: "{{handoff}}\n\n{{url}}" } }] }, ai: { handoff: "A short Slack message asking Sam to handle this" }, when: "Scheduling or logistics" }
    ],
    lookup: [
      { label: "Web: person", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{personQuery}}", limit: 5 } }] } },
      { label: "Web: company", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", needs: ["companyQuery"], input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{companyQuery}}", limit: 5 } }] } }
    ],
    snippets: [{ name: "Meetup basics", text: "Hi {{firstName}}, the meetup is the first Thursday of each month at 6pm." }],
    labelPrefix: "CB",
    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
