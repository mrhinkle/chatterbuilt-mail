// Regression: after each common step, is the bottom bar (Send bar of a thread, or the draft editor's bar) on screen?
// usage: node harness_bar.js <page.html> <outdir> [WxH ...]
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , SRC, OUT, ...sizes] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; let pass = 0, fail = 0;
  for (const sz of (sizes.length ? sizes : ['1500x760', '1280x680', '900x760', '390x844'])) {
    const [W, Hh] = sz.split('x').map(Number);
    const ctx = await b.newContext(W < 500 ? { viewport: { width: W, height: Hh }, isMobile: true, hasTouch: true } : { viewport: { width: W, height: Hh } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(sz + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(() => { window.__batchDrafts = true; });
    await pg.goto('file://' + wrap(SRC, 'p' + sz + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    const bar = async (label) => {
      const r = await pg.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id) || document.querySelector(id); if (!e) return 'absent'; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) return 'hidden'; const r = e.getBoundingClientRect(); if (r.height === 0) return 'zero'; const vh = window.innerHeight; if (r.top >= vh || r.bottom <= 0) return 'offscreen(top ' + Math.round(r.top) + ')'; if (r.bottom > vh + 1) return 'cut(bottom ' + Math.round(r.bottom) + '>' + vh + ')'; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (el && !e.contains(el) && !el.contains(e)) return 'covered by ' + el.tagName + '.' + el.className; return 'ok'; };
        const open = !!document.querySelector('.compose:not([hidden]):not(.folded)');
        const cf = document.getElementById('composeFoot'), pb = document.getElementById('phoneBar'); const a = cf && cf.getBoundingClientRect(), q = pb && pb.getBoundingClientRect(); const overlap = !!(a && q && a.height && q.height && a.bottom > q.top + 1 && a.top < q.bottom - 1);
        return { send: vis('sendBtn'), cfoot: vis('composeFoot'), dSend: vis('dSend'), dfoot: vis('.dfoot'), phone: vis('phoneBar'), open: open, typing: document.body.classList.contains('typing'), overlap: overlap };
      });
      // The rule: a draft shows its own Send. In a thread on a narrow screen the action bar is always on screen (on a
      // touch screen it steps aside only while the keyboard is up), and with the reply box open the bar with Send is on
      // screen too, above it, never under it. On a wide screen the bar with Send is on screen and there's no action bar.
      const narrow = W <= 860, touch = W < 500; let verdict = 'ok';
      if (r.dSend !== 'absent' && r.dSend !== 'hidden') verdict = r.dSend;
      else if (narrow) {
        if (touch && r.typing && r.open) { if (r.phone !== 'hidden') verdict = 'action bar over the keyboard: ' + r.phone; else if (r.send !== 'ok') verdict = 'send ' + r.send; }
        else if (r.phone !== 'ok') verdict = 'action bar ' + r.phone;
        else if (r.open && r.send !== 'ok') verdict = 'send ' + r.send;
        else if (r.open && r.overlap) verdict = 'bars overlap';
      } else if (r.send !== 'ok') verdict = 'send ' + r.send;
      const want = ['', verdict];
      if (process.env.SHOTS) await pg.screenshot({ path: path.join(OUT, sz + '-' + label.replace(/\W+/g, '_') + '.png') });
      if (want[1] === 'ok') pass++; else { fail++; console.log('FAIL ' + sz + ' ' + label + ': ' + JSON.stringify(r)); await pg.screenshot({ path: path.join(OUT, sz + '-' + label.replace(/\W+/g, '_') + '.png') }); }
    };
    const click = async (sel) => { const e = await pg.$(sel); if (!e || !(await e.isVisible())) { console.log('   (no visible ' + sel + ')'); return false; } await e.click(); return true; };
    // threads
    await click('.thread[data-id="t1"]'); await pg.waitForTimeout(1500); await pg.waitForFunction(() => !document.getElementById('phoneBar') || getComputedStyle(document.getElementById('phoneBar')).display === 'none' || document.getElementById('phoneBar').getBoundingClientRect().height > 0, null, { timeout: 8000 }).catch(() => {}); await pg.waitForTimeout(1700); await bar('thread open');
    await pg.evaluate(() => { const d = document.getElementById('desk'); d.scrollTop = d.scrollHeight; const r = document.getElementById('reading'); if (r) r.scrollTop = r.scrollHeight; }); await pg.waitForTimeout(200); await bar('thread scrolled to the end');
    if (await click('#composeTog')) { await pg.waitForTimeout(500); await bar('reply box opened'); }
    await pg.fill('#body', Array(40).fill('A long reply line to make the box grow.').join('\n')); await pg.waitForTimeout(300); await bar('long reply typed');
    await pg.evaluate(() => { const d = document.getElementById('desk'); d.scrollTop = 0; }); await pg.waitForTimeout(200); await bar('scrolled back to the top');
    if (await click('#composeTog')) { await pg.waitForTimeout(400); await bar('reply box folded again'); }
    if (await pg.isVisible('.back')) { await pg.click('.back'); await pg.waitForTimeout(600); }
    await click('.thread[data-id="t2"]'); await pg.waitForTimeout(3200); await bar('another thread');
    // drafts
    if (await pg.isVisible('.back')) { await pg.click('.back'); await pg.waitForTimeout(600); }
    await click('.chip[data-key="drafts"]'); await pg.waitForTimeout(2600);
    await click('#list .draftrow[data-did="d2"]'); await pg.waitForTimeout(3000); await bar('draft open');
    await pg.evaluate(() => { const r = document.getElementById('reading'); r.scrollTop = r.scrollHeight; const d = document.getElementById('desk'); d.scrollTop = d.scrollHeight; }); await pg.waitForTimeout(200); await bar('draft scrolled to the end');
    await pg.click('#dEditor'); await pg.keyboard.press('End'); for (let i = 0; i < 25; i++) await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); await bar('draft made long');
    await click('#dNext'); await pg.waitForTimeout(3000); await bar('Next draft');
    await click('#dDone'); await pg.waitForTimeout(3000); await bar('Mark checked · next');
    await click('#dSend'); await pg.waitForTimeout(400); await bar('Send asked');
    await click('#dConfirmGo'); await pg.waitForTimeout(3000); await bar('after Send, next draft');
    // back to the inbox
    if (await pg.isVisible('.back')) { await pg.click('.back'); await pg.waitForTimeout(600); }
    await click('.chip[data-key="inbox"]'); await pg.waitForTimeout(2600);
    await click('.thread[data-id="t1"]'); await pg.waitForTimeout(3200); await bar('back to inbox, thread open');
    await ctx.close();
  }
  if (errs.length) { fail++; console.log('FAIL page errors: ' + errs.join(' | ')); }
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.slice(0, 500)); process.exit(1); });
