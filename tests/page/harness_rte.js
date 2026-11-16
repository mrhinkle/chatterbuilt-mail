// The draft editor shows the draft as it will look: your text, the signature in place, earlier messages folded,
// whatever mail app wrote it; it keeps them on Save; and a large Composio draft still comes with its HTML.
// usage: node harness_rte.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
// Since 0.8.0 these checks run with Open mail at once off: they test how mail is fetched and shown, and kept copies
// would answer instead of the fetch. harness_cache.js and harness_dcache.js cover the copies.
const NO_CACHE = (() => { try { const f = JSON.parse(localStorage.getItem('cm.features') || '{}') || {}; if (f.cache === undefined) { f.cache = false; localStorage.setItem('cm.features', JSON.stringify(f)); } } catch (e) {} });

const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')); const toLocal = (s) => s.split('/mnt/files/').join(SB + '/'); const bashLog = [];
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: opts.vp || { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    if (opts.sandbox) {
      await pg.exposeFunction('__sbWrite', (p, text) => { const f = toLocal(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); });
      await pg.exposeFunction('__bash', (cmd) => { bashLog.push(cmd); try { return { stdout: execFileSync('bash', ['-c', toLocal(cmd)], { encoding: 'utf8', maxBuffer: 1 << 26 }), stderr: '' }; } catch (e) { return { stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message) }; } });
    }
    await pg.addInitScript(fake); await pg.addInitScript(NO_CACHE);
    if (opts.init) await pg.addInitScript(opts.init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const shadowText = (pg, sel) => pg.evaluate((s) => { const h = document.querySelector(s); return h && h.shadowRoot ? h.shadowRoot.textContent : ''; }, sel);
  const openDraft = async (pg, id, wait) => { await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(wait || 1800); await pg.click('#list .draftrow[data-did="' + id + '"]'); await pg.waitForTimeout(wait || 2200); };

  // ---------- native: a reply started in Outlook mobile (Mark's "Re: Reconnect") ----------
  let pg = await open(DEMO, 'outlook', { init: () => { window.__outlookDraft = true; } });
  await openDraft(pg, 'd1');
  ok('an empty draft says where to write, instead of showing a blank box', await pg.$eval('#dEditor', (e) => e.classList.contains('isempty') && /Write your message/.test(getComputedStyle(e, '::before').content)));
  ok('the Outlook signature shows in the sheet, under the text, as it will look', /Alex Rivera · Founder, Rivera Labs/.test(await shadowText(pg, '#dSigBox .sigview')) && /Website/.test(await shadowText(pg, '#dSigBox .sigview')) && await pg.$eval('#dSheet', (s) => s.contains(document.getElementById('dSigBox')) && document.getElementById('dEditor').compareDocumentPosition(document.getElementById('dSigBox')) & Node.DOCUMENT_POSITION_FOLLOWING));
  ok('the signature is not in the editable text', !/Alex Rivera/.test(await pg.textContent('#dEditor')));
  ok('earlier messages fold at the bottom of the sheet', await pg.isVisible('#dQuoteBox details.dquote summary') && !(await pg.$eval('#dQuoteBox details', (d) => d.open)));
  await pg.click('#dQuoteBox summary'); await pg.waitForTimeout(300);
  const q = await pg.evaluate(() => { const h = document.querySelector('#dQuoteBox .mailhost'); return h && h.shadowRoot ? { t: h.shadowRoot.textContent, d: h.shadowRoot.querySelectorAll('details').length } : null; });
  ok('…and open to the earlier message, without a second fold inside', !!q && /want to walk the space/.test(q.t) && /From:/.test(q.t) && q.d === 0, JSON.stringify(q));
  ok('pictures note shows (the signature has a picture)', await pg.isVisible('#dSheetNote'));
  // toolbar
  const tb = await pg.$$eval('.rtbar [data-cmd]', (x) => x.map((e) => e.dataset.cmd + (e.querySelector('svg') ? '' : '!noicon')));
  ok('the toolbar is icons: undo, redo, bold, italic, underline, strikethrough, link, lists, clear', tb.join(',') === 'undo,redo,bold,italic,underline,strikeThrough,link,insertUnorderedList,insertOrderedList,removeFormat', tb.join(','));
  await pg.click('#dEditor'); await pg.keyboard.type('Tuesday at 10 works. See you there.'); await pg.waitForTimeout(100);
  ok('typing clears the prompt', !(await pg.$eval('#dEditor', (e) => e.classList.contains('isempty'))));
  await pg.evaluate(() => { const ed = document.getElementById('dEditor'); const tn = [...ed.querySelectorAll('*')].concat([ed]).map((e) => [...e.childNodes]).flat().find((n) => n.nodeType === 3 && n.nodeValue.includes('Tuesday')); const r = document.createRange(); const i = tn.nodeValue.indexOf('Tuesday'); r.setStart(tn, i); r.setEnd(tn, i + 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.click('.rtbar [data-cmd="bold"]'); await pg.waitForTimeout(150);
  ok('Bold shows as on for the bold text', (await pg.getAttribute('.rtbar [data-cmd="bold"]', 'aria-pressed')) === 'true' && /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>|font-weight/.test(await pg.innerHTML('#dEditor')));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(800);
  const u = (await calls(pg)).find((c) => c.tool === 'update_draft'); const h = (u && u.input.htmlBody) || '';
  const iT = h.indexOf('Tuesday'), iS = h.indexOf('ms-outlook-mobile-signature'), iQ = h.indexOf('mail-editor-reference-message-container');
  ok('Save keeps your text, then the Outlook signature, then the earlier messages, all intact', iT > -1 && iS > iT && iQ > iS && h.includes('Alex Rivera · Founder') && h.includes('src="https://riveralabs.example/logo.png"') && h.includes('want to walk the space') && /<b>Tuesday<\/b>|<strong>Tuesday<\/strong>|font-weight/.test(h), [iT, iS, iQ].join(','));
  ok('…and the plain-text copy has the text', !!u && /Tuesday at 10 works/.test(u.input.body));
  await pg.context().close();

  // ---------- native: a draft's own fonts and colors show and stay ----------
  pg = await open(DEMO, 'styled', { init: () => { window.__draftHtml = { d2: '<div dir="ltr"><div style="color:#c00000;font-family:Georgia,serif">Red Georgia line</div><div><font color="#0b8043" face="Courier New">Green courier</font></div><div style="background:url(https://t.example/x.gif)">No fetch</div></div>' }; } });
  await openDraft(pg, 'd2');
  const sty = await pg.evaluate(() => { const ed = document.getElementById('dEditor'); const f = (t) => [...ed.querySelectorAll('*')].find((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.includes(t))); const a = f('Red Georgia'), g = f('Green courier'), n = f('No fetch'); return { a: a && getComputedStyle(a).color + '|' + getComputedStyle(a).fontFamily, g: g && getComputedStyle(g).color + '|' + getComputedStyle(g).fontFamily, n: n ? n.getAttribute('style') : 'none', html: ed.innerHTML }; });
  ok('the draft keeps its own colors and fonts in the editor (what you see is what goes)', /rgb\(192, 0, 0\)\|Georgia/.test(sty.a || '') && /rgb\(11, 128, 67\)\|"?Courier New/.test(sty.g || ''), JSON.stringify(sty).slice(0, 300));
  ok('…but never a style that loads something', !/url\(|t\.example/.test(sty.html));
  await pg.context().close();

  // ---------- phone width: the toolbar fits ----------
  pg = await open(DEMO, 'phone', { vp: { width: 390, height: 844 }, init: () => { window.__outlookDraft = true; } });
  await pg.click('.chip[data-key="drafts"]').catch(() => {}); await pg.waitForTimeout(1800);
  await pg.evaluate(() => { const r = document.querySelector('#list .draftrow[data-did="d1"]'); if (r) r.click(); }); await pg.waitForTimeout(2400);
  ok('phone: the sheet and toolbar fit the screen', await pg.evaluate(() => { const s = document.getElementById('dSheet'); return !!s && s.getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; }));
  await pg.context().close();

  // ---------- Composio: a draft too large to come back inline still opens with its HTML ----------
  pg = await open(GXP, 'gxbig', { sandbox: true, init: () => { window.__outlookDraft = true; } });
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
  await pg.evaluate(() => { window.__offloadAt = 1500; });
  bashLog.length = 0;
  await pg.click('#list .draftrow[data-did="d1"]'); await pg.waitForTimeout(4000);
  ok('Composio, large draft: read back with its HTML (full)', bashLog.some((c) => /--argjson full true/.test(c)), bashLog.map((c) => c.slice(0, 90)).join(' | '));
  ok('…so the signature and earlier messages show', /Alex Rivera · Founder/.test(await shadowText(pg, '#dSigBox .sigview')) && await pg.isVisible('#dQuoteBox summary'));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
