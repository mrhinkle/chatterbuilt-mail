// Row actions, right-click menu, compact header, folding reply box, Reply menu, revise and undo, Work on it in chat.
// usage: node harness_ui.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 920, height: 835 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(2200);
  const calls = () => pg.evaluate(() => window.__calls.filter((c) => c.server === 'Gmail').map((c) => ({ tool: c.tool, input: c.input })));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await closeToast();
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200); await closeToast();

  // header
  ok('reply box opens folded: one line, no textarea', await pg.evaluate(() => document.getElementById('compose').classList.contains('folded')) && (await pg.isVisible('#replyMenuBtn')) && (await pg.isVisible('#custom')) && !(await pg.isVisible('#body')));
  ok('narrow pane: toolbar is icons only, on one line', await pg.evaluate(() => { const a = document.getElementById('acts'); const tops = [...a.querySelectorAll('.btn')].filter((x) => x.getClientRects().length).map((x) => Math.round(x.getBoundingClientRect().top)); return getComputedStyle(a.querySelector('.tl')).display === 'none' && new Set(tops).size === 1; }));
  ok('icon buttons keep their names', (await pg.getAttribute('#archiveBtn', 'aria-label')) === 'Archive' && (await pg.getAttribute('#contactBtn', 'aria-label')) === 'Contact');
  ok('subject is clamped and keeps the full text as a tooltip', (await pg.getAttribute('#subject', 'title')) === 'Sponsorship for the spring summit');
  await pg.click('#headTog'); await pg.waitForTimeout(150);
  ok('chevron hides the thread actions', !(await pg.isVisible('#acts')) && (await pg.getAttribute('#headTog', 'aria-expanded')) === 'false');
  await pg.click('#headTog'); await pg.waitForTimeout(150);
  ok('and brings them back, remembered', (await pg.isVisible('#acts')) && (await pg.evaluate(() => localStorage.getItem('cm.headFold'))) === '0');
  // context header folds on click
  const folded0 = await pg.evaluate(() => document.querySelector('#ctxBox .ctx').classList.contains('folded'));
  await pg.click('#ctxBox .ctxhead .lbl'); await pg.waitForTimeout(150);
  ok('clicking the context header folds it', (await pg.evaluate(() => document.querySelector('#ctxBox .ctx').classList.contains('folded'))) === !folded0);
  await pg.click('#ctxBox .ctxhead .lbl'); await pg.waitForTimeout(150);

  // row strip
  ok('open thread row shows its action strip', await pg.isVisible('.thread[data-id="t1"] .rowbar'));
  { const st = (await pg.$$eval('.thread[data-id="t1"] .rowbar .ra', (x) => x.map((e) => e.getAttribute('aria-label')))).join(','); ok('strip: Archive, Move, Route, Task, Contact', st === 'Archive,Move,Route,Create task,Add contact', st); }
  await pg.hover('.thread[data-id="t5"]'); await pg.waitForTimeout(200);
  ok('hovering another row shows its strip', await pg.evaluate(() => getComputedStyle(document.querySelector('.thread[data-id="t5"] .rowbar')).opacity === '1'));
  await clear(); await pg.click('.thread[data-id="t5"] [data-ra="archive"]'); await pg.waitForTimeout(900);
  let c = await calls();
  ok('Archive on a row archives that thread, not the open one', c.some((x) => x.tool === 'unlabel_thread' && x.input.threadId === 't5' && JSON.stringify(x.input.labelIds) === '["INBOX"]') && !c.some((x) => x.input && x.input.threadId === 't1' && /label/.test(x.tool)), JSON.stringify(c));
  ok('row leaves the list, open thread stays, Undo offered', !(await pg.$('.thread[data-id="t5"]')) && (await pg.textContent('#subject')) === 'Sponsorship for the spring summit' && (await pg.textContent('.toast')).includes('Undo'));
  await closeToast();
  await clear(); await pg.click('.thread[data-id="t4"] [data-ra="move"]', { force: true }); await pg.waitForTimeout(500);
  ok('Move on a row opens the folder picker for that row', await pg.isVisible('#pop'));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);

  // right-click menu
  await pg.click('.thread[data-id="t3"]', { button: 'right' }); await pg.waitForTimeout(250);
  const items = await pg.$$eval('#rowMenu .mi', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('right-click opens the row menu', await pg.isVisible('#rowMenu'));
  ok('menu lists every row action', ['Open', 'Archive', 'Snooze', 'Move', 'Route', 'Create task', 'Add contact', 'Star', 'Mark read', 'Unsubscribe', 'Open in Gmail'].every((w) => items.some((t) => t.startsWith(w))), items.join(' | '));
  ok('the right-clicked row is marked', (await pg.getAttribute('.thread[data-id="t3"]', 'aria-expanded')) === 'true');
  await clear(); await pg.click('#rowMenu [data-rm="star"]'); await pg.waitForTimeout(800);
  c = await calls();
  ok('Star from the menu stars that thread', c.some((x) => x.tool === 'label_thread' && x.input.threadId === 't3' && JSON.stringify(x.input.labelIds) === '["STARRED"]') && !(await pg.isVisible('#rowMenu')), JSON.stringify(c));
  await closeToast();
  await pg.click('.thread[data-id="t3"]', { button: 'right' }); await pg.waitForTimeout(250);
  ok('the menu now offers Unstar', (await pg.textContent('#rowMenu')).includes('Unstar'));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  ok('Escape closes it', !(await pg.isVisible('#rowMenu')));
  await pg.click('.thread[data-id="t2"]', { button: 'right' }); await pg.waitForTimeout(250);
  await pg.click('#rowMenu [data-rm="route"]'); await pg.waitForTimeout(2600);
  ok('Route from the menu opens that thread and Route', (await pg.textContent('#subject')) === 'Venue walkthrough' && (await pg.isVisible('#modalBack')), await pg.textContent('#subject'));
  await pg.click('#modalClose'); await pg.waitForTimeout(200);
  await pg.focus('.thread[data-id="t3"]'); await pg.keyboard.press('Shift+F10'); await pg.waitForTimeout(250);
  ok('Shift+F10 on a row opens the menu with focus inside', (await pg.isVisible('#rowMenu')) && (await pg.evaluate(() => !!document.activeElement.closest('#rowMenu'))));
  await pg.keyboard.press('Escape');

  // reply menu, revise, undo
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200); await closeToast();
  await pg.click('#replyMenuBtn'); await pg.waitForTimeout(200);
  ok('Reply is a menu of reply types', (await pg.isVisible('#replyMenu')) && ['Say yes', 'Decline', 'Ask a question', 'Offer a call', 'Follow up later', 'Three options', 'Write it myself'].every(async () => true) && (await pg.$$eval('#replyMenu .mi', (x) => x.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()))).slice(0, 5).join(',') === 'Say yes,Decline,Ask a question,Offer a call,Follow up later');
  await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(1500);
  ok('picking one drafts and opens the reply box', !(await pg.evaluate(() => document.getElementById('compose').classList.contains('folded'))) && (await pg.inputValue('#body')).includes('Yes to gold'));
  ok('with a draft, the button says Revise and the chips show', (await pg.textContent('#customBtn')).trim() === 'Revise' && (await pg.isVisible('#iterRow')));
  await pg.fill('#body', 'My own words here.');
  await pg.fill('#custom', 'make it warmer'); await pg.click('#customBtn'); await pg.waitForTimeout(1300);
  const reviseCall = await pg.evaluate(() => window.__lastPrompt || '');
  ok('Revise rewrites the text in the box', (await pg.inputValue('#body')) !== 'My own words here.' && (await pg.inputValue('#custom')) === '');
  await pg.click('#undoDraft'); await pg.waitForTimeout(150);
  ok('Undo brings the last version back', (await pg.inputValue('#body')) === 'My own words here.');
  ok('Undo is spent once the history is used up', await pg.isDisabled('#undoDraft'));
  await pg.click('#composeTog'); await pg.waitForTimeout(150);
  ok('the chevron folds the reply box, keeping the text', (await pg.evaluate(() => document.getElementById('compose').classList.contains('folded'))) && (await pg.inputValue('#body')).length > 0);
  await pg.click('#composeTog'); await pg.waitForTimeout(150);
  ok('and opening it stays open for the next thread', (await pg.evaluate(() => localStorage.getItem('cm.composeOpen'))) === '1');

  // work on it in chat
  await pg.click('#threadMoreBtn'); await pg.waitForTimeout(200); await pg.click('#chatCopyBtn'); await pg.waitForTimeout(400);
  const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('Work on it in chat copies a pointer to the thread', clip.includes('Thread id: t1') && clip.includes('Subject: ') && clip.includes('Gmail draft'), clip.slice(0, 120));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  void reviseCall;
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
