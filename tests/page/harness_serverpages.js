// Renders every hosted setup page with made-up data. Nothing touches a real account.
// usage: node harness_serverpages.js <outdir>
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const OUT = process.argv[2];
if (!OUT) {
  console.log('FAIL usage: node harness_serverpages.js <outdir>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const repo = path.resolve(__dirname, '../..');
const serverDir = path.join(repo, 'server');
const distPages = path.join(serverDir, 'dist/src/auth/pages.js');

function npm(args) {
  try {
    execFileSync('npm', args, { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (error) {
    const out = error.stdout ? error.stdout.toString() : '';
    const err = error.stderr ? error.stderr.toString() : '';
    console.log('FAIL server ' + args.join(' '));
    console.log((out + err).split('\n').slice(-25).join('\n'));
    process.exit(1);
  }
}

if (!fs.existsSync(distPages)) {
  npm(['ci']);
  npm(['run', 'build']);
}

function luminance(color) {
  const nums = String(color).match(/[\d.]+/g);
  if (!nums || nums.length < 3) return 1;
  const rgb = nums.slice(0, 3).map((value) => {
    const s = Number(value) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a, b) {
  const left = luminance(a);
  const right = luminance(b);
  const hi = Math.max(left, right);
  const lo = Math.min(left, right);
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  const pages = await import(pathToFileURL(distPages).href);
  const ATTACK = '"><img src=x onerror=alert(1)>';
  const origin = 'https://mail.example.test';
  const nonce = 'test-nonce-serverpages';
  const csrf = 'csrf-token-value';
  const otherFound = {
    email: 'ada@icloud.com',
    host: 'imap.mail.me.com',
    port: '993',
    security: 'tls',
    user: 'ada@icloud.com',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: '587',
    helpUrl: 'https://support.apple.com/en-us/102654',
    helpLabel: "Apple's app-specific passwords",
    note: '',
    discoveredHost: 'imap.mail.me.com',
    discoveredSmtp: 'smtp.mail.me.com',
    serverKeepsSent: true,
    provider: 'icloud',
  };
  const fixtures = {
    setup: pages.setupPage(csrf, '', nonce, true),
    setupError: pages.setupPage(csrf, "The two passphrases don't match. Type them again.", nonce, false, 'confirm'),
    signin: pages.signInPage(csrf),
    signinWait: pages.signInPage(csrf, undefined, undefined, 'Too many tries. Wait about 12 minutes, then try again.'),
    connect: pages.connectHubPage({
      csrf, origin, googleReady: false, googleSaved: false, microsoftReady: false,
      microsoftDevice: false, microsoftSaved: false, nonce,
    }),
    connectGoogle: pages.connectHubPage({
      csrf, origin, googleReady: true, googleSaved: true, microsoftReady: false,
      microsoftDevice: false, microsoftSaved: false, nonce,
      accounts: [{ id: 'g1', email: 'ada@gmail.com', kind: 'gmail' }],
    }),
    connectOther: pages.connectHubPage({
      csrf, origin, googleReady: false, googleSaved: false, microsoftReady: false,
      microsoftDevice: false, microsoftSaved: false, nonce, other: otherFound,
    }),
    connectXss: pages.connectHubPage({
      csrf, origin, googleReady: true, googleSaved: true, microsoftReady: true,
      microsoftDevice: true, microsoftSaved: true, nonce,
      accounts: [{ id: 'xss', email: ATTACK, kind: 'gmail' }],
      other: { ...otherFound, email: ATTACK, host: ATTACK, user: ATTACK, note: ATTACK, helpUrl: '', helpLabel: '' },
      error: ATTACK,
    }),
    device: pages.microsoftDevicePage('ABCD-EFGH', 'https://microsoft.com/devicelogin', 5, nonce),
    consent: pages.consentPage(csrf, 'Claude', 'claude.ai', 'claude.ai'),
    connected: pages.connectedPage(csrf, 'ada@gmail.com', 'g1'),
    microsoftConnected: pages.microsoftConnectedPage(csrf, 'ada@outlook.com', 'm1'),
    message: pages.messagePage('Mailbox connected', 'This server will use ada@icloud.com. Nothing has been copied yet.'),
    signedIn: pages.signedInPage(true),
    signInFirst: pages.signInFirstPage('a mailbox'),
    microsoftStart: pages.microsoftStartPage(csrf),
  };

  const results = [];
  const ok = (name, pass, extra) => {
    results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + String(extra).slice(0, 240) : ''));
  };

  for (const [name, html] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(OUT, name + '.html'), html);
    ok(name + ' has no inline style attribute', !html.includes('style="'));
    ok(name + ' includes stylesheet', html.includes('<style>'));
  }
  ok('xss email stays text', fixtures.connectXss.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;') && !fixtures.connectXss.includes('<img'));

  const b = await chromium.launch();
  const viewports = [
    { name: '360', width: 360, height: 740 },
    { name: '390', width: 390, height: 844 },
    { name: '1280', width: 1280, height: 900 },
  ];
  const phone = new Set(['360', '390']);

  try {
    for (const [name, html] of Object.entries(fixtures)) {
      const file = path.join(OUT, name + '.html');
      for (const vp of viewports) {
        const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
        const pg = await ctx.newPage();
        await pg.goto('file://' + file);
        const metrics = await pg.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          font: getComputedStyle(document.body).fontFamily,
        }));
        ok(name + ' ' + vp.name + ' no sideways scroll', metrics.scrollWidth <= metrics.clientWidth + 1, metrics.scrollWidth + '>' + metrics.clientWidth);
        ok(name + ' ' + vp.name + ' not Times', !/times/i.test(metrics.font), metrics.font);
        const unlabeled = await pg.evaluate(() => {
          const inputs = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
          return inputs.filter((el) => {
            if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
            if (el.closest('label')) return false;
            if (el.getAttribute('aria-label')) return false;
            return true;
          }).map((el) => el.name || el.id || el.outerHTML.slice(0, 80));
        });
        ok(name + ' ' + vp.name + ' inputs labelled', unlabeled.length === 0, unlabeled.join(','));
        if (phone.has(vp.name)) {
          const short = await pg.evaluate(() => {
            const nodes = [...document.querySelectorAll('button, a')];
            return nodes.filter((el) => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && r.height < 44;
            }).map((el) => (el.textContent || '').trim().slice(0, 40) + ':' + Math.round(el.getBoundingClientRect().height));
          });
          ok(name + ' ' + vp.name + ' tap targets 44px', short.length === 0, short.join(','));
        }
        await ctx.close();
      }
    }

    const darkCtx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const dark = await darkCtx.newPage();
    await dark.goto('file://' + path.join(OUT, 'connect.html'));
    const darkColors = await dark.evaluate(() => {
      const body = getComputedStyle(document.body);
      return { bg: body.backgroundColor, fg: body.color };
    });
    ok('dark body background', luminance(darkColors.bg) < 0.3, darkColors.bg);
    ok('dark text contrast', contrast(darkColors.bg, darkColors.fg) >= 4.5, contrast(darkColors.bg, darkColors.fg).toFixed(2) + ' ' + darkColors.bg + ' ' + darkColors.fg);
    await darkCtx.close();

    const jsCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const jsPage = await jsCtx.newPage();
    await jsPage.goto('file://' + path.join(OUT, 'connect.html'));
    ok('copy buttons with JS', (await jsPage.$$('[data-copy]')).length >= 1);
    await jsCtx.close();

    const noJs = await b.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto('file://' + path.join(OUT, 'connect.html'));
    const selectable = await noJsPage.evaluate(() => {
      const el = document.querySelector('.copy-value, #google-redirect');
      if (!el) return false;
      const select = getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect;
      return select !== 'none';
    });
    ok('copy text selectable without JS', selectable);
    await noJs.close();
  } catch (error) {
    ok('harness', false, error && error.stack ? error.stack : error);
  }

  await b.close();
  const failed = results.filter((line) => line.startsWith('FAIL '));
  for (const line of results) console.log(line);
  console.log((results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.log('CRASH ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
