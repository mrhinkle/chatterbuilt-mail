// Screenshots of every feature, with made-up data only. Nothing touches a real account.
//
// usage (from the repo root):
//   node scripts/demo/screenshots.js [outdir]        default outdir: demo-out/screens
//   node scripts/demo/screenshots.js docs/images     to refresh the screenshots in the docs
// needs: Node with Playwright and Chromium, and Python 3.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const fake = require('./fake.js');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'demo-out/screens'); fs.mkdirSync(OUT, { recursive: true });
const only = (process.argv[3] || '').split(',').filter(Boolean);
const page = require('./build-page.js')('chatterbuilt-shots');
const pageAccounts = require('./build-page.js')('chatterbuilt-shots-accounts', { accounts: true });

const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const clearToasts = (pg) => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
const open = async (pg, id, wait) => { await pg.click('.thread[data-id="' + id + '"]'); await pg.waitForTimeout(wait || 3600); await clearToasts(pg); };
const tool = async (pg, id) => { await pg.click('#toolsBtn'); await pg.waitForTimeout(150); await pg.click('#' + id); };
const more = async (pg, sel) => { await pg.click('#threadMoreBtn'); await pg.waitForTimeout(150); await pg.click('#threadMenu ' + sel); };
const settings = async (pg, id) => { await pg.click('#setBtn'); await pg.waitForTimeout(150); await pg.click('#' + id); };

// name, device, steps. Steps leave the page in the state to capture; return 'keep-toasts' to keep toasts on screen.
// The attachment viewer loads pdf.js from cdnjs. Use a local pdfjs-dist@3.11.174 if one is installed (npm i pdfjs-dist@3.11.174).
const pdfRoute = async (ctx) => { let dir; try { dir = path.dirname(require.resolve('pdfjs-dist/build/pdf.min.js', { paths: [process.cwd(), __dirname] })); } catch { return; }
  await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(dir, r.request().url().split('/').pop())) })); };
const scenes = [
  ['today', DESK, async (pg) => { await pg.waitForTimeout(1200); }],
  ['triage', DESK, async (pg) => { await pg.click('#triageBtn'); await pg.waitForTimeout(2800); }],
  ['today-triaged', DESK, async (pg) => { await pg.click('#triageBtn'); await pg.waitForTimeout(2800); }],
  ['context-panel', DESK, async (pg) => { await open(pg, 't1'); }],
  ['panel-hidden', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideHide'); await pg.waitForTimeout(400); }],
  ['list-hidden', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#listTog'); await pg.waitForTimeout(400); }],
  ['resize', DESK, async (pg) => { await open(pg, 't1'); const b = await pg.$eval('#sideSplit', (h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); await pg.mouse.move(b.x, b.y); await pg.mouse.down(); await pg.mouse.move(b.x - 60, b.y, { steps: 6 }); await pg.mouse.move(b.x - 120, b.y, { steps: 6 }); await pg.mouse.up(); await pg.$eval('#sideSplit', (h) => h.classList.add('drag')); await pg.waitForTimeout(200); }],
  ['receipt-context', DESK, async (pg) => { await open(pg, 't8'); }],
  ['attachment', DESK, async (pg) => { await open(pg, 't8'); await pg.click('#reading .attbtn'); await pg.waitForTimeout(2500); }],
  ['accounts', DESK, async (pg) => { await pg.selectOption('#acctSel', '-1'); await pg.waitForTimeout(2200); await open(pg, 'p1'); }, { accounts: true }],
  ['more-context', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideBody [data-ctx="more"]'); await pg.waitForTimeout(3200); }],
  ['next-steps', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideBody [data-ctx="steps"]'); await pg.waitForTimeout(2800); }],
  ['route', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#routeBtn'); await pg.waitForTimeout(2800); }],
  ['draft', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); }],
  ['options', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('#variantsBtn'); await pg.waitForTimeout(2800); }],
  ['offer-call', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="call"]'); await pg.waitForTimeout(3200); }],
  ['presend', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.click('#sendBtn'); await pg.waitForTimeout(3000); }],
  ['snippets', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('#replyMenu [data-proxy="snipBtn"]'); await pg.waitForTimeout(400); }],
  ['row-menu', DESK, async (pg) => { await open(pg, 't1'); await pg.click('.thread[data-id="t3"]', { button: 'right' }); await pg.waitForTimeout(400); }],
  ['reply-menu', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.waitForTimeout(400); }],
  ['revise', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.fill('#custom', 'mention the deck is coming today'); await pg.mouse.move(5, 5); }],
  ['summarize', DESK, async (pg) => { await open(pg, 't1'); await more(pg, '[data-proxy="sumBtn"]'); await pg.waitForTimeout(2200); }],
  ['thread-more', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#threadMoreBtn'); await pg.waitForTimeout(250); }],
  ['formatted', DESK, async (pg) => { await open(pg, 't5'); await more(pg, '#htmlBtn'); await pg.waitForTimeout(2400); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); }],
  ['unsubscribe', DESK, async (pg) => { await open(pg, 't5'); await more(pg, '#unsubBtn'); await pg.waitForTimeout(1500); }],
  ['snooze', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#snoozeBtn'); await pg.waitForTimeout(400); }],
  ['move', DESK, async (pg) => { await open(pg, 't4'); await pg.click('#moveBtn'); await pg.waitForTimeout(600); }],
  ['copy', DESK, async (pg) => { await open(pg, 't4'); await pg.click('#moveBtn'); await pg.waitForTimeout(400); await pg.click('#tabCopy'); await pg.waitForTimeout(300); }],
  ['tools-menu', DESK, async (pg) => { await pg.click('#toolsBtn'); await pg.waitForTimeout(250); }],
  ['ask', DESK, async (pg) => { await tool(pg, 'askBtn'); await pg.fill('#askQ', 'When is the venue walkthrough?'); await pg.click('#askGo'); await pg.waitForTimeout(2800); }],
  ['ask-mode', DESK, async (pg) => { await pg.click('#askMode'); await pg.fill('#q', 'When is the venue walkthrough?'); await pg.waitForTimeout(200); }],
  ['review', DESK, async (pg) => { await pg.click('#triageBtn'); await pg.waitForTimeout(2800); await clearToasts(pg); await tool(pg, 'reviewBtn'); await pg.waitForTimeout(500); }],
  ['rules', DESK, async (pg) => { await tool(pg, 'rulesBtn'); await pg.waitForTimeout(400); await pg.fill('#ruleText', 'Calendar notifications'); await pg.selectOption('#ruleOp', 'archive'); await pg.click('#ruleAdd'); await pg.waitForTimeout(400); await pg.click('#ruleSuggest'); await pg.waitForTimeout(1800); }],
  ['sweep', DESK, async (pg) => { await tool(pg, 'sweepBtn'); await pg.waitForTimeout(300); await pg.click('#swScan'); await pg.waitForTimeout(2200); const u = await pg.$('[data-swu="1"]'); if (u) { await u.click(); await pg.waitForTimeout(1500); } }],
  ['predraft', DESK, async (pg) => { await tool(pg, 'predraftBtn'); await pg.waitForTimeout(9000); }],
  ['waiting', DESK, async (pg) => { await pg.click('.chip[data-key="waiting"]'); await pg.waitForTimeout(2200); }],
  ['nudge', DESK, async (pg) => { await pg.click('.chip[data-key="waiting"]'); await pg.waitForTimeout(2200); await open(pg, 'w1'); await pg.click('#replyMenuBtn'); await pg.click('#nudgeBtn'); await pg.waitForTimeout(2800); }],
  ['task', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#taskBtn'); await pg.waitForTimeout(1600); return 'keep-toasts'; }],
  ['contact', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#contactBtn'); await pg.waitForTimeout(3000); await pg.click('#cEnrich'); await pg.waitForTimeout(2600); await pg.fill('#cNotes', 'Wants a speaking slot for their CTO at the spring summit. Prefers calls before 11.'); await pg.mouse.move(5, 5); }],
  ['contact-story', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#contactBtn'); await pg.waitForTimeout(3000); await pg.click('#cEnrich'); await pg.waitForTimeout(2600); await pg.fill('#cNotes', 'Wants a speaking slot for their CTO at the spring summit. Prefers calls before 11.'); await pg.evaluate(() => { const m = document.getElementById('modalBody'); m.scrollTop = m.scrollHeight; }); await pg.mouse.move(5, 5); await pg.waitForTimeout(300); }],
  ['drafts', DESK, async (pg) => { await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2200); await pg.click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(2400); await pg.click('[data-dchk="d3"]'); await pg.check('[data-dtick="asks"]'); await pg.check('[data-dtick="facts"]'); await pg.check('[data-dtick="people"]'); await pg.evaluate(() => { const r = document.getElementById('reading'); r.scrollTop = 0; document.querySelectorAll('#reading, .desk *').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); }); await pg.mouse.move(5, 5); await pg.waitForTimeout(300); }],
  ['drafts-check', DESK, async (pg) => { await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2200); await pg.click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(2800); await pg.evaluate(() => { const r = document.getElementById('reading'); r.scrollTop = r.scrollHeight; }); await pg.mouse.move(5, 5); await pg.waitForTimeout(300); }],
  ['select', DESK, async (pg) => { await pg.click('.thread[data-id="t4"]', { modifiers: ['Meta'] }); await pg.click('.thread[data-id="t7"]', { modifiers: ['Meta'] }); await pg.click('.thread[data-id="t8"]', { modifiers: ['Meta'] }); await pg.waitForTimeout(300); await pg.click('.selbar [data-sb="move"]'); await pg.waitForTimeout(700); }],
  ['cc-bcc', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.click('#ccTog'); await pg.type('#ccIn', 'sam', { delay: 40 }); await pg.waitForTimeout(900); await pg.keyboard.press('Enter'); await pg.click('#bccTog'); await pg.type('#bccIn', 'tay', { delay: 40 }); await pg.waitForTimeout(900); }],
  ['voice', DESK, async (pg) => { await settings(pg, 'voiceBtn'); await pg.waitForTimeout(300); await pg.click('#vTrain'); await pg.waitForTimeout(2600); await pg.click('#lRun'); await pg.waitForTimeout(1800); }],
  ['lessons', DESK, async (pg) => {
    await pg.evaluate(() => { const at = Date.now(); localStorage.setItem('cm.learn', JSON.stringify({ edits: [
      { to: 'dana@acmerobotics.example', ai: 'Hi Dana,\n\nThanks so much for reaching out! Yes to gold. When are you free for a call?\n\nAlex', final: 'Hi Dana,\n\nYes to gold. Tuesday at 10 or Wednesday at 2 for a call?\n\nAlex', at },
      { to: 'lee@venuehall.example', ai: 'Hi Lee,\n\nThank you for the offer! Tuesday morning sounds great.\n\nAlex', final: 'Hi Lee,\n\nTuesday at 10 works.\n\nAlex', at },
      { to: 'priya@northwind.example', ai: 'Hi Priya,\n\nWhat a lovely invitation! I would be delighted to join.\n\nAlex', final: 'Hi Priya,\n\nYes, happy to. Send two December dates.\n\nAlex', at }
    ], rejects: [{ op: 'archive', folder: '', from: 'news@weeklybyte.example', subject: 'This week in AI: agents at work', why: 'newsletter', source: 'triage', at }], accepts: 2, lessons: '', lessonsAt: 0, newSignals: 4 })); });
    await settings(pg, 'voiceBtn'); await pg.waitForTimeout(300); await pg.click('#lRun'); await pg.waitForTimeout(1800);
  }],
  ['skills', DESK, async (pg) => { await settings(pg, 'skillsBtn'); await pg.waitForTimeout(400); }],
  ['settings', DESK, async (pg) => { await pg.click('#setBtn'); await pg.waitForTimeout(250); }],
  ['palette', DESK, async (pg) => { await pg.keyboard.press('Control+k'); await pg.waitForTimeout(300); }],
  ['readonly', DESK, async (pg) => { await settings(pg, 'roToggle'); await pg.keyboard.press('Escape'); await clearToasts(pg); await open(pg, 't1'); await pg.click('#archiveBtn'); await pg.waitForTimeout(500); }],
  ['phone-inbox', PHONE, async (pg) => { await pg.waitForTimeout(400); }],
  ['phone-today', PHONE, async (pg) => { await pg.tap('#tabbar [data-tab="today"]'); await pg.waitForTimeout(800); }],
  ['phone-thread', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); }],
  ['phone-context-folded', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.tap('#ctxBox [data-ctx="fold"]'); await pg.waitForTimeout(300); }],
  ['phone-more', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.tap('#pbMore'); await pg.waitForTimeout(300); }],
  ['phone-tools', PHONE, async (pg) => { await pg.tap('#tabbar [data-tab="tools"]'); await pg.waitForTimeout(300); }],
  ['phone-draft', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.evaluate(() => document.getElementById('desk').scrollTo(0, 99999)); await pg.tap('#replyMenuBtn'); await pg.tap('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.evaluate(() => { document.activeElement && document.activeElement.blur(); document.getElementById('desk').scrollTo(0, 99999); }); await pg.waitForTimeout(300); }],
  ['phone-review', PHONE, async (pg) => { await pg.tap('#triageBtn'); await pg.waitForTimeout(2800); await clearToasts(pg); await pg.tap('#toolsBtn'); await pg.waitForTimeout(200); await pg.tap('#reviewBtn'); await pg.waitForTimeout(500); }],
  ['phone-contact', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.tap('#pbMore'); await pg.waitForTimeout(250); await pg.tap('#threadMenu [data-proxy="contactBtn"]'); await pg.waitForTimeout(3000); }]
];

(async () => {
  const b = await chromium.launch(); const done = [], failed = [];
  for (const [name, device, steps, sopts] of scenes) {
    if (only.length && !only.includes(name)) continue;
    const ctx = await b.newContext(device); await pdfRoute(ctx); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    try {
      await pg.addInitScript(fake); await pg.goto('file://' + (sopts && sopts.accounts ? pageAccounts : page)); await pg.waitForTimeout(1600); await clearToasts(pg);
      const r = await steps(pg);
      if (r !== 'keep-toasts') await clearToasts(pg);
      if (device === DESK) await pg.mouse.move(1439, 899);
      await pg.screenshot({ path: path.join(OUT, name + '.png') });
      done.push(name + (errs.length ? ' (page error: ' + errs.join(' | ') + ')' : ''));
    } catch (e) { failed.push(name + ': ' + String(e.message).split('\n')[0]); }
    await ctx.close();
  }
  await b.close();
  console.log('saved ' + done.length + ' to ' + OUT + '\n  ' + done.join('\n  '));
  if (failed.length) { console.log('failed ' + failed.length + ':\n  ' + failed.join('\n  ')); process.exitCode = 1; }
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
