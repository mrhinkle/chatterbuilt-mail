// End-to-end check of the page against fake connectors and a fake Claude. usage: node harness.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);

const fake = () => {
  const now = Date.now(), day = 864e5, iso = (ms) => new Date(ms).toISOString();
  const T = {
    t1: { id: 't1', viewUrl: 'https://mail.google.com/t1', messages: [
      { id: 'm1a', sender: 'Dana Ruiz <dana@acme.io>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 2 * day), subject: 'Sponsorship for All Things AI', labelIds: ['INBOX', 'UNREAD'], plaintextBody: 'Hi Mark,\nCan we lock the gold package by Friday? What date works for a call?\n\nDana Ruiz\nVP Marketing, Acme\n+1 919 555 0100\nhttps://x.com/danaruiz\nhttps://www.linkedin.com/in/danaruiz/\nhttps://bsky.app/profile/dana.bsky.social', viewUrl: 'https://mail.google.com/m1a' }] },
    t2: { id: 't2', messages: [{ id: 'm2', sender: 'Stripe <receipts@stripe.com>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 1 * day), subject: 'Your receipt #1', labelIds: ['INBOX'], plaintextBody: 'Receipt for $20' }] },
    t3: { id: 't3', messages: [{ id: 'm3', sender: 'Stripe <receipts@stripe.com>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 3 * day), subject: 'Your receipt #2', labelIds: ['INBOX'], plaintextBody: 'Receipt for $40' }] },
    t4: { id: 't4', messages: [{ id: 'm4', sender: 'Stripe <receipts@stripe.com>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 4 * day), subject: 'Your receipt #3', labelIds: ['INBOX'], plaintextBody: 'Receipt for $60' }] },
    t5: { id: 't5', messages: [
      { id: 'm5a', sender: 'Lee Park <lee@venue.org>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 9 * day), subject: 'Venue walkthrough', labelIds: [], plaintextBody: 'Want to walk the venue?' },
      { id: 'm5b', sender: 'Mark Hinkle <mrhinkle@peripety.com>', toRecipients: ['Lee Park <lee@venue.org>'], date: iso(now - 6 * day), subject: 'Re: Venue walkthrough', labelIds: ['SENT'], plaintextBody: 'Yes, does Tuesday work?' }] },
    t7: { id: 't7', messages: [{ id: 'm7', sender: 'Mark Hinkle <mrhinkle@peripety.com>', toRecipients: ['a@x.com'], date: iso(now - 20 * day), subject: 'Re: Panel', labelIds: ['SENT'], plaintextBody: 'Hey Sam, happy to do the panel. Send me the run of show and I will block the time. Mark' }] },
    t8: { id: 't8', messages: [{ id: 'm8', sender: 'Mark Hinkle <mrhinkle@peripety.com>', toRecipients: ['b@x.com'], date: iso(now - 30 * day), subject: 'Re: Intro', labelIds: ['SENT'], plaintextBody: 'Thanks for the intro, Pat. Looping you to bcc. Jo, great to meet you, how is Thursday? Mark' }] },
    t9: { id: 't9', messages: [{ id: 'm9', sender: 'Mark Hinkle <mrhinkle@peripety.com>', toRecipients: ['c@x.com'], date: iso(now - 40 * day), subject: 'Re: Pricing', labelIds: ['SENT'], plaintextBody: 'Short version: yes, but only if we can ship it before the holidays. Otherwise lets regroup in January. Mark' }] },
    t6: { id: 't6', messages: [{ id: 'm6', sender: 'News Weekly <news@weekly.com>', toRecipients: ['mrhinkle@peripety.com'], date: iso(now - 1 * day), subject: 'This week in AI', labelIds: ['INBOX'], plaintextBody: 'Stories... unsubscribe here https://weekly.com/unsubscribe?u=1' }] }
  };
  const summ = (id) => { const t = T[id]; const l = t.messages[t.messages.length - 1]; return { id: id, messageCount: t.messages.length, messages: [{ id: l.id, sender: l.sender, toRecipients: l.toRecipients, subject: l.subject, threadId: id }] }; };
  window.__calls = []; window.__prompts = [];
  const raw = btoa('List-Unsubscribe: <https://weekly.com/u?x=1>, <mailto:unsub@weekly.com?subject=stop>\r\nSubject: x\r\n\r\nbody').replace(/\+/g, '-').replace(/\//g, '_');
  const mcp = {
    async listTools() { return { servers: ['Gmail', 'Notion', 'OpenRouter', 'Google Calendar', 'Clay'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input });
      await new Promise((r) => setTimeout(r, 15));
      const P = (x) => ({ payload: x });
      if (server === 'Gmail') {
        if (tool === 'search_threads') {
          const q = input.query || '';
          if (q === 'in:sent newer_than:180d') return P({ threads: ['t7', 't8', 't9', 't5'].map(summ) });
          if (/in:sent newer_than:\d+d$/.test(q)) return P({ threads: ['t5', 't1'].map(summ) });
          if (/^in:sent to:/.test(q)) return P({ threads: [summ('t1')] });
          if (/unsubscribe/.test(q)) return P({ threads: ['t6', 't2', 't3'].map(summ) });
          if (/^from:receipts@stripe\.com in:inbox/.test(q)) return P({ threads: [{ id: 't2' }, { id: 't3' }] });
          if (/dana@acme\.io/.test(q)) return P({ threads: [{ id: 't1' }] });
          if (/pricing|walkthrough|venue/.test(q)) return P({ threads: [summ('t5')] });
          return P({ threads: ['t1', 't2', 't3', 't4', 't6'].map(summ), resultCountEstimate: 5 });
        }
        if (tool === 'get_thread') return P(JSON.parse(JSON.stringify(T[input.threadId])));
        if (tool === 'get_message') return P({ raw: raw });
        if (tool === 'list_labels') return P({ labels: [{ labelId: 'L1', name: 'Finance', labelType: 'USER' }, { labelId: 'L2', name: 'Sponsors', labelType: 'USER' }] });
        return P({ ok: true, id: 'x' });
      }
      if (server === 'Google Calendar') return P({ events: [{ status: 'confirmed', summary: 'Sponsor sync with Dana', start: { dateTime: iso(now + 3 * 3600e3) }, end: { dateTime: iso(now + 3.5 * 3600e3) }, attendees: [{ email: 'mrhinkle@peripety.com', self: true, responseStatus: 'accepted' }, { email: 'dana@acme.io', displayName: 'Dana Ruiz', responseStatus: 'accepted' }] }, { status: 'confirmed', start: { dateTime: iso(now + day) }, end: { dateTime: iso(now + day + 3600e3) } }], timeZone: 'America/New_York' });
      if (server === 'Notion') {
        if (tool === 'notion-fetch') return P({ text: '<page><content>Mark writes short, wry emails. Signs off Mark.</content></page>' });
        if (tool === 'notion-search') return P({ results: [] });
        return P({ pages: [{ url: 'https://www.notion.so/abc' }] });
      }
      if (server === 'Clay') {
        if (tool === 'search-contacts-by-name') return P({ taskId: 'mcp-task-1', entities: [{ entityId: 'e1', name: 'Dana Ruiz', title: 'VP Marketing', location: 'Raleigh, NC' }] });
        if (tool === 'add-contact-data-points') return P({ ok: true });
        if (tool === 'get-task-context') return P({ entities: [{ entityId: 'e1', enrichments: [{ name: 'Social profiles', state: 'completed', value: 'https://github.com/danaruiz https://instagram.com/danaruiz' }, { name: 'Summarize Work History', state: 'completed', value: '10 years in B2B marketing; previously at Red Hat.' }] }] });
      }
      return P({ text: 'ok' });
    }
  };
  const sample = async (prompt) => {
    window.__prompts.push(prompt);
    await new Promise((r) => setTimeout(r, 15));
    const t = (x) => ({ text: typeof x === 'string' ? x : JSON.stringify(x) });
    if (prompt.includes('Check the reply against the thread')) return t({ ok: false, issues: [{ severity: 'high', note: 'They asked what date works; the reply gives none.' }], revised: 'Yes to gold. How about Thursday at 2pm? Mark' });
    if (prompt.includes('For each thread decide')) return t([{ id: 't1', priority: 'reply', why: 'sponsor waiting', action: 'keep', folder: null }, { id: 't2', priority: 'skip', why: 'receipt', action: 'move', folder: 'Finance' }, { id: 't3', priority: 'skip', why: 'receipt', action: 'archive', folder: null }, { id: 't6', priority: 'read', why: 'newsletter', action: 'archive', folder: null }]);
    if (prompt.includes('Write three follow-ups') || prompt.includes('needs to reply to the newest message')) return t({ needsReply: true, drafts: [{ label: 'Best fit', body: 'Option A body' }, { label: 'Shorter', body: 'Option B' }, { label: 'Polite no', body: 'Option C' }] });
    if (prompt.includes('extract contact details')) return t({ name: 'Dana Ruiz', title: 'VP Marketing', company: 'Acme', phone: '+1 919 555 0100', website: null, location: null, linkedin: null, x: null, bluesky: null, github: null, instagram: null });
    if (prompt.includes('first connected with')) return t('Nov 2026: Dana reached out about sponsoring All Things AI.');
    if (prompt.includes('one Gmail search query')) return t('venue walkthrough');
    if (prompt.includes('Answer questions about')) return t('Lee offered a walkthrough; you proposed Tuesday [1].');
    if (prompt.includes('write a short voice guide')) return t('Open with their first name. Keep it under 100 words.');
    if (prompt.includes('improve an email assistant')) return t('DRAFTING:\n- Cut the opening pleasantry.\nTRIAGE:\n- Keep venue mail in the inbox.');
    if (prompt.includes("email rules. Reply with JSON")) return t([{ id: 't6', rule: 'r1', why: 'newsletter' }]);
    if (prompt.includes('suggest email rules')) return t([{ text: 'Receipts from Stripe', op: 'move', folder: 'Finance', from: 'stripe.com', count: 3, why: 'you file these' }]);
    if (prompt.includes('Write a 2-3 sentence summary')) return t('Dana wants gold.\n• Pick a date');
    return t('Thanks Dana, yes to gold. Mark');
  };
  window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? sample : null) };
};

(async () => {
  const b = await chromium.launch(); const errs = []; const results = global.__results = [];
  const ok = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.addInitScript(fake);
  await pg.goto('file://' + page); await pg.waitForTimeout(900);
  const calls = () => pg.evaluate(() => window.__calls);
  const prompts = () => pg.evaluate(() => window.__prompts);
  const clear = () => pg.evaluate(() => { window.__calls = []; window.__prompts = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  ok('inbox renders 5 threads', (await pg.$$('.thread')).length === 5);
  ok('Today shows when no thread is open', (await pg.textContent('#subject')) === 'Today' && (await pg.$$('.today .tcard')).length >= 2);
  ok('no side panel until a thread is open', !(await pg.isVisible('#side')));
  await pg.waitForTimeout(300);
  ok('Today shows the next meeting (title only, local)', (await pg.textContent('.today')).includes('Sponsor sync with Dana') && (await pg.textContent('.today')).includes('Find email with Dana Ruiz'));
  ok('next meeting is never sent to the model', !(await prompts()).some((p) => p.includes('Sponsor sync with Dana')));
  await pg.screenshot({ path: path.join(OUT, '00-today.png') });
  ok('header links to GitHub repo', (await pg.getAttribute('#repoLink', 'href')) === 'https://github.com/mrhinkle/chatterbuilt-mail');
  ok('dates filled from thread reads', (await pg.textContent('.thread[data-id="t1"] .when')).length > 0);
  ok('unread dot class', (await pg.$$('.thread.unread')).length === 1);
  await pg.screenshot({ path: path.join(OUT, '01-inbox.png') });

  // open + draft with tone
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(300);
  ok('compose visible', await pg.isVisible('#compose'));
  ok('nudge hidden on received thread', (await pg.$eval('#nudgeBtn', (e) => e.hidden)));
  await clear(); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(400);
  ok('draft filled', (await pg.inputValue('#body')).includes('Thanks Dana'));
  ok('tone lookup ran', (await calls()).some((c) => c.tool === 'search_threads' && /^in:sent to:dana@acme\.io/.test(c.input.query)));
  ok('voice page loaded into prompt', (await prompts()).some((p) => p.includes('Mark writes short, wry emails')));

  // pre-send check
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); await pg.fill('#body', 'Yes to gold. Mark'); await clear();
  await pg.click('#sendBtn'); await pg.waitForTimeout(400);
  ok('pre-send check flags issue', (await pg.textContent('#checkOut')).includes('date'));
  ok('use-fix offered', await pg.isVisible('#useFix'));
  await pg.screenshot({ path: path.join(OUT, '02-presend.png') });
  await pg.click('#useFix');
  ok('fix applied', (await pg.inputValue('#body')).includes('Thursday at 2pm'));
  await pg.click('#sendBtn'); await pg.waitForTimeout(400); await clear();
  await pg.click('#confirmSend'); await pg.waitForTimeout(400);
  ok('reply sent via reply tool', (await calls()).some((c) => c.tool === 'reply' && c.input.messageId === 'm1a'));
  ok('edit recorded for learning', await pg.evaluate(() => JSON.parse(localStorage.getItem('cm.learn')).edits.length === 1));

  // task with Mark adapter
  await clear(); await pg.click('#taskBtn'); await pg.waitForTimeout(300);
  const tc = (await calls()).find((c) => c.tool === 'notion-create-pages');
  ok('task filed with Priority + Inbox', !!tc && tc.input.pages[0].properties['Priority'] === '🧀 Medium' && tc.input.pages[0].properties['Inbox'] === '__YES__' && tc.input.pages[0].properties['Task'] === 'Sponsorship for All Things AI', tc ? JSON.stringify(tc.input.pages[0].properties) : 'no call');

  // contacts
  await closeToast(); await clear();
  await pg.keyboard.press('c'); await pg.waitForTimeout(900);
  ok('contact modal open', await pg.isVisible('#cName'));
  ok('X handle found in email', (await pg.inputValue('#cX')) === 'https://x.com/danaruiz');
  ok('LinkedIn found', (await pg.inputValue('#cLinkedIn')).includes('linkedin.com/in/danaruiz'));
  ok('Bluesky found', (await pg.inputValue('#cBluesky')).includes('bsky.app/profile/dana.bsky.social'));
  ok('title from signature', (await pg.inputValue('#cTitle')) === 'VP Marketing');
  ok('how-we-met filled', (await pg.inputValue('#cMet')).includes('sponsoring'), await pg.evaluate(() => document.getElementById('cMet').placeholder + ' | ' + document.getElementById('cMet').value));
  ok('first thread link shown', (await pg.textContent('#cFirst')).includes('First thread together'));
  await pg.click('#cClay'); await pg.waitForTimeout(2500);
  ok('Clay added GitHub', (await pg.inputValue('#cGitHub')).includes('github.com/danaruiz'), await pg.inputValue('#cGitHub'));
  ok('Clay added background', (await pg.inputValue('#cBackground')).includes('B2B'), await pg.inputValue('#cBackground'));
  await pg.screenshot({ path: path.join(OUT, '03-contact.png') });
  await clear(); await pg.click('#cSave'); await pg.waitForTimeout(300);
  const cc = (await calls()).find((c) => c.tool === 'notion-create-pages');
  const props = cc && cc.input.pages[0].properties;
  ok('contact saved with socials + first contact date', !!props && props['X'] === 'https://x.com/danaruiz' && props['GitHub'] && props['How we met'] && props['date:First contact:start'] && props['Source'] === 'Chatterbuilt Mail', props ? Object.keys(props).join(',') : 'no call');

  // triage -> review -> undo
  await closeToast(); await clear();
  await pg.click('#triageBtn'); await pg.waitForTimeout(500);
  ok('triage pills', (await pg.$$('.pill.reply')).length >= 1);
  ok('triage sorts the list into sections', await pg.evaluate(() => { const h = [...document.querySelectorAll('#list .lsec span:first-child')].map((e) => e.textContent); const first = document.querySelector('#list .lsec + .thread'); return h[0] === 'Needs you' && h.includes('FYI') && first && first.dataset.id === 't1'; }));
  ok('review badge shows 3', (await pg.textContent('#reviewCount')) === '3');
  ok('caret badge mirrors Review count', (await pg.isVisible('#toolsCount')) && (await pg.textContent('#toolsCount')) === '3');
  ok('tools row is gone (menu closed)', !(await pg.isVisible('#reviewBtn')) && !(await pg.isVisible('#sweepBtn')));
  await closeToast(); await pg.click('#toolsBtn'); await pg.waitForTimeout(100);
  ok('menu opens under the caret', await pg.evaluate(() => { const m = document.getElementById('toolMenu'), b = document.getElementById('toolsBtn'); if (m.hidden) return false; const r = m.getBoundingClientRect(), c = b.getBoundingClientRect(); return r.top >= c.bottom && r.right <= innerWidth && r.left >= 0; }));
  ok('menu lists 5 tools', (await pg.$$eval('#toolMenu .mi', (els) => els.filter((e) => e.offsetParent).length)) === 5);
  await pg.screenshot({ path: path.join(OUT, '04b-menu.png') });
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(50);
  ok('Escape closes the menu and refocuses caret', (await pg.evaluate(() => document.getElementById('toolMenu').hidden && document.activeElement.id === 'toolsBtn')));
  await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(50);
  ok('ArrowDown opens menu with focus on first item', await pg.evaluate(() => !document.getElementById('toolMenu').hidden && document.activeElement.id === 'reviewBtn'));
  await pg.keyboard.press('ArrowDown');
  ok('ArrowDown moves to Pre-draft', await pg.evaluate(() => document.activeElement.id === 'predraftBtn'));
  await pg.mouse.click(5, 5); await pg.waitForTimeout(50);
  ok('outside click closes the menu', await pg.evaluate(() => document.getElementById('toolMenu').hidden));
  await pg.click('#toolsBtn'); await pg.click('#reviewBtn'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(OUT, '04-review.png') });
  const boxes = await pg.$$('[data-rv]'); await boxes[boxes.length - 1].uncheck();
  await clear(); await pg.click('#rvApply'); await pg.waitForTimeout(500);
  const ops = (await calls()).filter((c) => c.tool === 'label_thread' || c.tool === 'unlabel_thread');
  ok('applied 2 of 3 via thread ops', ops.filter((c) => c.tool === 'unlabel_thread').length === 2, JSON.stringify(ops.map((c) => c.tool + ':' + c.input.threadId)));
  ok('reject recorded', await pg.evaluate(() => JSON.parse(localStorage.getItem('cm.learn')).rejects.length === 1));
  await clear(); await pg.click('[data-undo]'); await pg.waitForTimeout(500);
  ok('undo re-adds INBOX', (await calls()).some((c) => c.tool === 'label_thread' && c.input.labelIds.includes('INBOX')));

  // rule suggestion from 3 moves
  await closeToast();
  for (const id of ['t2', 't3', 't4']) {
    await pg.click('.thread[data-id="' + id + '"] [data-ra="move"]', { force: true }); await pg.waitForTimeout(250);
    await pg.click('#labelOpts .opt[data-lname="Finance"]'); await pg.waitForTimeout(350);
  }
  await pg.waitForTimeout(1400);
  ok('rule suggestion toast', (await pg.textContent('.toast')).includes('Make it a rule'), await pg.textContent('.toast'));
  await pg.click('[data-addsug]'); await pg.waitForTimeout(100);
  ok('suggested rule saved with sender match', await pg.evaluate(() => JSON.parse(localStorage.getItem('cm.rules')).some((r) => r.from === 'receipts@stripe.com' && r.op === 'move')));

  // rules modal: add text rule + run
  await closeToast(); await pg.click('#toolsBtn'); await pg.click('#rulesBtn'); await pg.waitForTimeout(300);
  await pg.fill('#ruleText', 'Newsletters'); await pg.selectOption('#ruleOp', 'archive'); await pg.click('#ruleAdd'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const r = JSON.parse(localStorage.getItem('cm.rules')); r[r.length - 1].id = 'r1'; localStorage.setItem('cm.rules', JSON.stringify(r)); });
  await pg.click('#modalClose'); await pg.click('#toolsBtn'); await pg.click('#rulesBtn'); await pg.waitForTimeout(300);
  await pg.click('#ruleSuggest'); await pg.waitForTimeout(400);
  ok('AI rule suggestions render', (await pg.textContent('#sugList')).includes('Receipts from Stripe'));
  await pg.screenshot({ path: path.join(OUT, '05-rules.png') });
  await pg.click('#ruleRun'); await pg.waitForTimeout(500);
  ok('rules -> review', (await pg.isVisible('#rvApply')) && (await pg.textContent('#modalBody')).includes('rule'));
  await pg.click('#modalClose');

  // waiting + nudge via send_message
  await closeToast(); await pg.click('.chip[data-key="waiting"]'); await pg.waitForTimeout(500);
  ok('waiting shows t5 only', (await pg.$$('.thread')).length === 1 && (await pg.textContent('.thread')).includes('waiting'));
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(300);
  ok('nudge visible', (await pg.$eval('#nudgeBtn', (e) => !e.hidden)));
  await pg.click('#replyMenuBtn'); await pg.click('#nudgeBtn'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('cm.features') || '{}'); s.precheck = false; localStorage.setItem('cm.features', JSON.stringify(s)); });
  await pg.evaluate(() => { document.querySelector('#body').value = 'Following up on Tuesday?'; });
  await pg.click('#sendBtn'); await pg.waitForTimeout(150);
  await clear(); await pg.click('#confirmSend'); await pg.waitForTimeout(300);
  const sm = (await calls()).find((c) => c.tool === 'send_message');
  ok('nudge sent to counterpart via send_message', !!sm && sm.input.to[0] === 'lee@venue.org' && sm.input.replyToMessageId === 'm5b', sm ? JSON.stringify(sm.input) : '');

  // calendar
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(400);
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(300); await clear();
  await pg.click('#replyMenuBtn'); await pg.click('[data-intent="call"]'); await pg.waitForTimeout(400);
  ok('calendar consulted', (await calls()).some((c) => c.tool === 'list_events'));
  ok('open times in prompt, no event details', (await prompts()).some((p) => p.includes('open 30-minute times')));

  // 3 options
  await clear(); await pg.click('#replyMenuBtn'); await pg.click('#variantsBtn'); await pg.waitForTimeout(400);
  ok('variant chips', (await pg.$$('#variants .v')).length === 3 && (await pg.inputValue('#body')) === 'Option A body');

  // sweep
  await closeToast(); await pg.click('#toolsBtn'); await pg.click('#sweepBtn'); await pg.click('#swScan'); await pg.waitForTimeout(400);
  ok('sweep groups senders', (await pg.$$('#swList .mitem')).length >= 2);
  await pg.click('[data-swu="0"]'); await pg.waitForTimeout(400);
  ok('sweep finds unsubscribe link', (await pg.textContent('#swList')).includes('Open unsubscribe page'));
  await pg.screenshot({ path: path.join(OUT, '06-sweep.png') });
  await pg.click('#modalClose');

  // ask
  await pg.click('#toolsBtn'); await pg.click('#askBtn'); await pg.fill('#askQ', 'When is the venue walkthrough?'); await pg.click('#askGo'); await pg.waitForTimeout(600);
  ok('ask answers with sources', (await pg.textContent('#askOut')).includes('[1]') && (await pg.$$('#askOut [data-src]')).length === 1);
  await pg.click('#modalClose');
  await pg.click('#askMode'); await pg.fill('#q', 'When is the venue walkthrough?'); await pg.press('#q', 'Enter'); await pg.waitForTimeout(600);
  ok('search box Ask mode asks instead of searching', (await pg.isVisible('#askOut')) && (await pg.inputValue('#askQ')) === 'When is the venue walkthrough?' && (await pg.textContent('#askOut')).includes('[1]'));
  await pg.click('#modalClose'); await pg.click('#askMode'); await pg.fill('#q', '');
  ok('Ask mode turns off', (await pg.getAttribute('#askMode', 'aria-pressed')) === 'false');

  // voice + learning
  await pg.click('#setBtn'); await pg.click('#voiceBtn'); await pg.waitForTimeout(200);
  await pg.click('#vTrain'); await pg.waitForTimeout(600);
  ok('voice trainer writes a guide', (await pg.inputValue('#vText')).includes('first name'));
  await pg.click('#lRun'); await pg.waitForTimeout(400);
  ok('learn now writes lessons', (await pg.inputValue('#lText')).includes('DRAFTING'));
  await pg.evaluate(() => { localStorage.setItem('cm.snippets', JSON.stringify([{ name: 'Basics', text: 'Hi {{firstName}}' }])); try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {} });
  await pg.click('#lCopy'); await pg.waitForTimeout(200);
  const exp = await pg.evaluate(() => { const t = window.__copied || (document.getElementById('copyBox') || {}).value || ''; try { return JSON.parse(t.slice(t.indexOf('{'))); } catch (e) { return null; } });
  ok('export keeps sender on sender rules', !!exp && exp.rules.some((r) => r.from === 'receipts@stripe.com'), exp && JSON.stringify(exp.rules));
  ok('export includes snippets', !!exp && Array.isArray(exp.snippets) && exp.snippets[0].name === 'Basics');
  await pg.screenshot({ path: path.join(OUT, '07-voice.png') });
  await pg.click('#vSave');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(300); await clear();
  await pg.click('#replyMenuBtn'); await pg.click('[data-intent="no"]'); await pg.waitForTimeout(400);
  ok('lessons steer next draft', (await prompts()).some((p) => p.includes('Cut the opening pleasantry')));

  // skills picker
  await pg.click('#setBtn'); await pg.click('#skillsBtn'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(OUT, '08-skills.png') });
  await pg.uncheck('[data-fk="sweep"]'); await pg.click('#modalClose');
  await pg.click('#toolsBtn'); await pg.waitForTimeout(50);
  ok('turning off Sweep hides it in the menu', !(await pg.isVisible('#sweepBtn')) && (await pg.isVisible('#askBtn')));
  await pg.keyboard.press('Escape');

  // palette
  await pg.keyboard.press('Control+k'); await pg.waitForTimeout(150);
  await pg.keyboard.type('ask'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  ok('palette runs Ask', await pg.isVisible('#askQ'));
  await pg.keyboard.press('Escape');

  // read-only
  await pg.click('#setBtn'); await pg.click('#roToggle'); await closeToast(); await clear();
  ok('read-only switch shows on, pill appears in the bar', (await pg.getAttribute('#roToggle', 'aria-checked')) === 'true' && (await pg.isVisible('#roPill')));
  await pg.click('#archiveBtn'); await pg.waitForTimeout(300);
  ok('read-only blocks archive', !(await calls()).some((c) => c.tool === 'unlabel_thread') && (await pg.textContent('#banner')).includes('Read-only'));
  await pg.click('#roPill'); await closeToast();
  ok('pill turns read-only off', !(await pg.isVisible('#roPill')) && (await pg.getAttribute('#roToggle', 'aria-checked')) === 'false');
  ok('thread toolbar fits on one line (desktop)', await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height < 44));
  ok('header bar fits on one line (desktop)', await pg.evaluate(() => document.querySelector('header.bar').getBoundingClientRect().height < 64));
  await pg.click('#threadMoreBtn'); await pg.waitForTimeout(80);
  ok('More lists Star, Unsubscribe, Formatted, Open in Gmail; hides phone-only items', await pg.evaluate(() => { const vis = [...document.querySelectorAll('#threadMenu .mi')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()); return vis.some((t) => /Star/.test(t)) && vis.includes('Unsubscribe…') && vis.includes('Formatted view') && vis.some((t) => /Open in Gmail/.test(t)) && !vis.includes('File as a task'); }));
  await pg.screenshot({ path: path.join(OUT, '09b-thread-more.png') });
  await pg.keyboard.press('Escape');
  await pg.click('#setBtn'); await pg.waitForTimeout(80);
  await pg.screenshot({ path: path.join(OUT, '09c-settings.png') });
  await pg.keyboard.press('Escape');

  // phone width
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('mobile pageerror: ' + e.message));
  await mp.addInitScript(fake); await mp.goto('file://' + page); await mp.waitForTimeout(900);
  const noHScroll = async () => mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok('phone: no sideways scroll (list)', await noHScroll());
  ok('phone: header bar is one row', await mp.evaluate(() => document.querySelector('header.bar').getBoundingClientRect().height < 70));
  ok('phone: tab bar at the bottom of the list', await mp.evaluate(() => { const t = document.getElementById('tabbar').getBoundingClientRect(); return t.height > 40 && Math.abs(t.bottom - innerHeight) < 2; }));
  ok('phone: list footer sits above the tab bar', await mp.evaluate(() => document.querySelector('.list-foot').getBoundingClientRect().bottom <= document.getElementById('tabbar').getBoundingClientRect().top + 1));
  await mp.tap('#tabbar [data-tab="today"]'); await mp.waitForTimeout(250);
  ok('phone: Today tab shows the Today view', (await mp.isVisible('#desk')) && (await mp.textContent('#subject')) === 'Today' && (await mp.$$('.today .tcard')).length >= 2);
  await mp.screenshot({ path: path.join(OUT, '10e-phone-today.png') });
  await mp.tap('#backBtn'); await mp.waitForTimeout(150);
  await mp.tap('#tabbar [data-tab="tools"]'); await mp.waitForTimeout(150);
  ok('phone: Tools tab opens the tools sheet', await mp.isVisible('#toolMenu'));
  await mp.keyboard.press('Escape'); await mp.waitForTimeout(100);
  await mp.tap('#tabbar [data-tab="waiting"]'); await mp.waitForTimeout(400);
  ok('phone: Waiting tab switches the list', await mp.evaluate(() => document.querySelector('#chips .chip.on').dataset.key === 'waiting'));
  await mp.tap('#tabbar [data-tab="inbox"]'); await mp.waitForTimeout(400);
  // phone: a long Review list must scroll, and every item must be reachable
  await mp.tap('#triageBtn'); await mp.waitForTimeout(600);
  await mp.setViewportSize({ width: 390, height: 430 }); await mp.waitForTimeout(100);
  await mp.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await mp.tap('#toolsBtn'); await mp.waitForTimeout(120); await mp.tap('#reviewBtn'); await mp.waitForTimeout(250);
  ok('phone review: list is not clipped', await mp.evaluate(() => { const l = document.querySelector('#modalBody .mlist'); return !!l && l.scrollHeight <= l.clientHeight + 1; }));
  ok('phone review: sheet scrolls', await mp.evaluate(() => { const b = document.getElementById('modalBody'); return b.scrollHeight > b.clientHeight; }));
  ok('phone review: Apply stays in view before scrolling', await mp.evaluate(() => { const a = document.getElementById('rvApply').getBoundingClientRect(); return a.bottom <= innerHeight && a.top >= 0; }));
  await mp.screenshot({ path: path.join(OUT, '10c-phone-review-top.png') });
  const lastRv = await mp.$$eval('[data-rv]', (els) => els.length - 1);
  await mp.locator('[data-rv="' + lastRv + '"]').scrollIntoViewIfNeeded(); await mp.waitForTimeout(100);
  await mp.tap('[data-rv="' + lastRv + '"]'); await mp.waitForTimeout(80);
  ok('phone review: last item can be unticked', !(await mp.isChecked('[data-rv="' + lastRv + '"]')));
  ok('phone review: last item not hidden behind the sticky footer', await mp.evaluate((i) => { const c = document.querySelector('[data-rv="' + i + '"]').getBoundingClientRect(); const f = document.querySelector('#modalBody .mfoot').getBoundingClientRect(); return c.bottom <= f.top + 1; }, lastRv));
  await mp.screenshot({ path: path.join(OUT, '10d-phone-review-end.png') });
  await mp.tap('#modalClose'); await mp.waitForTimeout(100);
  await mp.setViewportSize({ width: 390, height: 844 }); await mp.waitForTimeout(100);
  await mp.screenshot({ path: path.join(OUT, '10-phone-list.png') });
  await mp.tap('#toolsBtn'); await mp.waitForTimeout(150);
  ok('phone: tools menu is a bottom sheet', await mp.evaluate(() => { const r = document.getElementById('toolMenu').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 2 && r.left === 0 && Math.abs(r.width - innerWidth) < 2; }));
  ok('phone: menu items are tall enough to tap', await mp.evaluate(() => [...document.querySelectorAll('#toolMenu .mi')].filter((e) => e.offsetParent).every((e) => e.getBoundingClientRect().height >= 44)));
  await mp.screenshot({ path: path.join(OUT, '10b-phone-menu.png') });
  await mp.keyboard.press('Escape'); await mp.waitForTimeout(100);
  await mp.tap('.thread[data-id="t1"]'); await mp.waitForTimeout(400);
  ok('phone: thread view replaces list', (await mp.isVisible('#desk')) && !(await mp.isVisible('.rail')));
  ok('phone: no sideways scroll (thread)', await noHScroll());
  await mp.screenshot({ path: path.join(OUT, '11-phone-thread.png'), fullPage: false });
  await mp.evaluate(() => document.querySelector('#desk').scrollTo(0, 99999)); await mp.waitForTimeout(150);
  await mp.screenshot({ path: path.join(OUT, '12-phone-compose.png') });
  ok('phone: actions move to a bottom bar', await mp.evaluate(() => { const b = document.getElementById('phoneBar').getBoundingClientRect(); return b.height > 40 && Math.abs(b.bottom - innerHeight) < 2 && !document.getElementById('acts').getClientRects().length; }));
  ok('phone: bottom bar has Archive, Snooze, Route, Reply, More', (await mp.$$eval('#phoneBar .btn', (els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()))).join(',') === 'Archive,Snooze,Route,Reply,More');
  ok('phone: Send can scroll clear of the bottom bar', await mp.evaluate(() => { const d = document.getElementById('desk'); d.scrollTo(0, 99999); const s = document.getElementById('sendBtn').getBoundingClientRect(); const bar = document.getElementById('phoneBar').getBoundingClientRect(); return s.bottom <= bar.top; }));
  ok('phone: no tab bar inside a thread', !(await mp.isVisible('#tabbar')));
  await mp.tap('#replyJump'); await mp.waitForTimeout(400);
  ok('phone: Reply focuses the reply box and hides the bar while typing', await mp.evaluate(() => document.activeElement && document.activeElement.id === 'body' && !document.getElementById('phoneBar').getClientRects().length));
  await mp.evaluate(() => document.activeElement.blur()); await mp.waitForTimeout(120);
  ok('phone: bar comes back after typing', await mp.isVisible('#phoneBar'));
  await mp.tap('#pbMore'); await mp.waitForTimeout(150);
  ok('phone: More holds Move, Task, Contact, Summarize', await mp.evaluate(() => ['moveBtn', 'taskBtn', 'contactBtn', 'sumBtn'].every((id) => { const e = document.querySelector('[data-proxy="' + id + '"]'); return e && e.getClientRects().length > 0; })));
  ok('phone: More has a Close button', await mp.isVisible('#threadMenu [data-mclose]'));
  await mp.screenshot({ path: path.join(OUT, '12b-phone-more.png') });
  await mp.tap('#threadMenu [data-proxy="contactBtn"]'); await mp.waitForTimeout(900);
  ok('phone: contact sheet fits', await noHScroll());
  await mp.screenshot({ path: path.join(OUT, '13-phone-contact.png') });

  console.log(results.join('\n'));
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  console.log('PASSED', results.filter((r) => r.startsWith('PASS')).length, 'of', results.length);
  await b.close();
})().catch((e) => { console.log((global.__results || []).join('\n')); console.error('HARNESS CRASH', e.message.slice(0,600), e.stack.split('\n').slice(0,4).join(' | ')); process.exit(1); });
