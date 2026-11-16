// From: pick the address a reply goes from (any connected account, or an alias set up under "Send mail as").
// usage: node harness_from.js <demo.html> <gx.html> <outdir>
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
    await pg.addInitScript(fake);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2400);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const slugs = (cs) => cs.filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]);
  const unfold = async (pg) => { if (await pg.evaluate(() => document.querySelector('.compose').classList.contains('folded'))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); } };
  const send = async (pg, text) => { await pg.fill('#body', text); await pg.click('#sendBtn'); await pg.waitForTimeout(1800); const t = await pg.textContent('#confirmText'); await clear(pg); await pg.click('#confirmSend'); await pg.waitForTimeout(2200); return t; };

  // ---------- the Gmail connector: one account, no picker ----------
  let pg = await open(DEMO, 'native');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200); await unfold(pg);
  ok('Gmail connector: no From picker (it sends from its one account)', !(await pg.isVisible('#fromRow')));
  await pg.context().close();

  // ---------- Composio, two accounts and an alias ----------
  pg = await open(GXP, 'gx');
  const first = await pg.$eval('#list .thread[data-id]', (e) => e.dataset.id);
  await clear(pg); await pg.click('.thread[data-id="' + first + '"]'); await pg.waitForTimeout(2600); await unfold(pg);
  await pg.waitForTimeout(800);
  const opts = await pg.$$eval('#fromSel option', (x) => x.map((o) => o.textContent));
  ok('From lists every address on every account, aliases included', await pg.isVisible('#fromRow') && opts.includes('alex@riveralabs.example') && opts.includes('events@riveralabs.example') && opts.includes('alex.rivera@mail.example'), opts.join(', '));
  ok('…grouped by account', (await pg.$$eval('#fromSel optgroup', (x) => x.map((g) => g.label))).join() === 'Rivera Labs,Personal');
  ok('…starting on the thread\'s own address', (await pg.$eval('#fromSel', (s) => s.selectedOptions[0].textContent)) === 'alex@riveralabs.example' && !(await pg.textContent('#fromNote')));
  ok('reading the addresses writes nothing', !slugs(await calls(pg)).some((t) => /^GMAIL_(SEND|REPLY|CREATE|UPDATE|MODIFY|PATCH)/.test(t.tool_slug)));

  // an alias on the same account
  await pg.selectOption('#fromSel', { label: 'events@riveralabs.example' }); await pg.waitForTimeout(100);
  ok('picking an alias says it goes as a new email, not in the thread', /new email from events@riveralabs.example.*another address/.test(await pg.textContent('#fromNote')), await pg.textContent('#fromNote'));
  await pg.fill('#body', 'Yes to gold. Deck today.'); await clear(pg); await pg.click('#saveDraftBtn'); await pg.waitForTimeout(600);
  ok('a draft can\'t be saved from an alias, and it says which address can', /can't be saved from an alias.*alex@riveralabs.example/.test(await pg.textContent('#composeNote')) && !slugs(await calls(pg)).some((t) => t.tool_slug === 'GMAIL_CREATE_EMAIL_DRAFT'), await pg.textContent('#composeNote'));
  let conf = await send(pg, 'Yes to gold. Deck today.');
  ok('the send check names the From', /from events@riveralabs.example, as a new email/.test(conf), conf);
  let cs = slugs(await calls(pg)); let se = cs.find((t) => t.tool_slug === 'GMAIL_SEND_EMAIL');
  ok('it sends from the alias, on its account, as Re:', !!se && se.arguments.from_email === 'events@riveralabs.example' && se.account === 'gmail_work' && /^Re: /.test(se.arguments.subject) && !!se.arguments.recipient_email && !cs.some((t) => t.tool_slug === 'GMAIL_REPLY_TO_THREAD'), JSON.stringify(se));

  // another account
  await pg.waitForTimeout(800); await unfold(pg); await pg.waitForTimeout(600);
  ok('after sending, From is back on the thread\'s address', (await pg.$eval('#fromSel', (s) => s.selectedOptions[0].textContent)) === 'alex@riveralabs.example');
  await pg.selectOption('#fromSel', { label: 'alex.rivera@mail.example' }); await pg.waitForTimeout(100);
  ok('picking another account says so', /another account/.test(await pg.textContent('#fromNote')));
  await pg.click('#sigPeek'); await pg.waitForTimeout(1400);
  ok('Show previews the signature of the address you picked', /No signature is set in Gmail for alex.rivera@mail.example/.test(await pg.textContent('#sigBox')), await pg.textContent('#sigBox'));
  await pg.fill('#body', 'Sending from my personal address.');
  await clear(pg); await pg.click('#saveDraftBtn'); await pg.waitForTimeout(1600);
  const cd = slugs(await calls(pg)).find((t) => t.tool_slug === 'GMAIL_CREATE_EMAIL_DRAFT');
  ok('Save draft from another account makes the draft in that account', !!cd && cd.account === 'gmail_personal' && !cd.arguments.thread_id && /^Re: /.test(cd.arguments.subject), JSON.stringify(cd));
  conf = await send(pg, 'Sending from my personal address.');
  se = slugs(await calls(pg)).find((t) => t.tool_slug === 'GMAIL_SEND_EMAIL');
  ok('and Send goes from that account', !!se && se.account === 'gmail_personal' && se.arguments.from_email === 'alex.rivera@mail.example', JSON.stringify(se));

  // back to the thread's own address: a normal threaded reply
  await pg.waitForTimeout(800); await unfold(pg); await pg.waitForTimeout(600);
  conf = await send(pg, 'Threaded, from the usual address.');
  cs = slugs(await calls(pg));
  ok('the thread\'s own address still sends a normal reply in the thread', cs.some((t) => t.tool_slug === 'GMAIL_REPLY_TO_THREAD') && !cs.some((t) => t.tool_slug === 'GMAIL_SEND_EMAIL'));
  const lists = (await pg.evaluate(() => window.__calls.length)) >= 0;
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(2400);
  const ids = await pg.$$eval('#list .thread[data-id]', (x) => x.map((e) => e.dataset.id));
  await clear(pg); await pg.click('.thread[data-id="' + ids[1] + '"]'); await pg.waitForTimeout(2400); await unfold(pg); await pg.waitForTimeout(600);
  ok('the addresses are read once, not on every thread', lists && !slugs(await calls(pg)).some((t) => t.tool_slug === 'GMAIL_LIST_SEND_AS'));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
