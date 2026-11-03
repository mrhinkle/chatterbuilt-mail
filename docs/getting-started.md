# Getting started

Chatterbuilt Mail is one HTML page that Claude publishes as a private artifact on your claude.ai account. The page reaches your mail and apps through your own claude.ai connectors, so it never holds a password or token. Setup means filling in one `CONFIG` block and publishing the page.

Claude does the setup for you in every case: you answer a few questions, it writes the config and publishes the page. There are four ways to start, and they all end the same way: a private Chatterbuilt Mail page in your claude.ai artifacts.

| | You want | You need |
|---|---|---|
| [Path 1: just install it](#path-1-just-install-it-recommended) | to use it | a claude.ai account with Gmail |
| [Path 2: fork it](#path-2-fork-it-to-change-the-code) | to change the code, or send a pull request | a GitHub account |
| [Path 3: a private copy](#path-3-a-private-repo-backed-by-an-email-memory-file) | your settings and what it learns versioned | a private GitHub repo |
| [Path 4: no GitHub](#path-4-no-github-google-drive-onedrive-or-sharepoint) | the files in Drive or OneDrive | a cloud folder |

The quickest start is a single prompt: see [install.md](install.md). That page also has a ChatGPT version, which sets up the same triage approach as a chat workflow rather than the app.

## Before you start

- A claude.ai account with the **Gmail** connector added (Settings, Connectors).
- That's all you need for a first install. Setup shows which of your other connectors it can use (native ones, MCP servers from your Claude plugins, and [Composio](composio.md) if you use it) and turns on only what you pick. See [apps that fit each feature](connectors.md#apps-that-work-by-feature).
- Optional apps, depending on what you want:
  - **Notion**, or another task app (Asana, Basecamp, Linear, Todoist...), for Tasks.
  - Your mail account's address book (**Google Contacts** for Gmail, through Composio), **Notion** or a CRM for Contacts, plus **Clay**, **Apollo** or another enrichment app if you want enrichment.
  - **Google Calendar** for open times in replies.
  - **Slack** for Route's **Message someone in Slack**.
  - **OpenRouter**, only if you want models other than the one Claude gives the page.
  - A **web search** tool (Firecrawl, Exa, Tavily, Perplexity) for More context.
  - Meeting notes, a pipeline or CRM, newsletter lists and a memory system for the context panel.

## Path 1: just install it (recommended)

Paste the prompt from [install.md](install.md) into Claude, or install the plugin and say *"Set up Chatterbuilt Mail."* That's it: Claude reads this repo, looks at your connectors, asks a few questions, and publishes your page. You don't download, edit or run anything. It starts with just your inbox. Your settings live inside the published artifact, so there's no repo to manage, and changing something later is one sentence to Claude (*"turn on calendar times"*, *"file tasks in Asana"*).

## Path 2: fork it (to change the code)

Fork when you want to change how the app works, not just how it's set up: a new button, another email platform, a fix you'd like to send back.

1. **Fork** [mrhinkle/chatterbuilt-mail](https://github.com/mrhinkle/chatterbuilt-mail) on GitHub (the **Fork** button, top right).
2. **Open your fork in Claude.** Claude Code, or a claude.ai chat with the GitHub connector. Say *"Set up Chatterbuilt Mail from this repo."* `CLAUDE.md` tells Claude how the repo works; it writes your settings to `my/config.js`, builds the page from your fork's template and publishes it.
3. **Change the code by asking.** *"Add a button that…"*, *"make the list denser."* Claude edits the template in `skills/chatterbuilt-mail-setup/assets/`, rebuilds with `scripts/build.py`, republishes your page and keeps the docs in step.
4. **Keep it current.** **Sync fork** on GitHub pulls in upstream changes; then say *"rebuild my Chatterbuilt Mail and republish."*
5. **Send it back.** A pull request to mrhinkle/chatterbuilt-mail. [CONTRIBUTING.md](../CONTRIBUTING.md) has the map.

A public fork is fine for code. Your personal settings never go in it: `my/` and `memory/EMAIL-MEMORY.md` are git-ignored, and the skills don't commit them in a public repo. If you want your settings and lessons versioned as well, use Path 3.

## Path 3: a private repo backed by an email memory file

This keeps your settings, voice, rules and what the app learns in a repo you own, so every improvement is saved and versioned.

1. **Make your own private copy.**
   - Don't use a fork for this: forks of a public repo are public, and your settings and memory file describe your mail. Create an empty **private** repo, then use GitHub's "Import repository" with this repo's URL.
   - `my/` and `memory/EMAIL-MEMORY.md` are git-ignored, so nothing personal is committed by accident. In your private copy the skills commit them on purpose.
2. **Write your email memory.** Copy `memory/EMAIL-MEMORY.example.md` to `memory/EMAIL-MEMORY.md` and fill it in. It covers:
   - who you are and the people who matter most;
   - how you write;
   - which folders things go in;
   - where tasks and contacts live;
   - your rules ("receipts go to Finance");
   - what never to do.

   Plain sentences are fine. This is the memory Claude uses whenever it sets up or improves your copy.
3. **Run setup.** Open your repo in Claude Code, or in a claude.ai chat with the GitHub connector, and say: *"Run chatterbuilt-mail-setup using my memory file."*
   - `CLAUDE.md` tells Claude to read `memory/EMAIL-MEMORY.md` first.
   - The skill asks only about gaps, writes `my/config.js`, builds `my/chatterbuilt-mail.html` with `scripts/build.py`, and publishes it.
4. **Use it, then teach it.** Over time:
   - The app records how you edit its drafts and which suggestions you turn down.
   - When it has enough, open **Voice → What it has learned → Copy for Claude**.
   - Paste that into Claude and say *"run chatterbuilt-mail-improve."*
   - The skill updates `my/config.js` and `memory/EMAIL-MEMORY.md`, republishes the page, and commits the change. Your lessons now follow you to every browser and device.
5. **Get updates.** When this repo improves, pull from upstream (GitHub's "Sync fork", or `git pull upstream main`), then ask Claude to rebuild: *"rebuild my Chatterbuilt Mail from the template and republish."* Your `my/` folder and memory file are untouched by upstream changes.

## Path 4: no GitHub (Google Drive, OneDrive or SharePoint)

You can keep everything in a cloud folder instead of a repo.

1. **Make a folder**, for example `Chatterbuilt Mail`, in Google Drive, OneDrive or SharePoint.
2. **Put these files in it:**
   - `chatterbuilt-mail.template.html` (from `skills/chatterbuilt-mail-setup/assets/`);
   - the `skills/` folder, or just the `SKILL.md` files;
   - your `EMAIL-MEMORY.md`, filled in as in Path 3, step 2.

   Download them from GitHub's "Code → Download ZIP" if you don't use git.
3. **Connect the folder to Claude.**
   - Google Drive: add the Google Drive connector in claude.ai.
   - OneDrive or SharePoint: add the Microsoft 365 connector, where your organization offers it.
   - Or simply attach the files to a chat.
4. **Run setup.** Say: *"Set up Chatterbuilt Mail from the template and memory file in my Chatterbuilt Mail folder."*
   - Claude follows the setup skill and publishes your page.
   - Ask it to save the finished `config.js` and `chatterbuilt-mail.html` back to the folder, if your connector can write files. If it can't, download them from the chat and drop them in yourself.
5. **Improve it the same way:** Copy for Claude, then *"run chatterbuilt-mail-improve and update the files in my folder."*

What you give up without a repo: version history and an easy way to pull upstream updates. Drive and OneDrive keep file versions, which covers most of that.

## Installing the plugin

The plugin carries the skills (setup, improve, morning run, voice profile, feedback and contact cleanup). Install `chatterbuilt-mail.plugin` in Claude and say *"Set up Chatterbuilt Mail."* Claude's own memory, if you have it turned on, carries your preferences between chats; for a durable, editable record, Path 3 is better.

## After setup

![The app on first open: the list on the left and Today on the right](images/today.webp)

*Made-up data.*

- Open the artifact from your claude.ai artifacts list. The first time each connector is used, claude.ai asks for your OK.
- Open **Settings → Skills** at the top to see every feature and turn off what you don't need.
- Turn on **Read-only** for a careful first look; nothing can change in Gmail while it's on.
- Open a thread from someone you know well. The [context panel](context-panel.md) shows what your other systems know about them. Press **Route** to see where it would send the thread.
- Press a reply button to see a draft in your voice.
- When you trust the drafts, set up the [morning run](morning-run.md) so they're waiting in Gmail each morning.

## Changing things later

Ask Claude in plain words. For example:
- "Switch my tasks to Asana."
- "Save contacts to Google Contacts."
- "Enrich contacts with Apollo."
- "Add a custom action that hands scheduling to Christine in Slack."
- "Clean up my contacts." (the contact-cleanup skill)
- "Turn on calendar times."
- "My working hours are 8 to 4."
- "Save contacts to HubSpot."
- "Check Fireflies and my CRM when I open an email."
- "Add GPT as a model." (only if you want one besides Claude)
- "Set up the morning run, weekdays at 6:45."

The setup skill edits your `CONFIG` and republishes to the same link.
