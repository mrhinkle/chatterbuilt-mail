// The reply box as an expandable section: a header that opens and closes it, one scrollbar for thread and reply when
// it's open, and a text box that grows with its content instead of scrolling inside itself.
// usage: node harness_compose.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(name, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1280, height: 760 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake);
    await pg.goto('file://' + wrap(DEMO, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  // Every element inside the reading pane that scrolls on its own right now.
  const scrollers = (pg) => pg.evaluate(() => [...document.querySelectorAll('#desk, #desk *')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 2 && e.offsetParent !== null; }).map((e) => e.id || e.className.toString().split(' ')[0] || e.tagName));
  const folded = (pg) => pg.evaluate(() => document.getElementById('compose').classList.contains('folded'));
  const LONG = Array.from({ length: 30 }, (_, i) => 'Line ' + (i + 1) + ' of a long reply about the gold package and the deck.').join('\n');

  let pg = await open('desk');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  if (!(await folded(pg))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); }
  ok('folded, the reply box shows its header and the quick row', await pg.isVisible('#composeTog') && await pg.isVisible('#custom') && !(await pg.isVisible('#body')));
  ok('the header names who it is to', (await pg.textContent('#composeHeadTo')) === 'to Dana Ruiz', await pg.textContent('#composeHeadTo'));
  const inView = (sel) => pg.$eval(sel, (b) => { const r = b.getBoundingClientRect(); const d = document.getElementById('desk').getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= d.bottom + 1 && r.top >= d.top && !!top && (top === b || b.contains(top)); });
  ok('folded: the bar with Send still shows, at the bottom of the pane', await inView('#sendBtn') && await inView('#saveDraftBtn') && await pg.$eval('#composeFoot', (f) => document.getElementById('desk').getBoundingClientRect().bottom - f.getBoundingClientRect().bottom < 4));
  await pg.click('#sendBtn'); await pg.waitForTimeout(300);
  ok('…and Send on a folded box opens it to say what is missing (nothing sent)', !(await folded(pg)) && /Write something first/.test(await pg.textContent('#composeNote')) && await pg.isHidden('#confirmBox'), await pg.textContent('#composeNote'));
  await pg.click('#composeTog'); await pg.waitForTimeout(200);
  await pg.click('#composeHeadTo'); await pg.waitForTimeout(300);
  ok('clicking anywhere on the header opens it', !(await folded(pg)) && await pg.isVisible('#body') && (await pg.getAttribute('#composeTog', 'aria-expanded')) === 'true');
  await pg.fill('#body', LONG); await pg.waitForTimeout(200);
  const ta = await pg.$eval('#body', (t) => ({ sh: t.scrollHeight, ch: t.clientHeight, oy: getComputedStyle(t).overflowY }));
  ok('the text box grows to fit a long reply, no scrollbar of its own', ta.sh <= ta.ch + 2 && ta.oy === 'hidden', JSON.stringify(ta));
  let sc = await scrollers(pg);
  ok('open: thread and reply scroll as one page (one scrollbar)', sc.length === 1 && sc[0] === 'desk', sc.join(','));
  ok('…with the thread title kept at the top', (await pg.$eval('.deskhead', (e) => getComputedStyle(e).position)) === 'sticky');
  // A long thread, so the whole reply box starts below the fold (the case a short demo thread hides).
  await pg.evaluate(() => { const r = document.getElementById('reading'); const a = r.querySelector('article.msg'); for (let i = 0; i < 6; i++) r.appendChild(a.cloneNode(true)); });
  await pg.$eval('#desk', (d) => { d.scrollTop = 0; }); await pg.waitForTimeout(100);
  ok('long thread: the reply box starts below the fold', await pg.$eval('#compose', (c) => c.getBoundingClientRect().top > document.getElementById('desk').getBoundingClientRect().bottom));
  ok('open, at the top of the thread: the bar with Send is pinned to the bottom of the pane', await inView('#sendBtn') && await inView('#saveDraftBtn'));
  await pg.$eval('#desk', (d) => { d.scrollTop = Math.floor(d.scrollHeight / 2); }); await pg.waitForTimeout(100);
  ok('…and stays there halfway down', await inView('#sendBtn'));
  await pg.$eval('#desk', (d) => { d.scrollTop = d.scrollHeight; }); await pg.waitForTimeout(100);
  ok('…and the end of the reply reachable by scrolling', await pg.$eval('#sendBtn', (b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }));
  await pg.click('#composeTog'); await pg.waitForTimeout(300);
  sc = await scrollers(pg);
  ok('clicking the header again closes it', await folded(pg) && !(await pg.isVisible('#body')));
  ok('folded: back to the docked bar, thread scrolls on its own, no leftover offset', (await pg.$eval('#desk', (d) => d.scrollTop)) === 0 && !sc.includes('desk'), sc.join(','));
  // a draft filled in by the app grows the box too
  await pg.click('#composeTog'); await pg.waitForTimeout(200);
  await pg.evaluate((t) => { document.getElementById('body').value = t; }, LONG); await pg.waitForTimeout(100);
  const ta2 = await pg.$eval('#body', (t) => ({ sh: t.scrollHeight, ch: t.clientHeight }));
  ok('a draft the app fills in grows the box as well', ta2.sh <= ta2.ch + 2, JSON.stringify(ta2));
  // the next thread starts at its top
  await pg.$eval('#desk', (d) => { d.scrollTop = 400; });
  await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(2000);
  ok('opening another thread starts at its top', (await pg.$eval('#desk', (d) => d.scrollTop)) === 0);
  await pg.context().close();

  // phone width
  pg = await open('phone', { width: 390, height: 844 });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  if (!(await folded(pg))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); }
  await pg.$eval('#sendBtn', (b) => b.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(150);
  ok('phone, folded: the bar with Send shows and the bottom bar does not cover it', await pg.$eval('#sendBtn', (b) => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.height > 0 && !!t && (t === b || b.contains(t)); }));
  if (await folded(pg)) { await pg.click('#composeTog'); await pg.waitForTimeout(200); }
  await pg.fill('#body', LONG); await pg.waitForTimeout(200);
  sc = await scrollers(pg);
  ok('phone: one scrollbar, the text box grows, no sideways scroll', !sc.includes('reading') && !sc.some((x) => /^TEXTAREA|body$/.test(x)) && await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), sc.join(','));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
