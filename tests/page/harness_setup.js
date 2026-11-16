// Add an account, server_info, and filter hiding. Made-up addresses only.
// usage: node harness_setup.js <setup.html> <composio.html> <native.html> <bare.html> <xss.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , setupArg, composioArg, nativeArg, bareArg, xssArg, outArg] = process.argv;
const OUT = path.resolve(outArg);
fs.mkdirSync(OUT, { recursive: true });

function wrap(src) {
  const file = path.join(OUT, path.basename(src));
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'
    + fs.readFileSync(src, 'utf8') + '</body></html>';
  fs.writeFileSync(file, html);
  return file;
}

function install(standalone) {
  window.__calls = [];
  try { localStorage.clear(); } catch (e) { /* private mode */ }
  if (standalone) window.__cbmStandalone = true;
  const payload = (data) => ({ payload: data });
  const mcp = {
    async listTools() {
      return { servers: [
        { server: 'Chatterbuilt Mail', authStatus: 'ok' },
        { server: 'Gmail', authStatus: 'ok' },
        { server: 'Composio', authStatus: 'ok' },
      ] };
    },
    async invalidate() {},
    async callTool(server, tool, input) {
      window.__calls.push({ server, tool, input: input || {} });
      const fail = window.__failNext;
      if (fail && fail.tool === tool && (!fail.query || (input && input.query) === fail.query)) {
        window.__failNext = null;
        throw fail.error;
      }
      if (tool === 'search_threads') return payload({ threads: [], resultSizeEstimate: 0 });
      if (tool === 'list_labels') return payload({ labels: [] });
      if (tool === 'list_filters') return payload({ filters: [] });
      if (tool === 'list_drafts') return payload({ drafts: [] });
      if (tool === 'list_send_as') return payload({ sendAs: [] });
      if (tool === 'server_info') {
        const info = window.__serverInfo || { publicUrl: 'https://mail.example.test', version: '0.9.0', providers: { google: true, microsoft: false, imap: true } };
        return payload(info);
      }
      if (tool === 'list_accounts') return payload({ accounts: [
        { id: 'gmail_work', kind: 'gmail', capabilities: { filters: true, sendAs: true, labels: 'labels' } },
        { id: 'imap_ada', kind: 'imap', capabilities: { filters: false, sendAs: true, labels: 'folders' } },
      ] });
      return payload({ threads: [], messages: [], labels: [], filters: [], sendAs: [] });
    },
  };
  window.claude = { use: async (name) => (name === 'mcp' ? mcp : null) };
}

(async () => {
  const setupPage = wrap(path.resolve(setupArg));
  const composioPage = wrap(path.resolve(composioArg));
  const nativePage = wrap(path.resolve(nativeArg));
  const barePage = wrap(path.resolve(bareArg));
  const xssPage = wrap(path.resolve(xssArg));
  const browser = await chromium.launch();
  const results = [];
  const errs = [];
  const ok = (name, cond, extra) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + String(extra).slice(0, 180) : '')); };

  async function openPage(file, standalone, viewport) {
    const ctx = await browser.newContext({ viewport });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.addInitScript(install, standalone);
    await pg.goto('file://' + file);
    await pg.waitForFunction(() => {
      const spin = document.querySelector('#list .spin');
      const text = (document.getElementById('statusText') || {}).textContent || '';
      return !spin && text && text !== 'Connecting to Gmail…';
    });
    return { ctx, pg };
  }

  async function accounts(pg) {
    await pg.evaluate(() => document.getElementById('setBtn').click());
    await pg.evaluate(() => document.getElementById('acctBtn').click());
    await pg.waitForSelector('#modalBody .acctrow');
  }

  async function rules(pg) {
    await pg.evaluate(() => { const b = document.getElementById('modalClose'); if (b && document.getElementById('modalBack') && !document.getElementById('modalBack').hidden) b.click(); });
    await pg.evaluate(() => document.getElementById('toolsBtn').click());
    await pg.evaluate(() => document.getElementById('rulesBtn').click());
    await pg.waitForSelector('#ruleOp');
  }

  const skip = (pg) => pg.$eval('#ruleOp', (el) => [...el.options].some((o) => o.value === 'skip'));
  const calls = (pg) => pg.evaluate(() => window.__calls || []);
  const infoCalls = async (pg) => (await calls(pg)).filter((c) => c.tool === 'server_info');
  const settled = (pg) => pg.waitForFunction(() => {
    const back = document.getElementById('modalBack');
    return !!(back && back.dataset.addSettled === '1');
  });
  const CLAUDE_UPSTREAM = "Gmail couldn't finish that just now. If claude.ai asked you to allow Gmail, allow it, then try again. Otherwise wait a moment and try again.";
  async function settleList(pg) {
    await pg.waitForFunction(() => {
      const list = document.getElementById('list');
      return !!(list && !list.querySelector('.spin'));
    });
  }
  async function failList(pg, tool, error) {
    await pg.evaluate((next) => { window.__failNext = next; }, { tool, error });
    await pg.click('#refreshBtn');
    await pg.waitForFunction(() => {
      const list = document.getElementById('list');
      const text = (list && list.textContent) || '';
      return !!(list && !list.querySelector('.spin') && /couldn't finish|needs to be reconnected|call failed/.test(text));
    });
    return {
      text: await pg.textContent('#list'),
      html: await pg.$eval('#list', (el) => el.innerHTML),
    };
  }
  async function withPublicUrl(pg, publicUrl) {
    await pg.evaluate((url) => {
      window.__serverInfo = { publicUrl: url, version: '0.9.0', providers: { google: false, microsoft: false, imap: false } };
      const close = document.getElementById('modalClose');
      if (close && document.getElementById('modalBack') && !document.getElementById('modalBack').hidden) close.click();
    }, publicUrl);
    await accounts(pg);
    await settled(pg);
  }

  const desk = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };
  const hosted = await openPage(setupPage, true, desk);
  const pg = hosted.pg;

  ok('All inboxes shows Filters when one account can filter', await pg.$eval('#filtersBtn', (el) => el.hidden === false));
  ok('a page that already names capabilities does not call list_accounts', !(await calls(pg)).some((c) => c.tool === 'list_accounts'));
  await accounts(pg);
  const link = await pg.$eval('#addAcct', (el) => ({ text: el.textContent, href: el.getAttribute('href') })).catch(() => null);
  ok('standalone hosted page shows Add an account', !!link && link.text.trim() === 'Add an account' && link.href === '/connect', JSON.stringify(link));
  const asked = await infoCalls(pg);
  ok('Add an account asks Chatterbuilt Mail for server_info', asked.some((c) => c.server === 'Chatterbuilt Mail') && asked.every((c) => c.server !== 'Gmail'), asked.map((c) => c.server + ':' + c.tool).join(','));
  ok('the accounts list uses made-up addresses', (await pg.textContent('#modalBody')).includes('ada@mailbox.example') && (await pg.textContent('#modalBody')).includes('alex@riveralabs.example'));
  await pg.screenshot({ path: path.join(OUT, 'add-account.png'), animations: 'disabled' });
  await pg.click('#modalClose');

  await rules(pg);
  ok('All inboxes offers Skip the inbox', await skip(pg));
  await pg.click('#modalClose');

  await pg.selectOption('#acctSel', '1');
  await pg.waitForFunction(() => document.getElementById('filtersBtn').hidden === true);
  ok('an IMAP account hides Filters', await pg.$eval('#filtersBtn', (el) => el.hidden === true));
  await rules(pg);
  ok('an IMAP account hides Skip the inbox', !(await skip(pg)));
  await pg.screenshot({ path: path.join(OUT, 'filters-imap.png'), animations: 'disabled' });
  await pg.click('#modalClose');

  await pg.selectOption('#acctSel', '0');
  await pg.waitForFunction(() => document.getElementById('filtersBtn').hidden === false);
  ok('Gmail shows Filters again', await pg.$eval('#filtersBtn', (el) => el.hidden === false));
  await rules(pg);
  ok('Gmail offers Skip the inbox again', await skip(pg));
  await pg.click('#modalClose');

  await pg.selectOption('#acctSel', '-1');
  await pg.waitForFunction(() => document.getElementById('filtersBtn').hidden === false);
  ok('All inboxes shows Filters again', await pg.$eval('#filtersBtn', (el) => el.hidden === false));

  await pg.selectOption('#acctSel', '1');
  await settleList(pg);
  const imapUp = await failList(pg, 'search_threads', { code: 'upstream_error', message: 'blip' });
  ok('an IMAP account upstream_error on standalone names iCloud', imapUp.text.includes("iCloud couldn't finish that just now. Wait a moment and try again.") && !imapUp.text.includes('Gmail') && !imapUp.text.includes('claude.ai') && !imapUp.html.includes('<a'), imapUp.text.replace(/\s+/g, ' ').slice(0, 180));
  const imapRe = await failList(pg, 'search_threads', { code: 'needs_reauth', message: 'lapsed' });
  ok('needs_reauth on standalone mentions Connect', imapRe.text.includes('iCloud needs to be reconnected. Open Connect (/connect) and connect it again.') && !imapRe.text.includes('claude.ai') && !imapRe.html.includes('<a'), imapRe.text.replace(/\s+/g, ' ').slice(0, 180));

  await pg.setViewportSize(phone);
  await accounts(pg);
  ok('the phone page still shows Add an account', (await pg.$('#addAcct')) !== null);
  await pg.screenshot({ path: path.join(OUT, 'add-account-phone.png'), animations: 'disabled' });
  await hosted.ctx.close();

  const plain = await openPage(setupPage, false, desk);
  await accounts(plain.pg);
  await plain.pg.waitForSelector('#addAcct');
  const plainLink = await plain.pg.$eval('#addAcct', (el) => el.getAttribute('href'));
  ok('the hosted connector page links Add an account to the server', plainLink === 'https://mail.example.test/connect', plainLink);
  const plainInfo = await infoCalls(plain.pg);
  ok('the hosted connector page still calls server_info', plainInfo.some((c) => c.server === 'Chatterbuilt Mail' && c.tool === 'server_info'));
  await plain.pg.click('#modalClose');
  await plain.pg.selectOption('#acctSel', '0');
  await settleList(plain.pg);
  const gmailUp = await failList(plain.pg, 'search_threads', { code: 'upstream_error', message: 'blip' });
  ok('a Gmail account on the connector path says Gmail', gmailUp.text.includes("Gmail couldn't finish that just now. Wait a moment and try again.") && !gmailUp.text.includes('claude.ai') && !gmailUp.html.includes('<a'), gmailUp.text.replace(/\s+/g, ' ').slice(0, 180));
  const gmailRe = await failList(plain.pg, 'search_threads', { code: 'needs_reauth', message: 'lapsed' });
  ok('needs_reauth on the connector path names Connect as text', gmailRe.text.includes('Gmail needs to be reconnected. Open Connect (https://mail.example.test/connect) and connect it again.') && !gmailRe.html.includes('<a'), gmailRe.text.replace(/\s+/g, ' ').slice(0, 180));
  await withPublicUrl(plain.pg, 'javascript:alert(1)');
  ok('a javascript: publicUrl shows no Add an account link', (await plain.pg.$('#addAcct')) === null);
  await withPublicUrl(plain.pg, 'http://127.0.0.1:8787/');
  const loop = await plain.pg.$eval('#addAcct', (el) => el.getAttribute('href')).catch(() => null);
  ok('a loopback http publicUrl links Add an account', loop === 'http://127.0.0.1:8787/connect', loop);
  await withPublicUrl(plain.pg, 'http://mail.example.com');
  ok('a plain http publicUrl shows no Add an account link', (await plain.pg.$('#addAcct')) === null);
  await plain.ctx.close();

  const comp = await openPage(composioPage, true, desk);
  await comp.pg.evaluate(() => { window.__calls = []; });
  ok('Composio hides Filters', await comp.pg.$eval('#filtersBtn', (el) => el.hidden === true));
  await accounts(comp.pg);
  ok('Composio has no Add an account link', (await comp.pg.$('#addAcct')) === null);
  ok('Composio does not send server_info to a connector', !(await infoCalls(comp.pg)).length);
  await comp.pg.click('#modalClose');
  await rules(comp.pg);
  ok('Composio rules have no Skip the inbox', !(await skip(comp.pg)));
  await comp.pg.click('#modalClose');
  await comp.pg.selectOption('#acctSel', '0');
  await settleList(comp.pg);
  const composioUp = await failList(comp.pg, 'COMPOSIO_MULTI_EXECUTE_TOOL', { code: 'upstream_error', message: 'blip' });
  ok('the Composio path keeps the claude.ai upstream copy', composioUp.text.includes(CLAUDE_UPSTREAM), composioUp.text.replace(/\s+/g, ' ').slice(0, 200));
  await comp.ctx.close();

  const native = await openPage(nativePage, true, desk);
  ok('the claude.ai Gmail page hides Accounts', await native.pg.$eval('#acctBtn', (el) => el.hidden === true));
  ok('the claude.ai Gmail page hides Filters', await native.pg.$eval('#filtersBtn', (el) => el.hidden === true));
  ok('the claude.ai Gmail page does not call server_info', !(await infoCalls(native.pg)).some((c) => c.tool === 'server_info'));
  await settleList(native.pg);
  const nativeUp = await failList(native.pg, 'search_threads', { code: 'upstream_error', message: 'blip' });
  ok('the claude.ai Gmail path keeps the claude.ai upstream copy', nativeUp.text.includes(CLAUDE_UPSTREAM), nativeUp.text.replace(/\s+/g, ' ').slice(0, 200));
  await native.ctx.close();

  const bare = await openPage(barePage, false, desk);
  await bare.pg.waitForFunction(() => (window.__calls || []).some((c) => c.tool === 'list_accounts'));
  const listed = (await calls(bare.pg)).filter((c) => c.tool === 'list_accounts');
  ok('the connector page asks list_accounts once, with no account', listed.length === 1 && listed[0].server === 'Chatterbuilt Mail' && !listed[0].input.account, JSON.stringify(listed));
  ok('a Gmail account with no baked capabilities still shows Filters', await bare.pg.$eval('#filtersBtn', (el) => el.hidden === false));
  await bare.pg.selectOption('#acctSel', '1');
  await bare.pg.waitForFunction(() => document.getElementById('filtersBtn').hidden === true);
  ok('an IMAP account the server says cannot filter hides Filters', await bare.pg.$eval('#filtersBtn', (el) => el.hidden === true));
  await bare.pg.selectOption('#acctSel', '-1');
  await bare.pg.waitForFunction(() => document.getElementById('filtersBtn').hidden === false);
  await bare.pg.evaluate(() => document.getElementById('filtersBtn').click());
  await bare.pg.waitForSelector('#filtAcct');
  const menu = await bare.pg.$$eval('#filtAcct option', (els) => els.map((el) => el.value));
  ok('All inboxes offers only the Gmail account in the filter menu', menu.length === 1 && menu[0] === 'gmail_work', menu.join(','));
  await bare.ctx.close();

  const xss = await openPage(xssPage, false, desk);
  await accounts(xss.pg);
  const modalHtml = await xss.pg.$eval('#modalBody', (el) => el.innerHTML);
  const escaped = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;';
  ok('the Accounts modal escapes the account email and label', modalHtml.includes(escaped) && !modalHtml.includes('<img'), modalHtml.slice(0, 180));
  ok('the Accounts modal has no img element', (await xss.pg.$('#modalBody img')) === null);
  await xss.ctx.close();

  console.log(results.join('\n'));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'ERRORS: none');
  const passed = results.filter((row) => row.startsWith('PASS')).length;
  console.log('PASSED ' + passed + ' of ' + results.length);
  await browser.close();
  if (passed !== results.length || errs.length) process.exit(1);
})().catch((error) => {
  console.log('HARNESS CRASH ' + error.message);
  process.exit(1);
});
