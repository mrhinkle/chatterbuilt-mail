# An interactive mail panel in ChatGPT

The experimental [ChatGPT integration](../integrations/chatgpt/) adds an inbox, conversation reader and reply editor inside ChatGPT. It uses ChatGPT's existing native Gmail or Composio connections. ChatGPT performs the reads and approved writes in the conversation; the panel displays the results and lets you ask for the next step.

## Use your private copy

1. Build and publish the integration as a private Site with its MCP capability. This creates a private Chatterbuilt Mail plugin for that Site owner.
2. Install or connect that plugin in ChatGPT. Custom plugin access depends on your account and workspace policies.
3. Enable Chatterbuilt Mail and your mail connection in the same conversation. Ask: “Load a small sample of my inbox into Chatterbuilt Mail.”
4. Select a message to ask ChatGPT to read its thread. The reading pane updates when ChatGPT returns the result.
5. Choose **Draft with ChatGPT**, or write your reply in the editor. Enter instructions such as “make this shorter” in the revision box. Proposed replies stay in the panel until you approve a Gmail action.

The panel opens read-only. To save or send a real reply, turn read-only off, inspect the recipient and message, and approve the exact reply in the confirmation dialog. ChatGPT then uses the connected mail tool. Check the conversation for the provider's confirmed result; a button press alone is not proof that Gmail changed.

With multiple accounts, every message carries its owning account ID. Selecting an account filters the loaded sample; use Refresh to ask ChatGPT to fetch that account again. An approximate mailbox total is not used as evidence that every message has loaded.

## What is in this first version

- An account selector, Gmail search, refresh, message list, plain-text thread reader and reply editor.
- Draft and revision requests that use ChatGPT's conversation.
- Explicit Save and Send requests, subject to the connected tool's permissions and approvals.
- Private publication, authenticated rendering and no server-side email storage.

This version does not include the Claude artifact's attachments, rich-text editor, background triage, snooze, rules or context panel. Unsaved edits belong to the current panel; copy or save them before leaving it. A standard MCP host without ChatGPT's automatic follow-up extension may require you to continue the request in the conversation.

## Verification

Check these separately: the connector can read your mail; the plugin's tools appear; the panel renders real returned mail; a panel click starts a follow-up; the follow-up refreshes the panel. Test live writes only for a real, explicitly approved reply. The integration's local test host uses made-up mail and does not establish that ChatGPT's hosted connection works.

The [prompt-only ChatGPT workflow](install.md#chatgpt) remains available too.
