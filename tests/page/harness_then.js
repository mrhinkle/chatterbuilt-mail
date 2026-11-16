// Then: plain-words follow-ups in the reply box that run after the reply sends (Slack draft, task, reminder, actions).
// usage: node harness_then.js <demo.html> <outdir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const fake = require(require('path').resolve(__dirname, '../../scripts/demo/fake.js'));
const [, , DEMO, OUT] = process.argv; fs.mkdirSync(OUT, { recursive: true });
const wrap = (src, name) => { const p = path.join(OUT, name); fs.writeFileSync(p, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>'); return p; };
(async () => {
  const b = await chromium.launch(); const errs = []; const res = [];
  global.results_dump = () => res.join('\n'); const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(fake);
  await pg.goto('file://' + wrap(DEMO, 'then.html')); await pg.waitForTimeout(2400);
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const calls = () => pg.evaluate(() => window.__calls.map((c) => ({ server: c.server, tool: c.tool, input: c.input })));
  const clear = () => pg.evaluate(() => { window.__calls = []; });
  const unfold = async () => { if (await pg.evaluate(() => document.querySelector('.compose').classList.contains('folded'))) { await pg.click('#composeTog'); await pg.waitForTimeout(200); } };
  const WRITES = /slack_send_message_draft|ASANA|SLACK_SEND|label_thread/;
  const writes = async () => (await calls()).filter((c) => WRITES.test(c.tool + ' ' + JSON.stringify(c.input || {})));

  await pg.click('.thread[data-id="t1"]'); await pg.waitForTimeout(2200); await unfold();
  ok('the reply box has a Then line that says what it can do', await pg.isVisible('#thenIn') && /Runs after it sends.*Slack someone/.test(await pg.textContent('#thenNote')), await pg.textContent('#thenNote'));
  await pg.fill('#body', 'Dana, yes to gold. Deck today.');
  await pg.fill('#thenIn', 'Slack Sam to hold the big room, and add a task to send the deck');
  await clear(); await pg.click('#sendBtn'); await pg.waitForTimeout(2200);
  const plan = await pg.textContent('#thenPlan');
  ok('Send lists the follow-ups in the confirmation first', /Then/.test(plan) && /Slack draft to Sam Ortiz/.test(plan) && /Send Dana the sponsor deck/.test(plan), plan);
  ok('nothing runs before you confirm', (await writes()).length === 0, JSON.stringify(await writes()).slice(0, 200));
  await clear(); await pg.click('#confirmSend'); await pg.waitForTimeout(3200);
  let cs = await calls();
  const reply = cs.findIndex((c) => c.tool === 'reply'), draft = cs.findIndex((c) => c.tool === 'slack_send_message_draft'), task = cs.findIndex((c) => /ASANA_CREATE_A_TASK/.test(JSON.stringify(c.input || {})));
  ok('after the reply sends, the Slack message is left as a draft for Sam', reply >= 0 && draft > reply && /hold the big room/.test(cs[draft].input.message) && /mail\.google\.com/.test(cs[draft].input.message), JSON.stringify(cs[draft] && cs[draft].input).slice(0, 200));
  ok('…and the task is added', task > reply, cs.map((c) => c.tool).join(','));
  ok('it never posts to Slack directly', !cs.some((c) => c.tool === 'slack_send_message' || /SLACK_SEND_MESSAGE/.test(JSON.stringify(c.input || {}))));
  const note = await pg.textContent('.toast');
  ok('the sent note says what happened', /Slack draft for Sam Ortiz saved/.test(note) && /task added/.test(note), note);
  ok('the Then line clears after it runs', (await pg.inputValue('#thenIn')) === '');

  // something it can't do
  await unfold();
  await pg.fill('#body', 'Thanks!'); await pg.fill('#thenIn', 'order pizza for the team');
  await pg.click('#sendBtn'); await pg.waitForTimeout(2200);
  ok('anything it can\'t do is named before you send', /Can't do: order pizza/.test(await pg.textContent('#thenPlan')), await pg.textContent('#thenPlan'));
  await pg.click('#cancelSend');
  // editing the Then line closes a stale confirmation
  await pg.click('#sendBtn'); await pg.waitForTimeout(1500); await pg.fill('#thenIn', 'remind me Friday'); await pg.waitForTimeout(100);
  ok('changing the Then line closes the confirmation so it can\'t run a stale plan', !(await pg.isVisible('#confirmBox')));
  // no Then text: nothing extra
  await pg.fill('#thenIn', ''); await clear(); await pg.click('#sendBtn'); await pg.waitForTimeout(1800); await pg.click('#confirmSend'); await pg.waitForTimeout(2200);
  cs = await calls();
  ok('with the Then line empty, only the reply goes', cs.some((c) => c.tool === 'reply') && !cs.some((c) => /slack_|ASANA/.test(c.tool + JSON.stringify(c.input || {}))) && !cs.some((c) => /follow-up steps/.test(JSON.stringify(c.input || {}))));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(res.join('\n')); console.log('PASSED ' + res.filter((x) => x.startsWith('PASS')).length + ' of ' + res.length);
})().catch((e) => { console.log(results_dump()); console.log('CRASH', e.message.slice(0, 600)); process.exit(1); });
