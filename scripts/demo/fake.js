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
    t6: mk('t6', 'Morgan Lee <morgan@cityworks.example>', 'Intro: Alex, meet Jordan', 'Alex, meet Jordan, who runs the downtown makerspace. I think you two should talk.', 26 * H, { cc: 'Jordan Blake <jordan@makerspace.example>' }),
    t7: mk('t7', 'Stripe <receipts@stripe.example>', 'Your receipt from Rivera Labs', 'Receipt for $120.00', 30 * H, { labelIds: ['INBOX'] }),
    t8: mk('t8', 'Cloudway Billing <billing@notify.cloudway.example>', 'Payment received for invoice CW-2026-1142', 'Thanks for your payment. Invoice CW-2026-1142 for Rivera Labs has been paid. The invoice PDF is attached. This mailbox is not monitored.', 32 * H, { labelIds: ['INBOX'], attachments: [{ filename: 'CW-2026-1142.pdf', mimeType: 'application/pdf' }] }),
    w1: mine('w1', 'Jordan Blake <jordan@makerspace.example>', 'Re: Space for the March meetup', 'Hi Jordan, could the March meetup use the big room? We expect about 60 people. Happy to cover cleanup. Alex', 5 * D,
      [{ id: 'mw1a', sender: 'Jordan Blake <jordan@makerspace.example>', toRecipients: [ME], date: iso(now - 7 * D), subject: 'Space for the March meetup', labelIds: [], plaintextBody: 'Morgan said you might need a room for your meetup. Happy to talk.' }]),
    s1: mine('s1', 'Sam Ortiz <sam@riveralabs.example>', 'Re: Panel', 'Sam, happy to do the panel. Send the run of show and I will block the time. Alex', 20 * D),
    s2: mine('s2', 'Pat Kim <pat@example.org>', 'Re: Intro', 'Thanks for the intro, Pat. Moving you to bcc. Jo, great to meet you. Does Thursday work? Alex', 30 * D),
    n1: mine('n1', ME, 'Note to self: meetup venues', 'Ask Jordan about the big room. Check the library annex too.', 3 * H),
    s3: mine('s3', 'Dana Ruiz <dana@acmerobotics.example>', 'Re: Fall meetup', 'Dana, good to meet you at the meetup. Short version: yes, let us talk sponsorship in the new year. Alex', 40 * D)
  };
  // A made-up HTML signature: in Gmail's send-as settings (Composio) and on a sent message (the Gmail connector reads it there).
  const SIG = '<table cellpadding="0" cellspacing="0" style="margin:0px"><tbody><tr><td style="padding-right:12px"><a href="https://riveralabs.example/"><img src="https://riveralabs.example/logo.png" alt="Rivera Labs" width="40"></a></td><td><b style="font-size:14px">Alex Rivera</b><br><span style="color:#555">Events lead, Rivera Labs</span><br><a href="mailto:alex@riveralabs.example">alex@riveralabs.example</a> · <a href="https://riveralabs.example/">riveralabs.example</a></td></tr></tbody></table>';
  T.s1.messages[T.s1.messages.length - 1].htmlBody = '<div dir="ltr">Sam, happy to do the panel. Send the run of show and I will block the time.<br><br>Alex<br><br><div class="gmail_signature" data-smartmail="gmail_signature">' + SIG + '</div></div>';
  const order = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  // Tests: window.__newer[threadId] = messageId makes a new message arrive on that thread: the list shows it as the
  // newest and get_thread returns it at the end.
  const summ = (id) => { const t = T[id]; const m = t.messages[t.messages.length - 1]; const nw = (window.__newer || {})[id]; return { id, messageCount: t.messages.length + (nw ? 1 : 0), messages: [{ id: nw || m.id, sender: m.sender, subject: m.subject, toRecipients: m.toRecipients, threadId: id }] }; };
  const search = (q) => {
    if (/before:/.test(q)) return {};
    if (q === 'in:sent newer_than:180d') return { threads: ['s1', 's2', 's3', 'w1'].map(summ) };
    if (/^in:sent to:/.test(q)) return { threads: [summ('s3')] };
    if (/^in:sent/.test(q)) return { threads: ['w1', 's1'].map(summ) };
    if (/^label:/.test(q)) return {};
    if (/unsubscribe/i.test(q)) return { threads: ['t5', 't4', 't7'].map(summ) };
    if (/note to self/i.test(q)) return { threads: [summ('n1')] };
    if (/venue|walkthrough/i.test(q)) return { threads: [summ('t2')] };
    if (/stripe/i.test(q)) return { threads: [summ('t4'), summ('t7')] };
    if (/dana@|acmerobotics/i.test(q)) return { threads: [summ('s3'), summ('t1')] };
    // window.__newIn adds threads to the top of the inbox and window.__gone takes them out (tests of an in-place refresh).
    const ids = (window.__newIn || []).concat(order).filter((id) => !(window.__gone || []).includes(id));
    return { resultCountEstimate: String(ids.length), threads: ids.map(summ) };
  };
  const DRAFTS = { drafts: [{ id: 'd1', threadId: 't2', plaintextBody: 'Hi Lee, Tuesday at 10 works. See you there. Alex', viewUrl: 'https://mail.google.com/d1' }] };
  // The Drafts tab: full drafts by id (get_draft), plus two that aren't replies to anything in the inbox.
  const DRAFT_FULL = {
    d1: { id: 'd1', threadId: 't2', subject: 'Re: Venue walkthrough', toRecipients: ['Lee Park <lee@venuehall.example>'], date: iso(now - H), snippet: 'Hi Lee, Tuesday at 10 works. See you there. Alex', plaintextBody: 'Hi Lee,\n\nTuesday at 10 works. See you there.\n\nAlex', htmlBody: '<div dir="ltr">Hi Lee,<br><br>Tuesday at 10 works. See you there.<br><br>Alex</div>', viewUrl: 'https://mail.google.com/d1' },
    d2: { id: 'd2', subject: 'Keynote at the spring summit?', toRecipients: ['Riley Chen <riley@keynote.example>'], date: iso(now - 2 * H), snippet: 'Riley, your talk on AI agents at the March meetup was the one people kept quoting', plaintextBody: 'Riley,\n\nYour talk on AI agents at the March meetup was the one people kept quoting. Would you keynote the spring summit in April?\n\nAlex', htmlBody: '<p>Riley,</p><p>Your talk on AI agents at the March meetup was the one people kept quoting. Would you keynote the spring summit in <b>April</b>?</p><p>Alex</p>', viewUrl: 'https://mail.google.com/d2' },
    d3: { id: 'd3', threadId: 's2', subject: 'Re: Intro', toRecipients: ['Jo Park <jo@example.org>'], ccRecipients: ['Pat Kim <pat@example.org>'], date: iso(now - 3 * H), snippet: 'Jo, following up on Thursday. Does 2pm still work?', plaintextBody: 'Jo,\n\nFollowing up on Thursday. Does 2pm still work?\n\nAlex', viewUrl: 'https://mail.google.com/d3' }
  };
  // Tests: window.__batchDrafts adds four more drafts for the Drafts tab's batch review: one with no recipient, one
  // empty, one a duplicate of d2, one with a [TK] placeholder. window.__failSend makes sending that draft id fail.
  const BATCH_EXTRA = {
    d4: { id: 'd4', subject: 'Keystone intro', toRecipients: [], date: iso(now - 4 * H), snippet: 'Hi, I run All Things AI and wanted an introduction.', plaintextBody: 'Hi,\n\nI run All Things AI and wanted an introduction.\n\nAlex', viewUrl: 'https://mail.google.com/d4' },
    d5: { id: 'd5', threadId: 't3', subject: 'Re: Thanks', toRecipients: ['Sam Lee <sam@example.org>'], date: iso(now - 5 * H), snippet: '', plaintextBody: '', viewUrl: 'https://mail.google.com/d5' },
    d6: { id: 'd6', subject: 'Keynote at the spring summit?', toRecipients: ['Riley Chen <riley@keynote.example>'], date: iso(now - 6 * H), snippet: 'Riley, quick one: would April work for a keynote?', plaintextBody: 'Riley, quick one: would April work for a keynote?\n\nAlex', viewUrl: 'https://mail.google.com/d6' },
    d7: { id: 'd7', threadId: 't1', subject: 'Re: Gold package', toRecipients: ['Dana Ruiz <dana@acme.example>'], date: iso(now - 7 * H), snippet: 'Dana, yes to gold. The deck is [TK: link] and the invoice follows.', plaintextBody: 'Dana, yes to gold. The deck is [TK: link] and the invoice follows.\n\nAlex', viewUrl: 'https://mail.google.com/d7' }
  };
  const batchMerge = () => { if (window.__batchDrafts && !DRAFT_FULL.d4) Object.assign(DRAFT_FULL, BATCH_EXTRA); };
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
  // A second, personal mailbox for the account switcher (Gmail through Composio).
  const ME2 = 'Alex Rivera <alex.rivera@mail.example>';
  const pmk = (id, from, subject, body, ago, extra) => ({ id, messages: [Object.assign({ id: 'm' + id, sender: from, toRecipients: [ME2], date: iso(now - ago), subject, labelIds: ['INBOX', 'UNREAD'], plaintextBody: body }, extra || {})] });
  const PT = {
    p1: pmk('p1', 'Casey Rivera <casey@family.example>', 'Saturday dinner', 'Still on for Saturday? We can do 6:30 if that works better for you.', 3 * H),
    p2: pmk('p2', 'Library Annex <events@libraryannex.example>', 'Your room booking is confirmed', 'Room B is booked for March 14, 6 to 9 pm. Reply to this email to change it.', 20 * H, { labelIds: ['INBOX'] }),
    p3: pmk('p3', 'Spokeworks <service@spokeworks.example>', 'Your tune-up is ready', 'Your bike is ready for pickup any time before 6.', 2 * D, { labelIds: ['INBOX'] })
  };
  // Gmail through Composio: answer GMAIL_* tools the way Composio does (shapes taken from real responses, data made up).
  const u64 = (v) => btoa(unescape(encodeURIComponent(v))).replace(/\+/g, '-').replace(/\//g, '_');
  const cmsg = (m, tid, full) => {
    const o = { messageId: m.id, threadId: tid, sender: m.sender, to: (m.toRecipients || []).join(', '), subject: m.subject, messageTimestamp: m.date, labelIds: m.labelIds || [], attachmentList: (m.attachments || []).map((x, i) => ({ attachmentId: 'att' + i, filename: x.filename, mimeType: x.mimeType })),
      preview: { body: String(m.plaintextBody || '').replace(/'/g, '&#39;').slice(0, 200), subject: m.subject }, display_url: 'https://mail.google.com/mail/u/0/#inbox/' + tid, messageText: full ? String(m.plaintextBody || '').replace(/\n/g, '\r\n') : '' };
    if (full) o.payload = { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: m.sender }, { name: 'To', value: o.to }, { name: 'Subject', value: m.subject }].concat(m.cc ? [{ name: 'Cc', value: m.cc }] : []).concat(m.inReplyTo ? [{ name: 'In-Reply-To', value: m.inReplyTo }] : []),
      parts: [{ mimeType: 'text/plain', body: { data: u64(m.plaintextBody || '') } }].concat(m.htmlBody ? [{ mimeType: 'text/html', body: { data: u64(m.htmlBody) } }] : []) };
    return o;
  };
  const gmailBridge = (slug, a, account) => {
    const personal = /personal/.test(account || '');
    const box = personal ? PT : T;
    const last = (t) => t.messages[t.messages.length - 1];
    if (slug === 'GMAIL_FETCH_EMAILS' || slug === 'GMAIL_LIST_THREADS') {
      let ids;
      if (personal) ids = /before:|label:|in:sent/.test(a.query || '') ? [] : ['p1', 'p2', 'p3'];
      else ids = (search(a.query || '').threads || []).map((t) => t.id);
      // Pages like Gmail's: max_results per page, an opaque token for the next one (window.__pageMax caps it in tests).
      const total = ids.length, off = +(a.page_token || 0) || 0, max = Math.min(a.max_results || 500, window.__pageMax || 500);
      ids = ids.slice(off, off + max); const next = off + ids.length < total ? String(off + ids.length) : undefined;
      if (slug === 'GMAIL_LIST_THREADS') return { threads: ids.map((id) => ({ id, historyId: '1', snippet: String(last(box[id]).plaintextBody || '').slice(0, 120) })), nextPageToken: next, resultSizeEstimate: total };
      return { messages: ids.map((id) => cmsg(last(box[id]), id, false)), nextPageToken: next, resultSizeEstimate: total };
    }
    // Like Gmail: a thread asked of the wrong account, or one in window.__gone404 (deleted), is a 404.
    if (slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID') { const t = box[a.thread_id]; if (t && !(window.__gone404 || []).includes(a.thread_id)) return { threadId: t.id, display_url: '', messages: t.messages.map((m) => cmsg(m, t.id, true)) }; if ((personal ? T : PT)[a.thread_id] || (window.__gone404 || []).includes(a.thread_id)) return { __404: a.thread_id }; return { messages: [] }; }
    if (slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID' && a.format === 'raw') return { messageId: a.message_id, raw: a.message_id === 'mt8' ? cwRaw : b64('Subject: x\r\n\r\nbody') };
    if (slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID') return { messageId: a.message_id, payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: 'x' }].concat(a.message_id === 'mt5' ? [{ name: 'List-Unsubscribe', value: '<https://weeklybyte.example/u?x=demo>, <mailto:leave@weeklybyte.example?subject=unsubscribe>' }] : []) } };
    if (slug === 'GMAIL_LIST_LABELS') return { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }].concat((personal ? ['Family', 'Bikes'] : ['Finance', 'Sponsors', 'Meetup', 'Newsletters']).map((n, i) => ({ id: 'L' + (i + 1), name: n, type: 'user' }))) };
    if (slug === 'GMAIL_LIST_SEND_AS') return { sendAs: personal ? [{ sendAsEmail: 'alex.rivera@mail.example', isPrimary: true, isDefault: true, signature: '' }] : [{ sendAsEmail: 'alex@riveralabs.example', isPrimary: true, isDefault: true, signature: window.__noSig ? '' : SIG }, { sendAsEmail: 'events@riveralabs.example', signature: '' }] };
    // Tests: window.__draftOrder gives the personal account a newer draft (dp1), so the merged list has to sort by date.
    if (slug === 'GMAIL_LIST_DRAFTS') return { drafts: personal ? (window.__draftOrder ? [{ id: 'dp1', message: { id: 'mdp1', threadId: 'p1' } }] : []) : [{ id: 'd1', message: { id: 'md1', threadId: 't2' } }].filter((d) => !(window.__deletedDrafts || []).includes(d.id)) };
    if (slug === 'GMAIL_GET_DRAFT' && a.draft_id === 'dp1') return { id: 'dp1', message: cmsg({ id: 'mdp1', sender: 'Alex Rivera <alex.rivera@mail.example>', toRecipients: ['Sam Lee <sam@mail.example>'], date: iso(now - 600000), subject: 'Re: Bike ride Saturday', labelIds: ['DRAFT'], plaintextBody: 'Sam, 8am at the trailhead works. Alex' }) };
    if (slug === 'GMAIL_DELETE_DRAFT') { (window.__deletedDrafts = window.__deletedDrafts || []).push(a.draft_id); return {}; }
    // window.__htmlOnlyDraft: a draft saved as HTML only, the way Gmail returns many through Composio: one text/html
    // payload, and the same HTML (entities and all) in messageText.
    if (slug === 'GMAIL_GET_DRAFT' && window.__attDraft && (a.draft_id === 'd1' || !a.draft_id)) return attDraftGx();
    if (slug === 'GMAIL_UPDATE_DRAFT' && window.__attDraft && a.draft_id === 'd1') { window.__attSaved = a.attachment || []; window.__attSavedHtml = a.body || ''; return { id: 'd1', message: { id: 'md1c' } }; }
    if (slug === 'GMAIL_GET_ATTACHMENT') { if (window.__failCopy) return { __fail: 'attachment not found' }; return { file: { name: a.file_name, mimetype: 'application/pdf', s3url: 'https://temp.demo.r2.cloudflarestorage.com/project_scope/demo/files/' + a.attachment_id + '.bin?X-Amz-Signature=x' } }; }
    if (slug === 'GMAIL_GET_DRAFT' && window.__outlookDraft && (a.draft_id === 'd1' || !a.draft_id)) return outlookDraft();
    if (slug === 'GMAIL_GET_DRAFT' && window.__htmlOnlyDraft) {
      const html = 'Hi Lee,<br><br>Thanks for the walkthrough. We&#x27;re set for Thursday at 10, and I&#x27;ll bring the floor plan.<br><br>Best,<br>Sam<br><br><div class="gmail_signature" data-smartmail="gmail_signature"><table cellpadding="0" cellspacing="0" style="margin:0px"><tbody><tr><td style="font-family:Inter,sans-serif;font-size:10px">Sam Rivera &middot; Rivera Labs</td></tr></tbody></table></div>';
      return { id: 'd1', message: { messageId: 'md1', threadId: 't2', sender: ME, to: 'Lee Park <lee@venuehall.example>', subject: 'Re: Venue walkthrough', messageTimestamp: iso(now - H), labelIds: ['DRAFT'], attachmentList: [], preview: { body: 'Hi Lee, Thanks for the walkthrough. We&#39;re set for Thursday at 10', subject: 'Re: Venue walkthrough' }, messageText: html, payload: { mimeType: 'text/html', filename: '', partId: '', headers: [{ name: 'From', value: ME }, { name: 'To', value: 'Lee Park <lee@venuehall.example>' }, { name: 'Subject', value: 'Re: Venue walkthrough' }], body: { data: u64(html), size: html.length } } } };
    }
    if (slug === 'GMAIL_GET_DRAFT') return { id: 'd1', message: cmsg({ id: 'md1', sender: ME, toRecipients: ['Lee Park <lee@venuehall.example>'], date: iso(now - H), subject: 'Re: Venue walkthrough', labelIds: ['DRAFT'], inReplyTo: '<walkthrough-1@venuehall.example>', plaintextBody: DRAFTS.drafts[0].plaintextBody }, 't2', true) };
    return { id: 'ok' };
  };
  // The Cloudway invoice as a raw message with a (made-up) PDF attached, for the attachment viewer.
  const INVOICE_PDF = 'JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChhbm9ueW1vdXMpIC9DcmVhdGlvbkRhdGUgKEQ6MjAyNjExMDIxODQyNDktMDUnMDAnKSAvQ3JlYXRvciAoYW5vbnltb3VzKSAvS2V5d29yZHMgKCkgL01vZERhdGUgKEQ6MjAyNjExMDIxODQyNDktMDUnMDAnKSAvUHJvZHVjZXIgKFJlcG9ydExhYiBQREYgTGlicmFyeSAtIFwob3BlbnNvdXJjZVwpKSAKICAvU3ViamVjdCAodW5zcGVjaWZpZWQpIC9UaXRsZSAoQ2xvdWR3YXkgaW52b2ljZSBDVy0yMDI2LTExNDIpIC9UcmFwcGVkIC9GYWxzZQo+PgplbmRvYmoKNyAwIG9iago8PAovQ291bnQgMSAvS2lkcyBbIDQgMCBSIF0gL1R5cGUgL1BhZ2VzCj4+CmVuZG9iago4IDAgb2JqCjw8Ci9GaWx0ZXIgWyAvQVNDSUk4NURlY29kZSAvRmxhdGVEZWNvZGUgXSAvTGVuZ3RoIDY2OQo+PgpzdHJlYW0KR2F0JHViQVEmZyZBNzxaaylfcUMsVjZLUkxxOiE7aCZuc1woVEdiZkVoUCkpOzUmYWdlI0U2PUtkOS9jU1tvPTsrRVo4LFJAU2EzRSxeWCQ/J2A4T2BMQEE+SnJpL10uJk4qX0AkWDhVLipXRDUtRVNTbl8lSUM3LFxVNFUiY2VyYE4kJ0FjTlE4cV4sZ18iYi5kQCE/VWZwJGhiakdLWmwoMW0/LyZZPS8vVEVnJ2w+PzdOckFbMUAlSSpbUFlZdWYuNz9aJjYhJHNLOSchXkY6YVMhUyxvQllXTGUkIytWYV1vMUhrWj5QQzskZ2lnNzgsbEMtXlNKVS1QTCIoJS8lSXJPUSQ8bmE9KlxOaD9lKFkwZWpNQFw0RmlCZWl1YVYkSD5uNDJUXmxvQiplMjEoIydvXGRpbU4uOlZMaFlFSnIqMWxZQyIsa1tJaVZHQWlzJ1RsPm8hby9nJFYkXC03cj03dDtAbEpNS2BaSDpdQVlIJm8nX0QlaEpPUlRFU1tvRjpCQlNBQHFKNkFqIzsuLWdrb140My8zaTYjUUtcIVUvLytFP1ZoOWdPKjk2ZE5zK2c0b184QS1PWS9tTywtZStrYWErT2s3dExESmQ+KkBvJmA7SipeLStqTHRnN2lnNFk9ZT4iSWowL2k0aiZXbWppNCwzcWFXZV4iVGNzKHMqQUksPyY6WlRrcGtwPGZIPFVtX25VPC4+M2ssNixRWTQ+RzxRbXVQaV9TYzdga0RJRjgmcEJqQiFROUxIb1ZbL2BFWGVmUG8pJTliSV9uYl5ZR3VTPSYzdFFvUVs7UktMXypmVUM0bXNNZXVjJ2dxKC1gazAnNFBxJ3MwWykrSHQoZixnRS9mYWFdK2ZMUkViVERKKCZJZn4+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMjA5IDAwMDAwIG4gCjAwMDAwMDAzMjEgMDAwMDAgbiAKMDAwMDAwMDUxNCAwMDAwMCBuIAowMDAwMDAwNTgyIDAwMDAwIG4gCjAwMDAwMDA4NjQgMDAwMDAgbiAKMDAwMDAwMDkyMyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxmM2YyNmFkNzZhNGQwOGVhMjQzYjlmNTE3ZTJjODhkYj48ZjNmMjZhZDc2YTRkMDhlYTI0M2I5ZjUxN2UyYzg4ZGI+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDYgMCBSCi9Sb290IDUgMCBSCi9TaXplIDkKPj4Kc3RhcnR4cmVmCjE2ODIKJSVFT0YK';
  const cwRaw = b64('From: Cloudway Billing <billing@notify.cloudway.example>\r\nTo: Alex Rivera <alex@riveralabs.example>\r\nSubject: Payment received for invoice CW-2026-1142\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="cwb"\r\n\r\n--cwb\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nThanks for your payment.\r\n--cwb\r\nContent-Type: application/pdf; name="CW-2026-1142.pdf"\r\nContent-Disposition: attachment; filename="CW-2026-1142.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + INVOICE_PDF.replace(/(.{76})/g, '$1\r\n') + '\r\n--cwb--\r\n');
  const unsubRaw = b64('List-Unsubscribe: <https://weeklybyte.example/u?x=demo>, <mailto:leave@weeklybyte.example?subject=unsubscribe>\r\nSubject: This week in AI\r\n\r\nbody');
  // Tests: window.__outlookDraft makes d1 a reply started in Outlook mobile and synced to Gmail, the shape Gmail returns
  // for one: no text yet, Outlook's separator and signature (tables and pictures), and Outlook's quoted-history container.
  const OUTLOOK_HTML = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'
    + '<div style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);"><br></div>'
    + '<div id="ms-outlook-mobile-body-separator-line" dir="ltr"><br></div>'
    + '<div id="ms-outlook-mobile-signature" dir="ltr"><table cellspacing="0" cellpadding="0" border="0"><tbody><tr><td><a href="https://riveralabs.example/">Website</a> · <a href="https://www.linkedin.com/in/alexrivera-demo/">LinkedIn</a></td></tr>'
    + '<tr><td><img src="https://riveralabs.example/logo.png" alt="Rivera Labs" width="120" height="40"></td></tr><tr><td style="font-family:Arial;font-size:12px;color:#555555">Alex Rivera · Founder, Rivera Labs · 919.555.0100</td></tr></tbody></table></div>'
    + '<div><br></div><div id="mail-editor-reference-message-container"><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Lee Park &lt;lee@venuehall.example&gt;<br><b>Sent:</b> Monday, November 2, 2026 7:46 PM<br><b>Subject:</b> Venue walkthrough</div>'
    + '<div>Hi Alex, want to walk the space before we sign? Tuesday or Wednesday morning works on our side.</div></div></body></html>';
  const OUTLOOK_TEXT = '\r\n\r\n[Website]<https://riveralabs.example/>\r\n[LinkedIn]<https://www.linkedin.com/in/alexrivera-demo/>\r\n[Rivera Labs]\r\nAlex Rivera · Founder, Rivera Labs · 919.555.0100\r\n________________________________\r\nFrom: Lee Park <lee@venuehall.example>\r\nSent: Monday, November 2, 2026 7:46 PM\r\n\r\nHi Alex, want to walk the space before we sign?';
  const outlookDraft = () => ({ id: 'd1', message: { messageId: 'md1', threadId: 't2', sender: ME, to: 'Lee Park <lee@venuehall.example>', subject: 'Re: Venue walkthrough', messageTimestamp: iso(now - H), labelIds: ['DRAFT'], attachmentList: [], preview: { body: 'Website LinkedIn Alex Rivera Founder', subject: 'Re: Venue walkthrough' }, messageText: OUTLOOK_TEXT,
    payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: 'Re: Venue walkthrough' }, { name: 'To', value: 'Lee Park <lee@venuehall.example>' }], parts: [{ mimeType: 'text/plain', body: { data: u64(OUTLOOK_TEXT) } }, { mimeType: 'text/html', body: { data: u64(OUTLOOK_HTML) } }] } } });
  // Tests: window.__attDraft gives a draft a PDF, a logo inside the email (cid:logo1) and a 0x0 spacer (cid:spacer1):
  // d2 through the Gmail connector (its raw MIME too), d1 through Composio.
  const ATT_HTML = '<div dir="ltr">Riley, the deck is attached.<br><br>Alex</div><div class="gmail_signature" data-smartmail="gmail_signature"><div>Alex Rivera</div><img src="cid:logo1" width="120" height="40" alt="Rivera Labs"><img src="cid:spacer1" width="0" height="0"></div>';
  const ATT_RAW = 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="mx"\r\n\r\n--mx\r\nContent-Type: multipart/related; boundary="rl"\r\n\r\n--rl\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + ATT_HTML + '\r\n--rl\r\nContent-Type: image/png; name="logo.png"\r\nContent-Disposition: inline; filename="logo.png"\r\nContent-ID: <logo1>\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgoAAAANSUhEUg==\r\n--rl\r\nContent-Type: image/gif; name="inline_image"\r\nContent-Disposition: inline; filename="inline_image"\r\nContent-ID: <spacer1>\r\nContent-Transfer-Encoding: base64\r\n\r\nR0lGODlhAQABAAAAACw=\r\n--rl--\r\n--mx\r\nContent-Type: application/pdf; name="deck.pdf"\r\nContent-Disposition: attachment; filename="deck.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQKJcfsj6IK\r\n--mx--\r\n';
  const ATT_META = [{ id: 'A1', filename: 'deck.pdf', mimeType: 'application/pdf' }, { id: 'A2', filename: 'logo.png', mimeType: 'image/png' }, { id: 'A3', filename: 'inline_image', mimeType: 'image/gif' }];
  const attDraftGx = () => window.__attSaved ? { id: 'd1', message: { messageId: 'md1c', threadId: 't2', sender: ME, to: 'Lee Park <lee@venuehall.example>', subject: 'Re: Venue walkthrough', messageTimestamp: iso(now - H), labelIds: ['DRAFT'],
    attachmentList: window.__attSaved.map((a, i) => ({ attachmentId: 'S' + i, filename: a.name, mimeType: a.mimetype })), preview: { body: 'Riley, the deck is attached.', subject: 'Re: Venue walkthrough' }, messageText: 'Riley, the deck is attached.',
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Re: Venue walkthrough' }], parts: [{ mimeType: 'text/html', body: { data: u64(window.__attSavedHtml || '') } }].concat(window.__attSaved.map((a, i) => ({ mimeType: a.mimetype, filename: a.name, headers: [], body: { attachmentId: 'S' + i, size: 10 } }))) } } }
    : ({ id: 'd1', message: { messageId: 'md1b', threadId: 't2', sender: ME, to: 'Lee Park <lee@venuehall.example>', subject: 'Re: Venue walkthrough', messageTimestamp: iso(now - H), labelIds: ['DRAFT'],
    attachmentList: ATT_META.map((a) => ({ attachmentId: a.id, filename: a.filename, mimeType: a.mimeType })), preview: { body: 'Riley, the deck is attached.', subject: 'Re: Venue walkthrough' }, messageText: 'Riley, the deck is attached.\n\nAlex',
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Re: Venue walkthrough' }, { name: 'To', value: 'Lee Park <lee@venuehall.example>' }], parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'text/html', body: { data: u64(ATT_HTML) } },
      { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo1>' }], body: { attachmentId: 'A2', size: 16 } }, { mimeType: 'image/gif', filename: 'inline_image', headers: [{ name: 'Content-ID', value: '<spacer1>' }], body: { attachmentId: 'A3', size: 14 } }] },
      { mimeType: 'application/pdf', filename: 'deck.pdf', headers: [], body: { attachmentId: 'A1', size: 15 } }] } } });
  // Composio shortens big replies: past window.__offloadAt characters (about 8K tokens) only a preview comes back and
  // the full response goes to a file in its sandbox, for COMPOSIO_REMOTE_BASH_TOOL to read. A test harness can back
  // that sandbox with a real folder and real bash and jq (window.__sbWrite and window.__bash); without one, bash fails.
  let offN = 0;
  const offload = async (res) => {
    if (!res || !res.data || !Array.isArray(res.data.results) || JSON.stringify(res).length <= (window.__offloadAt || 32000)) return res;
    const file = '/mnt/files/mex/f' + (++offN) + '.json';
    if (window.__sbWrite) await window.__sbWrite(file, JSON.stringify({ results: res.data.results.map((r, i) => ({ response: r.response, tool_slug: r.tool_slug, index: i })) }));
    return { successful: true, data: { results: res.data.results.map((r, i) => ({ response: { successful: true, data_preview: { note: '...more items' } }, tool_slug: r.tool_slug, index: i, structure_info: {} })), total_count: 1, remote_file_info: { message: 'Complete response was large. Full data saved to sandbox in ' + file + '.', file_path: file } }, error: null };
  };
  const bashTool = async (command) => {
    // Upload pieces: kept here when there's no real sandbox, for the workbench stand-in below.
    const up = /^mkdir -p (\/mnt\/files\/cbup\/\w+) && printf '%s' '([A-Za-z0-9+\/=]*)' > \1\/(p\d+)$/.exec(command);
    if (up && !window.__bash) { const m = (window.__cbup = window.__cbup || {}); (m[up[1]] = m[up[1]] || {})[up[3]] = up[2]; return { successful: true, data: { stdout: '', stderr: '' }, error: null }; }
    if (!window.__bash) return { successful: false, data: { stdout: '', stderr: 'no sandbox in this demo' }, error: 'no sandbox' };
    const r = await window.__bash(command);
    if (r.stdout.length > 45000) return { successful: true, data: { stdout: r.stdout.slice(0, 2000) + '\n... (output truncated, full output saved to: /mnt/files/.composio/output/bash_x_stdout.txt)', stdout_file_path: '/mnt/files/.composio/output/bash_x_stdout.txt', stderr: r.stderr }, error: null };
    return { successful: true, data: { stdout: r.stdout, stdoutLines: r.stdout.split('\n').length, stderr: r.stderr, sandbox_id_suffix: 'demo' }, error: null };
  };
  window.__calls = [];
  const mcp = {
    async listTools() { return { servers: ['Gmail', 'Composio', 'Google Calendar'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input }); await new Promise((r) => setTimeout(r, 120));
      const P = (x) => ({ payload: x });
      if (server === 'Gmail') {
        if (tool === 'search_threads') { if (window.__failSearch) throw Object.assign(new Error('Gmail is not answering'), { code: 'upstream_error' }); return P(search(input.query || '')); }
        if (tool === 'get_thread') {
          const t = JSON.parse(JSON.stringify(T[input.threadId]));
          // Tests: window.__mailHtml[threadId] replaces the last message's HTML; window.__extraMsg[threadId] adds a
          // message (or a list of them) to the end (a reply that just arrived), copying the last one with the fields given.
          if (window.__mailHtml && window.__mailHtml[input.threadId]) t.messages[t.messages.length - 1].htmlBody = window.__mailHtml[input.threadId];
          if (window.__extraMsg && window.__extraMsg[input.threadId]) [].concat(window.__extraMsg[input.threadId]).forEach((x) => t.messages.push(Object.assign({}, t.messages[t.messages.length - 1], { date: new Date().toISOString() }, x)));
          if (window.__newer && window.__newer[input.threadId]) t.messages.push(Object.assign({}, t.messages[t.messages.length - 1], { id: window.__newer[input.threadId], date: new Date().toISOString(), plaintextBody: 'A newer message on this thread.', htmlBody: '<p>A newer message on this thread.</p>' }));
          if (input.messageFormat !== 'FULL_CONTENT') t.messages.forEach((m) => { delete m.htmlBody; });
          return P(t);
        }
        if (tool === 'get_message') return P({ id: input.messageId, raw: input.messageId === 'mt5' ? unsubRaw : input.messageId === 'mt8' ? cwRaw : b64('Subject: x\r\n\r\nbody') });
        if (tool === 'list_drafts') {
          batchMerge(); const gone = (id) => (window.__sentDrafts || []).includes(id) || (window.__deletedDrafts || []).includes(id);
          if ((input || {}).view === 'DRAFT_VIEW_METADATA_ONLY' && window.__draftsTab !== false) return P({ drafts: Object.values(DRAFT_FULL).filter((d) => !gone(d.id)).map((d) => ({ id: d.id, threadId: d.threadId, toRecipients: d.toRecipients, ccRecipients: d.ccRecipients, date: d.date, viewUrl: d.viewUrl })) });
          return P({ drafts: DRAFTS.drafts.filter((d) => !gone(d.id)) });
        }
        if (tool === 'get_draft' && window.__attDraft && (input || {}).draftId === 'd2' && (input || {}).messageFormat !== 'MINIMAL') {
          if (input.messageFormat === 'RAW') { if (window.__failRaw) throw Object.assign(new Error('Gmail is not answering'), { code: 'upstream_error' }); return P({ id: 'd2', raw: b64(unescape(encodeURIComponent(ATT_RAW))) }); }
          return P(Object.assign({}, DRAFT_FULL.d2, { htmlBody: ATT_HTML, attachments: ATT_META.map((x) => ({ id: x.id, filename: x.filename, mimeType: x.mimeType })) }));
        }
        // Tests: window.__draftHtml[id] gives a draft this HTML.
        if (tool === 'get_draft' && window.__draftHtml && window.__draftHtml[(input || {}).draftId] && (input || {}).messageFormat !== 'MINIMAL') return P(Object.assign({}, DRAFT_FULL[input.draftId], { htmlBody: window.__draftHtml[input.draftId] }));
        if (tool === 'get_draft' && window.__outlookDraft && (input || {}).draftId === 'd1' && (input || {}).messageFormat !== 'MINIMAL') return P(Object.assign({}, DRAFT_FULL.d1, { htmlBody: OUTLOOK_HTML, plaintextBody: OUTLOOK_TEXT.replace(/\r\n/g, '\n') }));
        if (tool === 'get_draft') { const d = DRAFT_FULL[(input || {}).draftId]; if (!d) return P({}); if ((input || {}).messageFormat === 'MINIMAL') { const m = Object.assign({}, d); delete m.plaintextBody; delete m.htmlBody; return P(m); } return P(d); }
        if (tool === 'update_draft') { const d = DRAFT_FULL[(input || {}).draftId]; if (d) { if (input.htmlBody) d.htmlBody = input.htmlBody; if (input.body) d.plaintextBody = input.body; if (input.subject) d.subject = input.subject; if (input.to) d.toRecipients = input.to; } return P({ id: input.draftId }); }
        if (tool === 'delete_draft') {
          // Tests: window.__slowDelete waits that many ms; window.__delete404 answers like Gmail for a draft that's already gone.
          if (window.__slowDelete) await new Promise((r) => setTimeout(r, window.__slowDelete));
          if (window.__delete404) throw Object.assign(new Error('Requested entity was not found.'), { code: 'tool_error' });
          if (window.__failDelete) throw Object.assign(new Error('Gmail is not answering'), { code: 'upstream_error' }); (window.__deletedDrafts = window.__deletedDrafts || []).push((input || {}).draftId); return P({}); }
        if (tool === 'send_message' && (input || {}).draftId) { if (window.__failSend === input.draftId) throw Object.assign(new Error('Gmail is not answering'), { code: 'upstream_error' }); (window.__sentDrafts = window.__sentDrafts || []).push(input.draftId); return P({ id: 'sent-' + input.draftId, threadId: (DRAFT_FULL[input.draftId] || {}).threadId || 'new', labelIds: ['SENT'] }); }
        if (tool === 'list_labels') return P({ labels: [{ labelId: 'L1', name: 'Finance', labelType: 'USER' }, { labelId: 'L2', name: 'Sponsors', labelType: 'USER' }, { labelId: 'L3', name: 'Meetup', labelType: 'USER' }, { labelId: 'L4', name: 'Newsletters', labelType: 'USER' }] });
        return P({ id: 'ok' });
      }
      if (server === 'Google Calendar') return P({ events: [
        { status: 'confirmed', summary: 'Weekly partnerships sync', start: { dateTime: iso(now + 2 * H) }, end: { dateTime: iso(now + 2.5 * H) }, attendees: [{ email: 'alex@riveralabs.example', self: true, responseStatus: 'accepted' }, { email: 'sam@riveralabs.example', displayName: 'Sam Ortiz', responseStatus: 'accepted' }] },
        { status: 'confirmed', start: { dateTime: iso(now + D) }, end: { dateTime: iso(now + D + H) } }
      ] });
      if (server === 'Composio') {
        if (tool === 'COMPOSIO_REMOTE_WORKBENCH') {
          // Stand-in for the upload: put the pieces back together and hand back a key, as upload_local_file does.
          const code = String((input || {}).code_to_execute || ''); const dir = (/d = "([^"]+)"/.exec(code) || [])[1]; const name = (/os\.path\.join\(d, "([^"]+)"\)/.exec(code) || [])[1];
          const parts = ((window.__cbup || {})[dir]) || {}; const b = Object.keys(parts).sort().map((k) => parts[k]).join('');
          if (window.__failUpload || !dir || !name) return P({ successful: true, data: { stdout: 'CBUP' + JSON.stringify({ k: null, e: 'upload failed' }), stderr: '' } });
          (window.__uploads = window.__uploads || []).push({ name: name, b64: b });
          return P({ successful: true, data: { stdout: 'CBUP' + JSON.stringify({ k: 'session_scope/demo/files/' + name, e: '' }), stderr: '' } });
        }
        if (tool === 'COMPOSIO_REMOTE_BASH_TOOL') return P(await bashTool(String((input || {}).command || '')));
        const it = (input.tools || [])[0] || {}; const slug = it.tool_slug;
        if (/^GMAIL_/.test(slug)) {
          if ((window.__failSearch && /^GMAIL_(FETCH_EMAILS|LIST_THREADS)$/.test(slug)) || (window.__failDelete && slug === 'GMAIL_DELETE_DRAFT')) return P({ successful: false, data: { results: [{ response: { successful: false, data: {}, error: 'Gmail is not answering' }, tool_slug: slug }] } });
          const r = gmailBridge(slug, it.arguments || {}, it.account);
          if (r && r.__fail) return P({ successful: false, data: { results: [{ response: { successful: false, data: {}, error: r.__fail }, tool_slug: slug }] } });
          if (r && r.__404) return P({ successful: false, data: { results: [{ response: { successful: false, data: { http_error: '404 Client Error: Not Found for url: https://gmail.googleapis.com/gmail/v1/users/me/threads/' + r.__404, message: '{\n  "error": {\n    "code": 404,\n    "message": "Requested entity was not found.",\n    "status": "NOT_FOUND"\n  }\n}' }, error: '404 Client Error: Not Found' }, tool_slug: slug }] } });
          return P(await offload(env(r)));
        }
        if (slug === 'FIRECRAWL_SEARCH') return P(env({ data: { web: web(it.arguments.q) } }));
        const c = ctx(slug, it.arguments); if (c !== undefined) return P(env(c));
        if (slug === 'ASANA_CREATE_A_TASK') return P(env({ data: { gid: '1200000000000001', permalink_url: 'https://app.asana.com/0/0/1200000000000001' } }));
        if (slug === 'NOTION_INSERT_ROW_DATABASE') return P(env({ id: 'demo-page', url: 'https://www.notion.so/demo-page' }));
        if (/^GOOGLECONTACTS_/.test(slug) && window.__gcDown) return P({ successful: true, data: { results: [{ response: { successful: false, data: {}, error: 'No Active connection for toolkit=googlecontacts' }, tool_slug: slug }] } });
        if (slug === 'GOOGLECONTACTS_SEARCH_CONTACTS') {
          const q = String((it.arguments || {}).query || '').toLowerCase();
          const book = [['Sam Ortiz', 'sam@riveralabs.example'], ['Taylor Brooks', 'taylor@riveralabs.example'], ['Priya Shah', 'priya@northwind.example'], ['Morgan Lee', 'morgan@cityworks.example']];
          return P(env({ results: q ? book.filter((b) => b[0].toLowerCase().includes(q) || b[1].includes(q)).map((b, i) => ({ person: { resourceName: 'people/c10' + i, names: [{ displayName: b[0] }], emailAddresses: [{ value: b[1] }] } })) : [] }));
        }
        if (slug === 'GOOGLECONTACTS_CREATE_CONTACT') return P(env({ resourceName: 'people/c4242424242', etag: 'demo' }));
        if (slug === 'APOLLO_PEOPLE_ENRICHMENT') return P(env({ person: { name: 'Dana Ruiz', title: 'VP Marketing', headline: 'VP Marketing at Acme Robotics', linkedin_url: 'https://www.linkedin.com/in/danaruiz-demo', city: 'Raleigh', state: 'North Carolina', organization: { name: 'Acme Robotics', website_url: 'https://acmerobotics.example' }, employment_history: [{ title: 'VP Marketing', organization_name: 'Acme Robotics', start_date: '2023-02-01', current: true }, { title: 'Director of Developer Marketing', organization_name: 'Fieldline Systems', start_date: '2018-05-01', end_date: '2023-01-31' }] } }));
        return P(env({ ok: true }));
      }
      if (server === 'Slack') {
        if (tool === 'slack_search_users') return P({ results: [{ user_id: 'U07SAMORTIZ', name: 'Sam Ortiz', title: 'Events lead' }] });
        if (tool === 'slack_search_channels') return P({ results: [{ id: 'C07EVENTS01', name: 'events' }] });
        if (tool === 'slack_send_message_draft') return P({ channel_link: 'https://app.slack.com/client/T000/' + (input || {}).channel_id });
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
    if (p.includes('You triage their inbox')) return t([
      { id: 't1', priority: 'reply', why: 'sponsor waiting on a date', next: { do: 'reply', intent: 'yes', hint: 'Yes to gold by Friday; offer Tuesday or Wednesday for a call' } },
      { id: 't2', priority: 'reply', why: 'venue needs a time', next: { do: 'route', route: 'handoff' } },
      { id: 't3', priority: 'reply', why: 'podcast invite', next: { do: 'reply', intent: 'ask', hint: 'Ask the recording date and who listens' } },
      { id: 't6', priority: 'read', why: 'warm intro', next: { do: 'contact' } },
      { id: 't5', priority: 'skip', why: 'newsletter', next: { do: 'unsub' } },
      { id: 't4', priority: 'skip', why: 'receipt', next: { do: 'move', folder: 'Finance' } },
      { id: 't7', priority: 'skip', why: 'receipt', next: { do: 'move', folder: 'Finance' } },
      { id: 't8', priority: 'skip', why: 'paid invoice', next: { do: 'archive' } }]);
    if (p.includes('public web search results')) return t('• VP Marketing at Acme Robotics, which builds warehouse robots for mid-size retailers. [1][2]\n• Acme Robotics is opening a Raleigh office and hiring this year. [3]\n• Worth mentioning: the Raleigh expansion makes the spring summit a good fit for recruiting. [3]');
    if (p.includes('You brief')) {
      if (/cloudway/i.test(p)) return t('• This is an automated payment confirmation from Cloudway for invoice CW-2026-1142, addressed to Rivera Labs. The invoice PDF is attached. No reply is needed. [Email]\n• Meetings and the pipeline have nothing on Cloudway: no meetings, no open commitments, no action items for Alex. [Meetings] [Pipeline]\n• The only Cloudway match in Notes is a sponsor-lead page from 2026-09-05 naming a Cloudway contact. It looks like a sales lead, not a billing record, and nothing links it to this invoice. [Notes]\n• Nothing says what the invoice was for (probably a subscription). If you need it for bookkeeping, file the PDF with your records. [Notes]\n• Your "Email reply rules" note doesn\'t cover receipts or automated notices. [Notes]');
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
    if (p.includes('You map person-enrichment data')) return t({ title: 'VP Marketing', company: 'Acme Robotics', location: 'Raleigh, North Carolina', linkedin: 'https://www.linkedin.com/in/danaruiz-demo', background: 'VP Marketing at Acme Robotics since 2023, leading partnerships and events. Before that, five years running developer marketing at Fieldline Systems.' });
    if (p.includes('first connected with')) return t('Met at the fall meetup in October 2026; Dana followed up about sponsoring the spring summit.');
    // Then: the follow-ups after a reply sends (made-up).
    if (p.includes('You turn a short instruction into follow-up steps')) return t(/pizza/i.test(p) ? { steps: [], unmatched: 'order pizza' } : { steps: [{ key: 'slack', fields: { to: 'Sam Ortiz', message: 'Dana is in for gold. Can you hold the big room for the sponsor walkthrough?' } }, { key: 'task', fields: { title: 'Send Dana the sponsor deck' } }], unmatched: '' });
    // Check it for me in the Drafts tab: five pass, one flagged (made-up).
    if (p.includes('You review an email draft before')) return t({ asks: { ok: true, note: 'New email; the ask is clear' }, facts: { ok: true, note: 'March meetup and April summit are consistent' }, commit: { ok: true, note: 'Asks a question, promises nothing yet' }, people: { ok: true, note: 'Riley only' }, tone: { ok: true, note: 'Warm and direct' }, clean: { ok: false, note: 'Give the summit date so Riley can check her calendar' } });
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
