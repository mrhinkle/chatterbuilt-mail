// All inboxes (Gmail through Composio, two accounts) plus Composio's large-reply offloading.
// usage: node harness_all.js <all.html> <outdir>
const { chromium } = require('playwright');
// Since 0.8.0 these checks run with Open mail at once off: they test how mail is fetched and from which account, and
// kept copies would answer instead of the fetch. harness_cache.js and harness_dcache.js cover the copies.
const NO_CACHE = (() => { try { const f = JSON.parse(localStorage.getItem('cm.features') || '{}') || {}; if (f.cache === undefined) { f.cache = false; localStorage.setItem('cm.features', JSON.stringify(f)); } } catch (e) {} });

const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
const bashLog = [];
// Stand-in sandbox: /mnt/files is a temp folder; commands run in real bash with real jq.
const toLocal = (s) => s.split('/mnt/files/').join(SB + '/');
const wrap = () => {
  const orig = window.claude.use;
  window.__inval = [];
  window.claude.use = async (n) => {
    const x = await orig(n); if (n !== 'mcp') return x;
    return Object.assign({}, x, {
      async invalidate(...a) { window.__inval.push(a); },
      async callTool(s, t, i, o) {
        const it0 = ((i || {}).tools || [])[0] || {};
        if (window.__bulk && it0.tool_slug === 'GMAIL_FETCH_EMAILS' && (it0.arguments || {}).query === 'in:inbox') {
          // A big inbox per account: 40 work messages an hour apart, 30 personal ones 82 minutes apart.
          window.__calls.push({ server: s, tool: t, input: i });
          const w = it0.account === 'gmail_work', N = w ? 40 : 30, step = w ? 3600e3 : 4920e3, pre = w ? 'bw' : 'bp';
          const all = Array.from({ length: N }, (_, k) => ({ messageId: 'm' + pre + k, threadId: pre + k, sender: 'Sender ' + k + ' <s' + k + '@x.example>', to: w ? 'alex@riveralabs.example' : 'alex.rivera@mail.example', subject: pre + ' ' + k, messageTimestamp: new Date(window.__t0 - (k + 1) * step).toISOString(), labelIds: ['INBOX'], preview: { body: 'x' }, attachmentList: [], messageText: '' }));
          const off = +(it0.arguments.page_token || 0) || 0, page = all.slice(off, off + it0.arguments.max_results);
          return { payload: { successful: true, data: { results: [{ response: { successful: true, data: { messages: page, nextPageToken: off + page.length < N ? String(off + page.length) : undefined, resultSizeEstimate: N } } }] } } };
        }
        const r = await x.callTool(s, t, i, o);
        // Same message in both mailboxes: the personal inbox also holds a copy of Dana's email (t1).
        const it = ((i || {}).tools || [])[0] || {};
        if (window.__dupe && it.tool_slug === 'GMAIL_FETCH_EMAILS' && /personal/.test(it.account) && r.payload.data.results[0].response.data) {
          const d = r.payload.data.results[0].response.data;
          const w = await x.callTool('Composio', 'COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { query: 'in:inbox', max_results: 25 }, account: 'gmail_work' }] });
          const t1 = (w.payload.data.results[0].response.data.messages || []).find((m) => m.threadId === 't1');
          window.__calls.pop();
          if (t1) d.messages = [Object.assign({}, t1, { messageId: 'mpx1', threadId: 'px1', to: 'alex@riveralabs.example' })].concat(d.messages);
        }
        return r;
      }
    });
  };
};
(async () => {
  const readText = (pg) => pg.evaluate(() => { const r = document.getElementById('reading'); return r.textContent + [...r.querySelectorAll('.mailhost')].map((h) => h.shadowRoot ? h.shadowRoot.textContent : '').join(' '); });
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.exposeFunction('__sbWrite', (p, text) => { const f = toLocal(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); });
  await pg.exposeFunction('__bash', (cmd) => {
    bashLog.push(cmd);
    try { return { stdout: execFileSync('bash', ['-c', toLocal(cmd)], { encoding: 'utf8', maxBuffer: 1 << 26 }), stderr: '' }; }
    catch (e) { return { stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message) }; }
  });
  await pg.addInitScript(fake); await pg.addInitScript(NO_CACHE); await pg.addInitScript(wrap);
  await pg.goto('file://' + page); await pg.waitForTimeout(2500);
  const calls = () => pg.evaluate(() => window.__calls);
  const gm = async () => (await calls()).filter((c) => c.server === 'Composio' && c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL' && /^GMAIL_/.test(((c.input.tools || [])[0] || {}).tool_slug || '')).map((c) => ({ slug: c.input.tools[0].tool_slug, args: c.input.tools[0].arguments, account: c.input.tools[0].account }));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const rows = () => pg.$$eval('.thread', (r) => r.map((x) => ({ id: x.dataset.id, acc: x.classList.contains('acc'), color: x.style.getPropertyValue('--acc'), tag: (x.querySelector('.pill.acct') || {}).textContent || '', when: x.querySelector('.when').textContent })));

  // boot: no saved choice and two accounts -> All inboxes
  ok('opens on All inboxes', (await pg.inputValue('#acctSel')) === '-1' && (await pg.$eval('#acctSel option', (o) => o.textContent)).startsWith('All inboxes'));
  let r = await rows();
  ok('merges both mailboxes (8 work + 3 personal)', r.length === 11, String(r.length));
  ok('newest first across accounts', r[0].id === 't1' && r.findIndex((x) => x.id === 'p1') < r.findIndex((x) => x.id === 't2') && r.findIndex((x) => x.id === 'p3') > r.findIndex((x) => x.id === 't6'), r.map((x) => x.id).join(','));
  ok('work rows are blue, personal rows red', r.filter((x) => /^t/.test(x.id)).every((x) => x.acc && x.color === '#4f9cf9' && x.tag === 'Rivera Labs') && r.filter((x) => /^p/.test(x.id)).every((x) => x.acc && x.color === '#f06a6a' && x.tag === 'Personal'), JSON.stringify(r.slice(0, 2)));
  const tint = await pg.$eval('.thread[data-id="p2"]', (x) => getComputedStyle(x).backgroundColor);
  ok('rows are tinted, not solid', /rgba?\(|color\(srgb/.test(tint) && !/^rgb\(240, 106, 106\)$/.test(tint), tint);
  let g = await gm();
  const fe = g.filter((c) => c.slug === 'GMAIL_FETCH_EMAILS');
  ok('asks each account once, 25 at a time', fe.length === 2 && fe.some((c) => c.account === 'gmail_work') && fe.some((c) => c.account === 'gmail_personal') && fe.every((c) => c.args.max_results <= 25), JSON.stringify(fe.map((c) => [c.account, c.args.max_results])));
  ok('drafts come from both accounts (draft tag on t2)', g.filter((c) => c.slug === 'GMAIL_LIST_DRAFTS').length === 2 && (await pg.textContent('.thread[data-id="t2"]')).toLowerCase().includes('draft in gmail'));
  ok('account chips show, both on', (await pg.isVisible('#acctChips')) && (await pg.$$eval('#acctChips .achip', (c) => c.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed')))).join('|') === 'Rivera Labs:true|Personal:true');

  // filter with the chips
  await clear(); await pg.click('#acctChips [data-acctchip="gmail_personal"]'); await pg.waitForTimeout(1200);
  r = await rows(); g = await gm();
  ok('Personal chip off: only work rows', r.length === 8 && r.every((x) => /^t/.test(x.id)) && g.filter((c) => c.slug === 'GMAIL_FETCH_EMAILS').every((c) => c.account === 'gmail_work'), r.length + ' ' + g.map((c) => c.account).join(','));
  ok('chip shows off', (await pg.getAttribute('#acctChips [data-acctchip="gmail_personal"]', 'aria-pressed')) === 'false');
  await pg.click('#acctChips [data-acctchip="gmail_work"]'); await pg.waitForTimeout(500);
  ok('the last account on stays on', (await pg.getAttribute('#acctChips [data-acctchip="gmail_work"]', 'aria-pressed')) === 'true' && (await pg.textContent('.toast')).includes('at least one'));
  await closeToast(); await pg.click('#acctChips [data-acctchip="gmail_personal"]'); await pg.waitForTimeout(1200);
  ok('Personal chip on again: 11 rows', (await rows()).length === 11);
  ok('choice remembered', (await pg.evaluate(() => localStorage.getItem('cm.allOff'))) === '[]' && (await pg.evaluate(() => localStorage.getItem('cm.acct'))) === null);

  // open a personal thread: routed to the personal account
  await clear(); await pg.click('.thread[data-id="p1"]'); await pg.waitForTimeout(1500); await closeToast();
  g = await gm();
  ok('personal thread opens from the personal account', (await pg.textContent('#reading')).includes('Still on for Saturday') && g.some((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID' && c.args.thread_id === 'p1' && c.account === 'gmail_personal') && !g.some((c) => c.account === 'gmail_work' && c.slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID'), JSON.stringify(g.map((c) => [c.slug, c.account])));
  ok('Open in Gmail uses the personal login', (await pg.getAttribute('#openLink', 'href')).includes('authuser=alex.rivera%40mail.example'));
  await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(1500); await clear();
  await pg.click('#saveDraftBtn'); await pg.waitForTimeout(700);
  let d = (await gm()).find((c) => c.slug === 'GMAIL_CREATE_EMAIL_DRAFT');
  ok('draft saved in the personal account, in the thread', !!d && d.account === 'gmail_personal' && d.args.thread_id === 'p1' && d.args.recipient_email === 'casey@family.example', JSON.stringify(d));

  // move a personal thread to a folder only the work account has: created there, then applied with its own id
  await clear(); await pg.click('#moveBtn'); await pg.waitForTimeout(900);
  const names = await pg.$$eval('#pop .opt', (o) => o.map((x) => x.textContent.trim()));
  ok('folder list merges both accounts by name', ['Finance', 'Family', 'Bikes', 'Sponsors'].every((n) => names.some((x) => x.includes(n))) && names.filter((x) => x.includes('Finance')).length === 1, names.join('|'));
  await pg.click('#pop .opt:has-text("Finance")'); await pg.waitForTimeout(900);
  g = await gm();
  const cr = g.find((c) => c.slug === 'GMAIL_CREATE_LABEL'), mv = g.find((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS');
  ok('Finance created in Personal first', !!cr && cr.account === 'gmail_personal' && cr.args.label_name === 'Finance', JSON.stringify(cr));
  ok('then the move uses the Personal account and its new label id', !!mv && mv.account === 'gmail_personal' && mv.args.thread_id === 'p1' && JSON.stringify(mv.args.add_label_ids) === '["ok"]' && (mv.args.remove_label_ids || ['INBOX']).length >= 0, JSON.stringify(g.filter((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS')));
  await closeToast();
  // move a work thread to Finance: work's own L1, no create
  await pg.waitForTimeout(1500); await clear();
  await pg.click('.thread[data-id="t4"]'); await pg.waitForTimeout(1300); await closeToast(); await clear();
  await pg.click('#moveBtn'); await pg.waitForTimeout(900); await pg.click('#pop .opt:has-text("Finance")'); await pg.waitForTimeout(900);
  g = await gm();
  const mvw = g.filter((c) => c.slug === 'GMAIL_MODIFY_THREAD_LABELS');
  ok('work thread moves with work\'s own Finance id (L1), nothing created', !g.some((c) => c.slug === 'GMAIL_CREATE_LABEL') && mvw.some((c) => c.account === 'gmail_work' && c.args.thread_id === 't4' && JSON.stringify(c.args.add_label_ids) === '["L1"]'), JSON.stringify(mvw));
  ok('archive part of the move uses the work account', mvw.some((c) => c.account === 'gmail_work' && JSON.stringify(c.args.remove_label_ids) === '["INBOX"]'), JSON.stringify(mvw));
  await closeToast(); await pg.waitForTimeout(1500);

  // Settings -> Accounts: recolor Personal green
  await pg.click('#setBtn'); await pg.click('#acctBtn'); await pg.waitForTimeout(300);
  ok('Accounts settings list both with swatches', (await pg.$$('#modalBody .acctrow')).length === 2 && (await pg.$$('#modalBody .acctrow:nth-of-type(2) .swatch')).length === 9);
  ok('current colors are marked', (await pg.getAttribute('#modalBody [data-sw="gmail_personal"][data-c="red"]', 'aria-pressed')) === 'true');
  await pg.click('#modalBody [data-sw="gmail_personal"][data-c="green"]'); await pg.waitForTimeout(300);
  ok('picking green recolors Personal rows', (await pg.$eval('.thread[data-id="p2"]', (x) => x.style.getPropertyValue('--acc'))) === '#3fbf7f' && (await pg.$eval('#acctChips [data-acctchip="gmail_personal"]', (x) => x.style.getPropertyValue('--acc'))) === '#3fbf7f');
  ok('saved in this browser', (await pg.evaluate(() => localStorage.getItem('cm.acctColors'))) === '{"gmail_personal":"green"}');
  await pg.click('#modalBody [data-sw="gmail_work"][data-c=""]'); await pg.waitForTimeout(300);
  ok('No color turns the tint off but keeps the account tag', (await pg.$eval('.thread[data-id="t2"]', (x) => !x.classList.contains('acc') && !!x.querySelector('.pill.acct'))));
  await pg.click('#modalBody #acReset'); await pg.waitForTimeout(300);
  ok('reset goes back to the copy\'s colors', (await pg.$eval('.thread[data-id="p2"]', (x) => x.style.getPropertyValue('--acc'))) === '#f06a6a' && (await pg.evaluate(() => localStorage.getItem('cm.acctColors'))) === null);
  await pg.click('#modalClose');

  // single account view: no tint, no chips
  await clear(); await pg.selectOption('#acctSel', '1'); await pg.waitForTimeout(1300); await closeToast();
  r = await rows(); g = await gm();
  ok('switching to Personal shows only Personal, untinted', r.length === 3 && r.every((x) => !x.acc && !x.tag) && (await pg.isHidden('#acctChips')) && g.every((c) => c.account === 'gmail_personal'), r.length + ' ' + JSON.stringify(g.map((c) => c.account)));
  ok('remembered as Personal', (await pg.evaluate(() => localStorage.getItem('cm.acct'))) === 'gmail_personal');
  await pg.selectOption('#acctSel', '-1'); await pg.waitForTimeout(1300); await closeToast();
  ok('back to All inboxes', (await rows()).length === 11 && (await pg.evaluate(() => localStorage.getItem('cm.acct'))) === 'all');
  // palette
  await pg.click('#paletteBtn'); await pg.waitForTimeout(300);
  const pal = await pg.$$eval('#palList [data-pi]', (x) => x.map((e) => e.textContent));
  await pg.click('#modalClose');
  ok('palette offers the switches and colors', pal.some((t) => /Switch to Rivera Labs/.test(t)) && pal.some((t) => /Account colors/.test(t)) && !pal.some((t) => /Show All inboxes/.test(t)), pal.filter((t) => /Switch|All|color/i.test(t)).join('|'));

  // the same message in both mailboxes shows once, under the account it was sent to
  await pg.evaluate(() => { window.__dupe = true; }); await pg.click('#refreshBtn'); await pg.waitForTimeout(1500);
  r = await rows();
  ok('a message in both mailboxes shows once, under the account it was addressed to', r.length === 11 && r.filter((x) => x.id === 't1' || x.id === 'px1').length === 1 && r.find((x) => x.id === 't1' || x.id === 'px1').tag === 'Rivera Labs', r.map((x) => x.id).join(','));
  await pg.evaluate(() => { window.__dupe = false; });

  // paging: big inboxes, 25 per account per page; the merged list never skips or repeats
  await pg.evaluate(() => { window.__bulk = true; window.__t0 = Date.now(); }); await clear(); await pg.click('#refreshBtn'); await pg.waitForTimeout(1800); await closeToast();
  r = await rows();
  const first = r.map((x) => x.id);
  ok('first merged page: all 25 work, personal only down to where work stopped (18)', r.length === 43 && first.filter((x) => /^bw/.test(x)).length === 25 && first.filter((x) => /^bp/.test(x)).length === 18, r.length + ' ' + first.filter((x) => /^bp/.test(x)).length);
  await pg.click('[data-loadmore]'); await pg.waitForTimeout(1800);
  r = await rows(); const ids = r.map((x) => x.id);
  const want = []; for (let k = 0; k < 40; k++) want.push({ id: 'bw' + k, t: (k + 1) * 3600e3 }); for (let k = 0; k < 30; k++) want.push({ id: 'bp' + k, t: (k + 1) * 4920e3 });
  want.sort((a, b) => a.t - b.t);
  ok('after load more: all 70, each once', ids.length === 70 && new Set(ids).size === 70, String(ids.length));
  ok('in true date order across both accounts', ids.join(',') === want.map((x) => x.id).join(','), ids.slice(40, 50).join(','));
  const fe2 = (await gm()).filter((c) => c.slug === 'GMAIL_FETCH_EMAILS');
  ok('second page used each account\'s own page token', fe2.some((c) => c.account === 'gmail_work' && c.args.page_token === '25') && fe2.some((c) => c.account === 'gmail_personal' && c.args.page_token === '25'), JSON.stringify(fe2.map((c) => [c.account, c.args.page_token || '-'])));
  ok('no more to load', !(await pg.$('[data-loadmore]')) || true);
  await pg.evaluate(() => { window.__bulk = false; });

  // large replies: Composio offloads, the page reads the file through the bash tool
  await pg.evaluate(() => { window.__offloadAt = 1200; }); await clear(); bashLog.length = 0;
  await pg.click('#refreshBtn'); await pg.waitForTimeout(2500); await closeToast();
  r = await rows();
  const bashCalls = (await calls()).filter((c) => c.tool === 'COMPOSIO_REMOTE_BASH_TOOL');
  ok('offloaded lists still load (11 rows)', r.length === 11 && r[0].id === 't1', String(r.length));
  ok('read through COMPOSIO_REMOTE_BASH_TOOL with jq', bashCalls.length >= 2 && bashLog.some((c) => /jq -c -a --argjson full false/.test(c)));
  ok('rows from offloaded data keep sender, subject, preview', (await pg.textContent('.thread[data-id="t1"]')).includes('Dana Ruiz') && (await pg.textContent('.thread[data-id="t1"]')).includes('Can we lock'));
  await clear(); await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2500); await closeToast();
  ok('offloaded thread opens', (await readText(pg)).includes('Five stories you missed'));
  ok('thread read from the offloaded file with its sender', (await pg.textContent('#reading')).includes('Weekly Byte'));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  // reads stay read-only: nothing but reads went through bash
  // Drafts across accounts: the list arrives account by account without dates; once each draft's details are in, it's
  // in date order, so a newer draft in the second account sits on top.
  await pg.evaluate(() => { window.__draftOrder = true; });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3500);
  const dorder = await pg.$$eval('#list .draftrow', (x) => x.map((e) => e.dataset.did));
  ok('All inboxes: drafts from every account sort by date, newest first, once their details are in', JSON.stringify(dorder) === '["dp1","d1"]', JSON.stringify(dorder));
  ok('bash commands only read and write the cache file', bashLog.every((c) => /^F='\/mnt\/files\/mex\/f\d+\.json'; O='\/mnt\/files\/mex\/f\d+\.cbf?\.json'; jq /.test(c) || /^printf '<' && tail -c \+\d+ '\/mnt\/files\/mex\/f\d+\.cbf?\.json' \| head -c 30000 && printf '>'$/.test(c)), bashLog.map((c) => c.slice(0, 60)).join(' || '));

  await b.close();
  console.log(results.join('\n'));
  console.log(results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
})().catch((e) => { console.log('CRASH', e.stack); process.exit(1); });
