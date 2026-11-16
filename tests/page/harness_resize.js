// Resizable panes: drag, keyboard, double-click reset, persistence, clamps, hidden states, phone.
// usage: node harness_resize.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const mk = async (opts) => { const ctx = await b.newContext(opts); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(1500); return { ctx, pg }; };
  const W = (pg, id) => pg.evaluate((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return el.getClientRects().length ? Math.round(r.width) : 0; }, id);
  const box = (pg, id) => pg.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
  const noH = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const drag = async (pg, id, dx) => { const h = await box(pg, id); const x = h.x + h.w / 2, y = h.y + h.h / 2; await pg.mouse.move(x, y); await pg.mouse.down(); for (let i = 1; i <= 8; i++) await pg.mouse.move(x + (dx * i) / 8, y); await pg.mouse.up(); await pg.waitForTimeout(150); };
  const between = (pg, hid, leftId, rightId) => pg.evaluate(([hid, l, r]) => { const h = document.getElementById(hid).getBoundingClientRect(); const a = document.getElementById(l).getBoundingClientRect(); const c = document.getElementById(r).getBoundingClientRect(); const mid = h.left + h.width / 2; return mid >= a.right - 2 && mid <= c.left + 2; }, [hid, leftId, rightId]);

  // 1440 with a thread open: both handles
  let { ctx, pg } = await mk({ viewport: { width: 1440, height: 900 } });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1440: both handles show', (await pg.isVisible('#railSplit')) && (await pg.isVisible('#sideSplit')));
  ok('1440: rail handle sits in the gap', await between(pg, 'railSplit', 'rail', 'desk'));
  ok('1440: side handle sits in the gap', await between(pg, 'sideSplit', 'desk', 'side'));
  ok('1440: handles are labelled separators', (await pg.getAttribute('#railSplit', 'role')) === 'separator' && (await pg.getAttribute('#railSplit', 'aria-label')) === 'Resize the thread list' && (await pg.getAttribute('#sideSplit', 'aria-label')) === 'Resize the context panel');
  const r0 = await W(pg, 'rail'), s0 = await W(pg, 'side'), d0 = await W(pg, 'desk');
  await drag(pg, 'railSplit', 120);
  const r1 = await W(pg, 'rail');
  ok('1440: dragging the list handle right widens the list', Math.abs(r1 - (r0 + 120)) <= 4, r0 + ' -> ' + r1);
  ok('1440: the thread gives up the room', (await W(pg, 'desk')) < d0 - 100);
  ok('1440: rail handle follows', await between(pg, 'railSplit', 'rail', 'desk'));
  ok('1440: list width saved', +(await pg.evaluate(() => localStorage.getItem('cm.railW'))) === r1);
  await drag(pg, 'sideSplit', -100);
  const s1 = await W(pg, 'side');
  ok('1440: dragging the panel handle left widens the panel', Math.abs(s1 - (s0 + 100)) <= 4, s0 + ' -> ' + s1);
  ok('1440: aria-valuenow tracks width', +(await pg.getAttribute('#sideSplit', 'aria-valuenow')) === s1);
  ok('1440: no sideways scroll', await noH(pg));
  // clamp: drag way right; thread keeps 380
  await drag(pg, 'railSplit', 900);
  ok('1440: list stops at its max', (await W(pg, 'rail')) <= 600);
  ok('1440: thread never narrower than 380', (await W(pg, 'desk')) >= 378, String(await W(pg, 'desk')));
  await drag(pg, 'railSplit', -900);
  ok('1440: list stops at its min', (await W(pg, 'rail')) === 240, String(await W(pg, 'rail')));
  // keyboard
  await pg.focus('#railSplit'); await pg.keyboard.press('ArrowRight');
  ok('1440: ArrowRight widens by 16', (await W(pg, 'rail')) === 256, String(await W(pg, 'rail')));
  await pg.keyboard.press('Shift+ArrowRight');
  ok('1440: Shift+ArrowRight widens by 64', (await W(pg, 'rail')) === 320, String(await W(pg, 'rail')));
  await pg.keyboard.press('Home');
  ok('1440: Home goes to the min', (await W(pg, 'rail')) === 240);
  ok('1440: arrow keys on the handle do not move thread focus', (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'railSplit');
  await pg.focus('#sideSplit'); const sk = await W(pg, 'side'); await pg.keyboard.press('ArrowLeft');
  ok('1440: ArrowLeft on the panel handle widens the panel', (await W(pg, 'side')) === sk + 16, sk + ' -> ' + (await W(pg, 'side')));
  await pg.keyboard.press('End');
  ok('1440: End on the panel keeps the thread at 380+', (await W(pg, 'desk')) >= 378 && (await W(pg, 'side')) <= 520);
  await pg.keyboard.press('Home');
  // persistence
  await pg.focus('#railSplit'); await pg.keyboard.press('Shift+ArrowRight'); await pg.keyboard.press('Shift+ArrowRight');
  const rp = await W(pg, 'rail'), sp = await W(pg, 'side');
  await pg.reload(); await pg.waitForTimeout(1500);
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1440: widths survive a reload', (await W(pg, 'rail')) === rp && (await W(pg, 'side')) === sp, rp + '/' + sp + ' vs ' + (await W(pg, 'rail')) + '/' + (await W(pg, 'side')));
  // palette reset
  await pg.keyboard.press('Control+k'); await pg.waitForTimeout(200);
  ok('1440: palette offers Reset pane sizes', (await pg.textContent('#palList')).includes('Reset pane sizes'));
  await pg.fill('#palQ', 'reset pane'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  ok('1440: reset restores the default list width', Math.abs((await W(pg, 'rail')) - r0) <= 2, r0 + ' vs ' + (await W(pg, 'rail')));
  ok('1440: reset clears saved widths', (await pg.evaluate(() => localStorage.getItem('cm.railW') === null && localStorage.getItem('cm.sideW') === null)));
  await pg.keyboard.press('Control+k'); await pg.waitForTimeout(200);
  ok('1440: no reset command when sizes are default', !(await pg.textContent('#palList')).includes('Reset pane sizes'));
  await pg.keyboard.press('Escape');
  // double-click reset
  await drag(pg, 'railSplit', 80);
  ok('1440: drag again', (await W(pg, 'rail')) > r0 + 60);
  const rh = await box(pg, 'railSplit'); await pg.mouse.dblclick(rh.x + rh.w / 2, rh.y + rh.h / 2); await pg.waitForTimeout(150);
  ok('1440: double-click resets', Math.abs((await W(pg, 'rail')) - r0) <= 2 && (await pg.evaluate(() => localStorage.getItem('cm.railW'))) === null);
  // hidden panes hide their handle
  await pg.keyboard.press(']'); await pg.waitForTimeout(250);
  ok('1440: panel hidden -> its handle hides', !(await pg.isVisible('#sideSplit')) && (await pg.isVisible('#railSplit')));
  await pg.keyboard.press(']'); await pg.waitForTimeout(250);
  await pg.keyboard.press('['); await pg.waitForTimeout(250);
  ok('1440: list hidden -> its handle hides', !(await pg.isVisible('#railSplit')) && (await pg.isVisible('#sideSplit')));
  ok('1440: panel handle still in its gap with the list hidden', await between(pg, 'sideSplit', 'desk', 'side'));
  await pg.keyboard.press('['); await pg.waitForTimeout(250);
  // Today (no side panel)
  await pg.click('#todayBtn').catch(() => {}); await pg.waitForTimeout(800);
  ok('1440: on Today the panel handle is hidden unless the panel shows', (await pg.isVisible('#sideSplit')) === (await pg.isVisible('#side')));
  ok('no page errors (1440)', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // saved width squeezed when the window narrows
  ({ ctx, pg } = await mk({ viewport: { width: 1440, height: 900 } }));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  await pg.focus('#railSplit'); await pg.keyboard.press('End');
  const big = await W(pg, 'rail');
  await pg.setViewportSize({ width: 1200, height: 900 }); await pg.waitForTimeout(400);
  ok('1200: saved wide list squeezes so the thread keeps 380', (await W(pg, 'desk')) >= 378, 'rail ' + (await W(pg, 'rail')) + ' desk ' + (await W(pg, 'desk')));
  ok('1200: saved preference kept for a wider window', +(await pg.evaluate(() => localStorage.getItem('cm.railW'))) === big);
  ok('1200: handles still in the gaps', (await between(pg, 'railSplit', 'rail', 'desk')) && (await between(pg, 'sideSplit', 'desk', 'side')));
  await pg.setViewportSize({ width: 1440, height: 900 }); await pg.waitForTimeout(400);
  ok('1440 again: list grows back to the saved width', (await W(pg, 'rail')) === big, big + ' vs ' + (await W(pg, 'rail')));
  ok('1200/1440: no sideways scroll', await noH(pg));
  await ctx.close();

  // 1000: no side panel, list handle works
  ({ ctx, pg } = await mk({ viewport: { width: 1000, height: 860 } }));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1000: list handle shows, panel handle hidden', (await pg.isVisible('#railSplit')) && !(await pg.isVisible('#sideSplit')));
  const m0 = await W(pg, 'rail'); await drag(pg, 'railSplit', -60);
  ok('1000: list narrows by drag', Math.abs((await W(pg, 'rail')) - (m0 - 60)) <= 4, m0 + ' -> ' + (await W(pg, 'rail')));
  await drag(pg, 'railSplit', 700);
  ok('1000: thread keeps 380', (await W(pg, 'desk')) >= 378, String(await W(pg, 'desk')));
  ok('1000: no sideways scroll', await noH(pg));
  await ctx.close();

  // phone: no handles
  ({ ctx, pg } = await mk({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true }));
  ok('400: no handles on a phone', !(await pg.isVisible('#railSplit')) && !(await pg.isVisible('#sideSplit')));
  await pg.evaluate(() => { localStorage.setItem('cm.railW', '560'); }); await pg.reload(); await pg.waitForTimeout(1500);
  ok('400: a saved desktop width does not break the phone layout', (await noH(pg)) && (await W(pg, 'rail')) <= 400);
  await ctx.close();

  // 820 (the old half-empty bug width): still one pane, no handles
  ({ ctx, pg } = await mk({ viewport: { width: 820, height: 900 } }));
  await pg.click('.thread[data-id="t1"]').catch(() => {}); await pg.waitForTimeout(2500);
  ok('820: no handles', !(await pg.isVisible('#railSplit')) && !(await pg.isVisible('#sideSplit')));
  ok('820: no sideways scroll', await noH(pg));
  await ctx.close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(results.join('\n'));
  const f = results.filter((r) => r.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
