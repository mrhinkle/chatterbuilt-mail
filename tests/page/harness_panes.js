// Every pane can be closed and reopened: thread list, side panel, inline context card. Keys [ and ], palette, persistence.
// usage: node harness_panes.js <built.html> <outdir>
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
  const deskW = (pg) => pg.evaluate(() => Math.round(document.getElementById('desk').getBoundingClientRect().width));
  const noH = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  // desktop 1440
  let { ctx, pg } = await mk({ viewport: { width: 1440, height: 900 } });
  ok('1440: list toggle shows on Today, labelled', (await pg.isVisible('#listTog')) && (await pg.textContent('#listTog')).includes('Hide list'));
  const w0 = await deskW(pg);
  await pg.click('#listTog'); await pg.waitForTimeout(150);
  ok('1440: list hides', !(await pg.isVisible('#rail')) && (await pg.getAttribute('#listTog', 'aria-expanded')) === 'false' && (await pg.textContent('#listTog')).includes('Show list'));
  ok('1440: Today gets the room', (await deskW(pg)) > w0 + 250, w0 + ' -> ' + (await deskW(pg)));
  await pg.keyboard.press('['); await pg.waitForTimeout(150);
  ok('1440: [ brings the list back', await pg.isVisible('#rail'));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  await pg.keyboard.press('['); await pg.waitForTimeout(150);
  ok('1440: list hidden with a thread open, panel still beside it', !(await pg.isVisible('#rail')) && (await pg.isVisible('#side')));
  ok('1440: panel has a labelled Hide', (await pg.isVisible('#sideHide')) && (await pg.textContent('#sideHide')).trim() === 'Hide' && (await pg.textContent('.sidecap')).includes('Context'));
  ok('1440: toolbar one line with list hidden', await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height < 44));
  await pg.keyboard.press(']'); await pg.waitForTimeout(250);
  ok('1440: ] closes the side panel to its strip, with no copy of the brief left in the thread', !(await pg.isVisible('#sideBody')) && (await pg.isVisible('#sideOpen')) && (await pg.textContent('#ctxBox')).trim() === '');
  await pg.keyboard.press(']'); await pg.waitForTimeout(250);
  ok('1440: ] brings the side panel back', await pg.isVisible('#sideBody'));
  await pg.reload(); await pg.waitForTimeout(1500);
  ok('1440: hidden list survives a reload', !(await pg.isVisible('#rail')));
  await pg.keyboard.press('Control+k'); await pg.waitForTimeout(200);
  ok('1440: palette offers Show the thread list', (await pg.textContent('#palList')).includes('Show the thread list'));
  await pg.fill('#palQ', 'thread list'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  ok('1440: palette command shows the list', await pg.isVisible('#rail'));
  ok('1440: no sideways scroll', await noH(pg));
  await ctx.close();

  // 1360 toolbar fit with everything open
  ({ ctx, pg } = await mk({ viewport: { width: 1360, height: 900 } }));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1360: toolbar one line with list and panel open', await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height < 44));
  ok('1360: title row one line', await pg.evaluate(() => document.querySelector('.titlerow').getBoundingClientRect().height < 44));
  await ctx.close();

  // mid width 1000: no side panel, inline card folds
  ({ ctx, pg } = await mk({ viewport: { width: 1000, height: 860 } }));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1000: inline card has Hide', (await pg.textContent('#ctxBox [data-ctx="fold"]')).trim() === 'Hide');
  await pg.click('#ctxBox [data-ctx="fold"]'); await pg.waitForTimeout(150);
  ok('1000: card folds to its header', !(await pg.isVisible('#ctxBox .ctxlines')) && (await pg.textContent('#ctxBox [data-ctx="fold"]')).trim() === 'Show' && (await pg.textContent('#ctxBox')).includes('Context'));
  await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(1500);
  ok('1000: fold sticks across threads', (await pg.textContent('#ctxBox [data-ctx="fold"]')).trim() === 'Show');
  await pg.keyboard.press(']'); await pg.waitForTimeout(150);
  ok('1000: ] unfolds it', await pg.isVisible('#ctxBox .ctxlines'));
  await pg.click('#listTog'); await pg.waitForTimeout(150);
  ok('1000: list hides at mid width too', !(await pg.isVisible('#rail')));
  ok('1000: no sideways scroll', await noH(pg));
  await ctx.close();

  // narrow tablet / large phone widths: one pane, full width (no empty column)
  for (const w of [600, 820, 860]) {
    ({ ctx, pg } = await mk({ viewport: { width: w, height: 1000 }, hasTouch: true, isMobile: true }));
    await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(2500);
    const r = await pg.evaluate(() => ({ d: document.getElementById('desk').getBoundingClientRect().width, m: document.querySelector('.main').getBoundingClientRect().width }));
    ok(w + ': thread fills the width', Math.abs(r.d - r.m) < 2, JSON.stringify(r));
    await ctx.close();
  }
  for (const w of [900, 1024]) {
    ({ ctx, pg } = await mk({ viewport: { width: w, height: 900 } }));
    await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2500);
    const r = await pg.evaluate(() => { const m = document.querySelector('.main').getBoundingClientRect(); const d = document.getElementById('desk').getBoundingClientRect(); return { right: Math.round(m.right - d.right) }; });
    ok(w + ': list + thread fill the width, no empty column', r.right < 2, JSON.stringify(r));
    await ctx.close();
  }
  // a brief line with two source tags shows two chips, no raw [brackets]
  ({ ctx, pg } = await mk({ viewport: { width: 1440, height: 900 } }));
  await pg.click('.thread[data-id="t8"]'); await pg.waitForTimeout(3500);
  const line = await pg.evaluate(() => { const l = [...document.querySelectorAll('#sideBody .ctxlines > div')].find((x) => x.textContent.includes('Meetings and the pipeline')); return l ? { tags: l.querySelectorAll('.srctag').length, text: l.textContent } : null; });
  ok('two source tags on one line become two chips', !!line && line.tags === 2 && !/\[/.test(line.text), JSON.stringify(line));
  await ctx.close();

  // phone: no list toggle (one pane at a time), card folds
  ({ ctx, pg } = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }));
  ok('phone: no list toggle', !(await pg.isVisible('#listTog')));
  await pg.evaluate(() => localStorage.setItem('cm.railOff', '1')); await pg.reload(); await pg.waitForTimeout(1500);
  ok('phone: a desktop "list hidden" choice never hides the phone list', await pg.isVisible('#rail'));
  await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  await pg.tap('#ctxBox [data-ctx="fold"]'); await pg.waitForTimeout(200);
  ok('phone: context card folds', !(await pg.isVisible('#ctxBox .ctxlines')));
  ok('phone: message is near the top once folded', await pg.evaluate(() => { const m = document.querySelector('.msg, .reading .m, .reading > div'); return !!m && m.getBoundingClientRect().top < 300; }));
  ok('phone: no sideways scroll', await noH(pg));
  await ctx.close();

  await b.close();
  console.log(results.join('\n')); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
})().catch((e) => { console.log('HARNESS CRASH', e.message.split('\n')[0]); process.exit(1); });
