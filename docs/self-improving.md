# Self-improving

Chatterbuilt Mail learns from the corrections you already make: how you change its drafts, what you turn down, and what you file by hand. It writes that up as short lessons and rules you can read and edit. Nothing is a black box, and nothing acts on its own.

## What it notices

| Signal | Where it comes from | What it's used for |
|---|---|---|
| Edited drafts | You change an AI draft before you send or save it. It keeps the draft and what you sent, up to 30 pairs. | Drafting lessons |
| Drafts sent as written | You send an AI draft unchanged | A count, so it knows what's working |
| Turned-down suggestions | You untick an item in Review, or Discard all | Triage lessons ("don't suggest archiving venue mail") |
| Hand actions | You move, archive, star or mark read; you approve a review item; you archive a sender in the sweep | Rule suggestions |

## What it does with them

**Lessons.**
- After five new corrections, a toast offers to learn from them. You can also press **Voice → What it has learned → Learn now** at any time.
- The AI reads your recent edits and rejections and writes up to eight drafting lessons and six triage lessons, merging them with the ones you already have.
- You can read, edit and save them. **Forget all** clears what this browser has learned.
- Drafting lessons go into every draft, option, pre-draft and nudge. Triage lessons go into triage and rules.

**Rule suggestions.**
- **From a pattern.** Move or archive three emails from the same sender the same way (or four from the same company) and it offers: *"You've moved 3 emails from Stripe to Finance. Make it a rule?"* An accepted suggestion becomes a sender rule that matches the address exactly. Dismissed suggestions don't come back.
- **From your history.** **Rules → Suggest rules from my history** asks the AI to find broader patterns across your last 120 actions.
- **Checking new mail.** With *Check the inbox against my rules each time it loads* on, rules run quietly as the inbox loads (at most every five minutes per view). Matches go to **Review**, never straight into Gmail.

## Making it permanent

What it learns lives in your browser first. To make lessons, voice, rules and feature switches follow you everywhere:

1. **Voice → Copy for Claude.** This copies a short export: your lessons, voice, linked voice page, rules, feature switches, counts, and a handful of recent draft edits so Claude can see what changed.
2. **Paste it into Claude and say *"run chatterbuilt-mail-improve."*** The skill:
   - folds the lessons into `CONFIG.lessons`, merging and pruning;
   - adds your rules to `CONFIG.mailRules`, voice changes to `CONFIG.voice`, and switches to `CONFIG.features`;
   - updates your email memory file (`memory/EMAIL-MEMORY.md` in a fork, or the copy in your Drive or OneDrive folder);
   - rebuilds and republishes your page to the same link;
   - in a fork, commits with a message that summarizes what changed.

Lessons built into your copy show in the Voice panel as "lessons built into this copy." They apply in every browser, even after you clear what one browser learned.

## Why memory matters

The memory file is the human-readable record of how you handle email:
- your people;
- your folders;
- your voice;
- your rules;
- the things you never do.

Claude reads it whenever it sets up or improves your copy, so a change you make there (a new VIP, a renamed folder) flows into the app the next time the setup or improve skill runs. Keep it in your fork or your cloud folder, and edit it like any other doc.
