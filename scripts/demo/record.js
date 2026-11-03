// Screenshots and a demo video of Chatterbuilt Mail, with fictional data only.
// Nothing here touches a real account: Gmail, Composio, Calendar and Claude are all faked in the page.
//
// usage (from the repo root):
//   node scripts/demo/record.js [outdir]          default outdir: demo-out
// needs: Node with Playwright and Chromium, Python 3, and ffmpeg for the video.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'demo-out'); fs.mkdirSync(OUT, { recursive: true });
const FR = path.join(OUT, 'frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
// The demo copy reads Gmail through Composio with two made-up accounts, so the account switcher shows.
const page = require('./build-page.js')('chatterbuilt-demo', { accounts: true });

const fake = require('./fake.js');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // The attachment viewer loads pdf.js from cdnjs; use a local pdfjs-dist@3.11.174 if one is installed.
  try { const dir = path.dirname(require.resolve('pdfjs-dist/build/pdf.min.js', { paths: [process.cwd(), __dirname] })); await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(dir, r.request().url().split('/').pop())) })); } catch {}
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page);
  const t0 = Date.now(); let n = 0; const snap = async () => { await pg.screenshot({ path: path.join(FR, String(n++).padStart(5, '0') + '.png') }); };
  const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await snap(); };
  const shot = async (name) => { await pg.screenshot({ path: path.join(OUT, name + '.png') }); };
  const caption = async (text) => pg.evaluate((t) => { let c = document.getElementById('__cap'); if (!c) { c = document.createElement('div'); c.id = '__cap'; c.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;background:rgba(15,23,42,.88);color:#fff;font:600 15px/1.3 -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:80vw;text-align:center'; document.body.append(c); } c.textContent = t; c.hidden = !t; }, text);
  const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await pg.waitForTimeout(1600); await clearToasts();
  await caption('Today: drafts waiting, what needs you, your next meeting'); await hold(2600);
  await caption(''); await shot('today');
  await caption('Triage sorts the inbox: Needs you, Worth reading, FYI'); await pg.click('#triageBtn'); await hold(2800); await clearToasts();
  await caption(''); await shot('triage');
  await caption('Open a thread: context from your systems, beside it'); await pg.click('.thread[data-id="t1"]'); await hold(3600);
  await caption(''); await shot('context-panel');
  await caption('More context: a cited web lookup, only when you press it'); await pg.click('#sideBody [data-ctx="more"]'); await hold(3200);
  await caption(''); await shot('more-context');
  await caption('Next steps: where this thread should go'); await pg.click('#sideBody [data-ctx="steps"]'); await hold(2600);
  await pg.click('#sideBody [data-ctx="route"]'); await caption('Review and apply: nothing runs until you do'); await hold(2600);
  await caption(''); await shot('route');
  await pg.click('#modalClose'); await hold(400);
  await caption('Draft in your voice, using what your systems know'); await pg.click('[data-intent="yes"]'); await hold(2600);
  await caption(''); await shot('draft');
  await caption('Pre-send check: catches the promise you forgot'); await pg.click('#sendBtn'); await hold(3000);
  await caption(''); await shot('presend');
  await pg.click('#cancelSend'); await hold(300);
  await caption('Drag any pane wider or narrower');
  { const g = await pg.$eval('#sideSplit', (h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pg.mouse.move(g.x, g.y); await pg.mouse.down(); for (let k = 1; k <= 12; k++) { await pg.mouse.move(g.x - k * 10, g.y); await snap(); } await pg.mouse.up(); await hold(900); }
  await caption('Open attachments right here: PDFs, images, text'); await pg.click('.thread[data-id="t8"]'); await hold(2600); await clearToasts();
  await pg.click('#reading .attbtn'); await hold(2800);
  await caption(''); await shot('attachment');
  await pg.keyboard.press('Escape'); await hold(300);
  await caption('Switch between your Gmail accounts'); await pg.selectOption('#acctSel', '1'); await hold(2600); await clearToasts();
  await caption(''); await hold(600);
  const secs = (Date.now() - t0) / 1000;

  // phone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await mp.addInitScript(fake); await mp.goto('file://' + page); await mp.waitForTimeout(1600);
  await mp.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await mp.screenshot({ path: path.join(OUT, 'phone-inbox.png') });
  await mp.tap('.thread[data-id="t1"]'); await mp.waitForTimeout(2600);
  await mp.screenshot({ path: path.join(OUT, 'phone-thread.png') });
  await mp.tap('#backBtn'); await mp.tap('#tabbar [data-tab="today"]'); await mp.waitForTimeout(600);
  await mp.screenshot({ path: path.join(OUT, 'phone-today.png') });
  await b.close();

  console.log('frames', n, 'in', secs.toFixed(1) + 's', 'page errors:', errs.length ? errs.join(' | ') : 'none');
  const mp4 = path.join(OUT, 'demo.mp4');
  try {
    // Frames are captured as fast as the browser allows, so pace the video by the measured time.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', (n / secs).toFixed(2), '-i', path.join(FR, '%05d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    console.log('video', mp4);
  } catch (e) { console.log('ffmpeg not found or failed; frames are in', FR); }
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
