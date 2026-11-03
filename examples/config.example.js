  const CONFIG = {
    // A starter CONFIG: your inbox and Claude, nothing else. Every other feature waits until you ask for it
    // ("offer open times from my calendar", "file tasks in Asana"), so the page only asks to use what you've turned on.
    // examples/config.full.example.js shows every option filled in.
    ownerName: "Your Name",
    ownEmail: "you@example.com",
    gmail: null,              // claude.ai's Gmail connector. Several Gmail accounts through Composio: see docs/composio.md
    about: "",                // one or two sentences on who you are and what you do
    voice: "",                // how you write; the setup skill can learn it from your sent mail
    rules: "",
    signoff: "",
    defaultModel: "claude",
    models: [],
    notion: null,
    copyTargets: [],
    searchExample: "from:alex newer_than:7d",
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
