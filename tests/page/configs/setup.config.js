  const CONFIG = {
    ownerName: "Alex Rivera",
    ownEmail: "alex@riveralabs.example",
    gmail: {
      via: "chatterbuilt",
      server: "Chatterbuilt Mail",
      accounts: [
        { id: "gmail_work", email: "alex@riveralabs.example", label: "Rivera Labs", color: "blue", kind: "gmail", capabilities: { filters: true, sendAs: true, labels: "labels" } },
        { id: "imap_ada", email: "ada@mailbox.example", label: "Ada IMAP", color: "teal", kind: "imap", provider: "iCloud", capabilities: { filters: false, sendAs: true, labels: "folders" } }
      ]
    },
    about: "Alex runs partnerships at Rivera Labs and hosts a monthly AI meetup.",
    voice: "Warm, brief, a little dry. Short paragraphs.",
    rules: "US spelling. No exclamation points.",
    signoff: "Alex",
    defaultModel: "claude",
    models: [],
    notion: null,
    copyTargets: [],
    searchExample: "from:dana newer_than:7d",
    tasks: null,
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
    context: [],
    actions: [],
    lookup: [],
    snippets: [],
    labelPrefix: "CB",
    repoUrl: "https://github.com/mrhinkle/chatterbuilt-mail",
    supportUrl: "https://github.com/mrhinkle/chatterbuilt-mail/issues"
  };
