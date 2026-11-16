// The Drafts tab: a checklist of Gmail drafts, a rich-text editor, the review checklist, save, send and next.
// usage: node harness_drafts.js <demo.html> <gx.html> <outdir>
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
    await pg.addInitScript(() => { const u = window.claude.use; window.__prompts = []; window.claude.use = async (n) => { const x = await u(n); if (n !== 'sample' || !x) return x; const f = async (inp, o) => { const p = typeof inp === 'string' ? inp : JSON.stringify(inp); window.__prompts.push(p); if (p.includes('You review an email draft before')) return { text: JSON.stringify({ asks: { ok: true, note: 'Answers the walkthrough time' }, facts: { ok: true, note: 'Tuesday at 10 matches' }, commit: { ok: true, note: 'Nothing new promised' }, people: { ok: true, note: 'Lee only' }, tone: { ok: true, note: 'Friendly' }, clean: { ok: false, note: 'No greeting comma after Hi Lee' } }) }; if (p.includes('Rewrite it: Shorter')) return { text: 'Tuesday at 10 works. Alex' }; return x(inp, o); }; Object.assign(f, x); return f; }; });
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });

  let pg = await open(DEMO, 'demo');
  ok('there is a Drafts tab', await pg.isVisible('.chip[data-key="drafts"]'));
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  const rows = await pg.$$eval('#list .draftrow', (x) => x.map((e) => e.querySelector('.from').textContent + ' | ' + e.querySelector('.subj').textContent));
  ok('lists every draft, newest first, with who and subject', rows.length === 3 && rows[0] === 'To Lee Park | Re: Venue walkthrough' && rows[1] === 'To Riley Chen | Keynote at the spring summit?' && rows[2].startsWith('To Jo Park'), rows.join(' / '));
  ok('the header counts checked drafts', (await pg.textContent('#list .lsec')).includes('0 of 3 checked'));
  ok('Triage is out of the way here', await pg.evaluate(() => getComputedStyle(document.getElementById('triageBtn')).visibility === 'hidden'));
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(1800);
  ok('opening a draft shows the message it answers', /Replying to Lee Park/.test(await pg.textContent('.dctx summary')) && (await pg.textContent('.dctx .body')).includes('walk the space'));
  const chips = (k) => pg.$$eval('.rbox[data-rk="' + k + '"] .rchip', (x) => x.map((e) => e.getAttribute('title')).join(','));
  ok('To is an address field with the recipient as a chip; Subject is filled', (await chips('dto')) === 'lee@venuehall.example' && (await pg.inputValue('#dSubj')) === 'Re: Venue walkthrough', await chips('dto'));
  await pg.waitForTimeout(1500);
  ok('the context panel shows what your systems know about Lee', (await pg.isVisible('#sideBody')) && /From your systems/i.test(await pg.textContent('#sideBody')) && !(await pg.$('#sideBody [data-ctx="more"]')) && !(await pg.$('#sideBody [data-ctx="steps"]')), (await pg.textContent('#sideBody')).slice(0, 160));
  ok('Check it for me ran on its own when the draft opened', await pg.evaluate(() => window.__prompts.some((p) => p.includes('You review an email draft before'))) && (await pg.isChecked('[data-dtick="asks"]')));
  ok('the checklist explains what the check does', /never changes the draft/.test(await pg.textContent('.dcheck .dhow')));
  ok('the draft loads into a rich-text editor', (await pg.getAttribute('#dEditor', 'contenteditable')) === 'true' && (await pg.textContent('#dEditor')).includes('Tuesday at 10 works'));
  const cmds = await pg.$$eval('.rtbar [data-cmd]', (x) => x.map((e) => e.dataset.cmd));
  ok('the toolbar has bold, italic, underline, link and lists', ['bold', 'italic', 'underline', 'link', 'insertUnorderedList', 'insertOrderedList', 'removeFormat'].every((c) => cmds.includes(c)), cmds.join(','));
  // bold a word
  await pg.evaluate(() => { const ed = document.getElementById('dEditor'); const r = document.createRange(); const tn = [...ed.querySelectorAll('*')].map((e) => [...e.childNodes]).flat().find((n) => n.nodeType === 3 && n.nodeValue.includes('Tuesday')) ; const i = tn.nodeValue.indexOf('Tuesday'); r.setStart(tn, i); r.setEnd(tn, i + 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.click('.rtbar [data-cmd="bold"]'); await pg.waitForTimeout(100);
  ok('Bold makes the selection bold', /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>|font-weight/.test(await pg.innerHTML('#dEditor')), await pg.innerHTML('#dEditor'));
  // link
  await pg.evaluate(() => { const ed = document.getElementById('dEditor'); const tn = [...ed.querySelectorAll('*')].map((e) => [...e.childNodes]).flat().find((n) => n.nodeType === 3 && n.nodeValue.includes('See you there')); const i = tn.nodeValue.indexOf('there'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 5); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.click('.rtbar [data-cmd="link"]'); await pg.fill('#dLinkUrl', 'venuehall.example/map'); await pg.click('#dLinkAdd'); await pg.waitForTimeout(100);
  ok('Link adds a safe link', (await pg.getAttribute('#dEditor a', 'href')) === 'https://venuehall.example/map' && (await pg.getAttribute('#dEditor a', 'rel')) === 'noopener');
  await pg.click('#dAutoCheck'); await pg.waitForTimeout(1200);
  const ticks = await pg.$$eval('[data-dtick]', (x) => x.map((e) => e.dataset.dtick + '=' + e.checked));
  ok('Check it for me ticks what passes and flags the rest', ticks.join(',') === 'asks=true,facts=true,commit=true,people=true,tone=true,clean=false', ticks.join(','));
  ok('flagged items carry a note', (await pg.textContent('.dcheck')).includes('No greeting comma'));
  ok('your edits survive the check', /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>/.test(await pg.innerHTML('#dEditor')) && !!(await pg.$('#dEditor a')));
  await pg.check('[data-dtick="clean"]'); await pg.waitForTimeout(150);
  ok('ticking the last item marks the draft checked', (await pg.textContent('#list .lsec')).includes('1 of 3 checked') && (await pg.isChecked('[data-dchk="d1"]')));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(700);
  let u = (await calls(pg)).find((c) => c.tool === 'update_draft');
  ok('Save updates the Gmail draft with HTML and plain text', !!u && u.input.draftId === 'd1' && /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>/.test(u.input.htmlBody) && u.input.htmlBody.includes('href="https://venuehall.example/map"') && u.input.body.includes('Tuesday at 10 works') && JSON.stringify(u.input.to) === '["lee@venuehall.example"]', JSON.stringify(u && u.input).slice(0, 300));
  ok('saving sends nothing', !(await calls(pg)).some((c) => c.tool === 'send_message'));
  // revise + undo
  await pg.click('[data-drev="Shorter"]'); await pg.waitForTimeout(1000);
  ok('Revise rewrites in place', (await pg.textContent('#dEditor')).trim() === 'Tuesday at 10 works. Alex');
  await pg.click('#dUndo'); await pg.waitForTimeout(100);
  ok('Undo brings back the version with formatting', /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>/.test(await pg.innerHTML('#dEditor')));
  // send
  await pg.click('#dSend'); await pg.waitForTimeout(200);
  ok('Send asks once and names who it goes to', (await pg.isVisible('#dConfirm')) && (await pg.textContent('#dConfirmText')).startsWith('Send this to lee@venuehall.example?'));
  await clear(pg); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2600);
  const cs = await calls(pg);
  ok('it saves the unsaved edit first, then sends the draft', cs.findIndex((c) => c.tool === 'update_draft') > -1 && cs.findIndex((c) => c.tool === 'update_draft') < cs.findIndex((c) => c.tool === 'send_message') && cs.find((c) => c.tool === 'send_message').input.draftId === 'd1', JSON.stringify(cs.map((c) => c.tool)));
  ok('the sent draft leaves the list and the next one opens', !(await pg.$('#list .draftrow[data-did="d1"]')) && (await pg.inputValue('#dSubj')) === 'Keynote at the spring summit?');
  ok('a new email says so', (await pg.textContent('.dedit')).includes('A new email, not a reply'));
  ok('formatting from Gmail comes through', /<b>April<\/b>/.test(await pg.innerHTML('#dEditor')));
  // mark checked + next, hide checked
  await pg.click('#dDone'); await pg.waitForTimeout(1500);
  ok('Mark checked · next moves to the next unchecked draft', (await pg.inputValue('#dSubj')) === 'Re: Intro' && (await pg.isChecked('[data-dchk="d2"]')));
  ok('Cc carries over into the editor as a chip', (await chips('dcc')) === 'pat@example.org');
  await pg.click('[data-dhide]'); await pg.waitForTimeout(150);
  ok('Hide checked leaves the drafts still to do', (await pg.$$('#list .draftrow')).length === 1);
  await pg.click('[data-dhide]');
  // leave with unsaved edits
  await pg.click('#dEditor'); await pg.keyboard.type(' Thanks!'); await clear(pg);
  await pg.click('.chip[data-key="inbox"]'); await pg.waitForTimeout(1800);
  ok('leaving the tab saves your unsaved edits', (await calls(pg)).some((c) => c.tool === 'update_draft' && c.input.draftId === 'd3' && c.input.body.includes('Thanks!')));
  ok('the inbox comes back, Triage too', (await pg.$$('#list .thread[data-id]')).length > 3 && await pg.evaluate(() => getComputedStyle(document.getElementById('triageBtn')).visibility === 'visible'));
  // read-only
  await pg.evaluate(() => { document.getElementById('roToggle') && document.getElementById('roToggle').click(); });
  await pg.context().close();

  // ---------- address book lookups in the draft fields ----------
  pg = await open(process.argv[5] || DEMO, 'book');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(2500);
  ok('a new email gets context on the person it is to', /Riley|riley/i.test(await pg.textContent('#sideBody')));
  await pg.click('#dccIn'); await pg.type('#dccIn', 'tay', { delay: 30 }); await pg.waitForTimeout(900);
  ok('typing in a draft field suggests people from Google Contacts', (await pg.textContent('#dccSug')).includes('Taylor Brooks') && (await pg.textContent('#dccSug')).includes('Google Contacts'));
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { window.__calls = []; }); await pg.click('#dSave'); await pg.waitForTimeout(800);
  const bu = (await pg.evaluate(() => window.__calls.map((c) => ({ tool: c.tool, input: c.input })))).find((c) => c.tool === 'update_draft');
  ok('Save sends the picked Cc', !!bu && JSON.stringify(bu.input.cc) === '["taylor@riveralabs.example"]', JSON.stringify(bu && bu.input).slice(0, 200));
  await pg.context().close();

  // ---------- Composio path ----------
  pg = await open(GXP, 'gx');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  ok('Composio: drafts list loads', (await pg.$$('#list .draftrow')).length >= 1);
  const first = await pg.$eval('#list .draftrow', (e) => e.dataset.did);
  await pg.click('#list .draftrow[data-did="' + first + '"]'); await pg.waitForTimeout(2600);
  ok('Composio: a reply draft warns before you save that saving drops its threading', /can't keep a reply's threading headers/.test(await pg.textContent('#dThreadWarn')));
  await pg.click('#dEditor'); await pg.keyboard.type(' Extra line.');
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1500);
  const gu = (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]).find((t) => t.tool_slug === 'GMAIL_UPDATE_DRAFT');
  ok('Composio: Save is GMAIL_UPDATE_DRAFT with HTML, threaded, no extra signature', !!gu && gu.arguments.draft_id === first && gu.arguments.is_html === true && gu.arguments.include_signature === false && /Extra line/.test(gu.arguments.body), JSON.stringify(gu));
  ok('Composio: after saving a reply, it says the threading headers are gone', /no longer carries its threading headers/.test(await pg.textContent('#dThreadWarn')), await pg.textContent('#dThreadWarn'));
  await pg.click('#dSend'); await pg.waitForTimeout(200);
  ok('Composio: the send confirmation says so too', /dropped its threading headers.*new conversation/.test(await pg.textContent('#dConfirmText')), await pg.textContent('#dConfirmText'));
  await clear(pg); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2200);
  const gs = (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]).find((t) => t.tool_slug === 'GMAIL_SEND_DRAFT');
  ok('Composio: Send is GMAIL_SEND_DRAFT', !!gs && gs.arguments.draft_id === first, JSON.stringify(gs));
  await pg.context().close();

  // ---------- Composio, a draft saved as HTML only (Mark's live bug: the editor showed the tags) ----------
  pg = await open(GXP, 'gxhtml');
  await pg.evaluate(() => { window.__htmlOnlyDraft = true; });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  await pg.click('#list .draftrow'); await pg.waitForTimeout(2600);
  const edH = await pg.innerHTML('#dEditor'), edT = await pg.textContent('#dEditor');
  ok('HTML-only draft: the editor shows the message, not its markup', !/&lt;|<br>&lt;|gmail_signature&quot;/.test(edH) && !/<br>|<table|&#x27;/.test(edT) && edT.includes("We're set for Thursday at 10"), edT.slice(0, 200));
  ok('HTML-only draft: line breaks are real breaks', (await pg.$$('#dEditor br')).length >= 2 || (await pg.$$('#dEditor div, #dEditor p')).length >= 2);
  ok('HTML-only draft: the signature stays out of the editor and shows under it', !edT.includes('Sam Rivera') && (await pg.$eval('.dsig .sigview', (e) => e.shadowRoot.textContent)).includes('Sam Rivera'), edT.slice(-80));
  ok('the editor ends at the sign-off, no trailing blank lines', /Sam\s*$/.test(edT) && !/(<br>\s*)+(<\/div>)?\s*$/.test((await pg.innerHTML('#dEditor')).trim()), (await pg.innerHTML('#dEditor')).slice(-80));
  ok('HTML-only draft: the list row reads as text', !/<br>|&#x27;/.test(await pg.textContent('#list .draftrow')));
  const pr = await pg.evaluate(() => (window.__prompts || []).filter((p) => p.includes('You review an email draft before')).pop() || '');
  ok('the check leaves the signature out and only fails real problems', !!pr && !pr.includes('Sam Rivera') && /can't verify/.test(pr) && /signature is kept as it is/i.test(pr));
  ok('the check result shows in the bar by the buttons', !!(await pg.$('.dfoot #dNote')) && /checklist/.test(await pg.textContent('.dfoot #dNote')), await pg.textContent('#dNote'));
  await pg.click('#dEditor'); await pg.keyboard.press('End'); await pg.keyboard.type(' Thanks!');
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1500);
  const gh = (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]).find((t) => t.tool_slug === 'GMAIL_UPDATE_DRAFT');
  ok('Save puts the signature back exactly as it was', !!gh && gh.arguments.body.includes('<table cellpadding="0" cellspacing="0" style="margin:0px">') && gh.arguments.body.includes('data-smartmail="gmail_signature"') && /Thanks!/.test(gh.arguments.body) && (gh.arguments.body.match(/class="gmail_signature"/g) || []).length === 1, gh && gh.arguments.body.slice(-400));
  await pg.click('#dSend'); await pg.waitForTimeout(200);
  ok('the send confirmation opens in the bar, not below it', await pg.isVisible('.dfoot #dConfirm'));
  await pg.click('#dConfirmNo');
  await pg.context().close();

  // ---------- the Drafts tab with nothing open ----------
  pg = await open(DEMO, 'dhome');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  ok('with no draft open, the desk counts what is left, not Today', /drafts? to review/.test(await pg.textContent('#reading')) && !(await pg.$('.tcard')), (await pg.textContent('#reading')).slice(0, 120));
  await pg.click('#dStart'); await pg.waitForTimeout(1800);
  ok('Start with the first one opens it', !!(await pg.$('#dEditor')));
  await pg.context().close();

  // ---------- phone ----------
  pg = await open(DEMO, 'phone', { width: 390, height: 844 });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1600);
  await pg.click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(1600);
  ok('phone: the draft opens full width, no horizontal scroll', (await pg.isVisible('#dEditor')) && await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
