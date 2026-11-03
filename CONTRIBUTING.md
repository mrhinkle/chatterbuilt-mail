# Contributing

Thanks for wanting to make Chatterbuilt Mail better. Bug reports, ideas, docs fixes and pull requests are all welcome.

## Report a bug or share an idea

The easy way: type **chatterbuilt-mail-feedback** in Claude. It collects what went wrong (the message, your version, your setup), removes anything private, shows you the issue, and opens it on GitHub when you say so.

Or open one yourself at https://github.com/mrhinkle/chatterbuilt-mail/issues/new/choose. The issue is public, so leave out email content, the names and addresses of people you write to, and IDs or links to your own systems.

## Send a pull request

1. Fork the repo and make a branch.
2. Make the change. Know where it belongs:
   - **For everyone:** the page template (`skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html`), the skills, `scripts/`, `docs/`.
   - **Just for you:** your `CONFIG` in `my/config.js`. Don't put one person's settings in the template.
3. Build a copy and try it:
   ```bash
   python3 scripts/build.py skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html examples/config.full.example.js /tmp/chatterbuilt-mail.html
   ```
4. Check every screen. The screenshot script clicks through all of them with made-up data and fake connectors, and reports any page error:
   ```bash
   node scripts/demo/screenshots.js demo-out/screens
   ```
   If you changed the interface, update the matching images in `docs/images/` (see [docs/demo.md](docs/demo.md)).
5. Update the docs for anything a user would notice, and add a line to `CHANGELOG.md`.
6. Open the pull request. Say what changed and how you tested it.

Ground rules:
- **Never test by acting.** Don't send, move, forward, label, file a task or save a contact on a real account to test. Read-only calls are fine.
- **Never commit real mail.** Screenshots, fixtures and examples use made-up people and `.example` addresses.
- **Nothing happens without a click.** Anything that sends, moves, files or writes elsewhere needs the user's OK, and read-only mode must block it.
- **Docs are plain Markdown,** written plainly. "open source" is two words, no hyphen.

## Add another email platform

Chatterbuilt Mail is built on Gmail because that's where my mail lives. The page reaches Gmail only through these connector tools, all called through `call(GMAIL, …)`:

| Tool | Used for |
|---|---|
| `search_threads` | The list, tabs, search, paging, Waiting, Ask, rules, the sweep |
| `get_thread` | Reading a thread (plain text, or full content for the formatted view and unsubscribe links) |
| `get_message` | The raw message, for the List-Unsubscribe header and opening attachments |
| `reply`, `send_message`, `forward` | Sending, follow-ups, copies to another account, unsubscribe emails |
| `create_draft`, `list_drafts`, `delete_draft` | Save draft, drafts waiting, replacing a draft on send (plus `get_draft` through Composio) |
| `label_thread`, `unlabel_thread`, `list_labels`, `create_label` | Archive, move, star, read, snooze and remind-me labels |

`gmailComposio()` in the template is a working example of this kind of adapter: it maps every tool above onto Composio's Gmail tools (`GMAIL_FETCH_EMAILS`, `GMAIL_FETCH_MESSAGE_BY_THREAD_ID`, `GMAIL_MODIFY_THREAD_LABELS`, `GMAIL_REPLY_TO_THREAD` and the rest) and reshapes the replies so the rest of the page doesn't change. Start from it. Two parts carry over to any platform with more than one mailbox: `gxAllSearch()` merges several accounts into one list without skipping mail, and `gxAcctFor()` sends each call to the account that owns the thread. One part is Composio's own: `gxBig()` reads a reply Composio saved to its sandbox instead of sending it back.

To add a platform, such as Outlook through a Microsoft 365 connector, Fastmail, or IMAP through a custom MCP server:

- map each tool above to that connector's tool, with an adapter in the same `{ server, tool, input }` shape that `CONFIG.tasks` and `CONFIG.contacts` use;
- handle the Gmail-specific ideas:
  - **Labels.** Gmail archives by removing the `INBOX` label and keeps snooze and remind-me state in `CB/…` labels. Folder-based mail needs moves, and somewhere else to keep that state, such as categories or a folder.
  - **Search.** The page writes Gmail search syntax (`in:inbox`, `newer_than:7d`, `before:YYYY/MM/DD`).
  - **Paging.** Older mail is found by date because Gmail's connector returns no next-page token.
  - **Unsubscribe.** The page reads the raw headers for List-Unsubscribe.
- keep Gmail working exactly as it does now.

Open an issue first if you're planning something this size, so we can agree on the shape before you write it.

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0, the same as the project. See [LICENSE](LICENSE). The names "Chatterbuilt" and "Chatterbuilt Mail" are covered by [TRADEMARKS.md](TRADEMARKS.md), so a fork for another platform needs its own name if you publish it separately.
