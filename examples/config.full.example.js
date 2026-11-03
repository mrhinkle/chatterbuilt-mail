  const CONFIG = {
    ownerName: "Alex",
    ownEmail: "alex@example.com",
    gmail: null,              // or Gmail through Composio with several accounts: { via: "composio", accounts: [{ id: "gmail_xxx", email: "you@work.example", label: "Work" }] }
    about: "Alex Rivera runs partnerships at Example Co. and hosts a monthly community meetup.",
    voice: "Warm, brief, a little dry. Short paragraphs. Gets to the point in the first line.",
    rules: "US spelling. Never use the word 'synergy'. No exclamation points.",
    signoff: "Alex",
    defaultModel: "claude",
    models: [],               // e.g. [{ value: "provider/model-slug", label: "Name" }] via OpenRouter; the setup skill looks up real slugs
    notion: null,             // older Notion-only task shortcut; use tasks below instead
    copyTargets: [{ label: "personal", address: "alex.rivera@mail.example" }],
    searchExample: "from:jordan newer_than:7d",

    // Tasks: any connector's create tool. This one is Notion. The setup skill writes these from your app's own schema.
    tasks: {
      label: "Notion", server: "Notion", tool: "notion-create-pages",
      input: {
        parent: { type: "data_source_id", data_source_id: "00000000-0000-0000-0000-000000000000" },
        pages: [{ properties: { "Name": "{{title}}", "Status": "To Do", "Email": "{{fromEmail}}", "userDefined:URL": "{{url}}" }, content: "{{body}}" }],
        allow_async: false
      }
    },

    // Contacts: Notion short form. For HubSpot or another CRM, use { label, server, tool, input, dupCheck } (see docs/connectors.md).
    contacts: { dataSourceId: "00000000-0000-0000-0000-000000000000", nameProp: "Name", emailProp: "Email", companyProp: "Company", titleProp: "Title", phoneProp: "Phone", linkedinProp: "LinkedIn", xProp: "X", blueskyProp: "Bluesky", githubProp: "GitHub", instagramProp: "Instagram", websiteProp: "Website", locationProp: "Location", metProp: "How we met", firstContactProp: "First contact", notesProp: "Notes", backgroundProp: "Background", extra: { "Source": "Chatterbuilt Mail" } },
    // Or Google Contacts, through Composio: contacts: { book: "google" }. How we met and Background become custom fields.
    clay: false,
    // Another enrichment app instead of Clay, e.g. Apollo through Composio (the setup skill reads the real tool schema):
    enrich: null,             // { label: "Apollo", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [{ tool_slug: "APOLLO_PEOPLE_ENRICHMENT", arguments: { email: "{{email}}" } }], sync_response_to_workbench: false } }
    slack: true,              // Route offers "Message someone in Slack": a draft in Slack, never sent

    calendar: true,
    workHours: [9, 17],
    waitingDays: 3,
    readOnly: false,
    voiceSource: "",          // a Notion page link that holds your voice prompt
    lessons: "",              // written by the chatterbuilt-mail-improve skill
    mailRules: [
      { text: "Receipts, invoices and payment confirmations", op: "move", labelName: "Finance" },
      { text: "Email from the meetup platform", from: "meetup.com", op: "archive" }
    ],
    features: {},             // e.g. { sweep: false }

    // Context: read-only lookups on the person you're emailing. The setup skill writes the exact argument names from each connector's schema.
    context: [
      { label: "Meetings", server: "Fireflies", tool: "fireflies_get_transcripts", input: { participants: ["{{email}}"], limit: 3, format: "json" } },
      { label: "Calendar", server: "Google Calendar", tool: "search_events", input: { query: "{{who}}", pageSize: 5 } },
      { label: "Notes", server: "Notion", tool: "notion-search", input: { query: "{{who}}", page_size: 5, max_highlight_length: 160 } },
      { label: "Pipeline", server: "Notion", tool: "notion-search", input: { query: "{{orgOrEmail}}", data_source_url: "collection://00000000-0000-0000-0000-000000000000", page_size: 3, max_highlight_length: 200 } }
    ],

    // Route: extra places a thread can go. "ai" fields are written by the AI and editable before you apply.
    actions: [
      { key: "handoff", label: "Hand off to Sam (Slack draft)", server: "Slack", tool: "slack_send_message_draft",
        input: { channel_id: "U00000000", message: "{{handoff}}\n\n{{url}}" },
        ai: { handoff: "A short, friendly Slack message asking Sam to handle this email: what is needed, by when, and any detail Sam needs. No link; it is added." },
        when: "Scheduling, invoices, logistics, or anything Sam usually handles" }
    ],

    // More context: public web lookups, only when you press the button. Any search connector works; see docs/connectors.md.
    lookup: [],

    snippets: [
      { name: "Meetup basics", text: "Hi {{firstName}}, our meetup is the first Thursday of each month at 6pm. Details and RSVP are on our Meetup page." }
    ],
    labelPrefix: "CB",        // Gmail labels: CB/Snooze/2026-11-05, CB/Remind/2026-11-05, CB/Drafted

    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
