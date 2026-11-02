---
name: chatterbuilt-mail-setup
description: Sets up and customizes Chatterbuilt Mail, a Gmail reader and reply-drafting artifact, for the person asking. Use when the user says "set up Chatterbuilt Mail", "install my email reader", "customize the inbox artifact", "change my email voice or task database in Chatterbuilt Mail", "add another model to Chatterbuilt Mail", or asks to build a personal Gmail triage page.
---

# Chatterbuilt Mail setup

Chatterbuilt Mail is a single-page Claude artifact that reads the user's Gmail through their claude.ai Gmail connector. It summarizes threads, triages the inbox, drafts replies in the user's voice, moves mail to folders, forwards a copy to another address, finds unsubscribe options, and can file a dragged message as a Notion task.

The template is at `${CLAUDE_PLUGIN_ROOT}/skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html`. Every personal detail lives in one `CONFIG` object near the top of its script. Setup means filling in `CONFIG`, then publishing the page as an artifact. Do not rewrite the page.

## Steps

1. **Check the Gmail connector.** Confirm a Gmail connector is available. If not, tell the user to add Gmail under claude.ai Settings, Connectors, and stop.

2. **Collect the basics.** Use AskUserQuestion, skipping anything already known:
   - Name, Gmail address, and one or two sentences on what they do (fills `ownerName`, `ownEmail`, `about`).
   - Whether to build a voice profile from their sent mail. If yes, run the `email-voice-profile` skill and use its output for `voice`, `rules` and `signoff`. If no, ask for a one-line description of how they write and any hard rules (words they never use, spelling), plus a sign-off.
   - Whether replies should offer other models besides Claude. Claude is the built-in default and needs no connector. Other LLMs (GPT, Gemini, GLM, Llama and others) are available through the OpenRouter connector. If the user wants any, confirm the OpenRouter connector is available, call its `list-models` tool to find the exact model slugs, and fill `models` with `{ value, label }` pairs. Never invent a slug.
   - Whether to file tasks to Notion. If yes, see step 3. If no, leave `notion: null`; the Tasks controls hide themselves.
   - Other addresses they want as one-click "copy to account" targets (fills `copyTargets`).

3. **Map the Notion task database (only if wanted).** Search Notion for their task database, fetch it, and read its property names. Fill `notion` with `dataSourceId` (the data source id, not the page id), `titleProp` (the title property), and optional `urlProp`, `notesProp`, `emailProp`. Use `extra` for fixed values the database needs on every row (a status, a checkbox). Property names must match exactly, including case. Ask the user to confirm the mapping.

4. **Build the file.** Copy the template into the working directory as `chatterbuilt-mail.html`, then Edit only the `CONFIG` object. Set `defaultModel` to `"claude"` unless the user asked for another default. Keep strings plain text; escape quotes.

5. **Publish.** Load the `artifact-capabilities` and `artifact-design` skills if they are listed, then publish with the Artifact tool, icon `mail`, and a one-sentence description. Declare capabilities as follows:
   - Always: `mcp` with server `Gmail` and tools `search_threads`, `get_thread`, `get_message`, `create_draft`, `reply`, `send_message`, `update_message_labels`, `list_labels`, `create_label`, `forward`.
   - Always: `sample` (this is how Claude does the summaries and drafts).
   - If Notion tasks are configured: add server `Notion` with tool `notion-create-pages`.
   - If `models` is not empty: add server `OpenRouter` with tool `send-message`.
   Use the connectors' exact display names as `server`. Every server needs a non-empty `tools` array.

6. **Verify what you can.** Make one read-only Gmail call (a small inbox search) to confirm the connector responds. Do not send, move, forward or file anything as a test. Tell the user plainly which features were exercised and which were not (sending, moving, forwarding, Notion filing, unsubscribing, other models stay unverified until they use them).

7. **Hand over.** One or two sentences: what the page is, and the one thing to try first (open a thread and press a reply button). Mention that the first use of each connector asks for consent.

## Customizing later

When the user wants a change ("add GPT", "new sign-off", "different task database"), re-read the published artifact, edit `CONFIG` in the file, and republish to the same URL. Never rename the artifact.

## Notes for the page's behavior

- Replies are never sent without an on-page confirmation. Forward and unsubscribe-by-email also confirm first.
- "Copy to account" forwards the newest message to the chosen address as a new email. It is not a label-for-label copy, and a single Gmail connector cannot read or write a second account.
- Unsubscribe opens the sender's page or sends the sender's mailto request. A page cannot send one-click unsubscribe POSTs.
