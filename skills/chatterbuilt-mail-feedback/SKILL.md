---
name: chatterbuilt-mail-feedback
description: Turns a Chatterbuilt Mail bug, idea or question into a GitHub issue on mrhinkle/chatterbuilt-mail, and checks on issues already filed. Use when the user types "chatterbuilt-mail-feedback", or says "report a bug in Chatterbuilt Mail", "Chatterbuilt Mail is broken", "send feedback about Chatterbuilt Mail", "feature request for Chatterbuilt Mail", "open an issue", or "what happened to my bug report".
---

# Chatterbuilt Mail feedback

Write up a bug report, an idea or a question as a GitHub issue on **mrhinkle/chatterbuilt-mail** (https://github.com/mrhinkle/chatterbuilt-mail/issues), with as little typing from the user as possible. The repo is public, so nothing private goes in the issue.

## 1. Work out what kind it is

- **Bug:** something broke, showed an error, or did the wrong thing. Label `bug`.
- **Idea:** a feature, a change, another email platform or connector. Label `enhancement`.
- **Question:** how do I…, is it supposed to… Label `question`. Check the docs first (`docs/README.md` in the repo, or https://github.com/mrhinkle/chatterbuilt-mail/tree/main/docs). If the docs answer it, answer it and offer to file anyway.
- **Docs problem:** a page is wrong or missing. Label `documentation`.

If the user wants to check on reports they already filed, go to **Checking on a report** below.

## 2. Pull together what's already here

Gather before asking. Ask only for what's missing.

- **From this conversation:** what they described, any error text they pasted, and any screenshot they shared. Describe a screenshot in words; never attach one that shows real mail.
- **Version:** Settings → Skills → *Docs and support* shows "Version x.y.z" in the app. In a repo or plugin folder, read `version` from `.claude-plugin/plugin.json`. If neither is available, ask, or write "unknown".
- **Their setup**, from `my/config.js` if it's there (read it, never paste it):
  - native connectors, Composio, or a mix (`server` values in `context`, `tasks`, `contacts`, `actions`, `lookup`);
  - which connector the problem involves;
  - the model (`defaultModel`, `models`).
- **The exact message:** the toast, banner, red chip tooltip (hover the chip) or note under the button. Exact words matter most for a bug.
- **Where:** desktop or phone, the Claude app or claude.ai in a browser, and which browser.

Then ask for the gaps in one message (use AskUserQuestion when it's available). Usually that's just:
1. What did you do right before it happened?
2. What did you expect instead?
3. Does it happen every time?

For an idea, ask what problem it solves and how they'd use it.

## 3. Look for a duplicate

Search the repo's issues read-only before writing a new one. Use whichever works:

- `gh api "search/issues?q=repo:mrhinkle/chatterbuilt-mail+is:issue+<keywords>" --jq '.items[] | "#\(.number) [\(.state)] \(.title) \(.html_url)"'` (the query must include `is:issue`; `gh issue list` may fail where GraphQL is blocked);
- a GitHub connector's issue search;
- WebFetch on `https://github.com/mrhinkle/chatterbuilt-mail/issues?q=<keywords>`.

If there's a close match, show it and offer to add their details as a comment instead of a new issue.

## 4. Scrub it

The issue is public. Before showing the draft, remove or replace:

- email content: bodies, subjects, snippets, quoted text;
- people: names, email addresses and domains of anyone they correspond with. Use placeholders like `<a sponsor's email>` or `sender@example.com`;
- their own address, unless they ask to include it;
- IDs and links: Notion or database IDs, Slack channel or user IDs, Gmail thread or message IDs, claude.ai artifact links, API keys or tokens;
- anything from `my/config.js` beyond connector and tool names;
- anything from their email memory file.

Connector names, tool names, error codes and the app's own messages are fine.

## 5. Draft the issue

**Title:** short and specific. "Sweep finds no unsubscribe link for HTML-only newsletters" beats "Sweep broken".

**Bug body:**

```markdown
## What happened
<one or two sentences>

## What I expected
<one sentence>

## Steps to reproduce
1. …
2. …

## Message shown
<exact text, or "none">

## Setup
- Chatterbuilt Mail version: <x.y.z or unknown>
- Where: <desktop or phone>, <Claude app or claude.ai in Browser>
- Connectors: <native / Composio / mixed>; involved: <connector and tool names>
- Model: <Claude or the OpenRouter model>
- Read-only: <on or off>
- Happens: <every time / sometimes / once>

<sub>Filed with the chatterbuilt-mail-feedback skill.</sub>
```

**Idea body:**

```markdown
## The problem
<what's hard or missing today>

## What would help
<the change>

## How I'd use it
<a short example, with made-up names>

<sub>Filed with the chatterbuilt-mail-feedback skill.</sub>
```

**Question body:** the question, what they tried, and the doc pages they read.

## 6. Show it and get a yes

Show the title, label and body. Say it will be public on GitHub. File it only after the user says yes, and apply any changes they ask for first. Never file a test issue, and never file on someone's behalf without their OK.

## 7. File it

Use the first one that works:

1. **A GitHub connector or `gh` with write access:** `gh issue create -R mrhinkle/chatterbuilt-mail --title "…" --body-file <file> --label bug`, or the REST API: `gh api repos/mrhinkle/chatterbuilt-mail/issues -f title=… -f body=… -f "labels[]=bug"`. If the label is rejected, file without it. Give the user the issue link.
2. **A prefilled link:** build `https://github.com/mrhinkle/chatterbuilt-mail/issues/new?title=<urlencoded>&labels=<label>&body=<urlencoded>`. Keep the whole URL under about 6,000 characters (shorten the body if needed). Tell the user to open it, sign in to GitHub, and press **Create**. Also give the body in a code block in case the link is cut off.
3. **No GitHub account:** give them the title and body to copy, the link https://github.com/mrhinkle/chatterbuilt-mail/issues/new, and mention that GitHub accounts are free.

One problem per issue. If they described two, offer two issues.

## Ideas that are code

If the idea is something they could build, like another email platform (Outlook, Fastmail, IMAP through a connector), a new connector, or a fix, mention they can fork the repo and open a pull request. `CONTRIBUTING.md` says how.

## Forks

If `my/config.js` or the repo's remote points to someone's fork, decide where the problem lives. A bug in the shared template (`skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html`) or a skill goes to mrhinkle/chatterbuilt-mail. A problem caused by their own CONFIG is fixed in their copy with the `chatterbuilt-mail-setup` skill, not filed.

## Checking on a report

When they ask about reports they've filed:

- With `gh`: `gh api "search/issues?q=repo:mrhinkle/chatterbuilt-mail+is:issue+author:<their GitHub username>" --jq '.items[] | "#\(.number) [\(.state)] \(.title) \(.html_url)"'`. Ask for their GitHub username if you don't know it.
- Without: link https://github.com/mrhinkle/chatterbuilt-mail/issues?q=is%3Aissue+author%3A<username>.

For each one, say whether it's open or closed, and for a closed one, whether a fix shipped (look for a linked commit, or the version in `CHANGELOG.md`). If a fix shipped, tell them how to get it: update the plugin, or ask Claude to run `chatterbuilt-mail-setup` to rebuild and republish their copy.
