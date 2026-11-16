// Cc and Bcc on replies, the address book (Google Contacts through Composio), enrichment with any app,
// setup requests when something isn't set up, and Route's built-in Slack message.
// usage: node harness_cc.js <cc.html> <demo.html> <gx.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , CC, DEMO, GXP, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  async function open(src, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.addInitScript(fake);
    await pg.addInitScript(() => { const u = window.claude.use; window.__prompts = []; window.claude.use = async (n) => { const x = await u(n); if (n !== 'sample' || !x) return x; const f = async (inp, o) => { window.__prompts.push(typeof inp === 'string' ? inp : JSON.stringify(inp)); return x(inp, o); }; Object.assign(f, x); return f; }; });
    await pg.goto('file://' + wrap(src, name + '.html')); await pg.waitForTimeout(2200);
    await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    return pg;
  }
  const calls = (pg) => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = (pg) => pg.evaluate(() => { window.__calls = []; });
  const slugs = (cs) => cs.filter((c) => c.tool === 'COMPOSIO_MULTI_EXECUTE_TOOL').map((c) => c.input.tools[0]);

  // ---------- Cc / Bcc on the native Gmail path ----------
  let pg = await open(CC, 'cc');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  await pg.click('#composeTog'); await pg.waitForTimeout(150);
  ok('the reply box says who it goes to', (await pg.textContent('#toLine')) === 'To Dana Ruiz', await pg.textContent('#toLine'));
  ok('Cc and Bcc start closed', !(await pg.isVisible('#ccRow')) && !(await pg.isVisible('#bccRow')) && (await pg.isVisible('#ccTog')));
  await pg.click('#ccTog'); await pg.waitForTimeout(100);
  ok('Cc opens a field with focus', (await pg.isVisible('#ccRow')) && (await pg.evaluate(() => document.activeElement.id)) === 'ccIn');
  await pg.type('#ccIn', 'sam', { delay: 30 }); await pg.waitForTimeout(900);
  const sug = await pg.$$eval('#ccSug .sg', (x) => x.map((e) => e.textContent));
  ok('typing suggests people from the address book', sug.some((t) => t.includes('Sam Ortiz') && t.includes('sam@riveralabs.example') && t.includes('Google Contacts')), sug.join(' | '));
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  ok('Enter picks the suggestion as a chip', (await pg.$$eval('#ccRow .rchip', (x) => x.map((e) => e.textContent))).join() === 'Sam Ortiz×' && (await pg.inputValue('#ccIn')) === '');
  await pg.type('#ccIn', 'ops@riveralabs.example,', { delay: 10 }); await pg.waitForTimeout(150);
  ok('a typed address and a comma make a chip', (await pg.$$('#ccRow .rchip')).length === 2);
  await pg.type('#ccIn', 'not-an-email'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  ok('a bad address is refused, not added', (await pg.$$('#ccRow .rchip')).length === 2 && /doesn't look like an email/.test(await pg.textContent('#composeNote')));
  await pg.fill('#ccIn', '');
  ok('the toggle counts them', (await pg.textContent('#ccTog')).trim() === 'Cc 2');
  await pg.click('#bccTog'); await pg.type('#bccIn', 'Taylor'); await pg.waitForTimeout(900); await pg.click('#bccSug .sg'); await pg.waitForTimeout(150);
  ok('clicking a suggestion adds it to Bcc', (await pg.$$eval('#bccRow .rchip', (x) => x.map((e) => e.getAttribute('title')))).join() === 'taylor@riveralabs.example');
  await pg.click('#ccRow .rchip button[aria-label="Remove ops@riveralabs.example"]'); await pg.waitForTimeout(100);
  ok('× removes a chip', (await pg.$$('#ccRow .rchip')).length === 1);
  await pg.fill('#body', 'Yes to gold. Deck today.');
  await clear(pg); await pg.click('#sendBtn'); await pg.waitForTimeout(1600);
  ok('the send check names the cc and bcc', /cc Sam Ortiz, bcc Taylor Brooks/.test(await pg.textContent('#confirmText')), await pg.textContent('#confirmText'));
  await clear(pg); await pg.click('#confirmSend'); await pg.waitForTimeout(1400);
  let rp = (await calls(pg)).find((c) => c.tool === 'reply');
  ok('reply carries cc and bcc', !!rp && JSON.stringify(rp.input.cc) === '["sam@riveralabs.example"]' && JSON.stringify(rp.input.bcc) === '["taylor@riveralabs.example"]', JSON.stringify(rp && rp.input));
  ok('after sending, the chips clear', (await pg.$$('.rchip')).length === 0 && !(await pg.isVisible('#ccRow')));

  // ---------- address book + enrichment ----------
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(1800);
  await clear(pg); await pg.click('#contactBtn'); await pg.waitForTimeout(3200);
  ok('Save goes to Google Contacts', (await pg.textContent('#cSave')).trim() === 'Save to Google Contacts');
  ok('Change address book… is there, the picker is not', (await pg.isVisible('#cBookChange')) && !(await pg.$('#cBook')));
  ok('the duplicate check searched Google Contacts', slugs(await calls(pg)).some((t) => t.tool_slug === 'GOOGLECONTACTS_SEARCH_CONTACTS' && t.arguments.query === 'dana@acmerobotics.example'));
  ok('How we met is filled from your first thread', (await pg.inputValue('#cMet')).startsWith('Met at the fall meetup'));
  await clear(pg); await pg.click('#cEnrich'); await pg.waitForTimeout(2200);
  const en = slugs(await calls(pg)).find((t) => t.tool_slug === 'APOLLO_PEOPLE_ENRICHMENT');
  ok('Enrich with Apollo calls the configured action with their email', !!en && en.arguments.email === 'dana@acmerobotics.example' && en.arguments.domain === 'acmerobotics.example', JSON.stringify(en));
  ok('and fills Background', (await pg.inputValue('#cBackground')).includes('Fieldline Systems') && /Apollo filled/.test(await pg.textContent('#cNote')), await pg.textContent('#cNote'));
  await pg.fill('#cNotes', 'Wants a speaking slot for their CTO.');
  await clear(pg); await pg.click('#cSave'); await pg.waitForTimeout(1200);
  const cr = slugs(await calls(pg)).find((t) => t.tool_slug === 'GOOGLECONTACTS_CREATE_CONTACT');
  const a = cr ? cr.arguments : {}; const ud = (a.userDefined || []).map((x) => x.key + '=' + x.value.slice(0, 20));
  ok('creates the contact with name, work email and job', !!cr && a.names[0].givenName === 'Dana' && a.names[0].familyName === 'Ruiz' && a.emailAddresses[0].value === 'dana@acmerobotics.example' && a.organizations[0].name === 'Acme Robotics' && a.organizations[0].title === 'VP Marketing', JSON.stringify(a).slice(0, 300));
  ok('How we met and Background become custom fields', ud.some((x) => x.startsWith('How we met=Met at the fall')) && ud.some((x) => x.startsWith('Background=VP Marketing at Ac')) && ud.some((x) => x === 'Added by=Chatterbuilt Mail'), ud.join(' | '));
  ok('Notes go to the Notes field, first contact is a dated event', (a.biographies || [])[0] && a.biographies[0].value === 'Wants a speaking slot for their CTO.' && (a.events || [])[0] && a.events[0].type === 'First contact' && a.events[0].date.year > 2000, JSON.stringify([a.biographies, a.events]));
  ok('LinkedIn lands as a labeled link', (a.urls || []).some((u) => u.type === 'LinkedIn' && /linkedin\.com\/in\//.test(u.value)));
  ok('toast links to the new contact', /Added <strong>Dana Ruiz<\/strong> to Google Contacts/.test(await pg.innerHTML('.toast')) && (await pg.getAttribute('.toast a', 'href')) === 'https://contacts.google.com/person/c4242424242');
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // ---------- Route: Slack message ----------
  await pg.click('.thread[data-id="t2"]'); await pg.waitForTimeout(2200);
  await pg.click('#threadMoreBtn').catch(() => {}); await pg.waitForTimeout(150);
  await pg.evaluate(() => document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; }));
  await pg.click('#routeBtn'); await pg.waitForTimeout(2200);
  const labels = await pg.$$eval('#modalBody .mitem.rt .t', (x) => x.map((e) => e.textContent));
  ok('Route offers Message someone in Slack', labels.includes('Message someone in Slack'), labels.join(' | '));
  const si = labels.indexOf('Message someone in Slack');
  await pg.evaluate((i) => { document.querySelectorAll('[data-rt]').forEach((c) => { c.checked = +c.dataset.rt === i; }); document.querySelector('[data-rf="' + i + '"][data-k="to"]').value = 'Sam Ortiz'; document.querySelector('[data-rf="' + i + '"][data-k="message"]').value = 'Can you set up the venue walkthrough?'; }, si);
  await clear(pg); await pg.click('#rtApply'); await pg.waitForTimeout(1200);
  const sc = (await calls(pg)).filter((c) => c.server === 'Slack');
  ok('it finds the person, then leaves a draft (never sends)', sc.length === 2 && sc[0].tool === 'slack_search_users' && JSON.stringify(sc[0].input.keywords) === '["Sam","Ortiz"]' && sc[1].tool === 'slack_send_message_draft' && sc[1].input.channel_id === 'U07SAMORTIZ' && sc[1].input.message.startsWith('Can you set up the venue walkthrough?') && /mail\.google\.com|viewUrl|http/.test(sc[1].input.message), JSON.stringify(sc));
  ok('no Slack send tool is ever called', !sc.some((c) => c.tool === 'slack_send_message'));
  await pg.click('.rtadd summary'); await pg.fill('#rtCustom', 'log sponsor emails as deals in HubSpot'); await pg.click('[data-setup="action"]'); await pg.waitForTimeout(300);
  let clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('a custom action becomes a setup request for Claude', clip.includes('chatterbuilt-mail-setup') && clip.includes('Add a Route action: log sponsor emails as deals in HubSpot'), clip.slice(0, 160));
  await pg.context().close();

  // ---------- Google Contacts not connected yet ----------
  pg = await open(CC, 'ccdown'); await pg.evaluate(() => { window.__gcDown = true; });
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  await clear(pg); await pg.click('#contactBtn'); await pg.waitForTimeout(3000);
  ok('when Google Contacts is not connected, Save gives way to the address-book picker', !(await pg.$('#cSave')) && (await pg.isVisible('#cBook')) && /Google Contacts isn't connected yet/.test(await pg.textContent('#cBook')) && (await pg.getAttribute('#cBook [data-book="google"]', 'aria-pressed')) === 'true', await pg.textContent('#cBook'));
  ok('Set it up in Claude opens a new chat with the Google Contacts request', ((await pg.getAttribute('#cBookGo', 'href')) || '').startsWith('https://claude.ai/new?q=') && decodeURIComponent((await pg.getAttribute('#cBookGo', 'href')).split('q=')[1]).includes('Google Contacts toolkit') && (await pg.getAttribute('#cBookGo', 'target')) === '_blank');
  ok('and nothing was written', !slugs(await calls(pg)).some((t) => t.tool_slug === 'GOOGLECONTACTS_CREATE_CONTACT'));
  await pg.context().close();

  // ---------- nothing set up: setup requests ----------
  pg = await open(DEMO, 'demo');
  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200);
  await pg.click('#contactBtn'); await pg.waitForTimeout(2500);
  ok('with no enrichment app, the button offers setup', await pg.isVisible('[data-setup="enrich"]'));
  ok('with no address book, the dialog opens with the picker and vCard', !(await pg.$('#cSave')) && (await pg.isVisible('#cBook')) && /Contacts aren't connected yet/.test(await pg.textContent('#cBook')) && (await pg.isVisible('#cVcard')));
  await pg.click('#cBook [data-book="notion"]'); await pg.waitForTimeout(100);
  ok('picking Notion rewrites the request and remembers it', decodeURIComponent((await pg.getAttribute('#cBookGo', 'href')).split('q=')[1]).includes('Notion database') && (await pg.evaluate(() => localStorage.getItem('cm.bookPref'))) === 'notion');
  await pg.click('#cBook [data-book="other"]'); await pg.fill('#cBookApp', 'Attio'); await pg.waitForTimeout(100);
  ok('Something else asks which app and names it', decodeURIComponent((await pg.getAttribute('#cBookGo', 'href')).split('q=')[1]).includes('Save contacts to Attio'));
  await pg.click('#cBook [data-book="google"]');
  await pg.click('[data-setup="enrich"]'); await pg.waitForTimeout(300);
  clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('Set up enrichment copies a request naming Clay, Apollo and others', clip.startsWith('Run chatterbuilt-mail-setup') && /Clay, Apollo, People Data Labs/.test(clip) && /Copied/.test(await pg.textContent('#cNote')), clip.slice(0, 120));
  await pg.click('#cBookCopy'); await pg.waitForTimeout(300);
  clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('Copy the request copies the same request', clip.startsWith('Run chatterbuilt-mail-setup') && /Google Contacts toolkit/.test(clip) && /republish my copy/.test(clip), clip.slice(0, 120));
  ok('Set up enrichment is a link to a new Claude chat', ((await pg.getAttribute('[data-setup-link="enrich"]', 'href')) || '').startsWith('https://claude.ai/new?q='));
  await pg.context().close();

  // ---------- Composio Gmail path ----------
  pg = await open(GXP, 'gx');
  const first = await pg.$eval('.thread', (e) => e.dataset.id);
  await pg.click('.thread[data-id="' + first + '"]'); await pg.waitForTimeout(2600);
  await pg.click('#composeTog').catch(() => {}); await pg.waitForTimeout(150);
  if (await pg.evaluate(() => document.getElementById('compose').classList.contains('folded'))) { await pg.click('#composeTog'); await pg.waitForTimeout(150); }
  await pg.click('#ccTog'); await pg.type('#ccIn', 'cc1@example.org,'); await pg.click('#bccTog'); await pg.type('#bccIn', 'bcc1@example.org,'); await pg.waitForTimeout(100);
  await pg.fill('#body', 'Thanks, will do.');
  await pg.click('#sendBtn'); await pg.waitForTimeout(1600); await clear(pg); await pg.click('#confirmSend'); await pg.waitForTimeout(2200);
  const gr = slugs(await calls(pg)).find((t) => /GMAIL_REPLY_TO_THREAD|GMAIL_SEND_EMAIL/.test(t.tool_slug));
  ok('through Composio, the reply carries cc and bcc', !!gr && JSON.stringify(gr.arguments.cc) === '["cc1@example.org"]' && JSON.stringify(gr.arguments.bcc) === '["bcc1@example.org"]', JSON.stringify(gr));
  await pg.context().close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
