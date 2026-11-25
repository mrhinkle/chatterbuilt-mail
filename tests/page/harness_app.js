// The standalone page at /app. The real server, in this process, with the fake mailbox.
// No network, no real account, no real key. usage: node harness_app.js <outdir>
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer: createHttpServer } = require('node:http');
const { request: httpsRequest } = require('node:https');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '../..');
const serverDir = path.join(repo, 'server');
const passphrase = 'correct-horse-battery-staple';
const token = 'test-owner-token-do-not-log-0123456789';
const draftMark = 'ZEBRA-DRAFT-BODY-9f3c';
const mailBody = 'Can we lock the gold package';
const modelKey = 'sk-ant-stub-key-do-not-log-9f3c';
const key = randomBytes(32).toString('base64');

function safe(text) {
  return String(text)
    .split(passphrase).join('[passphrase]')
    .split(token).join('[token]')
    .split(modelKey).join('[model-key]')
    .split(key).join('[key]')
    .split(draftMark).join('[draft]')
    .split(mailBody).join('[mail]');
}

function npm(args) {
  try {
    execFileSync('npm', args, { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (error) {
    const out = error.stdout ? error.stdout.toString() : '';
    const err = error.stderr ? error.stderr.toString() : '';
    console.log('FAIL server ' + args.join(' '));
    console.log(safe((out + err).split('\n').slice(-25).join('\n')));
    process.exit(1);
  }
}

function env(extra) {
  return Object.assign({
    OWNER_TOKEN: token,
    OWNER_PASSPHRASE: passphrase,
    ENCRYPTION_KEY: key,
    MAIL_STORE: 'pglite',
    MAIL_MODE: 'mirror',
    MAIL_PROVIDER: 'fake',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
  }, extra || {});
}

function requestOnce(app, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(app.url + urlPath);
    const payload = Buffer.from(body || '');
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: method,
      headers: body === undefined ? headers : Object.assign({}, headers, { 'content-length': String(payload.length) }),
      ca: app.cert,
      servername: 'localhost',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(payload);
    else req.end();
  });
}

function cookieOf(res) {
  const value = res.headers['set-cookie'];
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  const line = lines.find((item) => item.startsWith('cbm_owner=')) || '';
  const match = /cbm_owner=([^;]+)/.exec(line);
  return match ? 'cbm_owner=' + match[1] : '';
}

function formCsrf(html) {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('csrf missing');
  return match[1];
}

async function signIn(app) {
  const start = await requestOnce(app, 'GET', '/signin?next=/app', {}, undefined);
  const first = cookieOf(start);
  const body = new URLSearchParams({ csrf: formCsrf(start.text), passphrase: passphrase, next: '/app' }).toString();
  const posted = await requestOnce(app, 'POST', '/signin', {
    cookie: first,
    'content-type': 'application/x-www-form-urlencoded',
  }, body);
  if (posted.status !== 302) throw new Error('sign-in status ' + posted.status);
  return cookieOf(posted) || first;
}

function draftCount(app) {
  if (!app.provider || !app.provider.counts) throw new Error('fake mailbox counts missing');
  return app.provider.counts.createDraft;
}

async function modelServer() {
  const hits = { n: 0 };
  const server = createHttpServer((req, res) => {
    hits.n += 1;
    res.setHeader('content-type', 'application/json');
    req.on('data', () => {});
    req.on('end', () => {
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'Sponsorship talks are moving.' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return {
    hits: hits,
    url: 'http://127.0.0.1:' + address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

(async () => {
  npm(['ci']);
  npm(['run', 'build']);
  const { createServer } = await import(pathToFileURL(path.join(serverDir, 'dist/src/http/app.js')).href);
  const { FakeGmailServer } = await import(pathToFileURL(path.join(serverDir, 'dist/src/providers/gmail-fake-server.js')).href);
  const results = [];
  const ok = (name, pass, extra) => results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + safe(extra).slice(0, 240) : ''));
  const closers = [];
  const closeAll = async () => {
    while (closers.length) {
      const item = closers.pop();
      try { await item(); } catch { /* already closed */ }
    }
  };

  try {
    const logs = [];
    const app = await createServer(env(), { logSink: (line) => logs.push(line) });
    closers.push(() => app.close());

    const unsigned = await requestOnce(app, 'GET', '/app', {}, undefined);
    ok('unsigned /app redirects to sign-in', unsigned.status === 302 && unsigned.headers.location === '/signin?next=/app' && !unsigned.text.includes('window.claude'));
    const unsignedCall = await requestOnce(app, 'POST', '/app/api/call', { 'content-type': 'application/json' }, JSON.stringify({
      tool: 'create_draft', input: { account: 'gmail_work', to: 'lee@makerspace.example', subject: 'Hi', body: draftMark },
    }));
    ok('unsigned /app/api/call runs nothing', unsignedCall.status === 401 && draftCount(app) === 0 && !unsignedCall.headers['access-control-allow-origin']);

    const browser = await chromium.launch();
    closers.push(() => browser.close());
    const errors = [];

    async function view(width, height, bodyText) {
      const context = await browser.newContext({ viewport: { width: width, height: height }, ignoreHTTPSErrors: true });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(app.url)) return route.continue();
        return route.abort();
      });
      await context.addInitScript(() => {
        try { localStorage.setItem('cm.ahead', '0'); localStorage.setItem('cm.ctxAhead', '0'); } catch (e) { /* private mode */ }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => errors.push(width + ':' + error.message));
      await page.goto(app.url + '/app', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[name="passphrase"]');
      ok(width + ' unsigned visit lands on sign-in', page.url().includes('/signin') && page.url().includes('next='));
      await page.fill('input[name="passphrase"]', passphrase);
      await page.click('button[type="submit"]');
      await page.waitForSelector('.thread[data-id="t1"]', { timeout: 25000 });
      const listText = await page.textContent('#list');
      ok(width + ' inbox lists the sponsorship thread', listText.includes('Sponsorship for the spring summit') && listText.includes('Dana Ruiz'), (listText || '').replace(/\s+/g, ' ').slice(0, 180));
      await page.waitForFunction(() => document.documentElement.classList.contains('no-sample'));
      const hidden = await page.evaluate(() => ({
        sum: document.getElementById('sumBtn').hidden,
        triage: document.getElementById('triageBtn').classList.contains('feat-off'),
        ask: document.getElementById('askBtn').classList.contains('feat-off'),
        nudge: document.getElementById('nudgeBtn').classList.contains('feat-off'),
        proxy: document.querySelector('[data-proxy="sumBtn"]').classList.contains('feat-off'),
        toastErr: !!document.querySelector('.toast.err'),
      }));
      ok(width + ' AI features are hidden without a model key', hidden.sum && hidden.triage && hidden.ask && hidden.nudge && hidden.proxy && !hidden.toastErr, JSON.stringify(hidden));
      const before = draftCount(app);
      await page.evaluate(() => document.querySelectorAll('.toast').forEach((node) => node.remove()));
      await page.click('.thread[data-id="t1"]');
      await page.waitForFunction(() => {
        const reading = document.getElementById('reading');
        return reading && /gold package|Dana/.test(reading.textContent || '');
      });
      await page.waitForSelector('.src.bad', { timeout: 15000 });
      const titles = await page.$$eval('.src.bad', (nodes) => nodes.map((node) => node.getAttribute('title') || ''));
      ok(width + ' context sources say they are not connected', titles.length >= 3 && titles.every((title) => title.includes("isn't available outside Claude")), titles.join(' | '));
      await page.evaluate(() => {
        const compose = document.getElementById('compose');
        if (compose && compose.classList.contains('folded')) document.getElementById('composeTog').click();
      });
      await page.fill('#body', bodyText);
      await page.click('#saveDraftBtn');
      await page.waitForFunction(() => {
        const note = document.getElementById('composeNote');
        return note && /Saved to Gmail drafts|reported an error|can't be saved|Write something/.test(note.textContent || '');
      });
      const note = await page.textContent('#composeNote');
      ok(width + ' a draft saves through the shim', (note || '').includes('Saved to Gmail drafts.') && draftCount(app) === before + 1, note);
      const downloaded = await Promise.all([
        page.waitForEvent('download'),
        page.evaluate(async () => {
          const downloads = await window.claude.use('downloads');
          await downloads.save({ filename: 'lane3.txt', data: 'saved-outside-claude' });
        }),
      ]);
      ok(width + ' downloads saves a file in the browser', downloaded[0].suggestedFilename() === 'lane3.txt');
      await context.close();
    }

    await view(1400, 900, draftMark + ' wide');
    await view(390, 844, draftMark + ' phone');
    ok('no page errors', errors.length === 0, errors.join(' | '));
    const cookie = await signIn(app);
    const page = await requestOnce(app, 'GET', '/app', { cookie: cookie }, undefined);
    const boot = JSON.parse(/window\.__cbm=(\{.*?\});/.exec(page.text)[1]);
    const marked = draftCount(app);
    const bad = await requestOnce(app, 'POST', '/app/api/call', {
      cookie: cookie,
      'content-type': 'application/json',
      'x-cbm-csrf': 'not-the-session-csrf',
    }, JSON.stringify({ tool: 'create_draft', input: { account: 'gmail_work', to: 'lee@makerspace.example', subject: 'Hi', body: draftMark } }));
    ok('a wrong CSRF header runs nothing', bad.status === 403 && draftCount(app) === marked && !bad.headers['access-control-allow-origin']);
    const missing = await requestOnce(app, 'POST', '/app/api/call', {
      cookie: cookie,
      'content-type': 'application/json',
    }, JSON.stringify({ tool: 'create_draft', input: { account: 'gmail_work', to: 'lee@makerspace.example', subject: 'Hi', body: draftMark } }));
    ok('a missing CSRF header runs nothing', missing.status === 403 && draftCount(app) === marked);
    const blob = logs.join('\n');
    const session = cookie.slice('cbm_owner='.length);
    ok('logs omit the key, token, passphrase, csrf and mail',
      !blob.includes(token) && !blob.includes(passphrase) && !blob.includes(session) && !blob.includes(boot.csrf) && !blob.includes(draftMark) && !blob.includes(mailBody));
    await app.close();

    const model = await modelServer();
    closers.push(() => model.close());
    const modelLogs = [];
    const sampled = await createServer(env({
      ANTHROPIC_API_KEY: modelKey,
      ANTHROPIC_API_BASE: model.url,
    }), { logSink: (line) => modelLogs.push(line) });
    closers.push(() => sampled.close());
    const sampleBrowser = await chromium.launch();
    closers.push(() => sampleBrowser.close());
    const sampleContext = await sampleBrowser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
    await sampleContext.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(sampled.url)) return route.continue();
      return route.abort();
    });
    await sampleContext.addInitScript(() => {
      try { localStorage.setItem('cm.ahead', '0'); localStorage.setItem('cm.ctxAhead', '0'); } catch (e) { /* private mode */ }
    });
    const samplePage = await sampleContext.newPage();
    const sampleErrors = [];
    samplePage.on('pageerror', (error) => sampleErrors.push(error.message));
    samplePage.setDefaultTimeout(20000);
    await samplePage.goto(sampled.url + '/signin?next=/app', { waitUntil: 'domcontentloaded' });
    await samplePage.fill('input[name="passphrase"]', passphrase);
    await samplePage.click('button[type="submit"]');
    await samplePage.waitForSelector('.thread[data-id="t1"]', { timeout: 25000 });
    await samplePage.click('.thread[data-id="t1"]');
    await samplePage.waitForFunction(() => {
      const reading = document.getElementById('reading');
      return reading && /gold package|Dana/.test(reading.textContent || '');
    });
    await samplePage.waitForFunction(() => {
      const button = document.getElementById('sumBtn');
      return button && button.hidden === false;
    });
    await samplePage.click('#sumBtn');
    await samplePage.waitForFunction(() => (document.getElementById('sumBox').textContent || '').includes('Sponsorship talks are moving.'), null, { timeout: 20000 });
    const summary = await samplePage.textContent('#sumBox');
    ok('a stub key renders a summary', (summary || '').includes('Sponsorship talks are moving.') && sampleErrors.length === 0, summary);
    const sampleCookie = await signIn(sampled);
    const huge = await requestOnce(sampled, 'POST', '/app/api/sample', {
      cookie: sampleCookie,
      'content-type': 'application/json',
      'x-cbm-csrf': JSON.parse(/window\.__cbm=(\{.*?\});/.exec((await requestOnce(sampled, 'GET', '/app', { cookie: sampleCookie }, undefined)).text)[1]).csrf,
    }, JSON.stringify({ prompt: 'x'.repeat(24001) }));
    ok('an oversized prompt does not call the model', huge.status === 413 && model.hits.n === 1);
    const modelBlob = modelLogs.join('\n');
    ok('the model key and the mail body stay out of the log', !modelBlob.includes(modelKey) && !modelBlob.includes(mailBody) && !modelBlob.includes(passphrase));
    await sampleBrowser.close();
    await sampled.close();
    await model.close();

    const gmail = await FakeGmailServer.demo();
    closers.push(() => gmail.close());
    const gmailKey = randomBytes(32).toString('base64');
    const direct = await createServer({
      OWNER_TOKEN: token,
      OWNER_PASSPHRASE: passphrase,
      ENCRYPTION_KEY: gmailKey,
      MAIL_MODE: 'direct',
      MAIL_STORE: 'pglite',
      MAIL_PROVIDER: 'gmail',
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret-DO-NOT-LOG-zz',
      OWNER_TIMEZONE: 'UTC',
      GMAIL_API_BASE: gmail.apiBase,
      GOOGLE_TOKEN_URL: gmail.tokenUrl,
    }, { logSink: () => {} });
    closers.push(() => direct.close());
    await direct.store.upsertAccount({
      id: 'gmail_work', email: 'alex@riveralabs.example', label: 'Rivera Labs', kind: 'gmail', color: 'blue',
    }, 0);
    await direct.store.upsertToken('gmail_work', direct.config.encryptionKey, JSON.stringify({
      refreshToken: 'refresh-DO-NOT-LOG-zz',
      accessToken: 'access-DO-NOT-LOG-zz',
      expiresAt: Date.now() + 3600000,
    }));
    const gmailCookie = await signIn(direct);
    const gmailPage = await requestOnce(direct, 'GET', '/app', { cookie: gmailCookie }, undefined);
    const gmailCsrf = JSON.parse(/window\.__cbm=(\{.*?\});/.exec(gmailPage.text)[1]).csrf;
    gmail.failNextWrite({ kind: 'status', status: 500 });
    const writesBefore = gmail.recordedWrites().length;
    const failedWrite = await requestOnce(direct, 'POST', '/app/api/call', {
      cookie: gmailCookie,
      'content-type': 'application/json',
      'x-cbm-csrf': gmailCsrf,
    }, JSON.stringify({
      server: 'Chatterbuilt Mail',
      tool: 'create_draft',
      input: { account: 'gmail_work', to: 'lee@makerspace.example', subject: 'Hello', body: draftMark },
    }));
    const failedBody = JSON.parse(failedWrite.text);
    ok('a failed write is one request and is not retryable',
      gmail.recordedWrites().length - writesBefore === 1 && failedBody.retryable !== true && failedBody.code === 'upstream_error',
      failedWrite.status + ' ' + failedWrite.text.slice(0, 120));
  } catch (error) {
    console.log(results.join('\n'));
    console.log('FAIL ' + safe(error && error.stack || error));
    console.log('CRASH app');
    await closeAll();
    process.exit(1);
  }

  await closeAll();
  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.log('FAIL ' + safe(error && error.stack || error));
  console.log('CRASH app');
  process.exit(1);
});
