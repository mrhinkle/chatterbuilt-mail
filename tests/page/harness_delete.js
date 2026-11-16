// Delete a draft from the draft editor: it asks first, calls Gmail once, never retries, and read-only blocks it.
// Both Gmail paths. usage: node harness_delete.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  // Native delete_draft calls, or Composio GMAIL_DELETE_DRAFT calls (with the account each went to).
  const dels = async (pg) => (await calls(pg)).flatMap((c) => c.tool === 'delete_draft' ? [{ id: c.input.draftId }] : c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL' ? (c.input.tools || []).filter((t) => t.tool_slug === 'GMAIL_DELETE_DRAFT').map((t) => ({ id: t.arguments.draft_id, acct: t.account })) : []);
  const rows = (pg) => pg.$$eval('#list .draftrow', (x) => x.map((e) => e.dataset.did));

  // ---------- native ----------
  let pg = await open(DEMO, 'demo');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(1800);
  ok('the draft editor has a Delete button', await pg.isVisible('#dDelete'));
  await clear(pg); await pg.click('#dDelete'); await pg.waitForTimeout(200);
  const txt = await pg.textContent('#dConfirmText');
  ok('Delete asks first, names the draft and says it is permanent', await pg.isVisible('#dConfirm') && /^Delete this draft \(“Re: Venue walkthrough”\) from Gmail\? It's gone for good/.test(txt), txt);
  ok('…with a red "Yes, delete it"', (await pg.textContent('#dConfirmGo')) === 'Yes, delete it' && await pg.$eval('#dConfirmGo', (e) => e.classList.contains('dangerbtn')));
  ok('nothing is deleted before Yes', (await dels(pg)).length === 0);
  await pg.click('#dConfirmNo'); await pg.waitForTimeout(150);
  ok('Cancel closes the question and deletes nothing', await pg.isHidden('#dConfirm') && (await dels(pg)).length === 0 && (await rows(pg)).includes('d1'));
  // Send afterwards still reads as Send, not Delete
  await pg.click('#dSend'); await pg.waitForTimeout(200);
  ok('after a cancelled delete, Send asks about sending (not deleting)', (await pg.textContent('#dConfirmGo')) === 'Yes, send it' && !(await pg.$eval('#dConfirmGo', (e) => e.classList.contains('dangerbtn'))) && /^Send this to/.test(await pg.textContent('#dConfirmText')));
  await pg.click('#dConfirmNo'); await pg.waitForTimeout(100);
  // an unsaved edit is mentioned
  await pg.click('#dEditor'); await pg.keyboard.type(' x'); await pg.waitForTimeout(100);
  await pg.click('#dDelete'); await pg.waitForTimeout(150);
  ok('with unsaved edits it says they go too', /Your unsaved changes go with it\./.test(await pg.textContent('#dConfirmText')));
  await clear(pg); await pg.dblclick('#dConfirmGo'); await pg.waitForTimeout(2200);
  let d = await dels(pg); let cs = await calls(pg);
  ok('Yes deletes it with one call, even on a double click', d.length === 1 && d[0].id === 'd1', JSON.stringify(d));
  ok('…and saves nothing first', !cs.some((c) => c.tool === 'update_draft' || c.tool === 'send_message'), cs.map((c) => c.tool).join(','));
  ok('the draft leaves the list and the next one opens', !(await rows(pg)).includes('d1') && (await pg.inputValue('#dSubj')) === 'Keynote at the spring summit?', (await rows(pg)).join(','));
  ok('the header and count follow', (await pg.textContent('#list .lsec')).includes('of 2') && /^2 drafts/.test(await pg.textContent('#countText')), await pg.textContent('#countText'));
  ok('it says so', await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Draft deleted/.test(t.textContent))));
  // failure: Gmail doesn't answer
  await pg.evaluate(() => { window.__failDelete = true; document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  await clear(pg); await pg.click('#dDelete'); await pg.waitForTimeout(150); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2400);
  d = await dels(pg);
  ok('a failed delete is not retried', d.length === 1 && d[0].id === 'd2', JSON.stringify(d));
  ok('…it says what to check, keeps the draft, and Delete works again', /may already be gone. Refresh the list or check Gmail Drafts before you delete it again/.test(await pg.textContent('#dNote')) && (await rows(pg)).includes('d2') && (await pg.inputValue('#dSubj')) === 'Keynote at the spring summit?' && await pg.isEnabled('#dDelete'), await pg.textContent('#dNote'));
  await pg.evaluate(() => { window.__failDelete = false; });
  // read-only
  await pg.evaluate(() => document.getElementById('roToggle').click()); await pg.waitForTimeout(150);
  await clear(pg); await pg.evaluate(() => document.getElementById('dDelete').click()); await pg.waitForTimeout(200);
  ok('read-only blocks Delete before it asks', (await dels(pg)).length === 0 && await pg.isHidden('#dConfirm'));
  await pg.evaluate(() => document.getElementById('roToggle').click()); await pg.waitForTimeout(150);
  // the inbox: the deleted draft's tag is gone
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(2200);
  ok('the thread it answered no longer says "draft in Gmail"', !(await pg.$eval('.thread[data-id="t2"]', (e) => /draft in Gmail/.test(e.textContent))));
  await pg.context().close();

  // last draft: nothing left to open
  pg = await open(DEMO, 'last');
  await pg.evaluate(() => { window.__deletedDrafts = ['d1', 'd2']; });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  ok('setup: one draft left', (await rows(pg)).length === 1, (await rows(pg)).join(','));
  await pg.click('#list .draftrow'); await pg.waitForTimeout(1800);
  await pg.click('#dDelete'); await pg.waitForTimeout(150); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2200);
  ok('deleting the last draft leaves an empty list and a clear desk', (await rows(pg)).length === 0 && !(await pg.$('#dEditor')));
  await pg.context().close();

  // ---------- Composio ----------
  pg = await open(GXP, 'gx');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  const first = await pg.$eval('#list .draftrow', (e) => e.dataset.did);
  await pg.click('#list .draftrow[data-did="' + first + '"]'); await pg.waitForTimeout(2600);
  await clear(pg); await pg.click('#dDelete'); await pg.waitForTimeout(200);
  ok('Composio: Delete asks first', await pg.isVisible('#dConfirm') && (await dels(pg)).length === 0);
  await pg.click('#dConfirmGo'); await pg.waitForTimeout(2600);
  d = await dels(pg);
  ok('Composio: one GMAIL_DELETE_DRAFT, to the account that holds the draft', d.length === 1 && d[0].id === first && !!d[0].acct && !/personal/.test(d[0].acct), JSON.stringify(d));
  ok('Composio: the draft leaves the list', !(await rows(pg)).includes(first), (await rows(pg)).join(','));
  await pg.evaluate(() => { window.__failDelete = true; });
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
