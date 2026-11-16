// Paging against a fake Gmail that behaves like the real connector: no nextPageToken, pageSize honored,
// before:YYYY/MM/DD exclusive at local midnight, newest first. usage: node harness_page.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);

const fake = (spec) => {
  const day = 864e5; const base = new Date(); base.setHours(15, 0, 0, 0);
  // spec.perDay[i] threads on day i back from today
  const T = []; let n = 0;
  spec.perDay.forEach((count, d) => { for (let k = 0; k < count; k++) { n++; T.push({ id: 'p' + String(n).padStart(3, '0'), ms: base.getTime() - d * day - k * 60e3 }); } });
  T.sort((a, b) => b.ms - a.ms);
  window.__calls = [];
  const thread = (t) => ({ id: t.id, messageCount: 1, messages: [{ id: 'm' + t.id, sender: 'Sender ' + t.id + ' <s' + t.id + '@example.com>', toRecipients: ['me@example.com'], subject: 'Subject ' + t.id, date: new Date(t.ms).toISOString(), labelIds: ['INBOX'], plaintextBody: 'Body ' + t.id }] });
  const summ = (t) => ({ id: t.id, messageCount: 1, messages: [{ id: 'm' + t.id, sender: 'Sender ' + t.id + ' <s' + t.id + '@example.com>', toRecipients: ['me@example.com'], subject: 'Subject ' + t.id }] });
  const mcp = {
    async listTools() { return { servers: ['Gmail'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input });
      await new Promise((r) => setTimeout(r, 10));
      const P = (x) => ({ payload: x });
      if (tool === 'search_threads') {
        const q = input.query || ''; let ts = T.slice();
        const m = q.match(/before:(\d{4})\/(\d{2})\/(\d{2})/);
        if (m) { const cut = new Date(+m[1], +m[2] - 1, +m[3]).getTime(); ts = ts.filter((t) => t.ms < cut); }
        if (/in:sent/.test(q)) ts = [];
        const size = Math.min(input.pageSize || 20, 50);
        const out = ts.slice(0, size).map((t) => (input.view === 'THREAD_VIEW_IDS_ONLY' ? { id: t.id } : summ(t)));
        return P(out.length ? { resultCountEstimate: String(ts.length), threads: out } : {});
      }
      if (tool === 'get_thread') { const t = T.find((x) => x.id === input.threadId); return P(thread(t)); }
      if (tool === 'list_labels') return P({ labels: [] });
      if (tool === 'list_drafts') return P({ drafts: [] });
      return P({ ok: true });
    }
  };
  window.claude = { use: async (nm) => (nm === 'mcp' ? mcp : nm === 'sample' ? (async () => ({ text: 'ok' })) : null) };
};

(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
  async function open(spec, viewport, mobile) {
    const ctx = await b.newContext(Object.assign({ viewport }, mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}));
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await pg.addInitScript(fake, spec);
    await pg.goto('file://' + page); await pg.waitForTimeout(800);
    return pg;
  }
  const ids = (pg) => pg.$$eval('.thread', (els) => els.map((e) => e.dataset.id));
  const waitIdle = async (pg) => { for (let i = 0; i < 60; i++) { if (!(await pg.evaluate(() => !!document.querySelector('.loadmore .spin')))) return; await pg.waitForTimeout(100); } };

  // 1) 60 threads, 2 a day for 30 days
  const pg = await open({ perDay: Array(30).fill(2) }, { width: 1360, height: 900 });
  let a = await ids(pg);
  ok('first page shows 25', a.length === 25, a.length);
  ok('count shows 25 of ~60', (await pg.textContent('#countText')).trim() === '25 of ~60', await pg.textContent('#countText'));
  ok('Load older mail row at the end of the list', await pg.isVisible('[data-loadmore]'));
  ok('footer Load more visible', await pg.isVisible('#moreBtn'));
  await pg.click('[data-loadmore]'); await pg.waitForTimeout(300); await waitIdle(pg);
  a = await ids(pg);
  ok('second page appended (up to 50 shown)', a.length > 25 && a.length <= 60, a.length);
  ok('no duplicates', new Set(a).size === a.length);
  ok('still newest first', a.every((id, i) => i === 0 || id > a[i - 1]));
  const q2 = (await pg.evaluate(() => window.__calls)).filter((c) => c.tool === 'search_threads').map((c) => c.input.query);
  ok('older page searched with before:', q2.some((q) => /^\(in:inbox\) before:\d{4}\/\d{2}\/\d{2}$/.test(q)), q2.slice(-2).join(' | '));
  // scroll to the bottom loads the rest
  await pg.evaluate(() => { const l = document.getElementById('list'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
  await pg.waitForTimeout(300); await waitIdle(pg);
  a = await ids(pg);
  ok('scrolling to the bottom loads more (all 60)', a.length === 60, a.length);
  ok('no duplicates after three pages', new Set(a).size === 60);
  await pg.waitForTimeout(200);
  ok('Load older mail disappears at the end', !(await pg.isVisible('[data-loadmore]')) && !(await pg.isVisible('#moreBtn')));
  ok('count shows 60 of ~60', (await pg.textContent('#countText')).trim() === '60 of ~60', await pg.textContent('#countText'));
  await pg.screenshot({ path: path.join(OUT, 'p1-desktop.png') });

  // 2) a busy day: 40 threads today, 30 yesterday, 10 the day before (pages can't move by whole days)
  const pg2 = await open({ perDay: [40, 30, 10] }, { width: 1360, height: 900 });
  for (let i = 0; i < 8 && (await pg2.isVisible('[data-loadmore]')); i++) { await pg2.click('[data-loadmore]'); await pg2.waitForTimeout(200); await waitIdle(pg2); }
  a = await ids(pg2);
  ok('busy days: paging ends (no endless loop)', !(await pg2.isVisible('[data-loadmore]')));
  ok('busy days: no duplicates', new Set(a).size === a.length, a.length);
  ok('busy days: every thread reached (40 + 30 + 10)', a.length === 80, a.length + ' loaded');

  // 3) small inbox: no Load more at all
  const pg3 = await open({ perDay: [3, 2] }, { width: 1360, height: 900 });
  ok('small inbox: no Load more', !(await pg3.isVisible('[data-loadmore]')) && !(await pg3.isVisible('#moreBtn')));

  // 4) phone
  const mp = await open({ perDay: Array(30).fill(2) }, { width: 390, height: 844 }, true);
  ok('phone: Load older mail is the last row of the list', await mp.evaluate(() => { const l = document.getElementById('list'); return l.lastElementChild && l.lastElementChild.classList.contains('loadmore'); }));
  await mp.evaluate(() => { const l = document.getElementById('list'); l.scrollTop = l.scrollHeight; });
  await mp.waitForTimeout(300); await waitIdle(mp);
  const after1 = (await ids(mp)).length;
  ok('phone: scrolling to the end loads older mail', after1 > 25, after1);
  await mp.evaluate(() => { const l = document.getElementById('list'); l.scrollTop = l.scrollHeight; });
  await mp.waitForTimeout(300); await waitIdle(mp);
  await mp.screenshot({ path: path.join(OUT, 'p2-phone-end.png') });
  const all = await ids(mp);
  ok('phone: reaches all 60 with no duplicates', all.length === 60 && new Set(all).size === 60, all.length);

  console.log(results.join('\n'));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
  await b.close();
})().catch((e) => { console.log('HARNESS CRASH', e.message); process.exit(1); });
