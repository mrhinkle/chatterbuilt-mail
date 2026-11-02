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
const built = path.join(os.tmpdir(), 'chatterbuilt-shots.html');
execFileSync('python3', [path.join(ROOT, 'scripts/build.py'), path.join(ROOT, 'skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html'), path.join(__dirname, 'demo.config.js'), built], { stdio: 'ignore' });
const page = path.join(os.tmpdir(), 'chatterbuilt-shots-page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(built, 'utf8') + '</body></html>');

const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const clearToasts = (pg) => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
const open = async (pg, id, wait) => { await pg.click('.thread[data-id="' + id + '"]'); await pg.waitForTimeout(wait || 3600); await clearToasts(pg); };
const tool = async (pg, id) => { await pg.click('#toolsBtn'); await pg.waitForTimeout(150); await pg.click('#' + id); };
const more = async (pg, sel) => { await pg.click('#threadMoreBtn'); await pg.waitForTimeout(150); await pg.click('#threadMenu ' + sel); };
const settings = async (pg, id) => { await pg.click('#setBtn'); await pg.waitForTimeout(150); await pg.click('#' + id); };

// name, device, steps. Steps leave the page in the state to capture; return 'keep-toasts' to keep toasts on screen.
const scenes = [
  ['today', DESK, async (pg) => { await pg.waitForTimeout(1200); }],
  ['triage', DESK, async (pg) => { await pg.click('#triageBtn'); await pg.waitForTimeout(2800); }],
  ['today-triaged', DESK, async (pg) => { await pg.click('#triageBtn'); await pg.waitForTimeout(2800); }],
  ['context-panel', DESK, async (pg) => { await open(pg, 't1'); }],
  ['panel-hidden', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideHide'); await pg.waitForTimeout(400); }],
  ['receipt-context', DESK, async (pg) => { await open(pg, 't8'); }],
  ['more-context', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideBody [data-ctx="more"]'); await pg.waitForTimeout(3200); }],
  ['next-steps', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#sideBody [data-ctx="steps"]'); await pg.waitForTimeout(2800); }],
  ['route', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#routeBtn'); await pg.waitForTimeout(2800); }],
  ['draft', DESK, async (pg) => { await open(pg, 't1'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); }],
  ['options', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#variantsBtn'); await pg.waitForTimeout(2800); }],
  ['offer-call', DESK, async (pg) => { await open(pg, 't1'); await pg.click('[data-intent="call"]'); await pg.waitForTimeout(3200); }],
  ['presend', DESK, async (pg) => { await open(pg, 't1'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.click('#sendBtn'); await pg.waitForTimeout(3000); }],
  ['snippets', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#snipBtn'); await pg.waitForTimeout(400); }],
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
  ['nudge', DESK, async (pg) => { await pg.click('.chip[data-key="waiting"]'); await pg.waitForTimeout(2200); await open(pg, 'w1'); await pg.click('#nudgeBtn'); await pg.waitForTimeout(2800); }],
  ['task', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#taskBtn'); await pg.waitForTimeout(1600); return 'keep-toasts'; }],
  ['contact', DESK, async (pg) => { await open(pg, 't1'); await pg.click('#contactBtn'); await pg.waitForTimeout(3000); }],
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
  ['phone-more', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.tap('#pbMore'); await pg.waitForTimeout(300); }],
  ['phone-tools', PHONE, async (pg) => { await pg.tap('#tabbar [data-tab="tools"]'); await pg.waitForTimeout(300); }],
  ['phone-draft', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.evaluate(() => document.getElementById('desk').scrollTo(0, 99999)); await pg.tap('[data-intent="yes"]'); await pg.waitForTimeout(2800); await pg.evaluate(() => { document.activeElement && document.activeElement.blur(); document.getElementById('desk').scrollTo(0, 99999); }); await pg.waitForTimeout(300); }],
  ['phone-review', PHONE, async (pg) => { await pg.tap('#triageBtn'); await pg.waitForTimeout(2800); await clearToasts(pg); await pg.tap('#toolsBtn'); await pg.waitForTimeout(200); await pg.tap('#reviewBtn'); await pg.waitForTimeout(500); }],
  ['phone-contact', PHONE, async (pg) => { await pg.tap('.thread[data-id="t1"]'); await pg.waitForTimeout(3000); await clearToasts(pg); await pg.tap('#pbMore'); await pg.waitForTimeout(250); await pg.tap('#threadMenu [data-proxy="contactBtn"]'); await pg.waitForTimeout(3000); }]
];

(async () => {
  const b = await chromium.launch(); const done = [], failed = [];
  for (const [name, device, steps] of scenes) {
    if (only.length && !only.includes(name)) continue;
    const ctx = await b.newContext(device); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    try {
      await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(1600); await clearToasts(pg);
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
