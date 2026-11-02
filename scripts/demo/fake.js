// Made-up data for the screenshots and the demo video. Runs inside the page (Playwright addInitScript),
// so it must stay self-contained: no references to anything outside this function.
// Every person, company, address and number here is fictional. Gmail, Composio, Google Calendar and Claude are all faked.
module.exports = function fake() {
  const now = Date.now(), H = 36e5, D = 864e5, iso = (ms) => new Date(ms).toISOString();
  const b64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  const ME = 'Alex Rivera <alex@riveralabs.example>';
  const mk = (id, from, subject, body, ago, extra) => ({ id, viewUrl: 'https://mail.google.com/' + id, messages: [Object.assign({ id: 'm' + id, sender: from, toRecipients: [ME], date: iso(now - ago), subject, labelIds: ['INBOX', 'UNREAD'], plaintextBody: body, viewUrl: 'https://mail.google.com/m' + id }, extra || {})] });
  const mine = (id, to, subject, body, ago, before) => ({ id, viewUrl: 'https://mail.google.com/' + id, messages: (before || []).concat([{ id: 'm' + id, sender: ME, toRecipients: [to], date: iso(now - ago), subject, labelIds: ['SENT'], plaintextBody: body, viewUrl: 'https://mail.google.com/m' + id }]) });
  const T = {
    t1: mk('t1', 'Dana Ruiz <dana@acmerobotics.example>', 'Sponsorship for the spring summit', 'Hi Alex,\n\nCan we lock the gold package by Friday? What date works for a call next week?\n\nDana Ruiz\nVP Marketing, Acme Robotics\n+1 919 555 0142\nhttps://www.linkedin.com/in/danaruiz-example/\nhttps://x.com/danaruiz_example', 2 * H),
    t2: mk('t2', 'Lee Park <lee@venuehall.example>', 'Venue walkthrough', 'Hi Alex, want to walk the space before we sign? Tuesday or Wednesday morning works on our side.', 5 * H),
    t3: mk('t3', 'Priya Shah <priya@northwind.example>', 'Podcast guest spot in December', 'Would you join us on the Northwind podcast? 30 minutes, recorded remotely.', 9 * H),
    t4: mk('t4', 'Stripe <receipts@stripe.example>', 'Your receipt from Rivera Labs', 'Receipt for $49.00', 11 * H, { labelIds: ['INBOX'] }),
    t5: mk('t5', 'The Weekly Byte <news@weeklybyte.example>', 'This week in AI: agents at work', 'Five stories you missed this week.\n\n1. Agents that file their own tickets\n2. The quiet return of on-prem\n\nUnsubscribe: https://weeklybyte.example/unsubscribe?u=demo', 14 * H, {
      labelIds: ['INBOX'],
      htmlBody: '<div style="font-family:Georgia,serif;max-width:560px"><h1 style="font-size:22px">The Weekly Byte</h1><p>Five stories you missed this week.</p><h2 style="font-size:17px">1. Agents that file their own tickets</h2><p>Support teams are letting agents open, tag and route tickets. <a href="https://weeklybyte.example/agents">Read more</a></p><h2 style="font-size:17px">2. The quiet return of on-prem</h2><p>Why some teams are bringing models back in-house.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Story</th><th>Minutes</th></tr><tr><td>Agents</td><td>4</td></tr><tr><td>On-prem</td><td>6</td></tr></table><img src="https://track.weeklybyte.example/open.gif" width="1" height="1"><p style="font-size:12px"><a href="https://weeklybyte.example/unsubscribe?u=demo">Unsubscribe</a></p><script>alert(1)</script></div>'
    }),
    t6: mk('t6', 'Morgan Lee <morgan@cityworks.example>', 'Intro: Alex, meet Jordan', 'Alex, meet Jordan, who runs the downtown makerspace. I think you two should talk.', 26 * H),
    t7: mk('t7', 'Stripe <receipts@stripe.example>', 'Your receipt from Rivera Labs', 'Receipt for $120.00', 30 * H, { labelIds: ['INBOX'] }),
    t8: mk('t8', 'Cloudway Billing <billing@notify.cloudway.example>', 'Payment received for invoice CW-2026-1142', 'Thanks for your payment. Invoice CW-2026-1142 for Rivera Labs has been paid. The invoice PDF is attached. This mailbox is not monitored.', 32 * H, { labelIds: ['INBOX'] }),
    w1: mine('w1', 'Jordan Blake <jordan@makerspace.example>', 'Re: Space for the March meetup', 'Hi Jordan, could the March meetup use the big room? We expect about 60 people. Happy to cover cleanup. Alex', 5 * D,
      [{ id: 'mw1a', sender: 'Jordan Blake <jordan@makerspace.example>', toRecipients: [ME], date: iso(now - 7 * D), subject: 'Space for the March meetup', labelIds: [], plaintextBody: 'Morgan said you might need a room for your meetup. Happy to talk.' }]),
    s1: mine('s1', 'Sam Ortiz <sam@riveralabs.example>', 'Re: Panel', 'Sam, happy to do the panel. Send the run of show and I will block the time. Alex', 20 * D),
    s2: mine('s2', 'Pat Kim <pat@example.org>', 'Re: Intro', 'Thanks for the intro, Pat. Moving you to bcc. Jo, great to meet you. Does Thursday work? Alex', 30 * D),
    s3: mine('s3', 'Dana Ruiz <dana@acmerobotics.example>', 'Re: Fall meetup', 'Dana, good to meet you at the meetup. Short version: yes, let us talk sponsorship in the new year. Alex', 40 * D)
  };
  const order = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const summ = (id) => { const t = T[id]; const m = t.messages[t.messages.length - 1]; return { id, messageCount: t.messages.length, messages: [{ id: m.id, sender: m.sender, subject: m.subject, toRecipients: m.toRecipients, threadId: id }] }; };
  const DRAFTS = { drafts: [{ id: 'd1', threadId: 't2', plaintextBody: 'Hi Lee, Tuesday at 10 works. See you there. Alex', viewUrl: 'https://mail.google.com/d1' }] };
  const env = (data) => ({ successful: true, data: { results: [{ response: { successful: true, data }, tool_slug: 'X' }] } });
  // Context sources answer by who is being looked up: Dana (a sponsor), Cloudway (a vendor invoice), Jordan (waiting on a reply).
  // Everyone else (newsletters, receipts) gets nothing, so their brief says "Nothing relevant".
  const ctx = (slug, a) => {
    const k = JSON.stringify(a || {});
    if (/cloudway/i.test(k)) return ({
      MEETINGS: { transcripts: [{ title: 'Weekly partnerships sync', date: iso(now - 3 * D), action_items: ['Sam to confirm catering'] }] },
      CALENDAR: { events: [] },
      NOTES: { results: [{ title: 'Sponsor leads: Cloudway (Sam Lin, sam.lin@cloudway.example)', created: '2026-09-05' }, { title: 'Email reply rules', text: 'Sponsors: reply same day. Speakers: send the speaker kit.' }] },
      PIPELINE: { results: [{ name: 'Acme Robotics', stage: 'Proposal', tier: 'Gold' }] },
      MEMORY: ''
    })[slug];
    if (/jordan|makerspace/i.test(k)) return ({
      MEETINGS: { transcripts: [] }, CALENDAR: { events: [] }, NOTES: { results: [] }, PIPELINE: { results: [] },
      MEMORY: 'Jordan Blake runs the downtown makerspace. Morgan Lee introduced Alex to Jordan.'
    })[slug];
    if (/dana|acme/i.test(k)) return ({
      MEETINGS: { transcripts: [{ title: 'Acme sponsorship call', date: iso(now - 12 * D), action_items: ['Alex to send the sponsor deck and gold package terms'] }] },
      CALENDAR: { events: [] },
      NOTES: { results: [] },
      PIPELINE: { results: [{ name: 'Acme Robotics', stage: 'Proposal', tier: 'Gold', owner: 'Alex' }] },
      MEMORY: 'Dana Ruiz: VP Marketing at Acme Robotics; met at the fall meetup; prefers short emails.'
    })[slug];
    return ({ MEETINGS: { transcripts: [] }, CALENDAR: { events: [] }, NOTES: { results: [] }, PIPELINE: { results: [] }, MEMORY: '' })[slug];
  };
  const web = (q) => /company news/.test(q)
    ? [{ title: 'Acme Robotics: warehouse robots for mid-size retailers', url: 'https://acmerobotics.example/about', description: 'Acme Robotics builds warehouse robots for mid-size retailers.' }, { title: 'Acme Robotics opens a Raleigh office', url: 'https://news.example/acme-raleigh', description: 'The company is hiring 40 people in Raleigh this year.' }]
    : [{ title: 'Dana Ruiz, VP Marketing, Acme Robotics', url: 'https://acmerobotics.example/team/dana', description: 'Dana leads marketing and events at Acme Robotics.' }];
  const unsubRaw = b64('List-Unsubscribe: <https://weeklybyte.example/u?x=demo>, <mailto:leave@weeklybyte.example?subject=unsubscribe>\r\nSubject: This week in AI\r\n\r\nbody');
  window.__calls = [];
  const mcp = {
    async listTools() { return { servers: ['Gmail', 'Composio', 'Google Calendar'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input }); await new Promise((r) => setTimeout(r, 120));
      const P = (x) => ({ payload: x });
      if (server === 'Gmail') {
        if (tool === 'search_threads') {
          const q = input.query || '';
          if (/before:/.test(q)) return P({});
          if (q === 'in:sent newer_than:180d') return P({ threads: ['s1', 's2', 's3', 'w1'].map(summ) });
          if (/^in:sent to:/.test(q)) return P({ threads: [summ('s3')] });
          if (/^in:sent/.test(q)) return P({ threads: ['w1', 's1'].map(summ) });
          if (/^label:/.test(q)) return P({});
          if (/unsubscribe/i.test(q)) return P({ threads: ['t5', 't4', 't7'].map(summ) });
          if (/venue|walkthrough/i.test(q)) return P({ threads: [summ('t2')] });
          if (/stripe/i.test(q)) return P({ threads: [summ('t4'), summ('t7')] });
          if (/dana@|acmerobotics/i.test(q)) return P({ threads: [summ('s3'), summ('t1')] });
          return P({ resultCountEstimate: '8', threads: order.map(summ) });
        }
        if (tool === 'get_thread') {
          const t = JSON.parse(JSON.stringify(T[input.threadId]));
          if (input.messageFormat !== 'FULL_CONTENT') t.messages.forEach((m) => { delete m.htmlBody; });
          return P(t);
        }
        if (tool === 'get_message') return P({ id: input.messageId, raw: input.messageId === 'mt5' ? unsubRaw : b64('Subject: x\r\n\r\nbody') });
        if (tool === 'list_drafts') return P(DRAFTS);
        if (tool === 'list_labels') return P({ labels: [{ labelId: 'L1', name: 'Finance', labelType: 'USER' }, { labelId: 'L2', name: 'Sponsors', labelType: 'USER' }, { labelId: 'L3', name: 'Meetup', labelType: 'USER' }, { labelId: 'L4', name: 'Newsletters', labelType: 'USER' }] });
        return P({ id: 'ok' });
      }
      if (server === 'Google Calendar') return P({ events: [
        { status: 'confirmed', summary: 'Weekly partnerships sync', start: { dateTime: iso(now + 2 * H) }, end: { dateTime: iso(now + 2.5 * H) }, attendees: [{ email: 'alex@riveralabs.example', self: true, responseStatus: 'accepted' }, { email: 'sam@riveralabs.example', displayName: 'Sam Ortiz', responseStatus: 'accepted' }] },
        { status: 'confirmed', start: { dateTime: iso(now + D) }, end: { dateTime: iso(now + D + H) } }
      ] });
      if (server === 'Composio') {
        const it = (input.tools || [])[0] || {}; const slug = it.tool_slug;
        if (slug === 'FIRECRAWL_SEARCH') return P(env({ data: { web: web(it.arguments.q) } }));
        const c = ctx(slug, it.arguments); if (c !== undefined) return P(env(c));
        if (slug === 'ASANA_CREATE_A_TASK') return P(env({ data: { gid: '1200000000000001', permalink_url: 'https://app.asana.com/0/0/1200000000000001' } }));
        if (slug === 'NOTION_INSERT_ROW_DATABASE') return P(env({ id: 'demo-page', url: 'https://www.notion.so/demo-page' }));
        return P(env({ ok: true }));
      }
      return P({ ok: true });
    }
  };
  const sample = async (prompt) => {
    await new Promise((r) => setTimeout(r, 700));
    const t = (x) => ({ text: typeof x === 'string' ? x : JSON.stringify(x) });
    const p = String(prompt);
    if (p.includes('This is a follow-up.')) return t('Hi Jordan,\n\nFloating this back up: could the March meetup use the big room? About 60 people, and we\'ll handle cleanup. A yes or no by Friday helps us plan.\n\nAlex');
    if (p.includes('Check the reply against the thread')) return t({ ok: false, issues: [{ severity: 'medium', note: 'You promised the deck on the last call; the reply doesn\'t attach or mention it.' }], revised: 'Hi Dana,\n\nYes to gold. I\'ll send the deck and terms today. Does Tuesday at 10 or Wednesday at 2 work for a call?\n\nAlex' });
    if (p.includes('You triage their inbox')) return t([{ id: 't1', priority: 'reply', why: 'sponsor waiting on a date', action: 'keep' }, { id: 't2', priority: 'reply', why: 'venue needs a time', action: 'keep' }, { id: 't3', priority: 'reply', why: 'podcast invite', action: 'keep' }, { id: 't6', priority: 'read', why: 'warm intro', action: 'keep' }, { id: 't5', priority: 'skip', why: 'newsletter', action: 'archive' }, { id: 't4', priority: 'skip', why: 'receipt', action: 'move', folder: 'Finance' }, { id: 't7', priority: 'skip', why: 'receipt', action: 'move', folder: 'Finance' }, { id: 't8', priority: 'skip', why: 'paid invoice', action: 'move', folder: 'Finance' }]);
    if (p.includes('public web search results')) return t('• VP Marketing at Acme Robotics, which builds warehouse robots for mid-size retailers. [1][2]\n• Acme Robotics is opening a Raleigh office and hiring this year. [3]\n• Worth mentioning: the Raleigh expansion makes the spring summit a good fit for recruiting. [3]');
    if (p.includes('You brief')) {
      if (/cloudway/i.test(p)) return t('• This is an automated payment confirmation from Cloudway for invoice CW-2026-1142, addressed to Rivera Labs. The invoice PDF is attached. No reply is needed. [Email]\n• Meetings and the pipeline have nothing on Cloudway: no meetings, no open commitments, no action items for Alex. [Meetings]\n• The only Cloudway match in Notes is a sponsor-lead page from 2026-09-05 naming a Cloudway contact. It looks like a sales lead, not a billing record, and nothing links it to this invoice. [Notes]\n• Nothing says what the invoice was for (probably a subscription). If you need it for bookkeeping, file the PDF with your records. [Notes]\n• Your "Email reply rules" note doesn\'t cover receipts or automated notices. [Notes]');
      if (/jordan/i.test(p)) return t('• Jordan runs the downtown makerspace; Morgan Lee introduced you. [Memory]\n• You asked about the big room for the March meetup 5 days ago and haven\'t heard back. [Email]');
      return t('• You owe Dana the sponsor deck and gold package terms from the call 12 days ago. [Meetings]\n• Acme Robotics is at Proposal, gold tier. [Pipeline]\n• Met at the fall meetup; prefers short emails. [Memory]\n• No call on the calendar yet. [Calendar]');
    }
    if (p.includes('You route email')) return t({ actions: [{ key: 'task', why: 'deck promised on the last call', fields: { title: 'Send Dana the sponsor deck and gold terms' } }, { key: 'handoff', why: 'needs a call booked', fields: { handoff: 'Can you book a 30-minute call with Dana Ruiz next week?' } }, { key: 'remind', why: 'waiting on her decision', fields: { until: new Date(now + 4 * D).toISOString().slice(0, 10) } }] });
    if (p.includes('For this task, put the replies inside the JSON')) {
      if (/Jordan Blake/.test(p) && !/Dana Ruiz/.test(p)) return t({ needsReply: true, drafts: [{ label: 'Gentle nudge', body: 'Hi Jordan,\n\nFloating this back up: could the March meetup use the big room? About 60 people, and we\'ll handle cleanup.\n\nAlex' }, { label: 'Shorter', body: 'Hi Jordan, any word on the big room for March? Alex' }, { label: 'Offer a call', body: 'Hi Jordan,\n\nEasier to talk? I\'m free Tuesday at 10 or Wednesday at 2.\n\nAlex' }] });
      if (/Lee Park/.test(p) && !/Dana Ruiz/.test(p)) return t({ needsReply: true, drafts: [{ label: 'Best fit', body: 'Hi Lee,\n\nTuesday at 10 works. See you at the front desk.\n\nAlex' }, { label: 'Shorter', body: 'Tuesday at 10 works. Alex' }, { label: 'Polite no', body: 'Hi Lee,\n\nThis week is full. Could we look at next Tuesday instead?\n\nAlex' }] });
      if (/Priya Shah/.test(p) && !/Dana Ruiz/.test(p)) return t({ needsReply: true, drafts: [{ label: 'Best fit', body: 'Hi Priya,\n\nI\'d love to. Send a couple of December dates and I\'ll pick one.\n\nAlex' }, { label: 'Shorter', body: 'Yes, happy to. Send dates. Alex' }, { label: 'Polite no', body: 'Hi Priya,\n\nThanks for thinking of me. December is packed, so I\'ll pass this time.\n\nAlex' }] });
      return t({ needsReply: true, drafts: [{ label: 'Best fit', body: 'Hi Dana,\n\nYes to gold. I\'ll send the deck and terms today. Does Tuesday at 10 or Wednesday at 2 work for a call?\n\nAlex' }, { label: 'Shorter', body: 'Hi Dana, yes to gold. Deck and terms coming today. Tuesday at 10 for a call? Alex' }, { label: 'Polite no', body: 'Hi Dana,\n\nThanks for pushing on this. We can\'t lock gold by Friday, but I can hold it through next week.\n\nAlex' }] });
    }
    if (p.includes('extract contact details')) return t({ name: 'Dana Ruiz', title: 'VP Marketing', company: 'Acme Robotics', phone: '+1 919 555 0142', website: 'https://acmerobotics.example', location: null, linkedin: 'https://www.linkedin.com/in/danaruiz-example/', x: 'https://x.com/danaruiz_example', bluesky: null, github: null, instagram: null });
    if (p.includes('first connected with')) return t('Met at the fall meetup in October 2026; Dana followed up about sponsoring the spring summit.');
    if (p.includes('one Gmail search query')) return t('venue walkthrough');
    if (p.includes('Answer questions about')) return t('Lee offered Tuesday or Wednesday morning for the walkthrough [1]. You have a draft in Gmail saying Tuesday at 10 that hasn\'t been sent yet [1].');
    if (p.includes('write a short voice guide')) return t('Open with their first name, no greeting word.\nKeep it under 80 words; two short paragraphs at most.\nSay yes or no in the first sentence.\nOffer two specific times instead of asking when they\'re free.\nNo exclamation points. Sign off "Alex".');
    if (p.includes('improve an email assistant')) return t('DRAFTING:\n- Cut the opening pleasantry; start with the answer.\n- When a sponsor asks for a call, offer two specific times.\n- Keep replies to sponsors under 80 words.\nTRIAGE:\n- Keep venue and sponsor mail in the inbox, even when it looks routine.\n- Don\'t suggest archiving The Weekly Byte; Alex reads it on Fridays.');
    if (p.includes('suggest email rules')) return t([{ text: 'Receipts from Stripe', op: 'move', folder: 'Finance', from: 'receipts@stripe.example', count: 2, why: 'You file these in Finance' }, { text: 'The Weekly Byte newsletter', op: 'archive', from: 'news@weeklybyte.example', count: 1, why: 'You archive it without opening' }]);
    if (p.includes('email rules. Reply with JSON')) return t([]);
    if (p.includes('Write a 2-3 sentence summary')) return t('Dana wants to lock the gold sponsorship by Friday and set up a call next week.\n• Pick a date and time for the call\n• Confirm gold by Friday');
    if (p.includes('open 30-minute times')) return t('Hi Dana,\n\nYes to gold. I\'m free Tuesday at 10:00 or Wednesday at 2:30 for a call. Either work?\n\nAlex');
    return t('Hi Dana,\n\nYes to gold. Does Tuesday at 10 or Wednesday at 2 work for a call next week?\n\nAlex');
  };
  window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? sample : null) };
};
