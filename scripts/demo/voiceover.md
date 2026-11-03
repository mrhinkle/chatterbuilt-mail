# Demo voiceover

One line per beat of `record.js`. Record each line as its own clip, `01.mp3` to `10.mp3`, in one folder, then:

```bash
node scripts/demo/record.js demo-out --voice path/to/clips
```

Each beat holds until its line has finished, so the video runs as long as the narration needs (about 70 seconds). The narrated cut ends with a caption saying the voice is a clone; change that line in `record.js` if you narrate it yourself. Keep the clips out of the repo.

1. **Today:** So this is my inbox. Well, Alex Rivera's. Mine's a crime scene, and I'm not showing you that.
2. **Triage:** Triage sorts everything into what needs me, what's worth reading, and what's noise.
3. **Context panel:** Open a thread and it pulls what my other systems know about this person: meetings, my pipeline, my notes. Right next to the email.
4. **More context:** More context does a web lookup, with sources, but only when I ask.
5. **Next steps and Route:** Next steps tells me where this thread should go. A task, a handoff to my assistant, a reminder. Nothing runs until I say so.
6. **Draft:** Then it drafts the reply in my voice. Not a robot's. Mine.
7. **Pre-send check:** And before I send, it checks the reply against the thread. Here it caught the deck I promised and forgot. Ask me how I know that's a real problem.
8. **Resize:** Every pane resizes.
9. **Attachment:** Attachments open right in the page.
10. **Accounts:** And through Composio, I flip between all my Gmail accounts. It's open source, so if you live in Outlook, fork it and send me a pull request.
