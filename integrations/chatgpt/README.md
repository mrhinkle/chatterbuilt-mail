# Chatterbuilt Mail for ChatGPT — experimental panel

This is an MCP App: an inbox, conversation reader and reply editor that can open beside ChatGPT or from the sidebar. It is a first integration, with a smaller feature set than the Claude artifact. See [the user guide](../../docs/chatgpt-panel.md).

The server has two tools: `open_mail` opens the empty panel; `show_mail` renders results ChatGPT has obtained from the user's existing native Gmail or Composio connection. No Gmail credentials or model API keys are needed by this rendering server. It never fetches, saves or sends mail itself, and it does not store message data. Real mail and personal account IDs must never be embedded in the source, tests or screenshots.

## Request flow

1. ChatGPT discovers and calls an existing mail connector with the user's authorization.
2. ChatGPT passes verified account IDs and returned messages to `show_mail`.
3. The MCP App renders the result using text nodes, including for message bodies.
4. A panel click asks the host conversation to read a thread, refresh, draft, revise, save or send. `sendFollowUpMessage` starts the ChatGPT follow-up when supported. The standard `ui/message` fallback adds a request to the conversation, where the user may need to continue it. Outside an MCP host, the fallback copies a request for the user to paste.
5. ChatGPT reasons over the request and uses the existing connectors, then calls `show_mail` again. Drafting and revision alone do not write to Gmail. Actual save/send needs approval of the exact mailbox, recipient and text and a confirmed provider result. These calls are subject to the host's connector permissions.

The interface starts in read-only mode. Turning it off permits a confirmation dialog for Save and Send; the render server still has no mail-write endpoint. The two tools return `readOnlyHint: true` because they only display data. Connector reads and writes remain separate tools with their own annotations and approvals.

## Develop and check

Node 20+ and OpenSSL (for a local development certificate) are enough; no package installation is required. The preview binds only to loopback and requires HTTPS.

```sh
node --test test/*.test.mjs
mkdir -p .preview-tls
openssl req -x509 -newkey rsa:2048 -nodes -keyout .preview-tls/key.pem -out .preview-tls/cert.pem -days 7 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
node scripts/preview.mjs
```

Open `https://127.0.0.1:4387/test-host` for a synthetic MCP host with made-up `.example` mail. The browser will warn about the self-signed development certificate; accept it only for this local preview. `.preview-tls/` is ignored by Git and excluded from the build. Do not use production certificates or real mail in this preview. The test host and its fixture are development-only. The deterministic deployment copies only `worker/index.js` and the deployment manifest:

```sh
node scripts/build.mjs
node scripts/validate-artifact.mjs
```

The worker implements MCP discovery, initialize, tools and UI resources over JSON-RPC `POST /mcp`. Mail rendering requires the Site-authenticated user header. This assumes Sites' authenticated ingress; do not host this worker behind an untrusted header-forwarding proxy. Configure your own ignored `.openai/hosting.json` from `.openai/hosting.example.json` and bind it to your private Site. Do not commit that personal Site ID. Sites source synchronization uses a separate private deployment checkout; include its real hosting manifest there.

Publish through the Sites workflow with the `mcp` capability. Sites creates the associated private plugin. Check its connection metadata and verify tool calls in the intended ChatGPT account. Publication and a local fixture test do not prove hosted plugin rendering or live connector writes.

The bridge derives its parent’s HTTPS origin from the browser-provided document referrer before sending a data-free `ui/initialize` request to that exact origin. Only a matching successful response establishes the session; tool results are ignored until then. All incoming messages must match both parent and origin, and outgoing messages target that exact origin. This trusts the embedding MCP host, not arbitrary windows. Hosts must preserve an HTTPS referrer when embedding the panel; HTTP, opaque-origin, and no-referrer MCP hosts cannot use the message bridge (the ChatGPT `window.openai` extension and copy fallback remain available).

## Limits

- This integration relies on ChatGPT making connector calls in the conversation. It is not a direct connector bridge or background email process.
- The first version has plain-text reading and editing. Attachments, rich-text editing, labels, snooze, rules, Today and the Claude context panel are not implemented here.
- Results are bounded to 50 messages, 12 accounts and 20 messages per opened thread. `hasMore` marks partial results. Do not silently omit older thread messages: explain the limit in `notice`.
- Unsaved edits are held in one live panel instance. Keep or copy a reply before opening a new panel or ending the conversation. Revisions include the current editor text in the request; in-place updates preserve local edits and offer an explicit button to adopt the proposed revision.
- The app does not create cross-session memory, retain mail, or run scheduled jobs.

## Official references

- [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Sidebar and conversation panels](https://developers.openai.com/plugins/build/extensions)
- [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
