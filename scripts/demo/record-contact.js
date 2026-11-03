// A short captioned video of Add contact, with made-up data only: the signature, how you met, enrichment,
// your notes, and saving to Google Contacts. Nothing touches a real account.
//
// usage (from the repo root):
//   node scripts/demo/record-contact.js [outdir]      writes add-contact.mp4 (default outdir: demo-out)
// needs: Node with Playwright and Chromium, Python 3, and ffmpeg.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const OUT = path.resolve(process.argv[2] || 'demo-out'); fs.mkdirSync(OUT, { recursive: true });
const FR = path.join(OUT, 'contact-frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const page = require('./build-page.js')('chatterbuilt-contact');
const fake = require('./fake.js');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page);
  // Each frame keeps the time it was taken, so the video plays at real speed.
  let n = 0; const stamps = []; const snap = async () => { await pg.screenshot({ path: path.join(FR, String(n++).padStart(5, '0') + '.png') }); stamps.push(Date.now()); };
  const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await snap(); };
  const caption = (text) => pg.evaluate((t) => { let c = document.getElementById('__cap'); if (!c) { c = document.createElement('div'); c.id = '__cap'; c.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;padding:9px 16px;border-radius:6px;background:rgba(13,17,23,.88);color:#fff;font:600 15px -apple-system,Inter,sans-serif;pointer-events:none;max-width:90vw;text-align:center'; document.body.append(c); } c.textContent = t; c.style.display = t ? 'block' : 'none'; }, text);
  const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const typeSlow = async (sel, text) => { await pg.click(sel); for (const w of text.split(/(?<= )/)) { await pg.keyboard.type(w); await snap(); } };

  await pg.waitForTimeout(1600); await clearToasts(); await snap();
  await caption('Someone worth keeping? Open the thread'); await pg.click('.thread[data-id="t1"]'); await hold(2600); await clearToasts();
  await caption('Add contact reads their signature and finds your first email together'); await pg.click('#contactBtn'); await hold(3600);
  await caption('How we met: written from that first thread, with a link to it'); await pg.evaluate(() => document.getElementById('cMet').scrollIntoView({ block: 'center' })); await hold(2600);
  await caption('Enrich with Apollo (or Clay, or any app): background and LinkedIn'); await pg.click('#cEnrich'); await hold(3200);
  await pg.evaluate(() => document.getElementById('cBackground').scrollIntoView({ block: 'center' })); await hold(1800);
  await caption('Add what you want to remember'); await typeSlow('#cNotes', 'Wants a speaking slot for their CTO at the spring summit.'); await hold(900);
  await pg.evaluate(() => { const m = document.getElementById('modalBody'); m.scrollTop = m.scrollHeight; }); await hold(600);
  await caption('Saved to Google Contacts: How we met and Background as custom fields'); await pg.click('#cSave'); await hold(3000);
  await caption(''); await hold(500);
  await b.close();

  const start = stamps[0], secs = (stamps[stamps.length - 1] - start) / 1000;
  console.log('frames', n, 'over', secs.toFixed(1) + 's', 'page errors:', errs.length ? errs.join(' | ') : 'none');
  const list = path.join(OUT, 'contact-frames.txt');
  fs.writeFileSync(list, 'ffconcat version 1.0\n' + stamps.map((t, k) => "file 'contact-frames/" + String(k).padStart(5, '0') + ".png'\nduration " + (((stamps[k + 1] || t + 100) - t) / 1000).toFixed(3) + '\n').join('') + "file 'contact-frames/" + String(n - 1).padStart(5, '0') + ".png'\n");
  const mp4 = path.join(OUT, 'add-contact.mp4');
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    console.log('video', mp4);
  } catch (e) { console.log('ffmpeg failed (' + String(e.message).split('\n')[0] + '); frames are in', FR); }
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
