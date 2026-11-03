# Chatterbuilt Mail

**A fun way to triage your Gmail with Claude.** It reads the room before you reply.

I've had an email address since the BBS days, and I don't think I've been caught up once. Remember when "You've got mail" was good news? These days I run a conference and a handful of AI newsletters, so my inbox is where sponsors, speakers, vendors and every SaaS receipt on earth wait in the same line.

I tried the AI email tools. They sort, they summarize, they draft. Fine. But the stuff I need before I reply, like what I promised on last week's call or where a sponsor is in the pipeline, doesn't live in my inbox. It lives in my meeting notes, my calendar, Notion, my CRM.

So I built Chatterbuilt Mail to triage my own email. It's a private Claude artifact that sits on top of Gmail. When I open a thread, it checks my other systems first, writes a draft that sounds like me, and right before I hit Send, it reminds me about the thing I forgot. It started as a side project. It got a little out of hand, in the best way.

![Chatterbuilt Mail: a thread with context from your systems, a cited web lookup, suggested next steps, and the pre-send check](docs/images/presend.webp)

*A thread with what your systems know beside it, suggested next steps, and the pre-send check catching a promised deck. Made-up data.* **[Watch the 30-second demo](docs/media/demo.mp4)** · [every screenshot](docs/demo.md)

## What it does

**It reads the room.** Open a thread and the context panel tells you what your other systems know about this person: what you owe them, where the deal stands, when you last met. Every line names its source, and it tells you what came back empty instead of guessing. **More context** looks them up on the web too, with citations, but only when you ask. → [The context panel](docs/context-panel.md)

**It sorts the pile.** Triage splits your inbox into Needs you, Worth reading and FYI, with a reason on each thread. **Today** shows drafts waiting, what needs you and your next meeting before you open anything. → [Today](docs/today.md) · [Reading and triage](docs/reading-and-triage.md)

**It shows you who owes you a reply.** The **Waiting** tab lists the things you sent that nobody has answered, oldest first, with how many days it's been. Press **Nudge** and you get a short, friendly follow-up ready to send. Or tick *Remind me* when you send, and if they go quiet, the thread comes back to your inbox on its own. → [Following up](docs/following-up.md)

**It routes the work.** **Route** is the "OK, now what?" button. It reads the thread and what your systems know, then suggests where the thread should go: a task in your task app, a handoff to your assistant in Slack, a new contact, a snooze, or a reminder if nobody answers. Each suggestion shows up with the text already written. You edit what you want, untick what you don't, and press **Apply selected**. Nothing moves until you do. → [Route and next steps](docs/route-and-next-steps.md)

**It writes like you.** Drafts come out in your voice, matched to how you write to each person, with open times from your calendar when someone wants to meet. **3 options** gives you a best fit, a shorter one and a polite no. → [Replying](docs/replying.md)

**It catches you before you hit Send.** The pre-send check rereads your reply against the thread and your systems. Forgot the deck you promised? Wrong date? Reply-all on something you shouldn't? It flags it and offers a fix. → [The pre-send check](docs/replying.md#the-pre-send-check)

**It works while you sleep.** The morning run checks your systems each weekday and leaves reply drafts in Gmail before you're up. → [Morning run](docs/morning-run.md)

**It cleans up.** Plain-English rules, an unsubscribe sweep, folder moves, and a review queue with undo for anything the AI suggests. → [Organizing](docs/organizing.md)

## Train it to sound like you

Out of the box it writes like a polite robot. Give it a few minutes and it writes like you. In **Settings → Voice**, train it from your sent mail, paste a style guide, or point it at a Notion page. After that, every draft you edit teaches it something, and it writes those up as lessons you can read and change. No black box. → [Voice](docs/voice.md) · [Self-improving](docs/self-improving.md)

## Make it yours

Every feature has an off switch in **Settings → Skills**. Everything personal, like your connectors, task app, CRM, rules and voice, lives in one `CONFIG` block. You don't have to edit it yourself: ask Claude to change something and the setup skill does the rest.

Connect your other apps however you like. I use a mix of native claude.ai connectors and [Composio](docs/composio.md), which reaches hundreds of apps through one connector. Native, Composio, or both all work. Claude drafts by default, and GPT, Gemini and other models plug in through OpenRouter. → [Connectors](docs/connectors.md) · [Configuration](docs/configuration.md)

## Built for Gmail. Bring your own inbox.

I built this for Gmail because that's where my mail lives. But the app only talks to a handful of connector tools (search, read, draft, send, label), so there's nothing stopping it from running on Outlook or anything else with a connector. Fork it, swap in your email platform, and send a pull request. That's how open source is supposed to work, right? [CONTRIBUTING.md](CONTRIBUTING.md) has the map of what to change.

Got more than one inbox? I've got four. Run Gmail through [Composio](docs/composio.md#gmail-through-composio-several-accounts-in-one-copy) and they land in one list, color-coded by account, or one at a time from the account menu.

## Nothing happens without a click

Nothing is sent, moved or filed until you say so. AI suggestions wait for your OK, there's undo, and read-only mode blocks every change outright, which is handy for demos. → [Safety and privacy](docs/safety-and-privacy.md)

## Get started

Paste this into Claude:

```text
Install Chatterbuilt Mail from https://github.com/mrhinkle/chatterbuilt-mail as my private Claude artifact. Gmail is native; use Composio for everything else. Read my email memory file if I have one, ask me only what you can't find, and never send, move or file anything as a test.
```

Rather use native connectors? Swap the Composio part for "use my native connectors." You need the Gmail connector in claude.ai (Settings → Connectors); everything else is optional.

The full prompt and a ChatGPT version are in [docs/install.md](docs/install.md). The three ways to set it up (fork it and back it with an email memory file, keep it in Google Drive or OneDrive, or just install the plugin) are in [docs/getting-started.md](docs/getting-started.md).

## Found a bug? Got an idea?

Type **chatterbuilt-mail-feedback** in Claude. It pulls together what went wrong (the error, your version, your setup), strips out anything private, shows you the issue, and opens it on GitHub when you say go. Ask it later what happened to your report and it'll check. Or [open an issue](https://github.com/mrhinkle/chatterbuilt-mail/issues/new/choose) yourself. Pull requests are even better.

## Documentation

The full index is [docs/README.md](docs/README.md). Every guide has screenshots.

**Set up:** [install with a prompt](docs/install.md) · [getting started](docs/getting-started.md) · [Composio](docs/composio.md) · [connectors](docs/connectors.md) · [configuration](docs/configuration.md) · [morning run](docs/morning-run.md)

**Use it:** [Today](docs/today.md) · [reading and triage](docs/reading-and-triage.md) · [the context panel](docs/context-panel.md) · [More context](docs/more-context.md) · [Route and next steps](docs/route-and-next-steps.md) · [replying](docs/replying.md) · [voice](docs/voice.md) · [following up](docs/following-up.md) · [organizing](docs/organizing.md) · [tasks and contacts](docs/tasks-and-contacts.md) · [settings and shortcuts](docs/settings-and-shortcuts.md) · [phone](docs/phone.md)

**Reference:** [features](docs/features.md) · [self-improving](docs/self-improving.md) · [safety and privacy](docs/safety-and-privacy.md) · [troubleshooting](docs/troubleshooting.md) · [screenshots and video](docs/demo.md) · [why Chatterbuilt Mail](docs/why.md)

## Skills in this plugin

| Skill | What it does |
|---|---|
| `chatterbuilt-mail-setup` | Builds and publishes your copy, or changes it later (new task app, contacts, calendar, models, voice) |
| `chatterbuilt-mail-improve` | Takes the "Copy for Claude" export from the app and folds lessons, voice, rules and snippets into your copy and your memory file |
| `chatterbuilt-mail-morning` | The morning run: wakes snoozes, drafts replies into Gmail with context, lists who owes you, and sends a short summary |
| `email-voice-profile` | Learns how you write from your sent mail |
| `chatterbuilt-mail-feedback` | Turns a bug or an idea into a GitHub issue, privately scrubbed, and checks on issues you've filed |

## Repository layout

```
.claude-plugin/plugin.json          plugin manifest
skills/chatterbuilt-mail-setup/     setup skill + the page template (assets/)
skills/chatterbuilt-mail-improve/   improve skill
skills/chatterbuilt-mail-morning/   morning run skill (for a scheduled task)
skills/chatterbuilt-mail-feedback/  feedback skill: bug reports and ideas as GitHub issues
skills/email-voice-profile/         voice profile skill
memory/EMAIL-MEMORY.example.md      template for your email memory file
examples/config.example.js          a filled-in CONFIG to copy from
scripts/build.py                    builds your page from the template + your CONFIG
scripts/demo/                       screenshots and the demo video, with made-up data
docs/                               documentation (images/ and media/ hold the screenshots and video)
.github/ISSUE_TEMPLATE/             bug report and idea templates
CONTRIBUTING.md                     how to send a pull request or add another email platform
CLAUDE.md                           tells Claude how to work in your fork
```

If it saves you twenty minutes a day, great. If it doesn't, you know where the feedback skill is.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright 2026 Mark R. Hinkle. "Chatterbuilt" and "Chatterbuilt Mail" are trademarks of Mark R. Hinkle; the license does not grant rights to the names. See [TRADEMARKS.md](TRADEMARKS.md).
