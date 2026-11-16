// The context panel: loading state, no-person threads, the Panel toggle, toolbar fit. usage: node harness_panel.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  for (const w of [1360, 1440]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
    await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(1500);
    const vis = (s) => pg.isVisible(s);
    ok(w + ': no panel or Panel button on Today', !(await vis('#side')) && !(await vis('#sideTog')));
    await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(40);
    const early = await pg.textContent('#sideBody');
    ok(w + ': panel is never blank while the thread loads', /Opening the thread|Checking|systems/.test(early), JSON.stringify(early.slice(0, 60)));
    await pg.waitForTimeout(3500);
    ok(w + ': panel shows the brief', (await pg.textContent('#sideBody')).includes('You owe Dana'));
    ok(w + ': Hide button in the panel; no strip while it shows', (await vis('#sideHide')) && !(await vis('#sideOpen')));
    ok(w + ': Hide button does not cover the name', await pg.evaluate(() => { const h = document.getElementById('sideHide').getBoundingClientRect(); const n = document.querySelector('#sideBody .nm'); if (!n) return false; const r = n.getBoundingClientRect(); return r.right <= h.left || r.top >= h.bottom; }));
    ok(w + ': toolbar still one line', await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height < 44), await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height));
    await pg.click('#sideHide'); await pg.waitForTimeout(200);
    ok(w + ': Hide closes the panel to a slim strip', (await pg.evaluate(() => document.getElementById('side').classList.contains('min'))) && !(await vis('#sideBody')) && (await vis('#sideOpen')));
    ok(w + ': Hide means hidden: no copy of the context at the top of the thread', (await pg.textContent('#ctxBox')).trim() === '', (await pg.textContent('#ctxBox')).slice(0, 60));
    ok(w + ': the strip is what brings it back; no toolbar button', (await vis('#sideOpen')) && !(await vis('#sideTog')));
    ok(w + ': toolbar one line with the panel hidden', await pg.evaluate(() => document.getElementById('acts').getBoundingClientRect().height < 44));
    await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(1500);
    ok(w + ': closed choice sticks across threads', (await vis('#sideOpen')) && !(await vis('#sideBody')));
    await pg.reload(); await pg.waitForTimeout(1500); await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(1500);
    ok(w + ': closed choice survives a reload', (await vis('#sideOpen')) && !(await vis('#sideBody')));
    await pg.click('#sideOpen'); await pg.waitForTimeout(300);
    ok(w + ': the strip brings it back with the brief', (await vis('#sideBody')) && (await pg.textContent('#sideBody')).includes('You owe Dana') && (await pg.textContent('#ctxBox')).trim() === '');
    await pg.fill('#q', 'note to self'); await pg.press('#q', 'Enter'); await pg.waitForTimeout(1200);
    await pg.click('.thread[data-id="n1"]'); await pg.waitForTimeout(1500);
    ok(w + ': a thread with no one else says so instead of a blank panel', (await pg.textContent('#sideBody')).includes("no one on this thread but you"), (await pg.textContent('#sideBody')).slice(0, 80));
    await pg.keyboard.press('Escape');
    await ctx.close();
  }
  // narrower than 1180: no Panel button, context inline
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(1500);
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500);
  ok('1100: no Panel button, context at the top of the thread', !(await pg.isVisible('#sideTog')) && (await pg.textContent('#ctxBox')).includes('You owe Dana'));
  await b.close();
  console.log(results.join('\n')); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
})().catch((e) => { console.log('HARNESS CRASH', e.message.split('\n')[0]); process.exit(1); });
