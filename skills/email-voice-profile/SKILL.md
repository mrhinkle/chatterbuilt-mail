---
name: email-voice-profile
description: Builds a short written profile of how the user writes email, from their own sent messages, for use when drafting replies in their voice. Use when the user says "learn my email voice", "build my voice profile", "make drafts sound like me", or when Chatterbuilt Mail setup needs voice, rules and sign-off.
---

# Email voice profile

Produce a compact, evidence-based description of how this person writes email so drafts sound like them. Work only from their own sent mail and anything they tell you directly.

## Steps

1. **Sample sent mail.** Using the Gmail connector, search `in:sent` and read 15 to 25 recent threads where the user wrote real replies to people. Skip newsletters, automated mail, forwards with no comment, and very short acknowledgements. Read their own words only, not quoted text.

2. **Look for patterns.** Note, with a short quoted example for each:
   - Length and shape: typical word count, paragraph size, whether they use lists.
   - Openers and closers: how they start, how they end, their usual sign-off.
   - Register: formal or casual, warmth, humor, directness.
   - Habits: favorite phrases, sentence starters, punctuation, emoji, contractions.
   - What they never do: words or moves that never appear.
   - How they say no, say yes, and ask for something.

3. **Write the profile.** Produce three short pieces:
   - `voice`: 3 to 5 sentences describing the style, in plain instructions to a writer.
   - `rules`: hard rules, as direct instructions (words to avoid, spelling, formatting). Include only rules the user stated or the evidence clearly supports. Ask before adding a banned-word rule that you inferred.
   - `signoff`: the sign-off text they use most.

4. **Confirm.** Show the three pieces and ask the user to correct them. Do not store or send anything anywhere else. Return the confirmed text to the caller (for example, the `chatterbuilt-mail-setup` skill) or, if invoked on its own, offer to paste it into their Chatterbuilt Mail `CONFIG`.

## Privacy

Quote only short fragments as evidence and keep other people's names and details out of the profile. The profile describes how the user writes, not what they wrote about.
