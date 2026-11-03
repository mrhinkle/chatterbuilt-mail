// Screenshots and a demo video of Chatterbuilt Mail, with fictional data only.
// Nothing here touches a real account: Gmail, Composio, Calendar and Claude are all faked in the page.
//
// usage (from the repo root):
//   node scripts/demo/record.js [outdir]                    silent, captioned video (demo.mp4)
//   node scripts/demo/record.js [outdir] --voice <dir>      narrated video (demo-narrated.mp4)
// <dir> holds one clip per beat, 01.mp3 to 10.mp3, reading the lines in scripts/demo/voiceover.md. Each beat holds
// until its line has finished, and the clips are laid on the soundtrack where their beats start.
// needs: Node with Playwright and Chromium, Python 3, and ffmpeg (with ffprobe) for the video.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const vi = args.indexOf('--voice'); const VO = vi >= 0 ? path.resolve(args[vi + 1]) : null; if (vi >= 0) args.splice(vi, 2);
const OUT = path.resolve(args[0] || 'demo-out'); fs.mkdirSync(OUT, { recursive: true });
const FR = path.join(OUT, 'frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
// The demo copy reads Gmail through Composio with two made-up accounts, so the account switcher shows.
const page = require('./build-page.js')('chatterbuilt-demo', { accounts: true });
const fake = require('./fake.js');
const clip = (i) => path.join(VO, String(i).padStart(2, '0') + '.mp3');
const voDur = VO ? Array.from({ length: 10 }, (_, k) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip(k + 1)]).toString().trim()) : [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // The attachment viewer loads pdf.js from cdnjs; use a local pdfjs-dist@3.11.174 if one is installed.
  try { const dir = path.dirname(require.resolve('pdfjs-dist/build/pdf.min.js', { paths: [process.cwd(), __dirname] })); await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(dir, r.request().url().split('/').pop())) })); } catch {}
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page);
  // Every frame keeps the time it was taken, so the video plays at real speed even though frames come unevenly.
  let n = 0; const stamps = []; const snap = async () => { await pg.screenshot({ path: path.join(FR, String(n++).padStart(5, '0') + '.png') }); stamps.push(Date.now()); };
  const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await snap(); };
  const shot = async (name) => { await pg.screenshot({ path: path.join(OUT, name + '.png') }); };
  const caption = async (text) => pg.evaluate((t) => { let c = document.getElementById('__cap'); if (!c) { c = document.createElement('div'); c.id = '__cap'; c.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;background:rgba(15,23,42,.88);color:#fff;font:600 15px/1.3 -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:80vw;text-align:center'; document.body.append(c); } c.textContent = t; c.hidden = !t; }, text);
  const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  // A beat starts a narration line; the next beat waits until that line (plus a breath) has played.
  const cues = []; let beatAt = 0, beatMin = 0;
  const finishBeat = async () => { const left = beatAt + beatMin - Date.now(); if (beatMin && left > 0) await hold(left); beatMin = 0; };
  const beat = async (i) => { await finishBeat(); await snap(); beatAt = Date.now(); beatMin = VO ? voDur[i - 1] * 1000 + 450 : 0; if (VO) cues.push({ i, at: beatAt }); };
  await pg.waitForTimeout(1600); await clearToasts();
  await snap();
  await beat(1); await caption('Today: drafts waiting, what needs you, your next meeting'); await hold(2600);
  await finishBeat(); await caption(''); await shot('today');
  await beat(2); await caption('Triage sorts the inbox: Needs you, Worth reading, FYI'); await pg.click('#triageBtn'); await hold(2800); await clearToasts();
  await finishBeat(); await caption(''); await shot('triage');
  await beat(3); await caption('Open a thread: context from your systems, beside it'); await pg.click('.thread[data-id="t1"]'); await hold(3600);
  await finishBeat(); await caption(''); await shot('context-panel');
  await beat(4); await caption('More context: a cited web lookup, only when you press it'); await pg.click('#sideBody [data-ctx="more"]'); await hold(3200);
  await finishBeat(); await caption(''); await shot('more-context');
  await beat(5); await caption('Next steps: where this thread should go'); await pg.click('#sideBody [data-ctx="steps"]'); await hold(2600);
  await pg.click('#sideBody [data-ctx="route"]'); await caption('Review and apply: nothing runs until you do'); await hold(2600);
  await finishBeat(); await caption(''); await shot('route');
  await pg.click('#modalClose'); await hold(400);
  await beat(6); await caption('Draft in your voice, using what your systems know'); await pg.click('[data-intent="yes"]'); await hold(2600);
  await finishBeat(); await caption(''); await shot('draft');
  await beat(7); await caption('Pre-send check: catches the promise you forgot'); await pg.click('#sendBtn'); await hold(3000);
  await finishBeat(); await caption(''); await shot('presend');
  await pg.click('#cancelSend'); await hold(300);
  await beat(8); await caption('Drag any pane wider or narrower');
  { const g = await pg.$eval('#sideSplit', (h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pg.mouse.move(g.x, g.y); await pg.mouse.down(); for (let k = 1; k <= 12; k++) { await pg.mouse.move(g.x - k * 10, g.y); await snap(); } await pg.mouse.up(); await hold(900); }
  await finishBeat();
  await caption('Open attachments right here: PDFs, images, text'); await pg.click('.thread[data-id="t8"]'); await hold(2200); await clearToasts();
  await beat(9); await pg.click('#reading .attbtn'); await hold(2800);
  await finishBeat(); await caption(''); await shot('attachment');
  await pg.keyboard.press('Escape'); await hold(300);
  await beat(10); await caption('Switch between your Gmail accounts'); await pg.selectOption('#acctSel', '1'); await hold(2600); await clearToasts();
  await finishBeat();
  if (VO) { await caption("Narrated with Mark's ElevenLabs voice clone"); await hold(2600); }
  await caption(''); await hold(600);

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

  const start = stamps[0], secs = (stamps[stamps.length - 1] - start) / 1000;
  console.log('frames', n, 'over', secs.toFixed(1) + 's', 'page errors:', errs.length ? errs.join(' | ') : 'none');
  // Each frame lasts until the next one was taken.
  const list = path.join(OUT, 'frames.txt');
  fs.writeFileSync(list, 'ffconcat version 1.0\n' + stamps.map((t, k) => "file 'frames/" + String(k).padStart(5, '0') + ".png'\nduration " + (((stamps[k + 1] || t + 100) - t) / 1000).toFixed(3) + '\n').join('') + "file 'frames/" + String(n - 1).padStart(5, '0') + ".png'\n");
  const mp4 = path.join(OUT, VO ? 'demo-narrated.mp4' : 'demo.mp4');
  try {
    const vid = ['-f', 'concat', '-safe', '0', '-i', list];
    const enc = ['-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-movflags', '+faststart'];
    if (!VO) execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(vid, enc, [mp4]), { stdio: 'inherit' });
    else {
      const ins = [], mix = [];
      cues.forEach((c, k) => { ins.push('-i', clip(c.i)); const ms = Math.max(0, c.at - start); mix.push('[' + (k + 1) + ':a]adelay=' + ms + '|' + ms + '[a' + k + ']'); });
      const filter = mix.join(';') + ';' + cues.map((c, k) => '[a' + k + ']').join('') + 'amix=inputs=' + cues.length + ':normalize=0,apad[aout]';
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(vid, ins, ['-filter_complex', filter, '-map', '0:v', '-map', '[aout]'], enc, ['-c:a', 'aac', '-b:a', '160k', '-shortest', mp4]), { stdio: 'inherit' });
    }
    console.log('video', mp4);
  } catch (e) { console.log('ffmpeg failed (' + String(e.message).split('\n')[0] + '); frames are in', FR); }
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
