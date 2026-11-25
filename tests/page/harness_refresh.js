// A list that updates instead of reloading: Refresh merges in place, views come back instantly from cache, the last
// list survives a reload in the same session, and a failed refresh leaves the list alone.
// usage: node harness_refresh.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake);
  // Note every time the list is wiped to the "Loading threads…" spinner.
  await pg.addInitScript(() => { window.__wipes = 0; let was = false; new MutationObserver(() => { const l = document.getElementById('list'); const now = !!l && /Loading threads/.test(l.textContent); if (now && !was) window.__wipes++; was = now; }).observe(document, { childList: true, subtree: true, characterData: true }); });
  await pg.goto('file://' + wrap(DEMO, 'refresh.html')); await pg.waitForTimeout(2400);
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const rows = () => pg.$$eval('#list .thread[data-id]', (x) => x.map((e) => e.dataset.id));
  const wipes = () => pg.evaluate(() => window.__wipes);
  ok('the first load shows the spinner once', (await wipes()) === 1 && (await rows()).length === 8);

  await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(1500);
  await pg.hover('.thread[data-id="t5"]'); await pg.click('.thread[data-id="t5"] [data-pick]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { window.__newIn = ['s1']; window.__gone = ['t3']; });
  const wb = await wipes(); await pg.click('#refreshBtn'); await pg.waitForTimeout(400);
  const r1 = await rows();
  ok('Refresh updates in place: no spinner, no blank list', (await wipes()) === wb, 'wipes ' + (await wipes()));
  ok('new mail comes in on top, highlighted', r1[0] === 's1' && await pg.evaluate(() => document.querySelector('.thread[data-id="s1"]').classList.contains('fresh')), r1.join(','));
  ok('mail that left the view drops out', !r1.includes('t3'));
  ok('the open thread stays open and selected', await pg.evaluate(() => document.querySelector('.thread[data-id="t2"]').classList.contains('sel')) && /walk/i.test(await pg.textContent('#subject')));
  ok('your selection survives', await pg.evaluate(() => document.querySelector('.thread[data-id="t5"]').classList.contains('picked')) && (await pg.textContent('.selbar .sn')) === '1 selected');
  ok('the count follows', /^8\b/.test(await pg.textContent('#countText')), await pg.textContent('#countText'));
  await pg.click('.selbar [data-sb="none"]');

  // switching views comes back instantly, then refreshes
  await pg.click('.chip[data-key="unread"]'); await pg.waitForTimeout(1500);
  const w0 = await wipes();
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(30);
  ok('a view you already opened comes back at once from its last list', (await rows()).includes('s1') && (await wipes()) === w0);
  await pg.waitForTimeout(1200);
  ok('…then refreshes in the background', (await wipes()) === w0 && (await rows())[0] === 's1');

  // a failed refresh keeps the list
  await pg.evaluate(() => { window.__failSearch = true; });
  await pg.click('#refreshBtn'); await pg.waitForTimeout(1500);
  ok('a refresh that fails leaves the list as it was and says so', (await rows()).length === 8 && /Couldn't refresh/.test(await pg.textContent('.toast')), await pg.textContent('.toast'));
  await pg.evaluate(() => { window.__failSearch = false; document.querySelectorAll('.toast').forEach((t) => t.remove()); });

  // reload: the session's last list shows straight away
  await pg.reload(); await pg.waitForTimeout(60);
  const early = await rows();
  await pg.waitForTimeout(2400);
  ok('after a reload the last list shows straight away, no spinner', early.length >= 8 && (await pg.evaluate(() => window.__wipes)) === 0, early.length + ' rows, wipes ' + (await pg.evaluate(() => window.__wipes)));
  ok('…and it matches Gmail once Gmail answers', (await rows()).join() === 't1,t2,t3,t4,t5,t6,t7,t8', (await rows()).join());
  // 0.8.0: with Open mail at once on (the default) the list is kept in local storage, so it outlasts the session;
  // switched off, it's kept for the session only, as before.
  ok('with Open mail at once on, the list is kept past this session (local storage)', await pg.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('cm.list.'))));
  // a page with no snapshot behaves as before
  await pg.evaluate(() => { sessionStorage.clear(); Object.keys(localStorage).filter((k) => k.startsWith('cm.list.')).forEach((k) => localStorage.removeItem(k)); }); await pg.reload(); await pg.waitForTimeout(2400);
  ok('with nothing saved it loads as before', (await pg.evaluate(() => window.__wipes)) === 1 && (await rows()).length >= 8);
  await pg.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('cm.list.')).forEach((k) => localStorage.removeItem(k)); localStorage.setItem('cm.features', JSON.stringify({ cache: false })); }); await pg.reload(); await pg.waitForTimeout(2400);
  ok('with it off, nothing about the list is kept beyond this browser session', await pg.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith('cm.list.')) && Object.keys(sessionStorage).some((k) => k.startsWith('cm.list.'))));
  await pg.evaluate(() => localStorage.removeItem('cm.features'));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
