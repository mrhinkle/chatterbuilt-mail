  const CONFIG = {
    ownerName: "Mark",
    ownEmail: "mrhinkle@peripety.com",
    about: "Mark Hinkle is CEO of Peripety Labs, publisher of The AIE Network newsletters (250,000+ readers) and co-founder of the All Things AI conference in Durham, NC.",
    voice: "First person, conversational, direct, a little wry. Casual but purposeful.",
    rules: "Never use the words delve, realm, unleash, tapestry, paradigm, landscape, cornerstone, game-changer, revolutionary, or 'unlock potential'. Never open with 'Excited to' or 'Thrilled to'. 'Open source' is always two words, never hyphenated.",
    signoff: "Mark",
    defaultModel: "claude",
    models: [{ value: "z-ai/glm-5.3", label: "GLM 5.3" }],
    notion: null,
    copyTargets: [{ label: "theaie.net", address: "mrhinkle@theaie.net" }, { label: "allthingsai.org", address: "mrhinkle@allthingsai.org" }],
    searchExample: "from:todd newer_than:7d",
    tasks: {
      label: "Notion", server: "Notion", tool: "notion-create-pages",
      input: {
        parent: { type: "data_source_id", data_source_id: "00000000-0000-4000-8000-000000000001" },
        pages: [{ properties: { "Task": "{{title}}", "Inbox": "__YES__", "Done": "__NO__", "Kanban - State": "To Do", "Priority": "🧀 Medium", "Email": "{{fromEmail}}", "userDefined:URL": "{{url}}", "Notes": "{{notes}}" }, content: "{{body}}" }],
        allow_async: false
      }
    },
    contacts: { dataSourceId: "00000000-0000-4000-8000-000000000002", nameProp: "Name", emailProp: "Email", companyProp: "Company", titleProp: "Title", phoneProp: "Phone", linkedinProp: "LinkedIn", xProp: "X", blueskyProp: "Bluesky", githubProp: "GitHub", instagramProp: "Instagram", websiteProp: "Website", locationProp: "Location", metProp: "How we met", firstContactProp: "First contact", notesProp: "Notes", backgroundProp: "Background", extra: { "Source": "Chatterbuilt Mail" } },
    clay: true,
    calendar: true,
    workHours: [9, 17],
    waitingDays: 3,
    readOnly: false,
    voiceSource: "https://app.notion.com/p/00000000000040008000000000000004",
    lessons: "",
    mailRules: [],
    features: {},
    context: [
      { label: "Fireflies", server: "Fireflies", tool: "fireflies_get_transcripts", input: { participants: ["{{email}}"], limit: 3, format: "json" } },
      { label: "Calendar", server: "Google Calendar", tool: "search_events", input: { query: "{{who}}", pageSize: 5 } },
      { label: "Notion", server: "Notion", tool: "notion-search", input: { query: "{{who}}", page_size: 5, max_highlight_length: 160 } },
      { label: "Sponsor pipeline", server: "Notion", tool: "notion-search", input: { query: "{{orgOrEmail}}", data_source_url: "collection://00000000-0000-4000-8000-000000000003", page_size: 3, max_highlight_length: 200 } },
      { label: "Contacts", server: "Notion", tool: "notion-search", input: { query: "{{email}}", data_source_url: "collection://00000000-0000-4000-8000-000000000002", page_size: 2, max_highlight_length: 200 } },
      { label: "Cortex", server: "Cortex", tool: "cortex_who_is", input: { name: "{{who}}" } },
      { label: "AI Enterprise subscriber", server: "Beehiiv", tool: "list_subscriptions", input: { publication_id: "pub_00000000-0000-4000-8000-000000000005", email: "{{email}}", per_page: 1 } },
      { label: "AI Tangle subscriber", server: "Beehiiv", tool: "list_subscriptions", input: { publication_id: "pub_00000000-0000-4000-8000-000000000006", email: "{{email}}", per_page: 1 } }
    ],
    actions: [
      { key: "christine", label: "Hand off to Christine (Slack draft)", server: "Slack", tool: "slack_send_message_draft", input: { channel_id: "U0000000001", message: "{{handoff}}\n\n{{url}}" }, ai: { handoff: "A short, friendly Slack message to Christine asking her to handle this email: what is needed, by when, and any detail she needs. No link; it is added." }, when: "Admin, scheduling, invoices, logistics, newsletter swaps, or anything Christine can take on" }
    ],
    snippets: [
      { name: "All Things AI 2027 basics", text: "All Things AI 2027 is April 18 through 20, 2027 at the Atlantic Union Bank Convention Center in Raleigh. April 18 is the Agent Hackathon and workshop day, April 19 and 20 are the main conference, and the invite-only Executive Summit follows on April 21." },
      { name: "CFP is open", text: "Our call for proposals for All Things AI 2027 is open until January 1, 2027: https://events.allthingsai.org/events/all-things-ai-2027/cfp" },
      { name: "Loop in Christine", text: "I'm copying Christine, who can find a time that works for both of us." }
    ],
    lookup: [
      { label: "Web: person", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{personQuery}}", limit: 5 } }], sync_response_to_workbench: false, current_step: "MORE_CONTEXT", thought: "Chatterbuilt Mail More context: public web lookup on a person" } },
      { label: "Web: company", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", needs: ["companyQuery"], input: { tools: [{ tool_slug: "FIRECRAWL_SEARCH", arguments: { q: "{{companyQuery}}", limit: 5 } }], sync_response_to_workbench: false, current_step: "MORE_CONTEXT", thought: "Chatterbuilt Mail More context: public web lookup on a company" } }
    ],
    labelPrefix: "CB",
    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
