// Signatures: pulled from Gmail (send-as settings through Composio; your newest signed sent message with the Gmail
// connector), previewed under the reply box with an on/off for one message, and inserted into a draft in the Drafts tab.
// usage: node harness_sig.js <demo.html> <gx.html> <outdir>
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
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const slugs = (cs) => cs.filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]);
  const shadowText = (pg, sel) => pg.$eval(sel + ' .sigview', (e) => (e.shadowRoot ? e.shadowRoot.textContent : '')).catch(() => '');
  const WRITES = /reply|send_message|create_draft|update_draft|label_thread|unlabel_thread|forward/;
  const unfold = async (pg) => { if (await pg.evaluate(() => document.querySelector('.compose').classList.contains('folded'))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); } };

  // ---------- the Gmail connector ----------
  let pg = await open(DEMO, 'native');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200); await unfold(pg);
  ok('the reply box has a Signature switch, on, and Show', await pg.isChecked('#sigChk') && await pg.isVisible('#sigPeek') && !(await pg.isVisible('#sigBox')));
  await clear(pg); await pg.click('#sigPeek'); await pg.waitForTimeout(1600);
  let cs = await calls(pg);
  ok('Show finds the signature on your newest signed sent message', (await shadowText(pg, '#sigBox')).includes('Alex Rivera') && cs.some((c) => c.tool === 'search_threads' && /in:sent/.test(c.input.query)) && cs.some((c) => c.tool === 'get_thread' && c.input.messageFormat === 'FULL_CONTENT'), await pg.textContent('#sigBox'));
  ok('the preview keeps the signature\'s own layout, styles and links', (await pg.getAttribute('#sigBox a[href^="mailto:"]', 'href')) === 'mailto:alex@riveralabs.example' && await pg.$eval('#sigBox .sigview', (e) => !!e.shadowRoot.querySelector('table') && /font-size:\s*14px/.test(e.shadowRoot.querySelector('b').getAttribute('style') || '') && /color:\s*#555/.test(e.shadowRoot.querySelector('span:not(.ph)[style]').getAttribute('style') || '')));
  ok('images show as boxes of their real size, labeled, with a note', await pg.$eval('#sigBox .sigview', (e) => { const p = e.shadowRoot.querySelector('.ph'); return !!p && p.title === 'Rivera Labs' && p.style.width === '40px' && !e.shadowRoot.querySelector('img'); }) && /real images/.test(await pg.textContent('#sigBox .sigimg')));
  ok('nothing in the signature can run or load from elsewhere', await pg.$eval('#sigBox .sigview', (e) => !e.shadowRoot.querySelector('script, iframe, form, img, [onclick], [onerror]')));
  ok('reading the signature writes nothing', !cs.some((c) => WRITES.test(c.tool)));
  await pg.click('#sigPeek'); await pg.waitForTimeout(100);
  ok('Hide folds it away', !(await pg.isVisible('#sigBox')) && (await pg.textContent('#sigPeek')) === 'Show');
  await pg.click('label:has(#sigChk)'); await pg.waitForTimeout(100);
  ok('switching it off says so', /Not added/.test(await pg.textContent('#sigNote')));
  await pg.fill('#body', 'Thanks, will do.');
  await clear(pg); await pg.click('#sendBtn'); await pg.waitForTimeout(1600); await pg.click('#confirmSend'); await pg.waitForTimeout(1600);
  let rp = (await calls(pg)).find((c) => c.tool === 'reply' || c.tool === 'send_message');
  ok('a reply with the switch off goes without the signature', !!rp && rp.input.includeSignature === false, JSON.stringify(rp && rp.input).slice(0, 200));
  await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(2000); await unfold(pg);
  ok('the next thread starts with it on again', await pg.isChecked('#sigChk') && !(await pg.textContent('#sigNote')));
  await pg.fill('#body', 'Tuesday works.');
  await clear(pg); await pg.click('#sendBtn'); await pg.waitForTimeout(1600); await pg.click('#confirmSend'); await pg.waitForTimeout(1600);
  rp = (await calls(pg)).find((c) => c.tool === 'reply' || c.tool === 'send_message');
  ok('with it on, the reply asks Gmail to add it', !!rp && rp.input.includeSignature === true);

  // Drafts: insert into a draft that has none
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d3"]'); await pg.waitForTimeout(2400);
  ok('a draft with no signature shows none, and offers Insert signature', !(await pg.$('.dsig')) && await pg.isVisible('.rtbar [data-sig]'));
  await clear(pg); await pg.click('.rtbar [data-sig]'); await pg.waitForTimeout(1400);
  ok('Insert signature puts your signature under the draft', (await shadowText(pg, '.dsig')).includes('Alex Rivera') && /Signature added/.test(await pg.textContent('#dNote')), await pg.textContent('#dNote'));
  ok('…without touching the text you wrote', !(await pg.textContent('#dEditor')).includes('Rivera Labs'));
  ok('…and without saving anything yet', !(await calls(pg)).some((c) => WRITES.test(c.tool)));
  await pg.click('.rtbar [data-sig]'); await pg.waitForTimeout(600);
  ok('pressing it again says it is already there', /already on this draft/.test(await pg.textContent('#dNote')));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1400);
  let up = (await calls(pg)).find((c) => c.tool === 'update_draft');
  ok('Save puts it on the draft once, as Gmail marks a signature', !!up && (up.input.htmlBody.match(/class="gmail_signature"/g) || []).length === 1 && up.input.htmlBody.includes('Events lead, Rivera Labs') && up.input.htmlBody.indexOf('Following up') < up.input.htmlBody.indexOf('gmail_signature'), up && up.input.htmlBody.slice(-300));
  await pg.click('#dSigX'); await pg.waitForTimeout(200);
  ok('Remove takes it off', !(await pg.$('.dsig')) && /removed/.test(await pg.textContent('#dNote')));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1400);
  up = (await calls(pg)).find((c) => c.tool === 'update_draft');
  ok('…and Save leaves it off', !!up && !/gmail_signature/.test(up.input.htmlBody));
  await pg.context().close();

  // ---------- Composio, All inboxes ----------
  pg = await open(GXP, 'gx');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  await pg.click('#list .draftrow'); await pg.waitForTimeout(2600);
  await clear(pg); await pg.click('.rtbar [data-sig]'); await pg.waitForTimeout(1600);
  cs = slugs(await calls(pg));
  const sa = cs.find((t) => t.tool_slug === 'GMAIL_LIST_SEND_AS');
  ok('Composio: the signature comes from Gmail settings for the draft\'s account', !!sa && !!sa.account && (await shadowText(pg, '.dsig')).includes('Alex Rivera'), JSON.stringify(sa));
  ok('Composio: reading settings writes nothing', !cs.some((t) => /^GMAIL_(SEND|REPLY|UPDATE|CREATE|MODIFY|PATCH|ADD|REMOVE|DELETE|TRASH|FORWARD|BATCH)/.test(t.tool_slug)));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1600);
  const gu = slugs(await calls(pg)).find((t) => t.tool_slug === 'GMAIL_UPDATE_DRAFT');
  ok('Composio: Save sends it in the HTML body, with no second one added', !!gu && gu.arguments.is_html === true && gu.arguments.include_signature === false && (gu.arguments.body.match(/class="gmail_signature"/g) || []).length === 1, gu && gu.arguments.body.slice(-200));
  await pg.context().close();

  // Composio, an account with no signature set
  pg = await open(GXP, 'gxnosig');
  await pg.evaluate(() => { window.__noSig = true; });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  await pg.click('#list .draftrow'); await pg.waitForTimeout(2600);
  await pg.click('.rtbar [data-sig]'); await pg.waitForTimeout(1600);
  ok('with no signature in Gmail, it says where to set one', /No signature is set in Gmail.*Settings → Signature/.test(await pg.textContent('#dNote')) && !(await pg.$('.dsig')), await pg.textContent('#dNote'));
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(2600);
  const first = await pg.$eval('#list .thread[data-id]', (e) => e.dataset.id);
  await pg.click('.thread[data-id="' + first + '"]'); await pg.waitForTimeout(2600); await unfold(pg);
  await pg.click('#sigPeek'); await pg.waitForTimeout(1600);
  ok('Show says the same under the reply box', /No signature is set in Gmail/.test(await pg.textContent('#sigBox')), await pg.textContent('#sigBox'));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
