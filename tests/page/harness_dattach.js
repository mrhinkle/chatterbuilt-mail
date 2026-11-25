// Attachments in the Drafts editor: a draft with files opens editable, shows its files, keeps them (and the pictures
// inside it) on Save, and takes new ones; both Gmail paths. usage: node harness_dattach.js <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
const NOTE = path.join(OUT, 'notes.txt'); fs.writeFileSync(NOTE, 'Agenda for Tuesday\n');
const noteB64 = Buffer.from('Agenda for Tuesday\n').toString('base64');
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name, init) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake); await pg.addInitScript(() => { window.__attDraft = true; });
    await pg.addInitScript(() => { const u = window.claude.use; window.claude.use = async (n) => { const x = await u(n); if (n !== 'sample' || !x) return x; const f = async (inp, o) => { const p = typeof inp === 'string' ? inp : JSON.stringify(inp); if (p.includes('Rewrite it: Shorter')) return { text: 'Riley, deck attached. Alex' }; if (p.includes('You review an email draft before')) return { text: '{}' }; return x(inp, o); }; Object.assign(f, x); return f; }; });
    if (init) await pg.addInitScript(init);
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const chips = (pg) => pg.$$eval('#dFiles .dfile .dfn', (x) => x.map((e) => e.textContent));
  const gxCalls = async (pg, slug) => (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').flatMap((c) => c.input.tools || []).filter((t) => t.tool_slug === slug);
  const openD = async (pg, id) => { await pg.click('.chip[data-key="drafts"]'); await pg.waitForTimeout(1800); await pg.click('#list .draftrow[data-did="' + id + '"]'); await pg.waitForTimeout(2600); };

  // ---------- Gmail connector ----------
  let pg = await open(DEMO, 'native');
  await openD(pg, 'd2');
  ok('a draft with attachments opens editable, with Save on', (await pg.getAttribute('#dEditor', 'contenteditable')) === 'true' && await pg.isEnabled('#dSave') && !/edit it in Gmail/.test(await pg.textContent('#reading')));
  ok('its file shows at the bottom of the sheet; the logo and spacer inside the email aren\'t listed', JSON.stringify(await chips(pg)) === '["deck.pdf"]', JSON.stringify(await chips(pg)));
  ok('the paperclip is in the toolbar', await pg.isVisible('.rtbar [data-attach]'));
  // revise works on it
  await pg.click('[data-drev="Shorter"]'); await pg.waitForTimeout(900);
  ok('Revise works on a draft with attachments', (await pg.textContent('#dEditor')).trim() === 'Riley, deck attached. Alex');
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(900);
  let u = (await calls(pg)).find((c) => c.tool === 'update_draft'); let at = (u && u.input.attachments) || [];
  ok('Save sends the file and the logo again (Gmail would drop them otherwise), not the spacer', at.length === 2 && at[0].filename === 'logo.png' && at[0].inline === true && at[0].content === 'iVBORw0KGgoAAAANSUhEUg==' && at[1].filename === 'deck.pdf' && !at[1].inline && at[1].content === 'JVBERi0xLjQKJcfsj6IK', JSON.stringify(at.map((a) => [a.filename, a.inline, (a.content || '').length])));
  const h = (u && u.input.htmlBody) || '';
  ok('…and the logo stays in place as cid:0; the spacer is gone', /src="cid:0"/.test(h) && !/cid:logo1|cid:spacer1/.test(h) && (h.match(/<img/g) || []).length === 1, (h.match(/<img[^>]*>/g) || []).join(' '));
  // remove the file
  await pg.click('#dFiles [data-dfx]'); await pg.waitForTimeout(150);
  ok('× takes the file off', (await chips(pg)).length === 0);
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(900);
  u = (await calls(pg)).find((c) => c.tool === 'update_draft'); at = (u && u.input.attachments) || [];
  ok('…and Save leaves it out, keeping the logo', at.length === 1 && at[0].filename === 'logo.png', JSON.stringify(at.map((a) => a.filename)));
  // add a file
  await pg.setInputFiles('#dFileIn', NOTE); await pg.waitForTimeout(600);
  ok('Attach adds a file to the list', JSON.stringify(await chips(pg)) === '["notes.txt"]', JSON.stringify(await chips(pg)));
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(900);
  u = (await calls(pg)).find((c) => c.tool === 'update_draft'); at = (u && u.input.attachments) || [];
  ok('…and Save sends it with its content', at.some((a) => a.filename === 'notes.txt' && a.content === noteB64 && a.mimeType === 'text/plain'), JSON.stringify(at.map((a) => a.filename)));
  await pg.context().close();

  // a draft whose files can't be read: Save stays off, nothing is written
  pg = await open(DEMO, 'nativefail', () => { window.__failRaw = true; });
  await openD(pg, 'd2');
  ok('if the draft\'s files can\'t be read, it says so and Save is off', !(await pg.isEnabled('#dSave')) && /Couldn't read this draft's attachments/.test(await pg.textContent('#dFiles')));
  await clear(pg); await pg.evaluate(() => document.getElementById('dSave').click()); await pg.waitForTimeout(600);
  ok('…so nothing can drop them', !(await calls(pg)).some((c) => c.tool === 'update_draft'));
  await pg.context().close();

  // a draft without attachments: no file row, no extra read
  pg = await open(DEMO, 'plain');
  await clear(pg); await openD(pg, 'd3');
  ok('a draft with no attachments shows no file row and reads nothing extra', await pg.isHidden('#dFiles') && !(await calls(pg)).some((c) => c.tool === 'get_draft' && c.input.messageFormat === 'RAW'));
  await pg.context().close();

  // ---------- Composio ----------
  pg = await open(GXP, 'gx');
  await openD(pg, 'd1');
  ok('Composio: the file shows; the logo inside the email isn\'t listed', JSON.stringify(await chips(pg)) === '["deck.pdf"]', JSON.stringify(await chips(pg)));
  await pg.click('#dEditor'); await pg.keyboard.press('End'); await pg.keyboard.type(' Thanks!');
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(900);
  ok('Composio: Save first says the logo can\'t be kept, and writes nothing yet', /drops the picture inside this email \(logo\.png\)/.test(await pg.textContent('#dNote')) && (await gxCalls(pg, 'GMAIL_UPDATE_DRAFT')).length === 0, await pg.textContent('#dNote'));
  await pg.click('#dPicsOk'); await pg.waitForTimeout(1600);
  let up = await gxCalls(pg, 'GMAIL_UPDATE_DRAFT'); const ga = await gxCalls(pg, 'GMAIL_GET_ATTACHMENT');
  ok('…then Composio copies the file from the draft and the save carries it', ga.length === 1 && ga[0].arguments.attachment_id === 'A1' && ga[0].arguments.message_id === 'md1b' && up.length === 1 && JSON.stringify(up[0].arguments.attachment) === JSON.stringify([{ name: 'deck.pdf', mimetype: 'application/pdf', s3key: 'project_scope/demo/files/A1.bin' }]), JSON.stringify(up[0] && up[0].arguments.attachment));
  ok('…with no broken picture left in the email', !/cid:/.test((up[0] && up[0].arguments.body) || ''));
  ok('…and it reads the draft again for the files\' new ids', (await gxCalls(pg, 'GMAIL_GET_DRAFT')).length >= 1);
  // a new file through Composio
  await pg.setInputFiles('#dFileIn', NOTE); await pg.waitForTimeout(600);
  await clear(pg); await pg.click('#dSave'); await pg.waitForTimeout(1800);
  up = await gxCalls(pg, 'GMAIL_UPDATE_DRAFT'); const ups = await pg.evaluate(() => window.__uploads || []);
  const wb = (await calls(pg)).filter((c) => c.tool === 'COMPOSIO_REMOTE_WORKBENCH');
  ok('Composio: a new file is uploaded through the workbench, in pieces, then attached', wb.length === 1 && ups.length === 1 && ups[0].name === 'notes.txt' && ups[0].b64 === noteB64 && up.length === 1 && JSON.stringify((up[0].arguments.attachment || []).map((a) => a.name + '=' + a.s3key)) === JSON.stringify(['deck.pdf=project_scope/demo/files/S0.bin', 'notes.txt=session_scope/demo/files/notes.txt']), JSON.stringify(up[0] && up[0].arguments.attachment));
  await pg.context().close();

  // Composio: a failed upload writes nothing
  pg = await open(GXP, 'gxfail', () => { window.__failUpload = true; });
  await openD(pg, 'd1');
  await pg.setInputFiles('#dFileIn', NOTE); await pg.waitForTimeout(600);
  await pg.evaluate(() => { window.__calls = []; }); await pg.click('#dSave'); await pg.waitForTimeout(600);
  if (await pg.$('#dPicsOk')) { await pg.click('#dPicsOk'); await pg.waitForTimeout(1600); }
  ok('Composio: if a file can\'t be uploaded, the draft isn\'t touched and it says so', (await gxCalls(pg, 'GMAIL_UPDATE_DRAFT')).length === 0 && /couldn't upload notes\.txt/i.test(await pg.textContent('#dNote')), await pg.textContent('#dNote'));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
