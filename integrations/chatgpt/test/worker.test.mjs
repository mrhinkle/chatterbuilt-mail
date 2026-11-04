import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker/index.js';

const sample = () => ({ accounts: [{ id: 'example-work', label: 'Work', email: 'owner@example.com' }], messages: [{ accountId: 'example-work', messageId: 'message-1', threadId: 'thread-1', from: 'Dana <dana@example.com>', subject: 'The workshop', snippet: 'Can we meet Wednesday?', date: '2026-11-04T12:00:00Z', unread: true }], fetchedAt: '2026-11-04T13:00:00Z', hasMore: true });
async function invoke(method, params, authenticated = true) {
  const response = await worker.fetch(new Request('https://mail.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { 'oai-authenticated-user-id': 'test-owner' } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  assert.match(response.headers.get('cache-control'), /no-store/);
  return response.json();
}
test('MCP discovery, initialization, tool metadata and UI resource agree', async () => {
  assert.deepEqual((await invoke('server/discover')).result.supportedVersions, ['2026-07-28']);
  const initialized = (await invoke('initialize', { protocolVersion: '2025-06-18' })).result;
  assert.equal(initialized.protocolVersion, '2025-06-18');
  const tools = (await invoke('tools/list')).result.tools;
  assert.equal(tools.length, 2);
  assert.ok(tools.every(t => t.annotations.readOnlyHint));
  const uri = tools[1]._meta.ui.resourceUri;
  const resource = (await invoke('resources/read', { uri })).result.contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.text, /id="reply"/);
  const script = resource.text.match(/<script>([\s\S]*)<\/script>/)[1];
  new vm.Script(script);
});
test('mail rendering requires an authenticated caller', async () => {
  const result = await invoke('tools/call', { name: 'show_mail', arguments: sample() }, false);
  assert.equal(result.error.code, -32001);
});
test('renders the exact sample without storing it or injecting it into HTML', async () => {
  const view = sample(); view.messages[0].subject = '</script><img src=x onerror=alert(1)>';
  const rendered = (await invoke('tools/call', { name: 'show_mail', arguments: view })).result;
  assert.equal(rendered.structuredContent.messages[0].subject, view.messages[0].subject);
  const page = await (await worker.fetch(new Request('https://mail.example/'))).text();
  assert.ok(!page.includes(view.messages[0].subject));
  const fresh = (await invoke('tools/call', { name: 'open_mail', arguments: {} })).result;
  assert.deepEqual(fresh.structuredContent.messages, []);
});
test('rejects cross-account messages, duplicate accounts and cross-thread replies', async () => {
  const wrongAccount = sample(); wrongAccount.messages[0].accountId = 'not-present';
  const duplicate = sample(); duplicate.accounts.push(duplicate.accounts[0]);
  const wrongReply = sample();
  wrongReply.selected = { accountId: 'example-work', threadId: 'thread-1', subject: 'The workshop', messages: [] };
  wrongReply.draft = { accountId: 'example-work', threadId: 'thread-2', to: 'dana@example.com', subject: 'Re: The workshop', body: 'Wednesday works.' };
  for (const arguments_ of [wrongAccount, duplicate, wrongReply]) {
    const result = (await invoke('tools/call', { name: 'show_mail', arguments: arguments_ })).result;
    assert.equal(result.isError, true);
    assert.ok(!result.structuredContent);
  }
});
test('rejects oversized lists, invalid timestamps, unknown fields and write tools', async () => {
  const oversized = sample(); oversized.messages = Array(51).fill(oversized.messages[0]);
  const badDate = sample(); badDate.fetchedAt = 'yesterday';
  const extra = sample(); extra.token = 'not-a-real-secret';
  for (const args of [oversized, badDate, extra]) assert.equal((await invoke('tools/call', { name: 'show_mail', arguments: args })).result.isError, true);
  assert.equal((await invoke('tools/call', { name: 'send_email', arguments: {} })).error.code, -32601);
});
test('no-store errors and invalid RPC input', async () => {
  const malformed = await worker.fetch(new Request('https://mail.example/mcp', { method: 'POST', body: '{' }));
  assert.equal((await malformed.json()).error.code, -32700);
  const get = await worker.fetch(new Request('https://mail.example/mcp'));
  assert.equal(get.status, 405);
});
export { sample };
