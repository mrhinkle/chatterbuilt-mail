  const CONFIG = {
    ownerName: "Alex",
    ownEmail: "alex@example.com",
    about: "Alex Rivera runs partnerships at Example Co. and hosts a monthly community meetup.",
    voice: "Warm, brief, a little dry. Short paragraphs. Gets to the point in the first line.",
    rules: "US spelling. Never use the word 'synergy'. No exclamation points.",
    signoff: "Alex",
    defaultModel: "claude",
    models: [],               // e.g. [{ value: "provider/model-slug", label: "Name" }] via OpenRouter; the setup skill looks up real slugs
    notion: null,             // older Notion-only task shortcut; use tasks below instead
    copyTargets: [{ label: "personal", address: "alex.rivera@gmail.com" }],
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
    clay: false,

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
    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
