// Drafts open at once (0.8.0): the top drafts load ahead, a draft opens from its kept copy, the next draft's brief and
// "Check it for me" are ready before you get to it, and copies, briefs and checks survive a reload.
// usage: node harness_dcache.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
const countAI = () => { const orig = window.claude.use; window.__ai = []; window.claude.use = async (n) => { const x = await orig(n); if (n !== 'sample' || !x) return x; const f = async (p, o) => { const s = JSON.stringify(p); window.__ai.push(/You review an email draft/.test(s) ? 'check' : /You brief /.test(s) ? 'brief' : 'other'); (window.__aiP = window.__aiP || []).push(s); return x(p, o); }; return Object.assign(f, x); }; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = []; global.__res = res;
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  let ctx;
  async function page(src, name, init) {
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(countAI); if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; window.__ai = []; window.__aiP = []; });
  // AI calls about one draft or person: a check names the draft's subject, a brief names the person.
  const aiAbout = (pg, kind, re) => pg.evaluate(([k, r]) => (window.__aiP || []).filter((x) => (k === 'check' ? /You review an email draft/ : /You brief /).test(x) && new RegExp(r).test(x)).length, [kind, re]);
  const meetingsFor = (pg, email) => pg.evaluate((e) => window.__calls.filter((c) => JSON.stringify(c.input || {}).includes('"MEETINGS"') && JSON.stringify(c.input || {}).includes(e)).length, email);
  const ai = (pg, k) => pg.evaluate((kk) => window.__ai.filter((x) => x === kk).length, k);
  const meetings = (pg) => pg.evaluate(() => window.__calls.filter((c) => JSON.stringify(c.input || {}).includes('"MEETINGS"')).length);
  const gxDraftFull = (pg, id) => pg.evaluate((i) => window.__calls.filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL' && ((c.input && c.input.tools) || []).some((t) => t.tool_slug === 'GMAIL_GET_DRAFT' && t.arguments.format === 'full' && (!i || t.arguments.draft_id === i))).length, id);
  const nDraftFull = (pg, id) => pg.evaluate((i) => window.__calls.filter((c) => c.tool === 'get_draft' && (c.input || {}).messageFormat !== 'MINIMAL' && (c.input || {}).messageFormat !== 'RAW' && (!i || c.input.draftId === i)).length, id);
  const drafts = (pg) => pg.evaluate(() => [...document.querySelectorAll('#list .draftrow')].map((e) => e.dataset.did));
  const checks = (pg) => pg.evaluate(() => { const e = document.getElementById('dChecks'); return e ? e.querySelectorAll('input[type=checkbox], [data-dck], li').length : 0; });
  const editorText = (pg) => pg.evaluate(() => { const e = document.getElementById('dEditor'); return e ? e.innerText.slice(0, 60) : ''; });

  // ---------- Composio ----------
  ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const two = () => { window.__draftOrder = true; };
  let pg = await page(GXP, 'g1', two);
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(6000);
  let ds = await drafts(pg);
  const warmed = []; for (const id of ds.slice(0, 2)) warmed.push(await gxDraftFull(pg, id));
  ok('Composio: the top drafts load ahead', ds.length >= 2 && warmed.every((n) => n >= 1), ds.join(',') + ' → ' + warmed.join(','));
  await clear(pg); await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(1500);
  ok('Composio: a draft opens from its kept copy', (await gxDraftFull(pg, 'd1')) === 0 && (await editorText(pg)).length > 0, await editorText(pg));
  await pg.waitForTimeout(4000); await pg.close();
  pg = await page(GXP, 'g2', two); await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3500); await clear(pg);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(1800);
  ok('after a reload, a draft opens from its copy with its brief and check kept', (await gxDraftFull(pg, 'd1')) === 0 && (await meetingsFor(pg, 'lee@venuehall')) === 0 && (await aiAbout(pg, 'check', 'Venue walkthrough')) === 0 && (await checks(pg)) > 0, 'full ' + (await gxDraftFull(pg, 'd1')) + ', meetings ' + (await meetingsFor(pg, 'lee@venuehall')) + ', checks ' + (await aiAbout(pg, 'check', 'Venue walkthrough')));
  // a save drops the copy
  await pg.click('#dEditor'); await pg.keyboard.press('End'); await pg.keyboard.type(' Thanks.'); await pg.waitForTimeout(200);
  await clear(pg); await pg.click('#dSave').catch(() => {}); await pg.waitForTimeout(1500);
  const saved = await pg.evaluate(() => window.__calls.some((c) => JSON.stringify(c.input || {}).includes('GMAIL_UPDATE_DRAFT')));
  const kept = await pg.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cm.tc') || '{}')).filter((x) => x.endsWith(':d:d1')).length);
  ok('saving a draft drops its kept copy', saved && kept === 0, 'saved ' + saved + ', still kept ' + kept);
  await pg.close(); await ctx.close();

  // ---------- claude.ai connector ----------
  ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  pg = await page(DEMO, 'n1'); await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(5000);
  ds = await drafts(pg);
  ok('connector: the first draft gets its check ahead', (await aiAbout(pg, 'check', 'Venue walkthrough')) === 1, ds.join(','));
  await clear(pg); await pg.click('#list .draftrow[data-did="' + ds[0] + '"]'); await pg.waitForTimeout(1500);
  ok('connector: the first draft opens without fetching it again, its check already done', (await nDraftFull(pg, ds[0])) === 0 && (await editorText(pg)).length > 0 && (await aiAbout(pg, 'check', 'Venue walkthrough')) === 0 && (await checks(pg)) > 0, ds.join(','));
  await pg.waitForTimeout(5000); await clear(pg); await pg.click('#dNext'); await pg.waitForTimeout(1500);
  ok('connector: Next opens from its copy, brief and check ready', (await nDraftFull(pg, ds[1])) === 0 && (await aiAbout(pg, 'check', 'Keynote at the spring summit')) === 0 && (await meetingsFor(pg, 'riley@keynote')) === 0 && (await aiAbout(pg, 'brief', 'riley@keynote')) === 0 && (await checks(pg)) > 0, 'full ' + (await nDraftFull(pg, ds[1])) + ', meetings ' + (await meetingsFor(pg, 'riley@keynote')) + ', checks ' + (await aiAbout(pg, 'check', 'Keynote')));
  await pg.close(); await ctx.close();

  // ---------- switched off: one draft ahead, in memory, as before ----------
  ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  pg = await page(GXP, 'off', () => { window.__draftOrder = true; localStorage.setItem('cm.features', JSON.stringify({ cache: false })); });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(4000); ds = await drafts(pg);
  ok('with Open mail at once off, nothing loads ahead before a draft is opened', (await gxDraftFull(pg)) === 0 && (await ai(pg, 'check')) === 0);
  await clear(pg); await pg.click('#list .draftrow[data-did="' + ds[0] + '"]'); await pg.waitForTimeout(2500);
  ok('…opening one fetches it, and the next one loads ahead as before', (await gxDraftFull(pg, ds[0])) >= 1 && (await gxDraftFull(pg, ds[1])) === 1, ds.join(',') + ' ' + (await gxDraftFull(pg, ds[0])) + ',' + (await gxDraftFull(pg, ds[1])));
  await pg.close(); await ctx.close();

  console.log(res.join('\n'));
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  console.log('PASSED', res.filter((r) => r.startsWith('PASS')).length, 'of', res.length);
  await b.close();
})().catch((e) => { console.log((global.__res || []).join('\n')); console.error('HARNESS CRASH', e.message.slice(0, 600)); process.exit(1); });
