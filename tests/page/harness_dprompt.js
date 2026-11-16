// The prompt box under the draft editor: your own instruction rewrites the draft in place and keeps formatting; a
// selected passage is rewritten on its own; Undo steps back one revision at a time. usage: node harness_dprompt.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake);
  await pg.addInitScript(() => {
    const u = window.claude.use; window.__prompts = [];
    window.claude.use = async (n) => {
      const x = await u(n); if (n !== 'sample' || !x) return x;
      const f = async (inp, o) => {
        const p = typeof inp === 'string' ? inp : JSON.stringify(inp); window.__prompts.push(p);
        if (p.includes('Rewrite it: tighten')) return { text: '<p>Riley,</p><p>Your March talk stuck with people. Keynote the spring summit in <b>April</b>? Details <a href="https://summit.example/april">here</a>.</p><p>Alex</p>' };
        if (p.includes('Rewrite it: fence')) return { text: '```html\n<p>Fenced.</p><p>Alex</p>\n```' };
        if (p.includes('Rewrite it: plain')) return { text: 'Plain one.\n\nPlain two.\n\nAlex' };
        if (p.includes('Rewrite only the passage: one sentence')) return { text: '<p>March was memorable; keynote in <b>April</b>?</p>' };
        if (p.includes('Rewrite it: Shorter')) return { text: 'Riley, keynote in April? Alex' };
        if (p.includes('You review an email draft before')) return { text: '{}' };
        return x(inp, o);
      }; Object.assign(f, x); return f;
    };
  });
  await pg.goto('file://' + wrap(DEMO, 'p.html')); await pg.waitForTimeout(2200);
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const calls = () => pg.evaluate(() => window.__calls.map((c) => ({ tool: c.tool, input: c.input })));
  const prompts = () => pg.evaluate(() => window.__prompts);
  const html = () => pg.innerHTML('#dEditor');
  await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800);
  await pg.click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(2600);

  ok('the prompt box is under the editor: a text box, Revise, Undo (off) and the quick chips', await pg.isVisible('#dPrompt textarea#dRevise') && await pg.isVisible('#dReviseGo') && !(await pg.isEnabled('#dUndo')) && (await pg.$$('#dPrompt [data-drev]')).length === 4 && await pg.isHidden('#dSelOnly'));
  ok('its hint says what to type', /Tell Claude what to change/.test(await pg.getAttribute('#dRevise', 'placeholder')));
  const before = await html();
  // an instruction of your own, sent with Enter
  await pg.evaluate(() => { window.__calls = []; });
  await pg.fill('#dRevise', 'tighten the ask'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1000);
  const p1 = (await prompts()).find((p) => p.includes('Rewrite it: tighten'));
  ok('Enter sends your instruction, with the draft as HTML so formatting can be kept', !!p1 && /as HTML\. Rewrite it: tighten the ask\./.test(p1) && p1.includes('<b>April</b>') && /HTML this time, not plain text/.test(p1) && /keep the sign-off/.test(p1), (p1 || '').slice(0, 200));
  const h1 = await html();
  ok('…and the answer keeps its link and bold', h1.includes('href="https://summit.example/april"') && /<b>April<\/b>/.test(h1) && /Your March talk stuck/.test(h1) && !/Your talk on AI agents/.test(h1), h1.slice(0, 200));
  ok('…the box is cleared, Undo is on, the note says nothing is saved yet', (await pg.inputValue('#dRevise')) === '' && await pg.isEnabled('#dUndo') && /Revised\. Undo puts the old version back\. Nothing is saved/.test(await pg.textContent('#dNote')), await pg.textContent('#dNote'));
  ok('…and nothing was written to Gmail', !(await calls()).some((c) => c.tool === 'update_draft' || c.tool === 'send_message'));
  // Shift+Enter is a new line, not a send
  const n0 = (await prompts()).length;
  await pg.fill('#dRevise', 'line one'); await pg.keyboard.press('Shift+Enter'); await pg.keyboard.type('line two'); await pg.waitForTimeout(300);
  ok('Shift+Enter adds a line to the instruction instead of sending it', (await pg.inputValue('#dRevise')) === 'line one\nline two' && (await prompts()).length === n0);
  await pg.fill('#dRevise', '');
  // code fence and plain text answers
  await pg.fill('#dRevise', 'fence it'); await pg.click('#dReviseGo'); await pg.waitForTimeout(900);
  ok('an answer wrapped in a code fence is unwrapped', (await html()) === '<p>Fenced.</p><p>Alex</p>', await html());
  await pg.fill('#dRevise', 'plain please'); await pg.click('#dReviseGo'); await pg.waitForTimeout(900);
  ok('a plain-text answer becomes paragraphs', (await html()) === '<p>Plain one.</p><p>Plain two.</p><p>Alex</p>', await html());
  // undo walks back through every revision
  await pg.click('#dUndo'); await pg.waitForTimeout(100);
  ok('Undo goes back one revision', (await html()) === '<p>Fenced.</p><p>Alex</p>' && await pg.isEnabled('#dUndo'));
  await pg.click('#dUndo'); await pg.waitForTimeout(100); await pg.click('#dUndo'); await pg.waitForTimeout(100);
  ok('…and again, back to the original, then it switches off', (await html()) === before && !(await pg.isEnabled('#dUndo')), (await html()).slice(0, 120));
  // a selected passage
  await pg.evaluate(() => { const p = document.querySelectorAll('#dEditor p')[1]; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.waitForTimeout(250);
  ok('selecting text in the editor shows "Selected text only" and changes the hint', await pg.isVisible('#dSelOnly') && /selected text/.test(await pg.getAttribute('#dRevise', 'placeholder')));
  await pg.click('#dRevise'); await pg.waitForTimeout(200);
  ok('…and clicking into the prompt box keeps the selection', await pg.isVisible('#dSelOnly'));
  await pg.fill('#dRevise', 'one sentence'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1000);
  const p2 = (await prompts()).find((p) => p.includes('Rewrite only the passage'));
  ok('the instruction goes with the passage and the whole draft for context', !!p2 && /The passage to rewrite:\nYour talk on AI agents[\s\S]*<b>April<\/b>\?\n\nThe whole draft, for context only:\n<p>Riley,<\/p>/.test(p2) && !/keep the sign-off/.test(p2), (p2 || '').slice(-300));
  const h2 = await html();
  ok('only that passage changed; the greeting and sign-off stayed; no paragraph inside a paragraph', h2 === '<p>Riley,</p><p>March was memorable; keynote in <b>April</b>?</p><p>Alex</p>', h2);
  ok('…the chip goes away and the note says so', await pg.isHidden('#dSelOnly') && /Revised the selected text/.test(await pg.textContent('#dNote')));
  // × forgets the selection; a click in the editor does too
  await pg.evaluate(() => { const p = document.querySelectorAll('#dEditor p')[0]; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.waitForTimeout(250); await pg.click('#dSelClear'); await pg.waitForTimeout(100);
  ok('× forgets the selection', await pg.isHidden('#dSelOnly') && /Tell Claude/.test(await pg.getAttribute('#dRevise', 'placeholder')));
  await pg.evaluate(() => { const p = document.querySelectorAll('#dEditor p')[0]; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.waitForTimeout(250); const shown = await pg.isVisible('#dSelOnly');
  await pg.evaluate(() => { const p = document.querySelectorAll('#dEditor p')[2]; const r = document.createRange(); r.setStart(p.firstChild, 1); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.waitForTimeout(250);
  ok('a click back in the editor that drops the selection forgets it too', shown && await pg.isHidden('#dSelOnly'));
  // a word selected for Bold doesn't turn the next revision into a one-word rewrite
  await pg.evaluate(() => { const t = document.createTreeWalker(document.getElementById('dEditor'), NodeFilter.SHOW_TEXT).nextNode(); const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await pg.waitForTimeout(250); const chipBefore = await pg.isVisible('#dSelOnly');
  await pg.click('.rtbar [data-cmd="bold"]'); await pg.waitForTimeout(300);
  ok('pressing Bold on a selection uses it up: the chip goes, even though the word stays selected', chipBefore && await pg.isHidden('#dSelOnly') && /<b>Riley<\/b>/.test(await html()), await html());
  // the quick chips still work and rewrite the whole draft
  await pg.click('[data-drev="Shorter"]'); await pg.waitForTimeout(900);
  ok('a quick chip rewrites the whole draft', (await html()) === '<p>Riley, keynote in April? Alex</p>', await html());
  // the sheet still saves what you see
  await pg.evaluate(() => { window.__calls = []; }); await pg.click('#dSave'); await pg.waitForTimeout(900);
  const u = (await calls()).find((c) => c.tool === 'update_draft');
  ok('Save sends the revised text', !!u && /Riley, keynote in April\? Alex/.test(u.input.htmlBody) && /Riley, keynote in April\? Alex/.test(u.input.body), JSON.stringify(u && u.input).slice(0, 200));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await pg.screenshot({ path: path.join(OUT, 'prompt.png') });
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
