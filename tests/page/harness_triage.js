// Triage: a suggested next step on every row, section bulk actions, dismiss, Review still fed.
// usage: node harness_triage.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake);
  await pg.addInitScript(() => { const u = window.claude.use; window.__prompts = []; window.claude.use = async (n) => { const x = await u(n); if (n !== 'sample' || !x) return x; const f = async (inp, o) => { window.__prompts.push(typeof inp === 'string' ? inp : JSON.stringify(inp)); return x(inp, o); }; Object.assign(f, x); return f; }; });
  await pg.goto('file://' + page); await pg.waitForTimeout(2200);
  const calls = () => pg.evaluate(() => window.__calls.filter((c) => c.server === 'Gmail').map((c) => ({ tool: c.tool, input: c.input })));
  const writes = async () => (await calls()).filter((c) => /label_thread|unlabel_thread|create|send|reply|forward|trash/.test(c.tool));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const chip = (id) => pg.evaluate((i) => { const e = document.querySelector('.thread[data-id="' + i + '"] .nxgo'); return e ? e.textContent.trim() : null; }, id);
  await closeToast(); await clear();

  await pg.click('#triageBtn'); await pg.waitForTimeout(1600);
  const pr = await pg.evaluate(() => window.__prompts.find((p) => p.includes('You triage their inbox')) || '');
  ok('prompt offers every step this copy can do', ['next.do', "'reply'", "'task'", "'route'", "'snooze'", "'unsub'", "'contact'", "'move'", "'archive'", 'handoff', 'Today is'].every((w) => pr.includes(w)), pr.slice(0, 200));
  ok('no mail changed by Triage', (await writes()).length === 0, JSON.stringify(await writes()));
  const want = { t1: 'Say yes', t2: 'Hand off to Sam in Slack', t3: 'Ask a question', t6: 'Add contact', t5: 'Unsubscribe…', t4: 'Move to Finance', t7: 'Move to Finance', t8: 'Archive' };
  const got = {}; for (const id of Object.keys(want)) got[id] = await chip(id);
  ok('each row shows its suggested next step', Object.keys(want).every((id) => got[id] === want[id]), JSON.stringify(got));
  ok('chip carries the reply hint as a tooltip', ((await pg.getAttribute('.thread[data-id="t1"] .nxgo', 'title')) || '').includes('Yes to gold by Friday'));
  ok('toast explains the next steps and Review', /next step/.test(await pg.textContent('.toast')) && /Review/.test(await pg.textContent('.toast')));
  ok('archive and move still wait in Review (3)', (await pg.textContent('#reviewCount')) === '3');
  const heads = await pg.$$eval('#list .lsec', (x) => x.map((e) => e.textContent.trim()));
  ok('Needs you offers Pre-draft, FYI offers Clear', heads.includes('Needs youPre-draft 33') && heads.includes('Worth readingMark 1 read1') && heads.includes('FYIClear 44'), heads.join(' | '));
  ok('section titles stay headings', (await pg.$$eval('#list .lsec [role="heading"]', (x) => x.map((e) => e.textContent))).join(',') === 'Needs you,Worth reading,FYI');
  await closeToast();

  // a reply step opens the thread and drafts with that intent and hint
  await clear(); await pg.click('.thread[data-id="t1"] .nxgo'); await pg.waitForTimeout(2600);
  const dp = await pg.evaluate(() => window.__prompts.filter((p) => p.includes('What the reply should do')).pop() || '');
  ok('Say yes opens the thread and drafts a yes', (await pg.textContent('#subject')) === 'Sponsorship for the spring summit' && dp.includes("Say yes to what they're asking") && dp.includes('Specifically: Yes to gold by Friday'), dp.slice(0, 160));
  ok('the reply box opens with the draft, nothing sent', !(await pg.evaluate(() => document.getElementById('compose').classList.contains('folded'))) && (await pg.inputValue('#body')).length > 10 && (await writes()).length === 0);
  ok('the reply chip stays until you send', (await chip('t1')) === 'Say yes');
  await closeToast();

  // archive from the chip
  await clear(); await pg.click('.thread[data-id="t8"] .nxgo'); await pg.waitForTimeout(900);
  let w = await writes();
  ok('Archive chip archives that thread only', w.length === 1 && w[0].tool === 'unlabel_thread' && w[0].input.threadId === 't8' && JSON.stringify(w[0].input.labelIds) === '["INBOX"]', JSON.stringify(w));
  ok('its row goes, its Review entry goes', !(await pg.$('.thread[data-id="t8"]')) && (await pg.textContent('#reviewCount')) === '2' && (await pg.textContent('.toast')).includes('Undo'));
  await closeToast();

  // move from the chip
  await clear(); await pg.click('.thread[data-id="t4"] .nxgo'); await pg.waitForTimeout(900);
  w = await writes();
  ok('Move chip files it in Finance and takes it out of the inbox', w.some((c) => c.tool === 'label_thread' && c.input.threadId === 't4' && c.input.labelIds.length === 1 && c.input.labelIds[0] !== 'INBOX') && w.some((c) => c.tool === 'unlabel_thread' && c.input.threadId === 't4' && c.input.labelIds[0] === 'INBOX') && w.length === 2, JSON.stringify(w));
  ok('Review now holds 1', (await pg.textContent('#reviewCount')) === '1');
  await closeToast();

  // dismiss
  await clear(); await pg.click('.thread[data-id="t6"] .nxx'); await pg.waitForTimeout(300);
  ok('× dismisses the step without touching mail', (await chip('t6')) === null && (await writes()).length === 0 && !!(await pg.$('.thread[data-id="t6"]')));
  ok('and records it for Learn now', await pg.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) || ''; if (v.includes('"rejects"') && v.includes('"op":"contact"') && v.includes('Intro: Alex, meet Jordan')) return true; } return false; }));
  await closeToast();

  // route opens Route
  await pg.click('.thread[data-id="t2"] .nxgo'); await pg.waitForTimeout(2600);
  ok('Hand off chip opens that thread and Route', (await pg.textContent('#subject')) === 'Venue walkthrough' && (await pg.isVisible('#modalBack')));
  await pg.click('#modalClose'); await pg.waitForTimeout(200); await closeToast();

  // Clear FYI: confirm, then archive or file each
  // the demo's fake Gmail doesn't keep label changes, so a reload brings archived rows back; count what's there now
  const nf = await pg.evaluate(() => { const h = [...document.querySelectorAll('#list .lsec')].find((e) => e.textContent.startsWith('FYI')); let n = 0, e = h && h.nextElementSibling; while (e && e.classList.contains('thread')) { n++; e = e.nextElementSibling; } return n; });
  await clear(); const cb = '#list [data-bulk="clear"]';
  await pg.click(cb); await pg.waitForTimeout(200);
  ok('Clear asks once before it runs', (await pg.textContent(cb)).trim() === 'Yes, clear ' + nf && (await writes()).length === 0, await pg.textContent(cb));
  await pg.click(cb); await pg.waitForTimeout(1500);
  w = await writes();
  ok('Clear archives t5 and files t7 in Finance', w.some((c) => c.tool === 'unlabel_thread' && c.input.threadId === 't5') && w.some((c) => c.tool === 'label_thread' && c.input.threadId === 't7') && w.some((c) => c.tool === 'unlabel_thread' && c.input.threadId === 't7') && !w.some((c) => ['t1', 't2', 't3', 't6'].includes(c.input.threadId)), JSON.stringify(w));
  ok('cleared rows leave; toast counts them with one Undo', !(await pg.$('.thread[data-id="t5"]')) && !(await pg.$('.thread[data-id="t7"]')) && (await pg.textContent('.toast')).includes('Cleared ' + nf + ' (1 filed, ' + (nf - 1) + ' archived)') && (await pg.textContent('.toast')).includes('Undo'), await pg.textContent('.toast'));
  ok('Review is empty after', (await pg.isHidden('#reviewCount')));
  await clear(); await pg.click('.toast [data-undo]'); await pg.waitForTimeout(1200);
  w = await writes();
  ok('Undo puts both back in the inbox', ['t5', 't7'].every((id) => w.some((c) => c.tool === 'label_thread' && c.input.threadId === id && c.input.labelIds.includes('INBOX'))), JSON.stringify(w));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
