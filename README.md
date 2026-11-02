# Chatterbuilt Mail

An AI email client for Gmail that runs as your own private Claude artifact. It reads your inbox, drafts replies in your voice, checks every reply before it goes out, and tracks who owes you an answer. It files tasks and contacts wherever you keep them, and gets better the more you correct it.

Nothing is sent, moved or filed without a click from you. Every AI suggestion waits in a review queue, and a read-only mode blocks changes outright.

## What it does

| Area | Features |
|---|---|
| Read | Inbox with previews and unread dots, one-click summaries, triage into reply / read / skip, Ask your inbox (plain-English questions answered with numbered sources) |
| Reply | Drafts in your voice from one-click intents or your own instruction, three options per thread (best fit, shorter, polite no), pre-drafts for everything that needs a reply, per-recipient tone matching, open times from your calendar, **pre-send check** that rereads your reply against the thread before it goes |
| Follow up | Waiting-on-reply tracker for sent mail nobody answered, with a one-click Nudge |
| Organize | Move to folder, copy to another account, unsubscribe, bulk unsubscribe sweep, plain-English rules, rules suggested from what you do by hand, review queue with undo |
| Capture | Drag a thread to Tasks (Notion, Asana, Basecamp, Linear, Todoist or anything with a connector), add a person to Contacts with their signature details, social handles, Clay enrichment and a note on how you first met |
| Learn | Voice panel (paste a prompt, point to a Notion page, or train from sent mail), lessons learned from your edits and rejections, a skill that makes those lessons permanent in your copy |
| Control | Skills picker to switch features on and off, keyboard shortcuts and a ⌘K command palette, read-only mode, works on phones |

Claude does the drafting by default. Other models (GPT, Gemini, GLM and more) plug in through the OpenRouter connector.

## Get started

Pick the path that fits how you work. The full walkthrough is in [docs/getting-started.md](docs/getting-started.md).

1. **Fork it and back it with memory (recommended).** Fork or privately copy this repo, fill in [`memory/EMAIL-MEMORY.md`](memory/EMAIL-MEMORY.example.md) with how you handle email, then ask Claude to run the `chatterbuilt-mail-setup` skill. Your config, voice, rules and lessons live in your own repo and improve over time.
2. **No GitHub.** Save the template and skills to Google Drive, OneDrive or SharePoint, keep your email memory file next to them, and point Claude at that folder.
3. **Just the plugin.** Install `chatterbuilt-mail.plugin` and say "Set up Chatterbuilt Mail."

You need the Gmail connector in claude.ai (Settings, Connectors). Everything else is optional: Notion or another task app, a contacts app, Google Calendar, Clay and OpenRouter.

## Documentation

- [Getting started](docs/getting-started.md): fork and memory, Google Drive or Microsoft storage, plugin install
- [Features](docs/features.md): every feature, how to use it, what it touches
- [Configuration](docs/configuration.md): every `CONFIG` setting
- [Connectors and permissions](docs/connectors.md): which connectors do what, and how to plug in any task manager or CRM
- [Self-improving](docs/self-improving.md): how it learns from you and how lessons become permanent
- [Safety and privacy](docs/safety-and-privacy.md): what is sent where, what needs a click, read-only mode
- [Troubleshooting](docs/troubleshooting.md)

## Skills in this plugin

| Skill | What it does |
|---|---|
| `chatterbuilt-mail-setup` | Builds and publishes your copy, or changes it later (new task app, contacts, calendar, models, voice) |
| `chatterbuilt-mail-improve` | Takes the "Copy for Claude" export from the app and folds lessons, voice and rules into your copy and your memory file |
| `email-voice-profile` | Learns how you write from your sent mail |

## Repository layout

```
.claude-plugin/plugin.json         plugin manifest
skills/chatterbuilt-mail-setup/    setup skill + the page template (assets/)
skills/chatterbuilt-mail-improve/  improve skill
skills/email-voice-profile/        voice profile skill
memory/EMAIL-MEMORY.example.md     template for your email memory file
examples/config.example.js         a filled-in CONFIG to copy from
scripts/build.py                   builds your page from the template + your CONFIG
docs/                              documentation
CLAUDE.md                          tells Claude how to work in your fork
```

## Support

Bugs and requests: [GitHub issues](https://github.com/mrhinkle/chatterbuilt-mail/issues). The app's Skills panel links here too.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright 2026 Mark R. Hinkle. "Chatterbuilt" and "Chatterbuilt Mail" are trademarks of Mark R. Hinkle; the license does not grant rights to the names. See [TRADEMARKS.md](TRADEMARKS.md).
