// Screenshots and a demo video of Chatterbuilt Mail, with fictional data only.
// Nothing here touches a real account: Gmail, Composio, Calendar and Claude are all faked in the page.
//
// usage (from the repo root):
//   node scripts/demo/record.js [outdir]          default outdir: demo-out
// needs: Node with Playwright and Chromium, Python 3, and ffmpeg for the video.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'demo-out'); fs.mkdirSync(OUT, { recursive: true });
const FR = path.join(OUT, 'frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const built = path.join(os.tmpdir(), 'chatterbuilt-demo.html');
execFileSync('python3', [path.join(ROOT, 'scripts/build.py'), path.join(ROOT, 'skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html'), path.join(__dirname, 'demo.config.js'), built], { stdio: 'inherit' });
// The artifact host wraps the page in this skeleton; do the same so it renders as it would in claude.ai.
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(built, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);

const fake = () => {
  const now = Date.now(), H = 36e5, D = 864e5, iso = (ms) => new Date(ms).toISOString();
  const ME = 'Alex Rivera <alex@riveralabs.example>';
  const mk = (id, from, subject, body, ago, extra) => ({ id, viewUrl: 'https://mail.google.com/' + id, messages: [Object.assign({ id: 'm' + id, sender: from, toRecipients: [ME], date: iso(now - ago), subject, labelIds: ['INBOX', 'UNREAD'], plaintextBody: body, viewUrl: 'https://mail.google.com/m' + id }, extra || {})] });
  const T = {
    t1: mk('t1', 'Dana Ruiz <dana@acmerobotics.example>', 'Sponsorship for the spring summit', 'Hi Alex,\n\nCan we lock the gold package by Friday? What date works for a call next week?\n\nDana Ruiz\nVP Marketing, Acme Robotics', 2 * H),
    t2: mk('t2', 'Lee Park <lee@venuehall.example>', 'Venue walkthrough', 'Hi Alex, want to walk the space before we sign? Tuesday or Wednesday morning works on our side.', 5 * H),
    t3: mk('t3', 'Priya Shah <priya@northwind.example>', 'Podcast guest spot in December', 'Would you join us on the Northwind podcast? 30 minutes, recorded remotely.', 9 * H),
    t4: mk('t4', 'Stripe <receipts@stripe.example>', 'Your receipt from Rivera Labs', 'Receipt for $49.00', 11 * H, { labelIds: ['INBOX'] }),
    t5: mk('t5', 'The Weekly Byte <news@weeklybyte.example>', 'This week in AI: agents at work', 'Five stories you missed. Unsubscribe at the bottom.', 14 * H, { labelIds: ['INBOX'] }),
    t6: mk('t6', 'Morgan Lee <morgan@cityworks.example>', 'Intro: Alex, meet Jordan', 'Alex, meet Jordan, who runs the downtown makerspace. I think you two should talk.', 26 * H),
    t7: mk('t7', 'Stripe <receipts@stripe.example>', 'Your receipt from Rivera Labs', 'Receipt for $120.00', 30 * H, { labelIds: ['INBOX'] }),
    t8: mk('t8', 'Calendar <calendar@example>', 'Updated invitation: Board prep', 'Invitation updated.', 32 * H, { labelIds: ['INBOX'] })
  };
  const order = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const summ = (id) => { const m = T[id].messages[0]; return { id, messageCount: 1, messages: [{ id: m.id, sender: m.sender, subject: m.subject, toRecipients: m.toRecipients }] }; };
  const DRAFTS = { drafts: [{ id: 'd1', threadId: 't2', plaintextBody: 'Hi Lee, Tuesday at 10 works. See you there. Alex', viewUrl: 'https://mail.google.com/d1' }] };
  const env = (data) => ({ successful: true, data: { results: [{ response: { successful: true, data }, tool_slug: 'X' }] } });
  const ctx = {
    MEETINGS: { transcripts: [{ title: 'Acme sponsorship call', date: iso(now - 12 * D), action_items: ['Alex to send the sponsor deck and gold package terms'] }] },
    CALENDAR: { events: [] },
    NOTES: { results: [] },
    PIPELINE: { results: [{ name: 'Acme Robotics', stage: 'Proposal', tier: 'Gold', owner: 'Alex' }] },
    MEMORY: 'Dana Ruiz: VP Marketing at Acme Robotics; met at the fall meetup; prefers short emails.'
  };
  const web = (q) => /company news/.test(q)
    ? [{ title: 'Acme Robotics: warehouse robots for mid-size retailers', url: 'https://acmerobotics.example/about', description: 'Acme Robotics builds warehouse robots for mid-size retailers.' }, { title: 'Acme Robotics opens a Raleigh office', url: 'https://news.example/acme-raleigh', description: 'The company is hiring 40 people in Raleigh this year.' }]
    : [{ title: 'Dana Ruiz, VP Marketing, Acme Robotics', url: 'https://acmerobotics.example/team/dana', description: 'Dana leads marketing and events at Acme Robotics.' }];
  window.__calls = [];
  const mcp = {
    async listTools() { return { servers: ['Gmail', 'Composio', 'Google Calendar'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input }); await new Promise((r) => setTimeout(r, 120));
      const P = (x) => ({ payload: x });
      if (server === 'Gmail') {
        if (tool === 'search_threads') { const q = input.query || ''; if (/^in:sent/.test(q)) return P({}); if (/^label:/.test(q)) return P({}); return P({ resultCountEstimate: '8', threads: order.map(summ) }); }
        if (tool === 'get_thread') return P(JSON.parse(JSON.stringify(T[input.threadId])));
        if (tool === 'list_drafts') return P(DRAFTS);
        if (tool === 'list_labels') return P({ labels: [{ labelId: 'L1', name: 'Finance', labelType: 'USER' }] });
        return P({ id: 'ok' });
      }
      if (server === 'Google Calendar') return P({ events: [{ status: 'confirmed', summary: 'Weekly partnerships sync', start: { dateTime: iso(now + 2 * H) }, end: { dateTime: iso(now + 2.5 * H) }, attendees: [{ email: 'alex@riveralabs.example', self: true, responseStatus: 'accepted' }, { email: 'sam@riveralabs.example', displayName: 'Sam Ortiz', responseStatus: 'accepted' }] }] });
      if (server === 'Composio') {
        const it = (input.tools || [])[0] || {}; const slug = it.tool_slug;
        if (slug === 'FIRECRAWL_SEARCH') return P(env({ data: { web: web(it.arguments.q) } }));
        if (ctx[slug] !== undefined) return P(env(ctx[slug]));
        return P(env({ ok: true }));
      }
      return P({ ok: true });
    }
  };
  const sample = async (prompt) => {
    await new Promise((r) => setTimeout(r, 700));
    const t = (x) => ({ text: typeof x === 'string' ? x : JSON.stringify(x) });
    if (prompt.includes('For each thread decide')) return t([{ id: 't1', priority: 'reply', why: 'sponsor waiting on a date', action: 'keep' }, { id: 't2', priority: 'reply', why: 'venue needs a time', action: 'keep' }, { id: 't3', priority: 'reply', why: 'podcast invite', action: 'keep' }, { id: 't6', priority: 'read', why: 'warm intro', action: 'keep' }, { id: 't5', priority: 'skip', why: 'newsletter', action: 'archive' }, { id: 't4', priority: 'skip', why: 'receipt', action: 'move', folder: 'Finance' }, { id: 't7', priority: 'skip', why: 'receipt', action: 'move', folder: 'Finance' }, { id: 't8', priority: 'skip', why: 'calendar notice', action: 'archive' }]);
    if (prompt.includes('public web search results')) return t('• VP Marketing at Acme Robotics, which builds warehouse robots for mid-size retailers. [1][2]\n• Acme Robotics is opening a Raleigh office and hiring this year. [3]\n• Worth mentioning: the Raleigh expansion makes the spring summit a good fit for recruiting. [3]');
    if (prompt.includes('You brief')) return t('• You owe Dana the sponsor deck and gold package terms from the call 12 days ago. [Meetings]\n• Acme Robotics is at Proposal, gold tier. [Pipeline]\n• Met at the fall meetup; prefers short emails. [Memory]\n• No call on the calendar yet. [Calendar]');
    if (prompt.includes('You route email')) return t({ actions: [{ key: 'task', why: 'deck promised on the last call', fields: { title: 'Send Dana the sponsor deck and gold terms' } }, { key: 'handoff', why: 'needs a call booked', fields: { handoff: 'Can you book a 30-minute call with Dana Ruiz next week?' } }, { key: 'remind', why: 'waiting on her decision', fields: { until: new Date(now + 4 * D).toISOString().slice(0, 10) } }] });
    if (prompt.includes('Check the reply against the thread')) return t({ ok: false, issues: [{ severity: 'medium', note: 'You promised the deck on the last call; the reply doesn\'t attach or mention it.' }], revised: 'Hi Dana,\n\nYes to gold. I\'ll send the deck and terms today. Does Tuesday at 10 or Wednesday at 2 work for a call?\n\nAlex' });
    return t('Hi Dana,\n\nYes to gold. Does Tuesday at 10 or Wednesday at 2 work for a call next week?\n\nAlex');
  };
  window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? sample : null) };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page);
  const t0 = Date.now(); let n = 0; const snap = async () => { await pg.screenshot({ path: path.join(FR, String(n++).padStart(5, '0') + '.png') }); };
  const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await snap(); };
  const shot = async (name) => { await pg.screenshot({ path: path.join(OUT, name + '.png') }); };
  const caption = async (text) => pg.evaluate((t) => { let c = document.getElementById('__cap'); if (!c) { c = document.createElement('div'); c.id = '__cap'; c.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;background:rgba(15,23,42,.88);color:#fff;font:600 15px/1.3 -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:80vw;text-align:center'; document.body.append(c); } c.textContent = t; c.hidden = !t; }, text);
  const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await pg.waitForTimeout(1600); await clearToasts();
  await caption('Today: drafts waiting, what needs you, your next meeting'); await hold(2600);
  await caption(''); await shot('today');
  await caption('Triage sorts the inbox: Needs you, Worth reading, FYI'); await pg.click('#triageBtn'); await hold(2800); await clearToasts();
  await caption(''); await shot('triage');
  await caption('Open a thread: context from your systems, beside it'); await pg.click('.thread[data-id="t1"]'); await hold(3600);
  await caption(''); await shot('context-panel');
  await caption('More context: a cited web lookup, only when you press it'); await pg.click('#sideBody [data-ctx="more"]'); await hold(3200);
  await caption(''); await shot('more-context');
  await caption('Next steps: where this thread should go'); await pg.click('#sideBody [data-ctx="steps"]'); await hold(2600);
  await pg.click('#sideBody [data-ctx="route"]'); await caption('Review and apply: nothing runs until you do'); await hold(2600);
  await caption(''); await shot('route');
  await pg.click('#modalClose'); await hold(400);
  await caption('Draft in your voice, using what your systems know'); await pg.click('[data-intent="yes"]'); await hold(2600);
  await caption(''); await shot('draft');
  await caption('Pre-send check: catches the promise you forgot'); await pg.click('#sendBtn'); await hold(3000);
  await caption(''); await shot('presend');
  await pg.click('#cancelSend'); await hold(300);
  await pg.click('#toolsBtn'); await caption('Tools: Review, Pre-draft, Rules, Sweep, Ask'); await hold(2200);
  await pg.keyboard.press('Escape'); await caption(''); await hold(600);
  const secs = (Date.now() - t0) / 1000;

  // phone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await mp.addInitScript(fake); await mp.goto('file://' + page); await mp.waitForTimeout(1600);
  await mp.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await mp.screenshot({ path: path.join(OUT, 'phone-inbox.png') });
  await mp.tap('.thread[data-id="t1"]'); await mp.waitForTimeout(2600);
  await mp.screenshot({ path: path.join(OUT, 'phone-thread.png') });
  await mp.tap('#backBtn'); await mp.tap('#tabbar [data-tab="today"]'); await mp.waitForTimeout(600);
  await mp.screenshot({ path: path.join(OUT, 'phone-today.png') });
  await b.close();

  console.log('frames', n, 'in', secs.toFixed(1) + 's', 'page errors:', errs.length ? errs.join(' | ') : 'none');
  const mp4 = path.join(OUT, 'demo.mp4');
  try {
    // Frames are captured as fast as the browser allows, so pace the video by the measured time.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', (n / secs).toFixed(2), '-i', path.join(FR, '%05d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    console.log('video', mp4);
  } catch (e) { console.log('ffmpeg not found or failed; frames are in', FR); }
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
