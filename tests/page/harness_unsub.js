// Unsubscribe pane: header, plain-text link, HTML-only link, nothing found. usage: node harness_unsub.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);

const fake = () => {
  const now = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const b64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  const msg = (id, sender, text, htmlBody, k) => ({ id: 'm' + id, sender, toRecipients: ['me@example.com'], date: iso(now - k * 36e5), subject: 'Subject ' + id, labelIds: ['INBOX'], plaintextBody: text, htmlBody });
  const T = {
    hdr: msg('hdr', 'News <news@weekly.example>', 'This week…', '', 1),
    txt: msg('txt', 'Events <events@corp.example>', 'Join us.\n\nTo unsubscribe from these emails, click here: https://go.corp.example/e/f2?elqTrackId=abc\n', '', 2),
    htm: msg('htm', 'Oracle <replies@oracle-mail.example>', 'Big news https://go.oracle.example/x?elq=1&elqTrackId=bbac', '<p>Big news</p><a href="https://go.oracle.example/x?elq=1">Read</a> <a href="https://go.oracle.example/subscriptions?elq=1">Unsubscribe</a>', 3),
    none: msg('none', 'Pat Lee <pat@friend.example>', 'Hey, lunch Thursday?', '<p>Hey, lunch Thursday?</p>', 4)
  };
  const heads = { hdr: 'List-Unsubscribe: <https://weekly.example/u?x=1>, <mailto:unsub@weekly.example?subject=stop>\r\nSubject: x\r\n\r\nbody' };
  window.__calls = [];
  const thread = (id) => ({ id, messageCount: 1, viewUrl: 'https://mail.google.com/' + id, messages: [JSON.parse(JSON.stringify(T[id]))] });
  const mcp = {
    async listTools() { return { servers: [{ server: 'Gmail', authStatus: 'ok' }] }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input });
      await new Promise((r) => setTimeout(r, 10));
      const P = (x) => ({ payload: x });
      if (tool === 'search_threads') return P({ resultCountEstimate: '4', threads: ['hdr', 'txt', 'htm', 'none'].map((id) => ({ id, messageCount: 1, messages: [{ id: 'm' + id, sender: T[id].sender, subject: T[id].subject }] })) });
      if (tool === 'get_thread') { const t = thread(input.threadId); if (input.messageFormat !== 'FULL_CONTENT') t.messages.forEach((m) => { delete m.htmlBody; }); return P(t); }
      if (tool === 'get_message') { const id = input.messageId.slice(1); return P({ id: input.messageId, raw: b64(heads[id] || 'Subject: x\r\n\r\nbody') }); }
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
  for (const [vw, mobile] of [[{ width: 1360, height: 900 }, false], [{ width: 390, height: 844 }, true]]) {
    const tag = mobile ? 'phone: ' : '';
    const ctx = await b.newContext(Object.assign({ viewport: vw }, mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}));
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(800);
    const open = async (id) => {
      await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
      if (mobile && await pg.isVisible('#backBtn')) { await pg.tap('#backBtn'); await pg.waitForTimeout(150); }
      await pg.click('.thread[data-id="' + id + '"]'); await pg.waitForTimeout(400);
      await pg.click(mobile ? '#pbMore' : '#threadMoreBtn'); await pg.click('#unsubBtn'); await pg.waitForTimeout(500);
      return pg.evaluate(() => ({ text: document.getElementById('unsubBox').textContent, primary: [...document.querySelectorAll('#unsubBox .primary')].map((e) => e.textContent.trim()), href: (document.querySelector('#unsubBox [data-unsub-link]') || {}).href || '', row: !document.getElementById('unsubArchiveRow').hidden }));
    };
    let r = await open('hdr');
    ok(tag + 'header: primary Unsubscribe opens the List-Unsubscribe page', r.primary[0] === 'Unsubscribe' && r.href.includes('weekly.example/u'), JSON.stringify(r.primary));
    ok(tag + 'header: email option and archive-afterward shown', r.text.includes('Unsubscribe by email') && r.row);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    r = await open('txt');
    ok(tag + 'plain-text link next to "unsubscribe" is found', r.primary[0] === 'Unsubscribe' && r.href.includes('go.corp.example/e/f2'), r.href);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    r = await open('htm');
    ok(tag + 'HTML-only "Unsubscribe" anchor is found', r.primary[0] === 'Unsubscribe' && r.href.includes('/subscriptions'), r.href);
    ok(tag + 'tracking link labelled "Read" is not used', !r.href.includes('x?elq'));
    await pg.screenshot({ path: path.join(OUT, (mobile ? 'phone-' : '') + 'u-htm.png') });
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    r = await open('none');
    ok(tag + 'nothing found: Archive is the primary action', r.primary[0] === 'Archive', JSON.stringify(r.primary));
    ok(tag + 'nothing found: no dangling archive-afterward checkbox', !r.row);
    await pg.screenshot({ path: path.join(OUT, (mobile ? 'phone-' : '') + 'u-none.png') });
    await pg.evaluate(() => { window.__calls = []; });
    await pg.click('#unsubRuleArchive'); await pg.waitForTimeout(500);
    const calls = await pg.evaluate(() => window.__calls);
    ok(tag + 'rule button archives the thread', calls.some((c) => c.tool === 'unlabel_thread' && c.input.threadId === 'none' && (c.input.labelIds || []).includes('INBOX')));
    ok(tag + 'rule button saves a sender rule', await pg.evaluate(() => (JSON.parse(localStorage.getItem('cm.rules') || '[]')).some((x) => x.from === 'pat@friend.example' && x.op === 'archive')));
    await ctx.close();
  }
  console.log(results.join('\n'));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
  await b.close();
})().catch((e) => { console.log('HARNESS CRASH', e.message); process.exit(1); });
