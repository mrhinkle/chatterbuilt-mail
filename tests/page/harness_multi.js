// Select several threads and archive, move, mark read or star them at once, with one Undo.
// usage: node harness_multi.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const writes = async (pg) => (await pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })))).filter((c) => /label_thread|unlabel_thread|COMPOSIO_MULTI/.test(c.tool));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const closeToast = (pg) => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  let pg = await open(DEMO, 'demo');
  ok('no selection bar to start', !(await pg.$('.selbar')));
  await pg.hover('.thread[data-id="t4"]'); await pg.waitForTimeout(100);
  ok('hovering a row shows its select box', await pg.isVisible('.thread[data-id="t4"] .rsel'));
  await pg.click('.thread[data-id="t4"] [data-pick]'); await pg.waitForTimeout(150);
  ok('ticking it shows the bar with a count', (await pg.textContent('.selbar .sn')) === '1 selected' && await pg.evaluate(() => document.querySelector('.thread[data-id="t4"]').classList.contains('picked')));
  ok('nothing opened', (await pg.textContent('#subject')) !== 'Your receipt from Rivera Labs');
  await pg.click('.thread[data-id="t7"] [data-pick]', { modifiers: ['Shift'] }); await pg.waitForTimeout(150);
  const ids = await pg.$$eval('.thread.picked', (x) => x.map((e) => e.dataset.id));
  ok('Shift-click selects the range', ids.length >= 2 && ids.includes('t4') && ids.includes('t7'), ids.join(','));
  await pg.click('.selbar [data-sb="none"]'); await pg.waitForTimeout(100);
  ok('Clear empties it', !(await pg.$('.selbar')) && (await pg.$$('.thread.picked')).length === 0);
  await pg.click('.thread[data-id="t4"]', { modifiers: ['Meta'] }); await pg.click('.thread[data-id="t7"]', { modifiers: ['Meta'] }); await pg.click('.thread[data-id="t8"]', { modifiers: ['Meta'] }); await pg.waitForTimeout(150);
  ok('Cmd-click picks rows without opening them', (await pg.textContent('.selbar .sn')) === '3 selected');
  // move to a folder
  await clear(pg); await pg.click('.selbar [data-sb="move"]'); await pg.waitForTimeout(500);
  ok('Move to… opens the folder picker for all of them, without the copy tab', (await pg.isVisible('#pop')) && !(await pg.isVisible('#pop .tabs')));
  await pg.click('#labelOpts .opt[data-lname="Finance"]'); await pg.waitForTimeout(1600);
  let w = await writes(pg);
  ok('each one is filed in Finance and leaves the inbox', ['t4', 't7', 't8'].every((id) => w.some((c) => c.tool === 'label_thread' && c.input.threadId === id) && w.some((c) => c.tool === 'unlabel_thread' && c.input.threadId === id && c.input.labelIds[0] === 'INBOX')), JSON.stringify(w.map((c) => c.tool + ':' + c.input.threadId)));
  ok('rows leave, the bar goes, one Undo', ['t4', 't7', 't8'].every(async () => true) && !(await pg.$('.thread[data-id="t4"]')) && !(await pg.$('.selbar')) && /Moved to Finance 3 threads/.test(await pg.textContent('.toast')) && (await pg.textContent('.toast')).includes('Undo'), await pg.textContent('.toast'));
  await clear(pg); await pg.click('.toast [data-undo]'); await pg.waitForTimeout(1500);
  w = await writes(pg);
  ok('Undo puts all three back', ['t4', 't7', 't8'].every((id) => w.some((c) => c.tool === 'label_thread' && c.input.threadId === id && c.input.labelIds.includes('INBOX'))));
  await closeToast(pg);
  // keyboard x, mark read
  await pg.focus('.thread[data-id="t1"]'); await pg.keyboard.press('x'); await pg.focus('.thread[data-id="t3"]'); await pg.keyboard.press('x'); await pg.waitForTimeout(150);
  ok('x selects the focused row', (await pg.textContent('.selbar .sn')) === '2 selected');
  await clear(pg); await pg.click('.selbar [data-sb="read"]'); await pg.waitForTimeout(1200);
  w = await writes(pg);
  ok('Mark read takes UNREAD off both, rows stay', w.filter((c) => c.tool === 'unlabel_thread' && c.input.labelIds[0] === 'UNREAD').length === 2 && !!(await pg.$('.thread[data-id="t1"]')));
  await closeToast(pg);
  // right-click menu Select
  await pg.click('.thread[data-id="t5"]', { button: 'right' }); await pg.waitForTimeout(200);
  await pg.click('#rowMenu [data-rm="select"]'); await pg.waitForTimeout(150);
  ok('the row menu can start a selection', (await pg.textContent('.selbar .sn')) === '1 selected');
  await pg.click('.selbar [data-sb="all"]'); await pg.waitForTimeout(100);
  const n = await pg.$$eval('#list .thread[data-id]', (x) => x.length);
  ok('Select all picks every row in the list', (await pg.textContent('.selbar .sn')) === n + ' selected');
  await pg.click('.selbar [data-sb="none"]');
  await pg.context().close();

  // Composio, All inboxes
  pg = await open(GXP, 'gx');
  const two = await pg.$$eval('#list .thread[data-id]', (x) => x.slice(0, 2).map((e) => e.dataset.id));
  await pg.hover('.thread[data-id="' + two[0] + '"]'); await pg.click('.thread[data-id="' + two[0] + '"] [data-pick]'); await pg.click('.thread[data-id="' + two[1] + '"] [data-pick]'); await pg.waitForTimeout(150);
  await clear(pg); await pg.click('.selbar [data-sb="archive"]'); await pg.waitForTimeout(2000);
  w = (await writes(pg)).map((c) => c.input.tools[0]).filter((t) => /MODIFY|LABEL/.test(t.tool_slug));
  ok('Composio: Archive removes INBOX on both', two.every((id) => w.some((t) => JSON.stringify(t.arguments).includes(id) && JSON.stringify(t.arguments).includes('INBOX'))), JSON.stringify(w).slice(0, 300));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
