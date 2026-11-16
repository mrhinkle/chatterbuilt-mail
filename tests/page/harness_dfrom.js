// 0.8.1: a draft can go out from another address or account (Composio); the Drafts home doesn't show the last thread's
// reply box. usage: node harness_dfrom.js <all.html> <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , ALL, DEMO, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = []; global.__res = res;
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function page(src, name, init) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(() => { window.__draftOrder = true; }); if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const gm = (pg) => pg.evaluate(() => window.__calls.filter((c) => c.server === 'Composio' && c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL' && /^GMAIL_/.test(((c.input.tools || [])[0] || {}).tool_slug || '')).map((c) => ({ slug: c.input.tools[0].tool_slug, args: c.input.tools[0].arguments, account: c.input.tools[0].account })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });

  // ---------- Composio, All inboxes ----------
  let pg = await page(ALL, 'a1');
  // the Drafts home after a thread: no leftover reply box or thread actions
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2500);
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3000);
  ok('the Drafts home shows no leftover reply box, thread actions or Send', !(await pg.isVisible('#compose')) && !(await pg.isVisible('#acts')) && !(await pg.isVisible('#sendBtn')) && /to review/.test(await pg.textContent('#reading')));
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(3000);
  ok('a draft shows From when there is more than one address', await pg.isVisible('#dFromSel'));
  const opts = await pg.$$eval('#dFromSel option', (os) => os.map((o) => o.value + (o.selected ? '*' : '')));
  ok('…listing every account\'s addresses, its own selected', opts.some((v) => v === 'gmail_work|alex@riveralabs.example*') && opts.some((v) => /^gmail_personal\|alex\.rivera@mail\.example/.test(v)), opts.join(', '));
  await pg.selectOption('#dFromSel', 'gmail_personal|alex.rivera@mail.example'); await pg.waitForTimeout(200);
  const note = await pg.textContent('#dFromNote');
  ok('picking another account says it goes as a new email, not in the thread, and the draft is deleted', /new email from alex\.rivera@mail\.example/.test(note) && /not inside the thread/.test(note) && /deleted from Rivera Labs/.test(note), note);
  // a batch plan won't quietly send it from its own account
  await pg.click('#list .dpb.send[data-id="d1"]'); await pg.waitForTimeout(200);
  if (await pg.isVisible('[data-dapply]')) { await pg.click('[data-dapply]'); await pg.waitForTimeout(300); if (await pg.isVisible('[data-dapplygo]')) { await pg.waitForTimeout(600); await clear(pg); await pg.click('[data-dapplygo]'); await pg.waitForTimeout(1200); } }
  let g = await gm(pg);
  ok('a batch plan with a draft set to another From stops and says so', !g.some((c) => /SEND/.test(c.slug)) && /set to go from/.test(await pg.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')), JSON.stringify(g.map((c) => c.slug)));
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  if (await pg.isVisible('[data-dclear]')) { await pg.click('[data-dclear]'); await pg.waitForTimeout(200); }
  // Send from the other account
  await clear(pg); await pg.click('#dSend'); await pg.waitForTimeout(300);
  const q = await pg.textContent('#dConfirmText');
  ok('Send asks naming the other address', /from alex\.rivera@mail\.example/.test(q) && /new email/.test(q) && /deleted/.test(q), q);
  await pg.waitForTimeout(600); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2500);
  g = await gm(pg);
  const send = g.find((c) => c.slug === 'GMAIL_SEND_EMAIL'); const del = g.find((c) => c.slug === 'GMAIL_DELETE_DRAFT');
  ok('it sends a new email from the other account, as HTML, with the draft\'s words', !!send && send.account === 'gmail_personal' && send.args.from_email === 'alex.rivera@mail.example' && send.args.is_html === true && /Tuesday at 10/.test(send.args.body) && send.args.recipient_email === 'lee@venuehall.example', JSON.stringify(send && { account: send.account, args: Object.assign({}, send.args, { body: String(send.args.body).slice(0, 80) }) }));
  ok('…leaves the old signature behind (the other address\'s own goes on)', !!send && !/gmail_signature/.test(send.args.body));
  ok('…then deletes the draft from its own account, and never sends the draft itself', !!del && del.account === 'gmail_work' && del.args.draft_id === 'd1' && !g.some((c) => c.slug === 'GMAIL_SEND_DRAFT') && g.indexOf(send) < g.indexOf(del), JSON.stringify(g.map((c) => c.slug + '@' + c.account)));
  ok('…and the draft leaves the list', !(await pg.$('#list .draftrow[data-did="d1"]')));
  await pg.context().close();

  // its own address sends the draft as before
  pg = await page(ALL, 'a2'); await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3000);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(3000); await clear(pg);
  await pg.click('#dSend'); await pg.waitForTimeout(900); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2500);
  g = await gm(pg);
  ok('with its own address, Send sends the draft itself', g.some((c) => c.slug === 'GMAIL_SEND_DRAFT' && c.args.draft_id === 'd1') && !g.some((c) => c.slug === 'GMAIL_SEND_EMAIL' || c.slug === 'GMAIL_DELETE_DRAFT'), JSON.stringify(g.map((c) => c.slug)));
  await pg.context().close();

  // a draft with files can't switch accounts
  pg = await page(ALL, 'a3', () => { window.__attDraft = true; }); await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3000);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(3500);
  if (await pg.isVisible('#dFromSel')) { await pg.selectOption('#dFromSel', 'gmail_personal|alex.rivera@mail.example'); await pg.waitForTimeout(200); }
  await clear(pg); await pg.click('#dSend'); await pg.waitForTimeout(400);
  g = await gm(pg);
  ok('a draft with files set to another account won\'t send, and says why', !(await pg.isVisible('#dConfirm')) && /files/.test(await pg.textContent('#dNote')) && !g.some((c) => /SEND/.test(c.slug)), await pg.textContent('#dNote'));
  await pg.context().close();

  // ---------- the claude.ai connector: one account, no From ----------
  pg = await page(DEMO, 'n1'); await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(3000);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(2500);
  ok('the Gmail connector: no From on a draft', !(await pg.isVisible('#dFromSel')));
  await pg.context().close();

  console.log(res.join('\n'));
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  console.log('PASSED', res.filter((r) => r.startsWith('PASS')).length, 'of', res.length);
  await b.close();
})().catch((e) => { console.log((global.__res || []).join('\n')); console.error('HARNESS CRASH', e.message.slice(0, 600)); process.exit(1); });
