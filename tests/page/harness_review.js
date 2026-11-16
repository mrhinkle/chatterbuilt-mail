// The fixes from the 0.7.3 review: the mail sanitizer, a delete that returns late, the delete/send confirm and the
// keyboard, a stale formatted copy, Send under a folded reply box, draft writes and account switches, Today's drafts.
// usage: node harness_review.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
// Since 0.8.0 these checks run with Open mail at once off: they test how mail is fetched and shown, and kept copies
// would answer instead of the fetch. harness_cache.js and harness_dcache.js cover the copies.
const NO_CACHE = (() => { try { const f = JSON.parse(localStorage.getItem('cm.features') || '{}') || {}; if (f.cache === undefined) { f.cache = false; localStorage.setItem('cm.features', JSON.stringify(f)); } } catch (e) {} });

const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: opts.vp || { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(NO_CACHE);
    if (opts.init) await pg.addInitScript(opts.init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const gxSlugs = async (pg, slug) => (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').flatMap((c) => c.input.tools || []).filter((t) => t.tool_slug === slug);
  // What the formatted view of each message shows: its shadow root's HTML, by message id.
  const shadows = (pg) => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#reading article.msg')].map((a) => { const h = a.querySelector('.mailhost'); return [a.dataset.mid, h && h.shadowRoot ? h.shadowRoot.innerHTML : null]; })));

  // ---------- the sanitizer: nothing that loads, no SVG content, quoted history folds once ----------
  const HOSTILE = '<div style="color:#123456;background:linear-gradient(red, blue)">Kept styles</div>'
    + '<div style="background:\\75 rl(https://t.example/a.gif)">Escaped</div>'
    + '<div style="background:image-set(\'https://t.example/b.gif\' 1x)">Image set</div>'
    + '<div style="background:u/**/rl(https://t.example/c.gif)">Comment</div>'
    + '<div style="background:-webkit-image-set(url(https://t.example/d.gif) 1x)">Webkit set</div>'
    + '<svg><style>.a{fill:red}</style><script>track()</script><text>svgtext</text></svg>'
    + '<math><mi>mathtext</mi></math>'
    + '<div class="gmail_quote_container"><div class="gmail_quote">On Monday Dana wrote:<blockquote class="gmail_quote">Old <div class="gmail_quote">older</div></blockquote></div></div>';
  let pg = await open(DEMO, 'san');
  await pg.evaluate((h) => { window.__mailHtml = { t5: h }; }, HOSTILE);
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  let sh = Object.values(await shadows(pg)).filter(Boolean).pop() || '';
  ok('sanitizer: plain colors and gradients are kept', /color:\s*#123456/.test(sh) && /linear-gradient/.test(sh) && sh.includes('Kept styles'), sh.slice(0, 200));
  ok('sanitizer: no style that could fetch survives (escapes, image-set, comments)', !/t\.example|image-set|\\|\/\*/.test(sh) && sh.includes('Escaped') && sh.includes('Image set'), (sh.match(/style="[^"]*"/g) || []).join(' '));
  ok('sanitizer: SVG and MathML are dropped with what is inside them', !/svgtext|mathtext|fill:red|track\(\)/.test(sh) && !/<svg|<math/i.test(sh));
  ok('sanitizer: quoted history folds once, not once per level', (sh.match(/<details/g) || []).length === 1 && sh.includes('older'), String((sh.match(/<details/g) || []).length));
  await pg.context().close();

  // ---------- a new message in a formatted thread is formatted too ----------
  pg = await open(DEMO, 'fresh');
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(1800);
  await pg.evaluate(() => { window.__extraMsg = { t5: { id: 'mt5new', plaintextBody: 'Brand new reply, see https://example.com/x', htmlBody: '<p>Brand new <b>reply</b>, see <a href="https://example.com/x">the link</a></p>' } }; });
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  sh = await shadows(pg);
  ok('a message that arrived after the thread was first opened shows formatted, not plain', !!sh.mt5new && /<b>reply<\/b>/.test(sh.mt5new), JSON.stringify(Object.keys(sh)));
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(400);
  ok('switching to plain text keeps links clickable', await pg.$eval('#reading article.msg[data-mid="mt5new"] .body', (b) => !!b.querySelector('a[href="https://example.com/x"]')));
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(600);
  await pg.context().close();

  // ---------- a long formatted thread renders only the messages on show; a collapsed one when you open it ----------
  pg = await open(DEMO, 'lazy');
  await pg.evaluate(() => { window.__extraMsg = { t5: [{ id: 'mtA', htmlBody: '<p>Second <b>message</b></p>' }, { id: 'mtB', htmlBody: '<p>Third <i>message</i></p>' }] }; });
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(2600);
  sh = await shadows(pg);
  ok('long thread: the collapsed first message is not rendered yet; the two on show are', sh.mt5 === null && /<b>message<\/b>/.test(sh.mtA || '') && /<i>message<\/i>/.test(sh.mtB || ''), JSON.stringify(Object.fromEntries(Object.entries(sh).map(([k, v]) => [k, v ? v.length : v]))));
  await pg.click('#reading article.msg[data-mid="mt5"] .mh'); await pg.waitForTimeout(300);
  sh = await shadows(pg);
  ok('…opening it renders it formatted', /The Weekly Byte/.test(sh.mt5 || ''));
  await pg.click('#reading article.msg[data-mid="mt5"] .mh'); await pg.waitForTimeout(100);
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(400);
  await pg.click('#reading article.msg[data-mid="mt5"] .mh'); await pg.waitForTimeout(300);
  ok('…and in plain text, opening a collapsed message shows plain text', (await shadows(pg)).mt5 === null && /Weekly Byte|stories/i.test(await pg.textContent('#reading article.msg[data-mid="mt5"] .body')));
  await pg.evaluate(() => document.getElementById('htmlBtn').click()); await pg.waitForTimeout(600);
  await pg.context().close();

  // ---------- Send under a folded reply box brings its note into view ----------
  pg = await open(DEMO, 'fold');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  if (!(await pg.evaluate(() => document.getElementById('compose').classList.contains('folded')))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); }
  await pg.evaluate(() => { const r = document.getElementById('reading'); const a = r.querySelector('article.msg'); for (let i = 0; i < 6; i++) r.appendChild(a.cloneNode(true)); r.scrollTop = r.scrollHeight; });
  await pg.click('#sendBtn'); await pg.waitForTimeout(500);
  ok('folded box, scrolled down a long thread: Send opens the box and shows "Write something first." on screen', await pg.$eval('#composeNote', (n) => { const r = n.getBoundingClientRect(), d = document.getElementById('desk').getBoundingClientRect(); return /Write something first/.test(n.textContent) && r.top >= d.top && r.bottom <= d.bottom; }));
  await pg.context().close();

  // ---------- a delete that returns late owns the editor; the confirm and the keyboard ----------
  pg = await open(DEMO, 'late');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(2000);
  ok('the Delete button is red', (await pg.$eval('#dDelete', (e) => getComputedStyle(e).color)) === 'rgb(180, 35, 24)', await pg.$eval('#dDelete', (e) => getComputedStyle(e).color));
  await pg.click('#dDelete'); await pg.waitForTimeout(150);
  ok('the delete question puts focus on Cancel, the safe answer', (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'dConfirmNo');
  await pg.click('#dConfirmNo'); await pg.waitForTimeout(100);
  await clear(pg);
  await pg.focus('#dDelete'); await pg.keyboard.press('Enter'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  ok('Enter twice on Delete asks, then cancels: nothing deleted', !(await calls(pg)).some((c) => c.tool === 'delete_draft') && await pg.isHidden('#dConfirm'));
  await pg.focus('#dSend'); await pg.keyboard.press('Enter'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  ok('Enter twice on Send asks, and the second Enter does not send', !(await calls(pg)).some((c) => c.tool === 'send_message') && await pg.isVisible('#dConfirm'));
  await pg.click('#dConfirmNo'); await pg.waitForTimeout(100);
  // slow delete, then try to move on while it runs
  await pg.evaluate(() => { window.__slowDelete = 2500; });
  await pg.click('#dDelete'); await pg.waitForTimeout(150); await clear(pg); await pg.click('#dConfirmGo'); await pg.waitForTimeout(300);
  ok('while it deletes, the other draft buttons are off', await pg.evaluate(() => ['dSend', 'dSave', 'dDone', 'dPrev', 'dNext', 'dDelete'].every((k) => document.getElementById(k).disabled)));
  await pg.evaluate(() => document.getElementById('dNext').click());
  await pg.click('#list .draftrow[data-did="d3"]'); await pg.waitForTimeout(300);
  ok('…and another draft does not open (it says to wait)', (await pg.inputValue('#dSubj')) === 'Re: Venue walkthrough' && await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /still deleting/.test(t.textContent))));
  await pg.waitForTimeout(3600);
  const opened = (await calls(pg)).filter((c) => c.tool === 'get_draft' && c.input.messageFormat !== 'MINIMAL').map((c) => c.input.draftId);
  ok('when it returns, the next draft opens once, and focus is in its editor', (await pg.inputValue('#dSubj')) === 'Keynote at the spring summit?' && opened.filter((x) => x === 'd2').length <= 1 && opened.filter((x) => x === 'd3').length <= 1 && (await pg.evaluate(() => document.activeElement && document.activeElement.id)) === 'dEditor', JSON.stringify(opened));
  await pg.evaluate(() => { window.__slowDelete = 0; window.__delete404 = true; document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  await pg.click('#dDelete'); await pg.waitForTimeout(150); await pg.click('#dConfirmGo'); await pg.waitForTimeout(2200);
  ok('deleting a draft Gmail says is already gone counts as deleted', !(await pg.$('#list .draftrow[data-did="d2"]')) && await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Draft deleted/.test(t.textContent))));
  ok('notes are announced to screen readers', (await pg.getAttribute('#dNote', 'aria-live')) === 'polite');
  await pg.context().close();

  // ---------- your own reply refreshes the list ----------
  pg = await open(DEMO, 'reply');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  if (await pg.evaluate(() => document.getElementById('compose').classList.contains('folded'))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); }
  await pg.fill('#body', 'Thanks Dana, Tuesday works.');
  await pg.click('#sendBtn'); await pg.waitForTimeout(1500);
  await clear(pg); await pg.click('#confirmSend'); await pg.waitForTimeout(3000);
  const rc = (await calls(pg)).map((c) => c.tool);
  ok('after you send a reply, the list updates too (so it is not "Updates available" later)', rc.includes('reply') && rc.lastIndexOf('search_threads') > rc.indexOf('reply'), rc.join(','));
  await pg.context().close();

  // ---------- Today asks for drafts itself when the list never loaded ----------
  pg = await open(DEMO, 'today', { init: () => { window.__failSearch = true; } });
  await pg.waitForTimeout(1500);
  const card = await pg.evaluate(() => { const c = [...document.querySelectorAll('.tcard')].find((x) => /Drafts waiting/.test(x.textContent)); return c ? c.textContent : ''; });
  ok('Today shows the drafts even when the inbox failed to load (no endless "Checking")', !/Checking Gmail Drafts/.test(card) && /Lee Park|Riley/.test(card), card.slice(0, 160));
  await pg.context().close();

  // ---------- Composio: a draft is saved to its own account when you switch accounts, and the editor closes ----------
  pg = await open(GXP, 'acct');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  const first = await pg.$eval('#list .draftrow', (e) => e.dataset.did);
  await pg.click('#list .draftrow[data-did="' + first + '"]'); await pg.waitForTimeout(2600);
  await pg.click('#dEditor'); await pg.keyboard.type(' One more line.'); await clear(pg);
  await pg.selectOption('#acctSel', '1'); await pg.waitForTimeout(2600);
  const up = await gxSlugs(pg, 'GMAIL_UPDATE_DRAFT');
  ok('switching accounts saves your edits to the draft, on its own account', up.length === 1 && up[0].arguments.draft_id === first && up[0].account === 'gmail_work' && /One more line/.test(up[0].arguments.body), JSON.stringify(up.map((u) => [u.account, u.arguments.draft_id])));
  ok('…and closes the other account\'s draft', !(await pg.$('#dEditor')));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
