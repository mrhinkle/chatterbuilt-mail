// Gmail through Composio, two accounts: every Gmail call goes through COMPOSIO_MULTI_EXECUTE_TOOL with the right
// account; replies, drafts, labels, unsubscribe, Waiting and drafts work; the switcher swaps mailboxes; reads retry,
// writes don't; read-only still blocks writes.
// usage: node harness_gx.js <built.html> <outdir>
const { chromium } = require('playwright');
// Since 0.8.0 these checks run with Open mail at once off: they test how mail is fetched and shown, and kept copies
// would answer instead of the fetch. harness_cache.js and harness_dcache.js cover the copies.
const NO_CACHE = (() => { try { const f = JSON.parse(localStorage.getItem('cm.features') || '{}') || {}; if (f.cache === undefined) { f.cache = false; localStorage.setItem('cm.features', JSON.stringify(f)); } } catch (e) {} });

const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const wrap = () => {
  const orig = window.claude.use;
  window.__fails = 0; window.__failOnce = {};
  window.claude.use = async (n) => {
    const x = await orig(n); if (n !== 'mcp') return x;
    return Object.assign({}, x, { async callTool(s, t, i, o) {
      const it = ((i || {}).tools || [])[0] || {};
      if (window.__failOnce[it.tool_slug]) { delete window.__failOnce[it.tool_slug]; window.__fails++; window.__calls.push({ server: s, tool: t, input: i, failed: true }); throw { code: 'upstream_error', retryable: true, retryAfterMs: 10, message: 'try again' }; }
      return x.callTool(s, t, i, o);
    } });
  };
};
(async () => {
  const readText = (pg) => pg.evaluate(() => { const r = document.getElementById('reading'); return r.textContent + [...r.querySelectorAll('.mailhost')].map((h) => h.shadowRoot ? h.shadowRoot.textContent : '').join(' '); });
  const b = await chromium.launch(); const errs = []; const results = global.__r = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.addInitScript(NO_CACHE); await pg.addInitScript(wrap);
  await pg.goto('file://' + page); await pg.waitForTimeout(2500);
  const calls = () => pg.evaluate(() => window.__calls);
  const gm = async () => (await calls()).filter((c) => c.server === 'Composio' && /^GMAIL_/.test(((c.input.tools || [])[0] || {}).tool_slug || '')).map((c) => Object.assign({ slug: c.input.tools[0].tool_slug, args: c.input.tools[0].arguments, account: c.input.tools[0].account, failed: c.failed }));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // boot
  ok('no calls to the Gmail connector', !(await calls()).some((c) => c.server === 'Gmail'));
  ok('inbox lists the work mailbox (8 threads)', (await pg.$$('.thread')).length === 8, String((await pg.$$('.thread')).length));
  const g0 = await gm();
  ok('list came from GMAIL_FETCH_EMAILS, metadata only', g0.some((c) => c.slug === 'GMAIL_FETCH_EMAILS' && c.args.include_payload === false && c.args.query === 'in:inbox'));
  ok('every Gmail call names the work account', g0.length > 0 && g0.every((c) => c.account === 'gmail_work'), g0.map((c) => c.account).join(','));
  ok('rows show sender, subject and preview', (await pg.textContent('.thread[data-id="t1"]')).includes('Dana Ruiz') && (await pg.textContent('.thread[data-id="t1"]')).includes('Sponsorship for the spring summit'));
  ok('unread dot from labels', (await pg.$$('.thread.unread')).length >= 3);
  ok('header has an account switcher', (await pg.isVisible('#acctSel')) && (await pg.$$eval('#acctSel option', (o) => o.map((x) => x.textContent))).join('|') === 'All inboxes · 2 accounts|Rivera Labs · alex@riveralabs.example|Personal · alex.rivera@mail.example');
  ok('drafts list maps to threads (draft tag on t2)', (await pg.textContent('.thread[data-id="t2"]')).toLowerCase().includes('draft in gmail'));
  ok('Today shows the draft waiting', (await pg.textContent('.today')).includes('Lee Park'));

  // read retry
  await clear(); await pg.evaluate(() => { window.__failOnce.GMAIL_FETCH_MESSAGE_BY_THREAD_ID = true; });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500); await closeToast();
  const g1 = await gm();
  // The failed read and its one retry (the thread now comes with its HTML in that one fetch, so two calls; a second retry would make three).
  ok('a retryable read failure retries once and the thread opens', (await readText(pg)).includes('Can we lock the gold package') && g1.filter((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID').length === 2, g1.map((c) => c.slug).join(','));
  ok('thread fetched by thread_id', g1.some((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID' && c.args.thread_id === 't1'));
  ok('Open in Gmail points at the right account', (await pg.getAttribute('#openLink', 'href')).includes('authuser=alex%40riveralabs.example') && (await pg.getAttribute('#openLink', 'href')).includes('#all/t1'));

  // save draft
  await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(1500); await clear();
  await pg.click('#saveDraftBtn'); await pg.waitForTimeout(600);
  const d = (await gm()).find((c) => c.slug === 'GMAIL_CREATE_EMAIL_DRAFT');
  ok('save draft creates a Composio draft in the thread', !!d && d.args.thread_id === 't1' && d.args.recipient_email === 'dana@acmerobotics.example' && d.args.include_signature === true && /Dana/.test(d.args.body), JSON.stringify(d && d.args).slice(0, 200));
  ok('save draft says saved', (await pg.textContent('#composeNote')).includes('Saved to Gmail drafts'));

  // reply all with cc
  await pg.click('.thread[data-id="t6"]'); await pg.waitForTimeout(3500); await closeToast();
  await pg.$eval('#replyAll', (c) => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); await pg.fill('#body', 'Thanks Morgan. Jordan, great to meet you. Alex');
  await pg.click('#sendBtn'); await pg.waitForTimeout(1500);
  if (await pg.isVisible('#sendBtn')) { await pg.click('#sendBtn'); await pg.waitForTimeout(500); }
  await clear(); if (await pg.isVisible('#confirmSend')) await pg.click('#confirmSend'); await pg.waitForTimeout(800);
  const r = (await gm()).find((c) => c.slug === 'GMAIL_REPLY_TO_THREAD');
  ok('reply all goes to the sender with the cc kept', !!r && r.args.thread_id === 't6' && r.args.recipient_email === 'morgan@cityworks.example' && JSON.stringify(r.args.cc) === '["jordan@makerspace.example"]' && r.args.include_signature === true, JSON.stringify(r && r.args).slice(0, 240));
  ok('reply never includes yourself', !!r && !JSON.stringify(r.args).includes('alex@riveralabs.example'));

  // labels / move menu
  await closeToast(); await pg.click('.thread[data-id="t4"]'); await pg.waitForTimeout(3000); await closeToast();
  await pg.click('#moveBtn'); await pg.waitForTimeout(800);
  const mv = await pg.textContent('#pop');
  ok('move menu lists user labels only', mv.includes('Finance') && mv.includes('Sponsors') && !mv.includes('INBOX'));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);

  // write never retries
  await clear(); await pg.evaluate(() => { window.__failOnce.GMAIL_MODIFY_THREAD_LABELS = true; window.__fails = 0; });
  await pg.click('#archiveBtn'); await pg.waitForTimeout(1500);
  const w = (await gm()).filter((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS');
  ok('a failed write is not retried', w.length === 1 && w[0].failed === true, JSON.stringify(w.map((x) => x.failed)));
  await closeToast();
  await clear(); await pg.click('.thread[data-id="t4"]').catch(() => {}); await pg.waitForTimeout(2500); await closeToast(); await clear();
  await pg.click('#archiveBtn'); await pg.waitForTimeout(1200);
  const a2 = (await gm()).find((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS');
  ok('archive removes INBOX through Composio', !!a2 && a2.args.thread_id === 't4' && JSON.stringify(a2.args.remove_label_ids) === '["INBOX"]' && a2.account === 'gmail_work', JSON.stringify(a2 && a2.args));
  await closeToast();

  // unsubscribe header
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(3000); await closeToast(); await clear();
  await pg.click('#threadMoreBtn'); await pg.waitForTimeout(150); await pg.click('#threadMenu #unsubBtn'); await pg.waitForTimeout(1800);
  const us = await pg.textContent('#pop');
  ok('unsubscribe reads List-Unsubscribe from the headers', /weeklybyte\.example\/u\?x=demo|leave@weeklybyte\.example/.test(us), us.replace(/\s+/g, ' ').slice(0, 160));
  ok('headers fetched as metadata, not the raw message', (await gm()).some((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID' && c.args.format === 'metadata'));
  await pg.keyboard.press('Escape');

  // formatted view uses html
  // Formatted is the default now: the HTML part renders in the message's shadow root.
  await pg.waitForTimeout(1200);
  ok('formatted view renders the HTML part', await pg.evaluate(() => [...document.querySelectorAll('#reading .mailhost')].some((h) => h.shadowRoot && h.shadowRoot.textContent.includes('The Weekly Byte') && h.shadowRoot.querySelectorAll('h2, table').length > 0)));

  // Waiting checks approx threads in full
  await clear(); await pg.click('.chip[data-key="waiting"]'); await pg.waitForTimeout(3500);
  const gw = await gm();
  ok('Waiting finds Jordan', (await pg.textContent('#list')).includes('Jordan'));
  ok('Waiting verifies each sent thread in full', gw.filter((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID').length >= 1);
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(2000);

  // draft box text via get_draft
  await clear(); await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(3500); await closeToast();
  const db = await pg.textContent('#draftBox');
  ok('draft box shows the Gmail draft text', db.includes('Tuesday at 10'), db.replace(/\s+/g, ' ').slice(0, 120));
  ok('draft text came from GMAIL_GET_DRAFT', (await gm()).some((c) => c.slug === 'GMAIL_GET_DRAFT' && c.args.draft_id === 'd1'));

  // attachments are off
  ok('Attach is hidden with Composio', !(await pg.isVisible('[data-feat="attach"]')));

  // palette
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+k'); await pg.waitForTimeout(200);
  ok('palette offers Switch to Personal', (await pg.textContent('#palList')).includes('Switch to Personal'));
  await pg.keyboard.press('Escape');

  // switch account
  await clear(); await pg.selectOption('#acctSel', '1'); await pg.waitForTimeout(2500);
  const gs = await gm();
  ok('switching shows the personal mailbox', (await pg.$$('.thread')).length === 3 && (await pg.textContent('#list')).includes('Casey Rivera'));
  ok('calls now name the personal account', gs.length > 0 && gs.every((c) => c.account === 'gmail_personal'), gs.map((c) => c.account).join(','));
  ok('switching closes the open thread and shows Today', (await pg.textContent('#subject')) === 'Today');
  ok('the switch is remembered', (await pg.evaluate(() => localStorage.getItem('cm.acct'))) === 'gmail_personal');
  await pg.click('.thread[data-id="p1"]'); await pg.waitForTimeout(3000); await closeToast();
  ok('a personal thread opens', (await pg.textContent('#reading')).includes('Still on for Saturday'));
  ok('Open in Gmail follows the account', (await pg.getAttribute('#openLink', 'href')).includes('authuser=alex.rivera%40mail.example'));
  await pg.click('#moveBtn'); await pg.waitForTimeout(800);
  ok('labels reload for the new account', (await pg.textContent('#pop')).includes('Family') && !(await pg.textContent('#pop')).includes('Sponsors'));
  await pg.keyboard.press('Escape');
  await pg.reload(); await pg.waitForTimeout(2500);
  ok('reload opens the remembered account', (await pg.$eval('#acctSel', (s) => s.value)) === '1' && (await pg.textContent('#list')).includes('Casey Rivera'));
  await pg.selectOption('#acctSel', '0'); await pg.waitForTimeout(2500);
  ok('switch back to work', (await pg.$$('.thread')).length === 8);

  // read-only still blocks
  await pg.click('.thread[data-id="t3"]'); await pg.waitForTimeout(3000); await closeToast();
  await pg.evaluate(() => { localStorage.setItem('cm.ro', '1'); }); await pg.reload(); await pg.waitForTimeout(2500);
  await pg.click('.thread[data-id="t3"]'); await pg.waitForTimeout(3000); await clear();
  await pg.click('#archiveBtn'); await pg.waitForTimeout(800);
  ok('read-only blocks a Composio write', !(await gm()).some((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS'));
  await pg.evaluate(() => { localStorage.setItem('cm.ro', '0'); });
  ok('no sideways scroll', await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await pg.screenshot({ path: path.join(OUT, 'gx-desk.png') });
  await ctx.close();

  // phone: switcher fits
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const pp = await pc.newPage();
  pp.on('pageerror', (e) => errs.push(e.message)); await pp.addInitScript(fake); await pp.addInitScript(NO_CACHE); await pp.goto('file://' + page); await pp.waitForTimeout(2500);
  ok('phone: no sideways scroll with the switcher', await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await pp.screenshot({ path: path.join(OUT, 'gx-phone.png') });
  await pc.close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(results.join('\n'));
  const f = results.filter((x) => x.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.log((global.__r || []).join('\n')); console.log('CRASH', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(1); });
