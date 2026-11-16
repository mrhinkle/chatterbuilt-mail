// 0.7.2: messages formatted by default, the context panel opens and closes with a click (a slim strip when closed),
// no purple edge on the context card, threads in All inboxes open from the right account after a reload, and a
// thread Gmail can't find says so in plain words.
// usage: node harness_view.js <demo.html> <all.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, ALL, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1440, height: 860 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const shadowText = (pg, mid) => pg.evaluate((mid) => { const h = document.querySelector('article.msg[data-mid="' + mid + '"] .mailhost'); return h && h.shadowRoot ? h.shadowRoot.textContent : null; }, mid);
  const vis = (pg, sel) => pg.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

  const ONLY = process.env.ONLY || ''; const run = (k) => !ONLY || ONLY === k; let pg;
  // ---- formatted by default ----
  if (run('fmt')) {
  pg = await open(DEMO, 'fmt');
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2500);
  const mid = await pg.$eval('article.msg:last-of-type', (a) => a.dataset.mid);
  const st = await shadowText(pg, mid);
  ok('a newsletter opens formatted, in its own shadow root', !!st && st.includes('The Weekly Byte') && st.includes('Agents that file their own tickets'), st && st.slice(0, 60));
  ok('…keeping its own inline styles', await pg.evaluate((mid) => { const h = document.querySelector('article.msg[data-mid="' + mid + '"] .mailhost'); if (!h || !h.shadowRoot) return false; const d = h.shadowRoot.querySelector('div[style]'); return !!d && /Georgia/.test(d.getAttribute('style')); }, mid));
  ok('…with no raw tags showing as text', !/<(div|p|h1)\b/i.test(st || ''));
  ok('More, Formatted view shows as on', (await pg.getAttribute('#htmlBtn', 'aria-checked')) === 'true');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2500);
  ok('a plain-text message stays text', await pg.evaluate(() => !document.querySelector('article.msg .mailhost') && document.querySelector('article.msg .body').textContent.includes('gold package')));
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2500);
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(400);
  ok('Formatted view off: plain text', await pg.evaluate(() => !document.querySelector('article.msg .mailhost') && /Five stories/.test(document.querySelector('article.msg:last-of-type .body').textContent)));
  await pg.reload(); await pg.waitForTimeout(2200); await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2500);
  ok('…and the choice survives a reload', await pg.evaluate(() => !document.querySelector('article.msg .mailhost')) && (await pg.getAttribute('#htmlBtn', 'aria-checked')) === 'false');
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(800);
  ok('switching it back on formats again', !!(await shadowText(pg, mid)));
  await pg.context().close(); }

  // ---- the context panel: click to close, a strip to open ----
  if (run('side')) {
  pg = await open(DEMO, 'side');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('open: the brief in the panel, no strip', (await pg.textContent('#sideBody')).includes('You owe Dana') && !(await vis(pg, '#sideOpen')));
  ok('no Context button in the thread toolbar', !(await vis(pg, '#sideTog')));
  await pg.click('#side .sidecap .lbl'); await pg.waitForTimeout(300);
  ok('clicking the panel header closes it to a strip', await pg.evaluate(() => document.getElementById('side').classList.contains('min')) && !(await vis(pg, '#sideBody')) && await vis(pg, '#sideOpen'));
  const w = await pg.$eval('#side', (e) => Math.round(e.getBoundingClientRect().width));
  ok('…a slim one', w > 20 && w < 60, w + 'px');
  ok('…and no copy of the brief in the thread', (await pg.textContent('#ctxBox')).trim() === '');
  ok('…and no resize grip on the strip', !(await vis(pg, '#sideSplit')));
  await pg.click('#sideOpen'); await pg.waitForTimeout(400);
  ok('clicking the strip opens it with the brief', !(await pg.evaluate(() => document.getElementById('side').classList.contains('min'))) && (await pg.textContent('#sideBody')).includes('You owe Dana'));
  await pg.click('#sideHide'); await pg.waitForTimeout(300);
  ok('Hide closes it to the strip too', await pg.evaluate(() => document.getElementById('side').classList.contains('min')));
  await pg.reload(); await pg.waitForTimeout(2200); await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(2500);
  ok('closed survives a reload as the strip', await pg.evaluate(() => document.getElementById('side').classList.contains('min')) && await vis(pg, '#sideOpen'));
  await pg.keyboard.press(']'); await pg.waitForTimeout(400);
  ok('] opens it', !(await pg.evaluate(() => document.getElementById('side').classList.contains('min'))) && await vis(pg, '#sideBody'));
  await pg.context().close(); }

  // ---- no purple edge on the context card (narrow screens show it in the thread) ----
  if (run('card')) {
  pg = await open(DEMO, 'card', { width: 1000, height: 860 });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  const edge = await pg.$eval('#ctxBox .ctx', (e) => { const c = getComputedStyle(e); return { l: c.borderLeftWidth + ' ' + c.borderLeftColor, t: c.borderTopWidth + ' ' + c.borderTopColor }; });
  ok('the context card has no purple edge: its left border matches the rest', edge.l === edge.t, JSON.stringify(edge));
  await pg.context().close(); }

  // ---- All inboxes: the right account after a reload, and a friendly not found ----
  if (run('all')) {
  pg = await open(ALL, 'all');
  ok('All inboxes lists the personal thread', !!(await pg.$('.thread[data-id="p1"]')));
  // From the reload on, search fails, so the list can only come back from the session's saved copy and nothing
  // fetched afterwards tells the page which account a thread is in.
  await pg.context().addInitScript(() => { try { if (sessionStorage.getItem('test.failSearch')) window.__failSearch = true; } catch (e) {} });
  await pg.evaluate(() => sessionStorage.setItem('test.failSearch', '1'));
  await pg.reload(); await pg.waitForTimeout(2200);
  ok('after a reload the list comes back from the saved copy', !!(await pg.$('.thread[data-id="p1"]')));
  await pg.click('.thread[data-id="p1"]'); await pg.waitForTimeout(2500);
  const subj = await pg.textContent('#subject'); const body = await pg.textContent('#reading');
  ok('a personal-account thread opens from the restored list', !/Couldn't|Can't find/.test(subj) && !/404|reported an error/.test(body), subj);
  await pg.evaluate(() => { sessionStorage.removeItem('test.failSearch'); window.__failSearch = false; window.__gone404 = ['t3']; });
  await pg.click('.thread[data-id="t3"]'); await pg.waitForTimeout(2500);
  const s2 = await pg.textContent('#subject'); const b2 = await pg.textContent('#reading');
  ok('a thread Gmail can\'t find says so in plain words', s2 === "Can't find this thread" && /can't find this any more/.test(b2), s2 + ' | ' + b2.slice(0, 120));
  ok('…with no raw error showing', !/http_error|\{|404|googleapis/.test(b2), b2.slice(0, 160));
  ok('…and a Refresh the list button', await vis(pg, '#reading [data-refreshlist]'));
  await pg.evaluate(() => { window.__gone404 = []; });
  if (await vis(pg, '#reading [data-refreshlist]')) { await pg.click('#reading [data-refreshlist]'); await pg.waitForTimeout(1800); }
  ok('Refresh the list goes back to the list', (await pg.getAttribute('#app', 'data-view')) !== 'thread');
  await pg.context().close(); }

  // ---- updates: a quiet check shows "Updates available"; the list changes only when you click ----
  if (run('upd')) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } }); pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push('upd: ' + e.message));
  await pg.addInitScript(() => { const real = Date.now.bind(Date); let off = 0; Date.now = () => real() + off; window.__advance = (ms) => { off += ms; }; });
  await pg.addInitScript(fake); await pg.goto('file://' + wrap(DEMO, 'upd.html')); await pg.waitForTimeout(2200);
  const rows = () => pg.$$eval('#list .thread', (x) => x.map((e) => e.dataset.id));
  const before = (await rows()).join();
  ok('no update notice to start', !(await vis(pg, '#updBtn')));
  await pg.evaluate(() => { window.__newIn = ['s1']; window.__advance(200000); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(1200);
  ok('new mail: the header says so', await vis(pg, '#updBtn') && /1 new/.test(await pg.textContent('#updBtn')), await pg.textContent('#updBtn'));
  ok('…and the list has not changed on its own', (await rows()).join() === before);
  ok('screen readers hear it too (a status line, not just the button)', (await pg.getAttribute('#updLive', 'role')) === 'status' && (await pg.textContent('#updLive')) === '1 new thread since the list loaded. Update is in the header.', await pg.textContent('#updLive'));
  await pg.evaluate(() => { window.__liveN = 0; new MutationObserver(() => { window.__liveN++; }).observe(document.getElementById('updLive'), { childList: true, characterData: true, subtree: true }); window.__advance(200000); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(1200);
  ok('…once: the next check with nothing different says nothing again', (await pg.evaluate(() => window.__liveN)) === 0 && await vis(pg, '#updBtn'));
  await pg.click('#updBtn'); await pg.waitForTimeout(1200);
  ok('clicking it updates the list and clears the notice', (await rows())[0] === 's1' && !(await vis(pg, '#updBtn')) && (await pg.textContent('#updLive')) === '', (await rows()).join());
  await pg.evaluate(() => { window.__advance(200000); document.dispatchEvent(new Event('visibilitychange')); }); await pg.waitForTimeout(1200);
  ok('nothing new: no notice', !(await vis(pg, '#updBtn')));
  await ctx.close(); }

  // ---- Today: every draft in Gmail, wrapped, not just drafts on threads in this view ----
  if (run('drafts')) {
  pg = await open(DEMO, 'tdrafts');
  await pg.click('.chip[data-key="unread"]'); await pg.waitForTimeout(1800);
  const card = () => pg.evaluate(() => { const c = [...document.querySelectorAll('.today .tcard')].find((x) => /Drafts waiting in Gmail/.test(x.textContent)); return c ? { n: c.querySelector('.thead .note').textContent, rows: [...c.querySelectorAll('[data-tdraft]')].map((r) => ({ id: r.dataset.tdraft, t: r.textContent, ws: getComputedStyle(r.querySelector('.s')).whiteSpace })) } : null; });
  await pg.waitForTimeout(800); const c = await card();
  // The demo has three drafts in Gmail (d1 on t2, d2 a new email, d3 on s2, a thread not in Unread): all three count.
  ok('the drafts card counts every draft in Gmail, whatever the view', !!c && c.n === '3' && c.rows.length === 3 && c.rows.some((r) => r.id === 'd3'), JSON.stringify(c).slice(0, 200));
  ok('…naming who each is to and its subject', !!c && c.rows.some((r) => /Lee Park/.test(r.t) && /Venue walkthrough/.test(r.t)) && c.rows.some((r) => /Riley Chen/.test(r.t) && /Keynote/.test(r.t)));
  ok('…wrapped, not cut off', !!c && c.rows.every((r) => r.ws === 'normal'));
  await pg.click('[data-tdraft="d2"]'); await pg.waitForTimeout(2500);
  ok('clicking a draft opens it in the Drafts tab', await pg.evaluate(() => document.body.classList.contains('drafts-mode')) && /Keynote/.test(await pg.textContent('#subject')), await pg.textContent('#subject'));
  await pg.context().close(); }

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(res.join('\n')); const f = res.filter((r) => r.startsWith('FAIL')).length;
  console.log((f ? 'FAILED ' : 'PASSED ') + (res.length - f) + ' of ' + res.length);
})().catch((e) => { console.log('CRASH ' + e.message); process.exit(1); });
