# Chatterbuilt Mail

A Gmail reader and reply desk that runs as your own private Claude artifact.

## What it does
- Reads your inbox with a two-line preview on every thread
- Summarizes a thread and triages the inbox into reply, read and skip
- Drafts replies in your voice from one-click intents or your own instruction. Nothing sends without a confirm
- Moves mail to a folder (existing label or a new one)
- Forwards a copy of a message to another address you own
- Finds the unsubscribe option and acts on it
- Drag a message onto Tasks to create a Notion task (optional)
- Claude is the default model. Other LLMs (GPT, Gemini, GLM and more) are available through the OpenRouter connector if you add them

## Install
1. Install this plugin.
2. Make sure the Gmail connector is connected in claude.ai Settings, Connectors. Notion and OpenRouter are optional.
3. Ask Claude: "Set up Chatterbuilt Mail." The `chatterbuilt-mail-setup` skill asks a few questions, fills in the page's `CONFIG` block, and publishes the artifact to your account.

## Skills
- `chatterbuilt-mail-setup`: configures and publishes (or later changes) your copy of the page
- `email-voice-profile`: learns how you write from your sent mail

## Good to know
- The page runs on your credentials and is private to you until you share it.
- "Copy to account" forwards a message as a new email. A single Gmail connector cannot read or write a second mailbox.
- Everything personal is in the `CONFIG` object at the top of the page script.

## License
Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright 2026 Mark R. Hinkle. "Chatterbuilt" and "Chatterbuilt Mail" are trademarks of Mark R. Hinkle; the license does not grant rights to the names. See [TRADEMARKS.md](TRADEMARKS.md).
