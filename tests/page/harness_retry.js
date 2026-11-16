// Connector failures: reads retry once when retryable; writes never; clear copy + Try again; drafts load metadata, then one draft's text.
// usage: node harness_retry.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const page = path.join(OUT, 'page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');

const fake = (mode) => {
  const now = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const ME = 'Alex Rivera <alex@riveralabs.example>';
  const T = {
    t1: { id: 't1', messages: [{ id: 'm1', sender: 'Lee Park <lee@venuehall.example>', toRecipients: [ME], date: iso(now - 36e5), subject: 'Venue walkthrough', labelIds: ['INBOX'], plaintextBody: 'Tuesday or Wednesday?' }] },
    t2: { id: 't2', messages: [{ id: 'm2', sender: 'Dana Ruiz <dana@acme.example>', toRecipients: [ME], date: iso(now - 72e5), subject: 'Gold package', labelIds: ['INBOX'], plaintextBody: 'Lock it by Friday?' }] }
  };
  const summ = (id) => ({ id, messageCount: 1, messages: [{ id: T[id].messages[0].id, sender: T[id].messages[0].sender, subject: T[id].messages[0].subject }] });
  window.__calls = []; window.__fails = { search: mode === 'retry' ? 1 : mode === 'hard' ? 99 : 0, draft: mode === 'retry' ? 1 : 0 };
  const mcp = {
    async listTools() { return { servers: ['Gmail'].map((s) => ({ server: s, authStatus: 'ok' })) }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ tool, input: JSON.parse(JSON.stringify(input)) }); await new Promise((r) => setTimeout(r, 10));
      const P = (x) => ({ payload: x });
      if (tool === 'search_threads') {
        if (/before:|^in:sent|^label:/.test(input.query || '')) return P({});
        if (input.query === 'in:inbox' && window.__fails.search > 0) { window.__fails.search--; throw mode === 'hard' ? { code: 'upstream_error', message: 'Connector call failed' } : { code: 'upstream_error', message: 'Connector call failed', retryable: true, retryAfterMs: 50 }; }
        return P({ resultCountEstimate: '2', threads: ['t1', 't2'].map(summ) });
      }
      if (tool === 'get_thread') return P(JSON.parse(JSON.stringify(T[input.threadId])));
      if (tool === 'list_drafts') {
        if (input.view === 'DRAFT_VIEW_FULL') return P({ drafts: input.query === 'to:lee@venuehall.example' ? [{ id: 'd1', threadId: 't1', toRecipients: ['lee@venuehall.example'], plaintextBody: 'Hi Lee, Tuesday at 10 works. Alex', viewUrl: 'https://mail.google.com/d1' }] : [] });
        return P({ drafts: [{ id: 'd1', threadId: 't1', toRecipients: ['lee@venuehall.example'], viewUrl: 'https://mail.google.com/d1' }] });
      }
      if (tool === 'create_draft' && window.__fails.draft > 0) { window.__fails.draft--; throw { code: 'upstream_error', message: 'Connector call failed', retryable: true, retryAfterMs: 50 }; }
      if (tool === 'list_labels') return P({ labels: [] });
      return P({ ok: true });
    }
  };
  window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? (async () => ({ text: 'ok' })) : null) };
};

(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const open = async (mode) => { const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(mode + ': ' + e.message)); await pg.addInitScript(fake, mode); await pg.goto('file://' + page); await pg.waitForTimeout(2200); return { ctx, pg }; };
  const calls = (pg) => pg.evaluate(() => window.__calls);

  // retryable read: one retry, list loads, no error shown
  let { ctx, pg } = await open('retry');
  let cs = await calls(pg);
  ok('a retryable read is retried once', cs.filter((c) => c.tool === 'search_threads' && c.input.query === 'in:inbox').length === 2);
  ok('the list loads after the retry', (await pg.$$('.thread')).length === 2);
  ok('drafts list asks for metadata only', cs.some((c) => c.tool === 'list_drafts' && c.input.view === 'DRAFT_VIEW_METADATA_ONLY') && !cs.some((c) => c.tool === 'list_drafts' && c.input.view === 'DRAFT_VIEW_FULL'));
  ok('Today still lists the waiting draft', (await pg.textContent('.today')).includes('Lee Park'));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(800);
  cs = await calls(pg);
  ok('opening the thread fetches just that draft', cs.some((c) => c.tool === 'list_drafts' && c.input.view === 'DRAFT_VIEW_FULL' && c.input.query === 'to:lee@venuehall.example' && c.input.pageSize === 10));
  ok('the banner shows the draft text', (await pg.textContent('#draftBox')).includes('Tuesday at 10'));
  await pg.click('#dLoad'); await pg.waitForTimeout(100);
  ok('Load it puts the draft in the reply box', (await pg.inputValue('#body')).includes('Tuesday at 10'));
  // a write is never retried
  await pg.evaluate(() => { window.__calls = []; });
  await pg.click('#saveDraftBtn'); await pg.waitForTimeout(1200);
  cs = await calls(pg);
  ok('a failed write is not retried', cs.filter((c) => c.tool === 'create_draft').length === 1, String(cs.filter((c) => c.tool === 'create_draft').length));
  await ctx.close();

  // not retryable: one call, clear copy, Try again
  ({ ctx, pg } = await open('hard'));
  cs = await calls(pg);
  ok('a non-retryable read is not retried', cs.filter((c) => c.tool === 'search_threads' && c.input.query === 'in:inbox').length === 1);
  const txt = await pg.textContent('#list');
  ok('the list explains the failure in plain words', txt.includes("couldn't finish that just now") && !txt.includes('(upstream_error)'), txt.slice(0, 160));
  ok('a Try again button is offered', await pg.isVisible('[data-retrylist]'));
  await pg.evaluate(() => { window.__fails.search = 0; });
  await pg.click('[data-retrylist]'); await pg.waitForTimeout(800);
  ok('Try again loads the list', (await pg.$$('.thread')).length === 2);
  await ctx.close();

  await b.close();
  console.log(results.join('\n')); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length);
})().catch((e) => { console.log('HARNESS CRASH', e.message.split('\n')[0]); process.exit(1); });
