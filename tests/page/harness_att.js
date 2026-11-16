// Attachments open in the page (PDF via pdf.js, Save via downloads), links are clickable, and the Gmail signature
// is requested on send/draft. Runs against a native build and a Composio build.
// usage: node harness_att.js <native.html> <composio.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , NAT, GXB, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrapPage = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
const nat = wrapPage(NAT, 'nat.html'), gxp = wrapPage(GXB, 'gx.html');
const PDFDIR = path.join(__dirname, 'node_modules/pdfjs-dist/build');
const withDownloads = () => { const orig = window.claude.use; window.__saved = []; window.claude.use = async (n) => n === 'downloads' ? { save: async (r) => { window.__saved.push({ filename: r.filename, size: r.data && r.data.size, type: r.data && r.data.constructor && r.data.constructor.name }); return { status: 'saved' }; } } : orig(n); };
(async () => {
  const b = await chromium.launch(); const errs = []; const results = global.__r = [];
  const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function mk(file, opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(file + ': ' + e.message));
    await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (route) => {
      if (opts.blockPdf) return route.abort();
      const f = path.join(PDFDIR, route.request().url().split('/').pop()); route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) });
    });
    await pg.addInitScript(fake); if (opts.downloads) await pg.addInitScript(withDownloads);
    if (opts.sigOff) await pg.addInitScript(() => { localStorage.setItem('cm.features', JSON.stringify({ signature: false })); });
    await pg.goto('file://' + file); await pg.waitForTimeout(2000);
    return { ctx, pg };
  }
  const calls = (pg) => pg.evaluate(() => window.__calls);
  const closeToast = (pg) => pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // ---- native ----
  let { ctx, pg } = await mk(nat, { downloads: true });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  const links = await pg.$$eval('#reading .msg .body a', (as) => as.map((a) => [a.getAttribute('href'), a.target, a.rel]));
  ok('links in the plain view are clickable', links.some((l) => l[0] === 'https://www.linkedin.com/in/danaruiz-example/' && l[1] === '_blank' && /noopener/.test(l[2])), JSON.stringify(links));
  ok('every link opens in a new tab', links.length >= 2 && links.every((l) => l[1] === '_blank'));
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); ok('the Signature switch shows in the reply box', await pg.isVisible('.sigrow') && await pg.isChecked('#sigChk'));
  await pg.click('#replyMenuBtn'); await pg.click('[data-intent="yes"]'); await pg.waitForTimeout(1500);
  await pg.evaluate(() => { window.__calls = []; }); await pg.click('#saveDraftBtn'); await pg.waitForTimeout(600);
  const cd = (await calls(pg)).find((c) => c.tool === 'create_draft');
  ok('drafts ask Gmail to add the signature', !!cd && cd.input.includeSignature === true);
  await pg.click('.thread[data-id="t5"]'); await pg.waitForTimeout(3000); await closeToast(pg);
  const l5 = await pg.$$eval('#reading .msg .body a', (as) => as.map((a) => a.getAttribute('href')));
  ok('trailing text is not swallowed into a link', l5.includes('https://weeklybyte.example/unsubscribe?u=demo'), JSON.stringify(l5));
  ok('no script from the message runs or renders', !(await pg.innerHTML('#reading')).includes('<script'));

  await pg.click('.thread[data-id="t8"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  ok('attachment shows as a button', (await pg.textContent('#reading .attbtn')).includes('CW-2026-1142.pdf'));
  await pg.evaluate(() => { window.__calls = []; });
  await pg.click('#reading .attbtn'); await pg.waitForTimeout(3500);
  ok('viewer opens with the file name', (await pg.textContent('#modalTitle')) === 'CW-2026-1142.pdf');
  const meta = await pg.textContent('#attMeta');
  ok('viewer shows size, type and pages', /KB · pdf · 1 page/.test(meta), meta);
  const cv = await pg.$$eval('#attStage canvas', (cs) => cs.map((c) => [c.width, c.height]));
  ok('the PDF renders to a canvas', cv.length === 1 && cv[0][0] > 300 && cv[0][1] > 300, JSON.stringify(cv));
  const painted = await pg.$eval('#attStage canvas', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, 80).data; let blue = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 80) blue++; return blue; });
  ok('the PDF actually painted (blue header band)', painted > 1000, String(painted));
  ok('raw message fetched once through get_message', (await calls(pg)).filter((c) => c.tool === 'get_message' && c.input.messageFormat === 'RAW').length === 1);
  ok('Save is offered when downloads are available', await pg.isVisible('#attSave'));
  await pg.click('#attSave'); await pg.waitForTimeout(300);
  const sv = await pg.evaluate(() => window.__saved);
  ok('Save hands over the PDF as a Blob with its name', sv.length === 1 && sv[0].filename === 'CW-2026-1142.pdf' && sv[0].size === 2073 && sv[0].type === 'Blob', JSON.stringify(sv));
  ok('Open in Gmail is in the viewer', (await pg.$$('#modalBody a[target="_blank"]')).length >= 1);
  await pg.screenshot({ path: path.join(OUT, 'att-native.png') });
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  ok('Escape closes the viewer', await pg.evaluate(() => document.getElementById('modalBack').hidden));
  await ctx.close();

  // ---- no downloads capability, pdf.js blocked ----
  ({ ctx, pg } = await mk(nat, { blockPdf: true }));
  await pg.click('.thread[data-id="t8"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  await pg.click('#reading .attbtn'); await pg.waitForTimeout(2500);
  ok('without pdf.js the viewer says so and points to Gmail', (await pg.textContent('#attStage')).includes("Couldn't open the PDF viewer"));
  ok('no Save button without the downloads capability', !(await pg.isVisible('#attSave')));
  await ctx.close();

  // ---- signature off ----
  ({ ctx, pg } = await mk(nat, { sigOff: true }));
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); ok('the Signature switch is hidden when the skill is off', !(await pg.isVisible('.sigrow')));
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); await pg.fill('#body', 'Yes. Alex'); await pg.evaluate(() => { window.__calls = []; }); await pg.click('#saveDraftBtn'); await pg.waitForTimeout(600);
  const cd2 = (await calls(pg)).find((c) => c.tool === 'create_draft');
  ok('signature off: drafts do not ask for it', !!cd2 && cd2.input.includeSignature === false);
  await ctx.close();

  // ---- Composio ----
  ({ ctx, pg } = await mk(gxp, { downloads: true }));
  await pg.click('.thread[data-id="t8"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  ok('Composio: attachment button from attachmentList', (await pg.textContent('#reading .attbtn')).includes('CW-2026-1142.pdf'));
  await pg.evaluate(() => { window.__calls = []; });
  await pg.click('#reading .attbtn'); await pg.waitForTimeout(3500);
  const gcalls = (await calls(pg)).filter((c) => c.server === 'Composio').map((c) => c.input.tools[0]);
  ok('Composio: raw source fetched with format raw', gcalls.some((t) => t.tool_slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID' && t.arguments.format === 'raw' && t.arguments.message_id === 'mt8'), JSON.stringify(gcalls));
  ok('Composio: the PDF renders', (await pg.$$('#attStage canvas')).length === 1 && /1 page/.test(await pg.textContent('#attMeta')));
  await pg.keyboard.press('Escape');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(3500); await closeToast(pg);
  await pg.evaluate(() => { const c = document.getElementById('compose'); if (c.classList.contains('folded')) document.getElementById('composeTog').click(); }); await pg.fill('#body', 'Yes. Alex'); await pg.evaluate(() => { window.__calls = []; }); await pg.click('#saveDraftBtn'); await pg.waitForTimeout(600);
  const gd = (await calls(pg)).filter((c) => c.server === 'Composio').map((c) => c.input.tools[0]).find((t) => t.tool_slug === 'GMAIL_CREATE_EMAIL_DRAFT');
  ok('Composio: drafts ask Gmail for the signature', !!gd && gd.arguments.include_signature === true, JSON.stringify(gd && gd.arguments));
  ok('Composio: links clickable too', (await pg.$$('#reading .msg .body a[target="_blank"]')).length >= 2);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(results.join('\n'));
  const f = results.filter((x) => x.startsWith('FAIL')).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.log((global.__r || []).join('\n')); console.log('CRASH', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(1); });
