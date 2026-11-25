// Sweep finds an HTML-only unsubscribe link; read-only greys Snooze, Route, Contact (desktop + phone) and says so in Route and Contact.
// usage: node harness_fixes.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);

const fake = () => {
  const now = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const b64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  const msg = (id, sender, text, htmlBody, k) => ({ id: 'm' + id, sender, toRecipients: ['me@example.com'], date: iso(now - k * 36e5), subject: 'Offer ' + id, labelIds: ['INBOX'], plaintextBody: text, htmlBody });
  const T = {
    h1: msg('h1', 'Oracle <replies@oracle-mail.example>', 'Big news https://go.oracle.example/x?elq=1', '<p>Big news</p><a href="https://go.oracle.example/x?elq=1">Read</a> <a href="https://go.oracle.example/subscriptions?elq=1">Manage your subscriptions</a>', 1),
    h2: msg('h2', 'Oracle <replies@oracle-mail.example>', 'More news', '<p>More</p><a href="https://go.oracle.example/subscriptions?elq=2">Unsubscribe</a>', 2),
    p1: msg('p1', 'Dana Ruiz <dana@acme.example>', 'Lunch Thursday?', '<p>Lunch Thursday?</p>', 3)
  };
  window.__calls = [];
  const thread = (id) => ({ id, messageCount: 1, viewUrl: 'https://mail.google.com/' + id, messages: [JSON.parse(JSON.stringify(T[id]))] });
  const summ = (id) => ({ id, messageCount: 1, messages: [{ id: 'm' + id, sender: T[id].sender, subject: T[id].subject }] });
  const mcp = {
    async listTools() { return { servers: ['Gmail', 'Notion'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input }); await new Promise((r) => setTimeout(r, 10));
      const P = (x) => ({ payload: x });
      if (tool === 'search_threads') { if (/before:|^in:sent|^label:/.test(input.query || '')) return P({}); return P({ resultCountEstimate: '3', threads: ['h1', 'h2', 'p1'].map(summ) }); }
      if (tool === 'get_thread') { const t = thread(input.threadId); if (input.messageFormat !== 'FULL_CONTENT') t.messages.forEach((m) => { delete m.htmlBody; }); return P(t); }
      if (tool === 'get_message') return P({ id: input.messageId, raw: b64('Subject: x\r\n\r\nbody') });
      if (tool === 'list_labels') return P({ labels: [] });
      if (tool === 'list_drafts') return P({ drafts: [] });
      return P({ ok: true });
    }
  };
  const sample = async (p) => ({ text: String(p).includes('You route email') ? JSON.stringify({ actions: [] }) : String(p).includes('extract contact details') ? JSON.stringify({ name: 'Dana Ruiz' }) : 'ok' });
  window.claude = { use: async (nm) => (nm === 'mcp' ? mcp : nm === 'sample' ? sample : null) };
};

(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(800);
  const clear = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // sweep: HTML-only link
  await clear(); await pg.click('#toolsBtn'); await pg.click('#sweepBtn'); await pg.click('#swScan'); await pg.waitForTimeout(600);
  const groups = await pg.$$eval('#swList .mitem', (els) => els.map((e) => e.textContent));
  const oi = groups.findIndex((t) => /oracle/i.test(t));
  ok('sweep lists the bulk sender', oi >= 0, JSON.stringify(groups));
  await pg.click('[data-swu="' + oi + '"]'); await pg.waitForTimeout(700);
  const href = await pg.evaluate((i) => { const a = document.querySelector('[data-swn="' + i + '"] a'); return a ? a.href : ''; }, oi);
  ok('sweep finds the HTML-only unsubscribe link', href.includes('/subscriptions'), href);
  ok('sweep skips the tracking link labelled Read', !href.includes('x?elq'));
  ok('sweep fetched the formatted message', (await pg.evaluate(() => window.__calls)).some((c) => c.tool === 'get_thread' && c.input.messageFormat === 'FULL_CONTENT'));
  await pg.click('#modalClose');

  // read-only greying
  await pg.click('.thread[data-id="p1"]'); await pg.waitForTimeout(400);
  const op = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).opacity : 'missing'; }, sel);
  ok('before read-only, Snooze is full strength', (await op('#snoozeBtn')) === '1');
  await pg.click('#setBtn'); await pg.click('#roToggle'); await pg.keyboard.press('Escape'); await clear();
  for (const id of ['snoozeBtn', 'routeBtn', 'contactBtn', 'archiveBtn', 'taskBtn']) ok('read-only greys ' + id, (await op('#' + id)) === '0.4', await op('#' + id));
  ok('read-only leaves Summarize alone', (await op('#threadMenu [data-proxy="sumBtn"]')) === '1');
  await pg.click('#routeBtn'); await pg.waitForTimeout(500);
  ok('Route says read-only is on', (await pg.textContent('#modalBody')).includes('Read-only is on'));
  await pg.click('#modalClose');
  await pg.click('#contactBtn'); await pg.waitForTimeout(900);
  ok('Contact says read-only is on', (await pg.textContent('#modalBody')).includes('Read-only is on'));
  ok('Contact still offers vCard', (await pg.textContent('#modalBody')).includes('vCard'));
  await pg.click('#modalClose');
  await pg.click('#snoozeBtn'); await pg.waitForTimeout(300);
  ok('snooze options are greyed', (await op('[data-snz]')) === '0.4' && (await op('[data-rmd]')) === '0.4');
  await pg.click('[data-snz]'); await pg.waitForTimeout(300);
  ok('snooze is blocked', !(await pg.evaluate(() => window.__calls)).some((c) => c.tool === 'label_thread' || c.tool === 'create_label'));
  await pg.keyboard.press('Escape');

  // phone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await mp.addInitScript(fake); await mp.addInitScript(() => { try { localStorage.setItem('cm.readOnly', '1'); } catch (e) {} });
  await mp.goto('file://' + page); await mp.waitForTimeout(800);
  const roOn = await mp.evaluate(() => document.body.classList.contains('ro'));
  if (!roOn) { await mp.tap('#setBtn'); await mp.tap('#roToggle'); await mp.keyboard.press('Escape'); }
  await mp.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await mp.tap('.thread[data-id="p1"]'); await mp.waitForTimeout(500);
  const mop = (sel) => mp.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).opacity : 'missing'; }, sel);
  ok('phone: bar Snooze greyed', (await mop('#phoneBar [data-proxy="snoozeBtn"]')) === '0.4');
  ok('phone: bar Route greyed', (await mop('#phoneBar [data-proxy="routeBtn"]')) === '0.4');
  ok('phone: bar Reply not greyed', (await mop('#replyJump')) === '1');
  await mp.tap('#pbMore'); await mp.waitForTimeout(200);
  ok('phone: More > Add to contacts greyed', (await mop('#threadMenu [data-proxy="contactBtn"]')) === '0.4');

  console.log(results.join('\n'));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
  await b.close();
})().catch((e) => { console.log('HARNESS CRASH', e.message.split('\n')[0]); process.exit(1); });
