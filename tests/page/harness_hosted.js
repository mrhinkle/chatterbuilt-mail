// Gmail through the Chatterbuilt Mail server: the page's own tool names, plus account, over HTTPS.
// Builds server/, starts it with the fake mailbox (no network, no real account), and routes
// callTool("Chatterbuilt Mail") at that process. Made-up mail only.
// usage: node harness_hosted.js <built.html> <outdir>
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { request: httpsRequest } = require('node:https');
const path = require('node:path');
const { chromium } = require('playwright');

const fake = require(path.resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , srcArg, outArg] = process.argv;
const SRC = path.resolve(srcArg);
const OUT = path.resolve(outArg);
const repo = path.resolve(__dirname, '../..');
const serverDir = path.join(repo, 'server');
const token = 'smoke-owner-token-do-not-log-032';
const key = randomBytes(32).toString('base64');
mkdirSync(OUT, { recursive: true });

function safe(text) {
  return String(text).split(token).join('[token]').split(key).join('[key]');
}

function npm(args) {
  try {
    execFileSync('npm', args, { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (e) {
    const tail = safe((e.stdout || '').toString() + (e.stderr || '').toString()).split('\n').slice(-25).join('\n');
    console.log('FAIL server ' + args.join(' '));
    console.log(tail);
    process.exit(1);
  }
}

let child = null;
async function boot() {
npm(['ci']);
npm(['run', 'build']);

child = spawn('npm', ['run', 'dev'], {
  cwd: serverDir,
  env: Object.assign({}, process.env, {
    MAIL_STORE: 'pglite',
    MAIL_MODE: 'mirror',
    MAIL_PROVIDER: 'fake',
    NODE_ENV: 'development',
    OWNER_TOKEN: token,
    ENCRYPTION_KEY: key,
    HOST: '127.0.0.1',
    PORT: '0',
  }),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});

let output = '';
let started = false;
let dying = false;
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

function stop() {
  if (!child || !child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }, 1500).unref();
}
process.on('exit', stop);

function fail(message) {
  if (dying) return;
  dying = true;
  console.log('FAIL ' + safe(message));
  if (output) console.log(safe(output.slice(-1500)));
  console.log('CRASH server');
  stop();
  process.exit(1);
}

function parseBody(text) {
  if (!text) return null;
  if (text.startsWith('event:') || text.startsWith('data:') || text.includes('\ndata:')) {
    const lines = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  }
  return JSON.parse(text);
}

function postJson(url, ca, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(body);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: 'POST',
      headers: Object.assign({}, headers, { 'content-length': String(payload.length) }),
      ca: ca,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => fail('dev server did not print a listening line'), 45000);
  const look = () => {
    const match = /listening https:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    const trust = /trust-file (\S+)/.exec(output);
    if (match && trust) { clearTimeout(timer); started = true; resolve({ url: 'https://127.0.0.1:' + match[1], certPath: trust[1] }); }
  };
  child.stdout.on('data', look);
  child.stderr.on('data', look);
  child.on('exit', (code) => { if (!started) fail('dev server exited before listening (code ' + code + ')'); });
  look();
});
started = true;
const base = ready.url;
const ca = readFileSync(ready.certPath);
let rpcId = 0;

async function rpc(body) {
  const res = await postJson(base + '/mcp', ca, {
    authorization: 'Bearer ' + token,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }, JSON.stringify(body));
  if (res.text.includes(token)) throw new Error('response contained the owner token');
  return res;
}

const hello = await rpc({
  jsonrpc: '2.0', id: ++rpcId, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'harness-hosted', version: '0' } },
});
if (hello.status < 200 || hello.status >= 300) fail('initialize returned ' + hello.status);
const noted = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
if (noted.status !== 200 && noted.status !== 202) fail('initialized notification returned ' + noted.status);

async function toolCall(name, args) {
  try {
    const res = await rpc({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: name, arguments: args || {} } });
    if (res.status < 200 || res.status >= 300) return { ok: false, error: { code: 'tool_error', message: 'HTTP ' + res.status } };
    const body = parseBody(res.text);
    if (body && body.error) return { ok: false, error: { code: 'tool_error', message: String(body.error.message || 'mcp error').slice(0, 200) } };
    const result = body && body.result;
    if (result && result.isError) return { ok: false, error: { code: 'tool_error', result: result } };
    const text = result && result.content && result.content[0] && result.content[0].text;
    let data = {};
    if (text) { try { data = JSON.parse(text); } catch { data = { text: text }; } }
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: { code: 'tool_error', message: safe(e && e.message || e).slice(0, 200) } };
  }
}
globalThis.__hostedStop = stop;
return toolCall;
}

const pageFile = path.join(OUT, 'page.html');
writeFileSync(pageFile, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + readFileSync(SRC, 'utf8') + '</body></html>');

const noAhead = () => { try { localStorage.setItem('cm.ahead', '0'); } catch (e) {} };
const wrap = () => {
  const orig = window.claude.use;
  window.claude.use = async (n) => {
    const x = await orig(n);
    if (n !== 'mcp') return x;
    return Object.assign({}, x, {
      async listTools() {
        const lt = await x.listTools();
        const servers = (lt.servers || []).slice();
        if (!servers.some((s) => s.server === 'Chatterbuilt Mail')) servers.push({ server: 'Chatterbuilt Mail', authStatus: 'ok' });
        return { servers: servers };
      },
      async callTool(s, t, i) {
        if (s !== 'Chatterbuilt Mail') return x.callTool(s, t, i);
        const input = Object.assign({}, i || {});
        const rw = window.__rewriteOnce;
        if (rw && rw.tool === t) { window.__rewriteOnce = null; Object.assign(input, rw.fields || {}); }
        const failNext = window.__failNext;
        if (failNext && failNext.tool === t) {
          window.__failNext = null;
          window.__calls.push({ server: s, tool: t, input: input, failed: true });
          throw failNext.error;
        }
        const r = await window.cbmHostedCall(t, input);
        if (!r || !r.ok) {
          window.__calls.push({ server: s, tool: t, input: input, failed: true });
          throw (r && r.error) || { code: 'tool_error', message: 'hosted call failed' };
        }
        window.__calls.push({ server: s, tool: t, input: input, result: r.data });
        return { payload: r.data };
      },
    });
  };
};

(async () => {
  const toolCall = await boot();
  const b = await chromium.launch();
  const errs = [];
  const results = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + String(x).slice(0, 240) : ''));
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.exposeFunction('cbmHostedCall', (tool, input) => toolCall(tool, input));
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(20000);
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake);
  await pg.addInitScript(noAhead);
  await pg.addInitScript(wrap);
  await pg.goto('file://' + pageFile);

  const calls = () => pg.evaluate(() => window.__calls || []);
  const hosted = async (tool) => (await calls()).filter((c) => c.server === 'Chatterbuilt Mail' && (!tool || c.tool === tool));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const closeToast = () => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const readText = () => pg.evaluate(() => { const r = document.getElementById('reading'); return (r ? r.textContent : '') + ' ' + [...(r ? r.querySelectorAll('.mailhost') : [])].map((h) => h.shadowRoot ? h.shadowRoot.textContent : '').join(' '); });

  await pg.waitForSelector('.thread[data-id="t1"]', { timeout: 25000 });
  await pg.waitForSelector('.thread[data-id="p1"]', { timeout: 25000 });
  const listText = await pg.textContent('#list');
  ok('All inboxes lists work and personal mail', listText.includes('Sponsorship for the spring summit') && listText.includes('Dana Ruiz') && listText.includes('Saturday dinner') && listText.includes('Casey'), listText.replace(/\s+/g, ' ').slice(0, 180));
  ok('Filters is in Settings', await pg.$eval('#filtersBtn', (el) => el.hidden === false));
  const listed = await hosted();
  ok('list uses the page tool names on Chatterbuilt Mail', listed.some((c) => c.tool === 'search_threads' && c.input && c.input.account === 'gmail_work' && c.input.query === 'in:inbox') && listed.some((c) => c.tool === 'search_threads' && c.input && c.input.account === 'gmail_personal'));
  ok('no calls to the Gmail connector', !(await calls()).some((c) => c.server === 'Gmail'));
  ok('no Composio tool slugs', listed.every((c) => !/^GMAIL_/.test(c.tool || '')));

  await pg.click('#setBtn');
  await pg.click('#acctBtn');
  await pg.waitForSelector('#modalBody .acctrow');
  await pg.waitForFunction(() => document.getElementById('modalBack').dataset.addSettled === '1');
  ok('Add an account is absent when the server has no public URL', (await pg.$('#addAcct')) === null);
  ok('Accounts asks the hosted server for server_info', (await hosted('server_info')).some((c) => !c.failed));
  await pg.click('#modalClose');

  await clear();
  await pg.click('.thread[data-id="t1"]');
  await pg.waitForFunction(() => { const r = document.getElementById('reading'); return r && /gold package|Dana/.test(r.textContent); });
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c && c.classList.contains('folded')) document.getElementById('composeTog').click(); });
  ok('Attach is available', await pg.isVisible('[data-feat="attach"]'));
  const opened = await hosted('get_thread');
  ok('open names the work account', opened.some((c) => c.input && c.input.threadId === 't1' && c.input.account === 'gmail_work' && !c.failed));

  await pg.waitForSelector('#fromSel option[value="gmail_work|events@riveralabs.example"]', { state: 'attached' });
  await pg.selectOption('#fromSel', 'gmail_personal|alex.rivera@mail.example');
  ok('a different account still sends a new email', (await pg.textContent('#fromNote')).includes('not inside this thread') && (await pg.textContent('#fromNote')).includes('account.'));
  await pg.selectOption('#fromSel', 'gmail_work|events@riveralabs.example');
  const fromNote = await pg.textContent('#fromNote');
  ok('a same-account alias stays in the thread', fromNote.includes('events@riveralabs.example') && fromNote.includes('still inside this thread'), fromNote);
  await pg.fill('#body', 'See you at the meetup.');
  await pg.click('#sendBtn');
  await pg.waitForFunction(() => { const b = document.getElementById('confirmSend'); return b && b.textContent !== 'Send without checking'; });
  ok('the send confirm says the reply stays in the thread', (await pg.textContent('#confirmText')).includes('still in this thread'));
  await clear();
  await pg.click('#confirmSend');
  await pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'send_message' && c.result));
  const sent = (await hosted('send_message')).find((c) => c.input && c.input.fromEmail);
  ok('alias reply uses send_message with fromEmail and replyToMessageId', !!sent && sent.input.fromEmail === 'events@riveralabs.example' && sent.input.replyToMessageId === 'mt1' && sent.input.account === 'gmail_work' && !sent.input.draftId, JSON.stringify(sent && sent.input));
  ok('the sent reply stays on thread t1', !!sent && sent.result && sent.result.threadId === 't1', JSON.stringify(sent && sent.result));
  await pg.waitForFunction(() => { const r = document.getElementById('reading'); return r && r.textContent.includes('See you at the meetup.'); }, null, { timeout: 15000 }).catch(() => {});
  ok('the thread shows the reply', (await readText()).includes('See you at the meetup.'));

  await closeToast();
  await pg.click('.thread[data-id="t4"]');
  await pg.waitForFunction(() => (document.getElementById('subject') || {}).textContent && document.getElementById('subject').textContent !== 'Today');
  await clear();
  await pg.evaluate(() => {
    window.__failNext = { tool: 'unlabel_thread', error: { code: 'tool_error', retryable: true, retryAfterMs: 10, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'upstream_error', message: 'blip' }) }] } } };
  });
  await pg.click('#archiveBtn');
  await pg.waitForTimeout(1800);
  const failedWrite = await hosted('unlabel_thread');
  ok('a failed write is not retried', failedWrite.length === 1 && failedWrite[0].failed === true, String(failedWrite.length));
  await clear();
  await pg.click('#archiveBtn');
  await pg.waitForSelector('.toast [data-undo="1"]');
  const archived = (await hosted('unlabel_thread')).find((c) => !c.failed);
  ok('archive removes INBOX on the work account', !!archived && archived.input.threadId === 't4' && JSON.stringify(archived.input.labelIds) === '["INBOX"]' && archived.input.account === 'gmail_work', JSON.stringify(archived && archived.input));
  await clear();
  await pg.click('.toast [data-undo="1"]');
  await pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'label_thread'));
  const undone = (await hosted('label_thread'))[0];
  ok('Undo puts INBOX back', !!undone && undone.input.threadId === 't4' && JSON.stringify(undone.input.labelIds) === '["INBOX"]' && undone.input.account === 'gmail_work');
  await closeToast();

  await pg.click('.chip[data-key="drafts"]');
  await pg.waitForSelector('.draftrow[data-did="d1"]');
  await clear();
  await pg.click('.draftrow[data-did="d1"]');
  await pg.waitForSelector('#dEditor');
  await pg.waitForSelector('#dFromSel option[value="gmail_work|events@riveralabs.example"]', { state: 'attached' });
  ok('draft d1 opens', (await pg.textContent('#dSubj') || '').includes('Venue') || (await pg.textContent('#dEditor') || '').includes('Tuesday'));
  ok('draft body came from get_draft', (await hosted('get_draft')).some((c) => c.input && c.input.draftId === 'd1' && c.input.account === 'gmail_work'));
  await pg.selectOption('#dFromSel', 'gmail_work|events@riveralabs.example');
  const dNote = await pg.textContent('#dFromNote');
  ok('From on a draft keeps a same-account alias in the thread', dNote.includes('still inside this thread'), dNote);
  await pg.selectOption('#dFromSel', 'gmail_personal|alex.rivera@mail.example');
  ok('From on a draft still warns for another account', (await pg.textContent('#dFromNote')).includes('not inside the thread'));
  await pg.selectOption('#dFromSel', 'gmail_work|alex@riveralabs.example');
  await clear();
  await pg.click('#dSave');
  await pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'update_draft'));
  const saved = (await hosted('update_draft'))[0];
  ok('save draft calls update_draft on its account', !!saved && saved.input.draftId === 'd1' && saved.input.account === 'gmail_work' && saved.input.threadId === 't2', JSON.stringify(saved && saved.input).slice(0, 220));
  await pg.click('#dSend');
  await pg.waitForSelector('#dConfirmGo');
  await clear();
  await pg.click('#dConfirmGo');
  await pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'send_message'));
  const draftSent = (await hosted('send_message'))[0];
  ok('sending the draft uses its draftId', !!draftSent && draftSent.input.draftId === 'd1' && draftSent.input.account === 'gmail_work' && !draftSent.input.fromEmail, JSON.stringify(draftSent && draftSent.input));

  await pg.click('.chip[data-key="inbox"]');
  await pg.waitForSelector('.thread[data-id="t1"]');
  await pg.click('#toolsBtn');
  await pg.click('#rulesBtn');
  await pg.waitForSelector('#ruleOp');
  await pg.selectOption('#ruleOp', 'skip');
  await pg.waitForSelector('#ruleFrom', { state: 'visible' });
  await pg.fill('#ruleText', 'Mail from the made-up digest');
  await pg.fill('#ruleFrom', 'digest@weeklybyte.example');
  await clear();
  await pg.click('#ruleAdd');
  await pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'create_filter'));
  const filt = (await hosted('create_filter'))[0];
  ok('a skip-the-inbox rule creates a Gmail filter', !!filt && filt.input.criteria && filt.input.criteria.from === 'digest@weeklybyte.example' && filt.input.action && filt.input.action.skipInbox === true && filt.input.account === 'gmail_work', JSON.stringify(filt && filt.input));
  await pg.click('#modalClose');
  await pg.click('#setBtn');
  await pg.click('#filtersBtn');
  await pg.waitForFunction(() => { const b = document.getElementById('modalBody'); return b && b.textContent.includes('digest@weeklybyte.example'); });
  ok('Settings lists the filter', (await pg.textContent('#modalBody')).includes('skips the inbox'));
  await pg.click('#modalClose');

  await clear();
  await pg.evaluate(() => {
    window.__failNext = { tool: 'get_thread', error: { code: 'tool_error', result: { content: [{ type: 'text', text: JSON.stringify({ code: 'needs_reauth', message: 'the connection lapsed' }) }] } } };
  });
  await pg.click('.thread[data-id="t3"]');
  await pg.waitForFunction(() => (document.getElementById('subject') || {}).textContent === "Couldn't open thread");
  await pg.waitForTimeout(1500);
  const reauth = await hosted('get_thread');
  const reauthText = await readText();
  ok('needs_reauth shows the reconnect copy', (await pg.textContent('#subject')) === "Couldn't open thread" && reauthText.includes('Gmail needs to be reconnected. Open your mail server\'s Connect page.') && !reauthText.includes('claude.ai') && !reauthText.includes('Settings → Connectors'), reauthText.replace(/\s+/g, ' ').slice(0, 180));
  ok('needs_reauth is not retried', reauth.length === 1 && reauth[0].failed === true, String(reauth.length));

  await clear();
  await pg.evaluate(() => { window.__rewriteOnce = { tool: 'get_thread', fields: { threadId: 'does-not-exist' } }; });
  await pg.click('.thread[data-id="t8"]');
  await pg.waitForFunction(() => (document.getElementById('subject') || {}).textContent === "Can't find this thread");
  const missing = await hosted('get_thread');
  const missingText = await readText();
  ok('a missing thread shows the not-found copy', missingText.includes("Gmail can't find this any more") && !missingText.includes('claude.ai'), missingText.replace(/\s+/g, ' ').slice(0, 180));
  ok('not-found asked the server and was not retried as a read error', missing.length >= 1 && missing.every((c) => c.failed) && missing.filter((c) => c.input && c.input.threadId === 'does-not-exist').length === 1, missing.map((c) => (c.input && c.input.account) + ':' + (c.input && c.input.threadId)).join(','));

  await clear();
  await pg.evaluate(() => {
    window.__failNext = { tool: 'get_thread', error: { code: 'tool_error', retryable: true, retryAfterMs: 10, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'upstream_error', message: 'blip' }) }] } } };
  });
  await pg.click('.thread[data-id="t5"]');
  // The list paints the subject immediately. Wait for the retry itself: one failed read, then the successful open.
  await pg.waitForFunction(() => {
    const calls = (window.__calls || []).filter((c) => c.tool === 'get_thread');
    const title = (document.getElementById('subject') || {}).textContent || '';
    return calls.length >= 2 && title && title !== "Couldn't open thread" && title !== 'Today' && title !== "Can't find this thread";
  }, null, { timeout: 15000 }).catch(() => {});
  const retried = await hosted('get_thread');
  ok('a retryable read retries once and then opens', retried.length === 2 && retried[0].failed === true && !retried[1].failed && retried[1].input.threadId === 't5', retried.map((c) => (c.failed ? 'fail' : 'ok') + ':' + (c.input && c.input.threadId)).join(','));

  ok('still no calls to the Gmail connector', !(await calls()).some((c) => c.server === 'Gmail'));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
  await b.close();
  globalThis.__hostedStop();
  console.log(results.join('\n'));
  const f = results.filter((x) => x.startsWith('FAIL')).length;
  console.log('\n' + (results.length - f) + '/' + results.length + ' passed');
  process.exit(f ? 1 : 0);
})().catch((e) => {
  console.log('CRASH ' + safe(e && e.stack || e).split('\n').slice(0, 6).join(' | '));
  if (globalThis.__hostedStop) globalThis.__hostedStop();
  process.exit(1);
});
