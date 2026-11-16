// Fewer, earlier calls: a thread opens with one fetch, a draft and its thread load together, the next draft loads ahead.
// usage: node harness_speed.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
// Since 0.8.0 these checks run with Open mail at once off: they test how mail is fetched and shown, and kept copies
// would answer instead of the fetch. harness_cache.js and harness_dcache.js cover the copies.
const NO_CACHE = (() => { try { const f = JSON.parse(localStorage.getItem('cm.features') || '{}') || {}; if (f.cache === undefined) { f.cache = false; localStorage.setItem('cm.features', JSON.stringify(f)); } } catch (e) {} });

const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
// Times every connector call: when it started and when it answered.
const timing = () => {
  const orig = window.claude.use; window.__t = [];
  window.claude.use = async (n) => { const x = await orig(n); if (n !== 'mcp' || !x) return x; return Object.assign({}, x, { async callTool(s, t, i, o) { const r = { tool: t, input: i, s: performance.now(), e: 0 }; window.__t.push(r); try { return await x.callTool(s, t, i, o); } finally { r.e = performance.now(); } } }); };
};
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, init) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(NO_CACHE); await pg.addInitScript(timing); if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; window.__t = []; });
  const shadow = (pg, mid) => pg.evaluate((m) => { const h = document.querySelector('#reading article.msg[data-mid="' + m + '"] .mailhost'); return h && h.shadowRoot ? h.shadowRoot.textContent : ''; }, mid);

  // ---------- native: one fetch per thread ----------
  let pg = await open(DEMO, 'thread', () => { window.__extraMsg = { t5: { id: 'mtH', plaintextBody: '', htmlBody: '<p>Only <b>HTML</b> in this one</p>' } }; });
  await clear(pg); await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  let gt = (await calls(pg)).filter((c) => c.tool === 'get_thread' && c.input.threadId === 't5');
  ok('opening a thread in the formatted view fetches it once', gt.length === 1 && gt[0].input.messageFormat === 'FULL_CONTENT', JSON.stringify(gt.map((c) => c.input.messageFormat)));
  ok('…and the formatted view shows from that one fetch', /Weekly Byte/.test(await shadow(pg, 'mt5')) && /HTML/.test(await shadow(pg, 'mtH')));
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(400);
  ok('a message sent as HTML only still has text in the plain view', /Only HTML in this one/.test(await pg.textContent('#reading article.msg[data-mid="mtH"] .body')));
  await clear(pg); await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2000);
  gt = (await calls(pg)).filter((c) => c.tool === 'get_thread' && c.input.threadId === 't1');
  ok('with the plain view, it fetches plain text once', gt.length === 1 && gt[0].input.messageFormat === 'PLAIN_TEXT', JSON.stringify(gt.map((c) => c.input.messageFormat)));
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(600);
  await pg.context().close();

  // ---------- native: a draft and its thread load together; the next draft loads ahead ----------
  pg = await open(DEMO, 'drafts');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await clear(pg); await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(2400);
  const tt = await pg.evaluate(() => window.__t.map((r) => ({ tool: r.tool, id: (r.input || {}).draftId || (r.input || {}).threadId, f: (r.input || {}).messageFormat, s: r.s, e: r.e })));
  const gd = tt.find((r) => r.tool === 'get_draft' && r.id === 'd1' && r.f !== 'MINIMAL'), th = tt.find((r) => r.tool === 'get_thread' && r.id === 't2');
  ok('opening a draft fetches it and the thread it answers at the same time', !!gd && !!th && th.s < gd.e, JSON.stringify({ gd, th }));
  ok('…and the next draft starts loading in the background', tt.some((r) => r.tool === 'get_draft' && r.id === 'd2' && r.f !== 'MINIMAL'));
  await pg.waitForTimeout(800); await clear(pg);
  await pg.click('#dNext'); await pg.waitForTimeout(900);
  let cs = await calls(pg);
  ok('Next opens the loaded draft without asking Gmail again', (await pg.inputValue('#dSubj')) === 'Keynote at the spring summit?' && !cs.some((c) => c.tool === 'get_draft' && c.input.draftId === 'd2' && c.input.messageFormat !== 'MINIMAL'), cs.map((c) => c.tool + ':' + (c.input.draftId || c.input.threadId || '')).join(','));
  await pg.waitForTimeout(1200); await clear(pg);
  await pg.click('#dNext'); await pg.waitForTimeout(900);
  cs = await calls(pg);
  ok('…and again for the one after (its thread too)', (await pg.inputValue('#dSubj')) === 'Re: Intro' && !cs.some((c) => (c.tool === 'get_draft' && c.input.draftId === 'd3' && c.input.messageFormat !== 'MINIMAL')), cs.map((c) => c.tool + ':' + (c.input.draftId || c.input.threadId || '')).join(','));
  await pg.context().close();

  // ---------- Composio: one fetch per thread ----------
  pg = await open(GXP, 'gx');
  const gxSlugs = async () => (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').flatMap((c) => c.input.tools || []).map((t) => t.tool_slug);
  await clear(pg); await pg.click('#list .thread[data-id]'); await pg.waitForTimeout(2800);
  const n = (await gxSlugs()).filter((s) => s === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID').length;
  ok('Composio: opening a thread is one Gmail fetch, not two', n === 1, String(n));
  await pg.context().close();

  // ---------- Settings → Speed ----------
  const speedRows = (pg) => pg.$$eval('.speedtab tbody tr', (x) => x.map((r) => [...r.cells].map((c) => c.textContent.trim())));
  pg = await open(DEMO, 'speedui');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(2400);
  await pg.click('#setBtn'); await pg.click('#speedBtn'); await pg.waitForTimeout(300);
  let rows = await speedRows(pg); const lab = rows.map((r) => r[0]);
  ok('Settings → Speed lists what you wait for: opening a thread, a draft, loading the list', ['Open a thread', 'Open a draft', 'Load the list'].every((l) => lab.some((x) => x.startsWith(l))), lab.join(' | '));
  const ot = rows.find((r) => r[0].startsWith('Open a thread'));
  ok('…with how many times and typical, slow and slowest times', !!ot && ot[1] === '2' && /\d+ (ms|s)$/.test(ot[2]) && /\d+ (ms|s)$/.test(ot[4]), JSON.stringify(ot));
  ok('…and every kind of call', lab.includes('Gmail: get_thread') && lab.includes('Gmail: search_threads') && lab.includes('Gmail: get_draft') && !lab.some((l) => /COMPOSIO_MULTI_EXECUTE_TOOL/.test(l)), lab.join(' | '));
  await pg.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await pg.click('#speedCopy'); await pg.waitForTimeout(200);
  const cp = await pg.evaluate(() => window.__copied || '');
  ok('Copy for Claude gives the same as text, and no mail', /^Chatterbuilt Mail speed \(Gmail connector\)/.test(cp) && /Open a thread: 2×, typical/.test(cp) && /Gmail: get_thread:/.test(cp) && !/Dana|gold package|Venue/.test(cp), cp.slice(0, 200));
  await pg.reload(); await pg.waitForTimeout(2200);
  await pg.click('#setBtn'); await pg.click('#speedBtn'); await pg.waitForTimeout(300);
  ok('the timings are still there after a reload', (await speedRows(pg)).some((r) => r[0].startsWith('Open a thread')));
  await pg.click('#speedClear'); await pg.waitForTimeout(200);
  ok('Clear empties it', (await speedRows(pg)).length === 0 && /Nothing yet/.test(await pg.textContent('#modalBody')));
  await pg.context().close();
  pg = await open(GXP, 'speedgx');
  await pg.click('#list .thread[data-id]'); await pg.waitForTimeout(2800);
  await pg.click('#setBtn'); await pg.click('#speedBtn'); await pg.waitForTimeout(300);
  const glab = (await speedRows(pg)).map((r) => r[0]);
  ok('Composio: each hop shows next to the Gmail call it belongs to', glab.includes('Gmail: get_thread') && glab.includes('Composio: GMAIL_FETCH_MESSAGE_BY_THREAD_ID') && glab.includes('Composio: GMAIL_FETCH_EMAILS'), glab.join(' | '));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
