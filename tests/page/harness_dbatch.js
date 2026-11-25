// Batch review in the Drafts tab: flags on the rows, a Send / Skip / Delete plan per draft, and Apply plan that sends
// and deletes one at a time after one confirmation. usage: node harness_dbatch.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, init, ctx0) {
    const ctx = ctx0 || await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(() => { window.__batchDrafts = true; });
    if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const drafts = async (pg) => { await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600); };
  const rows = (pg) => pg.$$eval('#list .draftrow', (x) => x.map((e) => e.dataset.did));
  const flags = (pg, id) => pg.$$eval('#list .draftrow[data-did="' + id + '"] .dflag', (x) => x.map((e) => e.textContent));
  const plan = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('cm.draftPlan') || '{}'));
  const toasts = (pg) => pg.$$eval('.toast', (x) => x.map((e) => e.textContent).join(' | '));
  const pb = (id, k) => '#list [data-dplan="' + k + '"][data-id="' + id + '"]';

  // ---------- Gmail connector ----------
  let pg = await open(DEMO, 'native');
  await drafts(pg);
  ok('the list shows seven drafts with their details', (await rows(pg)).length === 7 && (await pg.$$('#list .draftrow .dplan')).length === 7, JSON.stringify(await rows(pg)));
  ok('flags: no recipient, empty, duplicate (both of the pair), [TK]; none on a clean draft',
    JSON.stringify(await flags(pg, 'd4')) === '["No recipient"]' && JSON.stringify(await flags(pg, 'd5')) === '["Empty"]' && JSON.stringify(await flags(pg, 'd2')) === '["Duplicate"]' && JSON.stringify(await flags(pg, 'd6')) === '["Duplicate"]' && JSON.stringify(await flags(pg, 'd7')) === '["[TK] to fill in"]' && (await flags(pg, 'd1')).length === 0 && (await flags(pg, 'd3')).length === 0,
    ['d4', 'd5', 'd2', 'd6', 'd7', 'd1'].map(async (i) => i + '=' + JSON.stringify(await flags(pg, i))).join(' '));
  ok('Send is off for a draft with no recipient or nothing written, and says why', await pg.isDisabled(pb('d4', 'send')) && /can't be sent as it is: no recipient/.test(await pg.getAttribute(pb('d4', 'send'), 'title')) && await pg.isDisabled(pb('d5', 'send')) && !(await pg.isDisabled(pb('d1', 'send'))) && !(await pg.isDisabled(pb('d4', 'delete'))));
  ok('no plan bar until something is marked', !(await pg.$('.dplanbar')));
  // mark a plan
  await pg.click(pb('d1', 'send')); await pg.click(pb('d3', 'send')); await pg.click(pb('d5', 'delete')); await pg.waitForTimeout(150);
  ok('Send and Delete mark the rows and the bar counts them', JSON.stringify(await plan(pg)) === '{"d1":"send","d3":"send","d5":"delete"}' && /Send 2/.test(await pg.textContent('.dplanbar')) && /Delete 1/.test(await pg.textContent('.dplanbar')) && (await pg.getAttribute('#list .draftrow[data-did="d1"]', 'class')).includes('plan-send') && (await pg.getAttribute('#list .draftrow[data-did="d5"]', 'class')).includes('plan-delete') && (await pg.getAttribute(pb('d1', 'send'), 'aria-pressed')) === 'true', JSON.stringify(await plan(pg)));
  ok('…and no draft opened by marking it', !(await pg.$('#dEditor')));
  await pg.click(pb('d7', 'skip')); await pg.waitForTimeout(150);
  ok('Skip is the checkbox: the row is checked and out of the plan', await pg.isChecked('[data-dchk="d7"]') && (await pg.getAttribute(pb('d7', 'skip'), 'aria-pressed')) === 'true' && !(await plan(pg)).d7);
  await pg.click(pb('d3', 'send')); await pg.waitForTimeout(150);
  ok('pressing Send again unmarks it', !(await plan(pg)).d3 && /Send 1/.test(await pg.textContent('.dplanbar')));
  await pg.click(pb('d2', 'delete')); await pg.click('[data-dchk="d2"]'); await pg.waitForTimeout(150);
  ok('checking a marked row clears its mark', !(await plan(pg)).d2 && await pg.isChecked('[data-dchk="d2"]'));
  // the plan survives a reload
  const pg2 = await open(DEMO, 'native2', null, pg.context()); await drafts(pg2);
  ok('the plan is kept in this browser across a reload', /Send 1/.test(await pg2.textContent('.dplanbar')) && (await pg2.getAttribute(pb('d1', 'send'), 'aria-pressed')) === 'true');
  await pg2.close();
  // apply: ask first
  await clear(pg); await pg.click('[data-dapply]'); await pg.waitForTimeout(150);
  const ask = await pg.textContent('.dapplyask');
  ok('Apply plan asks first, naming who gets what and what goes', /Send 1 draft \(to Lee Park\) and delete 1 \(Re: Thanks\)\? Gmail keeps no copy of a deleted draft\./.test(ask) && (await pg.textContent('[data-dapplygo]')) === 'Yes, send 1 and delete 1', ask);
  ok('…and nothing has been written yet', !(await calls(pg)).some((c) => c.tool === 'send_message' || c.tool === 'delete_draft'));
  await pg.click('[data-dapplyno]'); await pg.waitForTimeout(100);
  ok('Cancel closes the question and keeps the plan', !(await pg.$('.dapplyask')) && /Send 1/.test(await pg.textContent('.dplanbar')));
  await pg.click('[data-dapply]'); await pg.waitForTimeout(600); await clear(pg); await pg.click('[data-dapplygo]'); await pg.waitForTimeout(1200);
  const w = (await calls(pg)).filter((c) => c.tool === 'send_message' || c.tool === 'delete_draft');
  ok('Yes sends then deletes, one call each, in that order', JSON.stringify(w.map((c) => c.tool + ':' + c.input.draftId)) === '["send_message:d1","delete_draft:d5"]', JSON.stringify(w.map((c) => c.tool + ':' + c.input.draftId)));
  ok('…the rows are gone, the plan is empty and it says what happened', !(await rows(pg)).includes('d1') && !(await rows(pg)).includes('d5') && JSON.stringify(await plan(pg)) === '{}' && !(await pg.$('.dplanbar')) && /Done: 1 sent, 1 deleted\./.test(await toasts(pg)), await toasts(pg));
  await pg.context().close();

  // a send that fails stops the run; nothing after it runs; no retry
  pg = await open(DEMO, 'nativefail', () => { window.__failSend = 'd3'; });
  await drafts(pg); await pg.click(pb('d3', 'send')); await pg.click(pb('d2', 'send')); await pg.click(pb('d6', 'delete')); await pg.waitForTimeout(150);
  await pg.click('[data-dapply]'); await pg.waitForTimeout(600); await clear(pg); await pg.click('[data-dapplygo]'); await pg.waitForTimeout(1200);
  const w2 = (await calls(pg)).filter((c) => c.tool === 'send_message' || c.tool === 'delete_draft');
  // Sends go in list order (d2 before d3), so d2 goes through, d3 fails, and nothing after it runs.
  ok('when a send fails, the run stops there: the one before it went, nothing after it is written, no retry', JSON.stringify(w2.map((c) => c.tool + ':' + c.input.draftId)) === '["send_message:d2","send_message:d3"]', JSON.stringify(w2.map((c) => c.tool + ':' + c.input.draftId)));
  ok('…it says where it stopped, what went before, and to check Sent before trying again; the failed draft and the rest of the plan stay', /Stopped at “Re: Intro”/.test(await toasts(pg)) && /Check your Sent folder/.test(await toasts(pg)) && /Before that: 1 sent\./.test(await toasts(pg)) && (await rows(pg)).includes('d3') && !(await rows(pg)).includes('d2') && JSON.stringify(await plan(pg)) === '{"d3":"send","d6":"delete"}', await toasts(pg) + ' ' + JSON.stringify(await plan(pg)));
  await pg.context().close();

  // the open draft, sent by the batch, leaves the desk
  pg = await open(DEMO, 'nativeopen');
  await drafts(pg); await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(2600);
  ok('(setup) d1 is open in the editor', !!(await pg.$('#dEditor')));
  await pg.click(pb('d1', 'send')); await pg.waitForTimeout(150); await pg.click('[data-dapply]'); await pg.waitForTimeout(600); await pg.click('[data-dapplygo]'); await pg.waitForTimeout(1200);
  ok('a draft open in the editor that the batch sends closes with it', !(await pg.$('#dEditor')) && !(await rows(pg)).includes('d1'));
  await pg.context().close();

  // read-only blocks the apply
  pg = await open(DEMO, 'nativero', () => { localStorage.setItem('cm.ro', '1'); });
  await drafts(pg); await pg.click(pb('d1', 'send')); await pg.waitForTimeout(150); await clear(pg); await pg.click('[data-dapply]'); await pg.waitForTimeout(300);
  ok('read-only mode: Apply plan says so and asks nothing', !(await pg.$('.dapplyask')) && /read-only/i.test(await toasts(pg)) && !(await calls(pg)).some((c) => c.tool === 'send_message'), await toasts(pg));
  await pg.context().close();

  // ---------- Composio ----------
  pg = await open(GXP, 'gx');
  await drafts(pg); await pg.waitForTimeout(800);
  await pg.click(pb('d1', 'send')); await pg.waitForTimeout(150); await pg.click('[data-dapply]'); await pg.waitForTimeout(600); await clear(pg); await pg.click('[data-dapplygo]'); await pg.waitForTimeout(1500);
  const gxw = (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').flatMap((c) => c.input.tools || []).filter((t) => /^GMAIL_(SEND_DRAFT|DELETE_DRAFT)$/.test(t.tool_slug));
  ok('Composio: the batch sends the draft with GMAIL_SEND_DRAFT, once', JSON.stringify(gxw.map((t) => t.tool_slug + ':' + t.arguments.draft_id)) === '["GMAIL_SEND_DRAFT:d1"]' && !(await rows(pg)).includes('d1'), JSON.stringify(gxw));
  await pg.screenshot({ path: path.join(OUT, 'gx.png') });
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
