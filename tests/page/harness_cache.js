// Open mail at once (0.8.0): kept copies of threads open without a fetch, load ahead, survive a reload, give way to
// new mail, catch up quietly, drop on a write, clear, and switch off. Context briefs are kept and built ahead. Both
// Gmail paths: the claude.ai connector (demo) and Composio (gx).
// usage: node harness_cache.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
// Counts the AI calls that write a context brief.
const slowGets = () => { const orig = window.claude.use; window.claude.use = async (n) => { const x = await orig(n); if (n !== 'mcp' || !x) return x; return Object.assign({}, x, { async callTool(sv, t, i, o) { if (window.__slowGet && t === 'get_thread') await new Promise((r) => setTimeout(r, 1500)); return x.callTool(sv, t, i, o); } }); }; };
const countBriefs = () => { const orig = window.claude.use; window.__briefs = 0; window.claude.use = async (n) => { const x = await orig(n); if (n !== 'sample' || !x) return x; const f = async (p, o) => { if (/You brief /.test(String(p))) window.__briefs++; return x(p, o); }; return Object.assign(f, x); }; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = []; global.__res = res;
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  let ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); // one context, so IndexedDB and local storage carry over
  async function page(src, name, init) {
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(slowGets); await pg.addInitScript(countBriefs); if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const gets = (pg, id) => pg.evaluate((i) => window.__calls.filter((c) => c.tool === 'get_thread' && (!i || c.input.threadId === i)).length, id);
  const gxGets = (pg, id) => pg.evaluate((i) => window.__calls.filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL' && ((c.input && c.input.tools) || []).some((t) => t.tool_slug === 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID' && (!i || t.arguments.thread_id === i))).length, id);
  const meetings = (pg) => pg.evaluate(() => window.__calls.filter((c) => JSON.stringify(c.input || {}).includes('"MEETINGS"')).length);
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; window.__briefs = 0; });
  const openRow = async (pg, id, wait) => { if (await pg.isVisible('.back')) { await pg.click('.back'); await pg.waitForTimeout(300); } await pg.click('.thread[data-id="' + id + '"]'); await pg.waitForTimeout(wait || 900); };
  const shown = (pg) => pg.evaluate(() => ({ subj: document.getElementById('subject').textContent, msgs: document.querySelectorAll('#reading article.msg').length, mids: [...document.querySelectorAll('#reading article.msg')].map((a) => a.dataset.mid).join(',') }));
  const ctxText = (pg) => pg.evaluate(() => { return ['ctxBox', 'sideBody'].map((id) => { const e = document.getElementById(id); return e ? e.innerText : ''; }).join(' '); });

  // ---------- the claude.ai connector ----------
  let pg = await page(DEMO, 'c1'); await pg.waitForTimeout(2500);
  const first = await pg.evaluate(() => [...document.querySelectorAll('#list .thread')].map((e) => e.dataset.id));
  ok('the list loads its threads (and keeps them)', first.length >= 6 && (await gets(pg)) >= 5, first.join(','));
  await clear(pg); await openRow(pg, first[1]);
  let s = await shown(pg);
  ok('a thread already loaded opens without fetching it again', (await gets(pg, first[1])) === 0 && s.msgs > 0 && s.subj !== 'Loading…', JSON.stringify(s.subj));
  await pg.waitForTimeout(1700);
  ok('Speed records it as opened from a kept copy', (await pg.evaluate(() => JSON.parse(localStorage.getItem('cm.speed') || '[]').some((r) => r.l === 'Open a thread (kept copy)'))));
  // the next thread's brief is built ahead
  await pg.waitForTimeout(2500); await clear(pg);
  await pg.keyboard.press('j'); await pg.waitForTimeout(900);
  s = await shown(pg); let ct = await ctxText(pg);
  ok('j opens the next thread from its copy', (await gets(pg, first[2])) === 0 && s.msgs > 0, JSON.stringify(s.subj));
  ok('…with its context brief already built', (await meetings(pg)) === 0 && (await pg.evaluate(() => window.__briefs)) === 0 && /From your systems/i.test(ct) && !/Checking \d+ systems/.test(ct), ct.slice(0, 120).replace(/\n/g, ' | '));
  await pg.close();

  // a reload: the list, the copies and the briefs are still there
  pg = await page(DEMO, 'c2', () => { window.__calls = []; }); await pg.waitForTimeout(1500);
  ok('after a reload, the list opens without fetching any thread', (await gets(pg)) === 0, String(await gets(pg)));
  await clear(pg); await openRow(pg, first[1]);
  s = await shown(pg); ct = await ctxText(pg);
  ok('after a reload, a thread opens from its kept copy', (await gets(pg, first[1])) === 0 && s.msgs > 0);
  ok('…and its context brief comes back without asking your systems again', (await meetings(pg)) === 0 && (await pg.evaluate(() => window.__briefs)) === 0 && /From your systems/i.test(ct), ct.slice(0, 100).replace(/\n/g, ' | '));

  // new mail: once the list shows a newer message, the copy gives way
  await pg.evaluate((id) => { window.__newer = { [id]: 'mNEW-a' }; }, first[3]);
  await pg.click('.back').catch(() => {}); await pg.waitForTimeout(300);
  await pg.evaluate(() => document.getElementById('refreshBtn').click()); await pg.waitForTimeout(1500);
  await clear(pg); await openRow(pg, first[3], 1400);
  s = await shown(pg);
  ok('a thread with a newer message than its copy is fetched again', (await gets(pg, first[3])) === 1 && s.mids.split(',').includes('mNEW-a'), s.mids);
  await pg.close();

  // a copy over a minute old opens at once, then catches up: here a message arrives that the list doesn't know of yet
  pg = await page(DEMO, 'c3'); await pg.waitForTimeout(1200);
  const age = await pg.evaluate((id) => new Promise((res) => { const r = indexedDB.open('cm-mail'); r.onsuccess = () => { const tx = r.result.transaction('threads', 'readwrite'); const st = tx.objectStore('threads'); const g = st.get('g:' + id); g.onsuccess = () => { const e = g.result; if (!e) return res('none'); e.at = Date.now() - 5 * 60000; st.put(e, 'g:' + id); }; tx.oncomplete = () => res('ok'); }; r.onerror = () => res('err'); }), first[4]);
  await pg.close();
  pg = await page(DEMO, 'c4'); await pg.waitForTimeout(1000);
  await pg.evaluate((id) => { window.__newer = { [id]: 'mNEW-b' }; window.__slowGet = true; }, first[4]);
  await clear(pg); await pg.click('.thread[data-id="' + first[4] + '"]'); await pg.waitForTimeout(400);
  const early = await shown(pg);
  await pg.waitForTimeout(2500); s = await shown(pg); await pg.evaluate(() => { window.__slowGet = false; });
  ok('an older copy opens at once', age === 'ok' && early.msgs > 0 && !early.mids.split(',').includes('mNEW-b'), age + ' ' + early.mids);
  ok('…then a quiet check shows the message that came in since', (await gets(pg, first[4])) === 1 && s.mids.split(',').includes('mNEW-b'), s.mids);

  // a write to a thread drops its copy
  await openRow(pg, first[5]); await clear(pg);
  await pg.evaluate(() => document.getElementById('starBtn').click()); await pg.waitForTimeout(1000);
  const wrote = await pg.evaluate(() => window.__calls.filter((c) => /label/.test(c.tool)).length);
  const order = await pg.evaluate((id) => window.__calls.map((c) => /label/.test(c.tool) ? 'w' : c.tool === 'get_thread' && c.input.threadId === id ? 'g' : '').join(''), first[5]);
  ok('after a change to a thread (Star), it is fetched fresh rather than shown from its copy', wrote > 0 && /w.*g/.test(order), order);

  // Settings → Speed: what's kept, how far ahead, Clear
  await pg.click('#setBtn'); await pg.waitForTimeout(150); await pg.click('#speedBtn'); await pg.waitForTimeout(300);
  let mt = await pg.textContent('#modalBody');
  ok('Speed says how many threads are kept', /\d+ threads? kept in this browser/.test(mt) && await pg.isVisible('#aheadSel') && await pg.isVisible('#tcClearBtn'), (mt.match(/[^.]*kept in this browser[^.]*/) || [''])[0]);
  await pg.click('#tcClearBtn'); await pg.waitForTimeout(600); mt = await pg.textContent('#modalBody');
  ok('Clear kept mail empties it', /Nothing kept yet/.test(mt) && /Cleared/.test(mt));
  await pg.selectOption('#aheadSel', '0'); await pg.waitForTimeout(100);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  await openRow(pg, first[0]); await clear(pg); await openRow(pg, first[1]);
  ok('after Clear, a thread is fetched again', (await gets(pg, first[1])) === 1);
  ok('local storage holds only the index of what is kept, never mail', await pg.evaluate(() => { const v = localStorage.getItem('cm.tc') || '{}'; return !/Dana|gold|sponsor/i.test(v); }));
  await pg.close();

  // switched off: every open fetches, nothing new is kept
  pg = await page(DEMO, 'c5', () => { localStorage.setItem('cm.features', JSON.stringify({ cache: false })); }); await pg.waitForTimeout(800);
  await openRow(pg, first[2]); await openRow(pg, first[0]); await clear(pg); await openRow(pg, first[2]);
  ok('with Open mail at once off, a thread is fetched every time', (await gets(pg, first[2])) === 1);
  await pg.close(); await ctx.close();

  // ---------- Composio ----------
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  pg = await page(GXP, 'g1'); await pg.waitForTimeout(3500);
  const grow = await pg.evaluate(() => [...document.querySelectorAll('#list .thread')].map((e) => e.dataset.id));
  const ahead = []; for (const id of grow.slice(0, 5)) ahead.push(await gxGets(pg, id));
  ok('Composio: the top threads load ahead', ahead.every((n) => n >= 1), grow.slice(0, 5).join(',') + ' → ' + ahead.join(','));
  await clear(pg); await openRow(pg, grow[2]);
  s = await shown(pg);
  ok('Composio: a thread loaded ahead opens without a fetch', (await gxGets(pg, grow[2])) === 0 && s.msgs > 0, JSON.stringify(s.subj));
  await pg.waitForTimeout(2000); await clear(pg); await pg.keyboard.press('j'); await pg.waitForTimeout(900);
  s = await shown(pg);
  ok('Composio: j opens the next one from its copy too', (await gxGets(pg, grow[3])) === 0 && s.msgs > 0);
  await pg.close(); await ctx.close();

  console.log(res.join('\n'));
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  console.log('PASSED', res.filter((r) => r.startsWith('PASS')).length, 'of', res.length);
  await b.close();
})().catch((e) => { console.log((global.__res || []).join('\n')); console.error('HARNESS CRASH', e.message.slice(0, 600)); process.exit(1); });
