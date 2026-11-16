// Everything except Gmail through one Composio connector. usage: node harness_composio.js <built.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , SRC, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const page = path.join(OUT, 'page.html'); fs.writeFileSync(page, html);
const fake = () => {
  const now = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const T = { t1: { id: 't1', viewUrl: 'https://mail.google.com/t1', messages: [{ id: 'm1', sender: 'Dana Ruiz <dana@acme.io>', toRecipients: ['alex@example.com'], date: iso(now - 36e5), subject: 'Sponsorship for 2027', labelIds: ['INBOX', 'UNREAD'], plaintextBody: 'Hi Alex, can we lock the gold package by Friday?', viewUrl: 'https://mail.google.com/m1' }] } };
  window.__calls = []; window.__prompts = []; window.__asanaFail = true;
  const env = (data, ok, err) => ({ successful: true, data: { results: [{ response: ok === false ? { successful: false, error: err } : { successful: true, data: data }, tool_slug: 'X', index: 0 }], total_count: 1 } });
  const mcp = {
    async listTools() { return { servers: [{ server: 'Gmail', authStatus: 'ok' }, { server: 'Composio', authStatus: 'ok' }] }; },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input }); await new Promise((r) => setTimeout(r, 10));
      const P = (x) => ({ payload: x });
      if (server === 'Gmail') {
        if (tool === 'search_threads') return P(/^in:sent/.test(input.query || '') ? {} : { resultCountEstimate: '1', threads: [{ id: 't1', messageCount: 1, messages: [{ id: 'm1', sender: T.t1.messages[0].sender, subject: T.t1.messages[0].subject }] }] });
        if (tool === 'get_thread') return P(JSON.parse(JSON.stringify(T[input.threadId])));
        if (tool === 'list_labels') return P({ labels: [] });
        if (tool === 'list_drafts') return P({ drafts: [] });
        return P({ id: 'ok' });
      }
      if (server === 'Composio') {
        const it = (input.tools || [])[0] || {}; const slug = it.tool_slug;
        if (slug === 'NOTION_SEARCH_NOTION_PAGE') return P(it.arguments.query === 'acme' ? env({ results: [{ object: 'page', id: 'p1', properties: { title: 'Acme sponsorship notes' }, url: 'https://notion.so/p1' }], next_cursor: null }) : env({ results: [], next_cursor: null, has_more: false }));
        if (slug === 'ASANA_CREATE_A_TASK') { if (window.__asanaFail) { window.__asanaFail = false; return P(env(null, false, 'No active connection for toolkit=asana')); } return P(env({ data: { gid: '999', name: it.arguments.data.name, permalink_url: 'https://app.asana.com/0/1/999' } })); }
        if (slug === 'SLACK_SEND_MESSAGE') return P(env({ ok: true, ts: '1.2' }));
        if (slug === 'FIRECRAWL_SEARCH') return P(env({ creditsUsed: 2, data: { web: [{ title: 'Dana Ruiz, VP Marketing at Acme', url: 'https://acme.example/team', description: 'Dana leads marketing at Acme.' }] } }));
      }
      return P({ ok: true });
    }
  };
  const sample = async (prompt) => {
    window.__prompts.push(prompt); await new Promise((r) => setTimeout(r, 10));
    const t = (x) => ({ text: typeof x === 'string' ? x : JSON.stringify(x) });
    if (prompt.includes('public web search results')) return t('• VP Marketing at Acme. [1]');
    if (prompt.includes('You brief')) return t('• Acme sponsorship notes exist in Notion. [Notion (company)]');
    if (prompt.includes('You route email')) return t({ actions: [{ key: 'handoff', why: 'logistics', fields: { handoff: 'Can you set up a call with Dana this week?' } }] });
    return t('Thanks Dana. Alex');
  };
  window.claude = { use: async (n) => (n === 'mcp' ? mcp : n === 'sample' ? sample : null) };
};
(async () => {
  const b = await chromium.launch(); const errs = []; const results = [];
  const ok = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await pg.addInitScript(fake); await pg.goto('file://' + page); await pg.waitForTimeout(900);
  const calls = () => pg.evaluate(() => window.__calls); const clearToasts = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  ok('only Gmail and Composio needed: no missing-connector warning', !(await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Not connected/.test(t.textContent)))));
  await clearToasts(); await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(800);
  const nc = (await calls()).filter((c) => c.server === 'Composio' && c.input.tools[0].tool_slug === 'NOTION_SEARCH_NOTION_PAGE');
  ok('context sources run through Composio', nc.length === 2 && nc.some((c) => c.input.tools[0].arguments.query === 'Dana Ruiz') && nc.some((c) => c.input.tools[0].arguments.query === 'acme'), nc.map((c) => c.input.tools[0].arguments.query).join(' | '));
  ok('empty Composio result shows as "nothing found"', (await pg.$$('#sideBody .src.none')).length === 1 && (await pg.$$('#sideBody .src.hit')).length === 1);
  ok('brief only gets the source that found something', await pg.evaluate(() => { const p = window.__prompts.find((x) => x.includes('You brief')); return !!p && p.includes('### Notion (company)') && !p.includes('### Notion\n') && !p.includes('"successful"'); }));
  await clearToasts(); await pg.evaluate(() => { window.__calls = []; }); await pg.click('#taskBtn'); await pg.waitForTimeout(400);
  const tt = await pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '));
  ok('a failed Composio call shows the real error, not "Task created"', /No active connection for toolkit=asana/.test(tt) && !/Task created/.test(tt), tt.slice(0, 160));
  await clearToasts(); await pg.click('#taskBtn'); await pg.waitForTimeout(400);
  const tt2 = await pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '));
  ok('Asana task through Composio', /Task created in Asana/.test(tt2), tt2.slice(0, 120));
  const ac = (await calls()).filter((c) => c.input && c.input.tools && c.input.tools[0].tool_slug === 'ASANA_CREATE_A_TASK').pop();
  ok('Asana arguments filled', !!ac && ac.input.tools[0].arguments.data.name === 'Sponsorship for 2027' && ac.input.tools[0].arguments.data.projects[0] === '1200000000000001');
  await clearToasts(); await pg.click('#sideBody [data-ctx="more"]'); await pg.waitForTimeout(500);
  ok('More context through Composio', (await pg.$$('#sideBody .webbox a.cite')).length === 1);
  await pg.click('#sideBody [data-ctx="steps"]'); await pg.waitForTimeout(400);
  await pg.click('#sideBody [data-ctx="route"]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__calls = []; }); await pg.click('#rtApply'); await pg.waitForTimeout(500);
  const sc = (await calls()).find((c) => c.input && c.input.tools && c.input.tools[0].tool_slug === 'SLACK_SEND_MESSAGE');
  ok('Route action (Slack) through Composio', !!sc && sc.input.tools[0].arguments.channel === 'U00000000' && sc.input.tools[0].arguments.markdown_text.includes('Can you set up a call') && sc.input.tools[0].arguments.markdown_text.includes('https://mail.google.com/m1'));
  ok('Route reports done', (await pg.textContent('#rtNote')).includes('1 of 1 done'));
  await pg.click('#modalClose');
  await pg.evaluate(() => { window.__calls = []; document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  await pg.click('#setBtn'); await pg.click('#roToggle'); await pg.keyboard.press('Escape');
  await pg.click('#taskBtn'); await pg.waitForTimeout(300);
  ok('read-only blocks a Composio write', !(await calls()).some((c) => c.server === 'Composio'));
  await pg.click('#roPill');
  await pg.screenshot({ path: path.join(OUT, 'composio.png') });
  console.log(results.join('\n')); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  console.log('PASSED ' + results.filter((r) => r.startsWith('PASS')).length + ' of ' + results.length); await b.close();
})().catch((e) => { console.log('HARNESS CRASH', e.message); process.exit(1); });
