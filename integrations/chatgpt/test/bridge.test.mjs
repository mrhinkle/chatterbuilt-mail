import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker/index.js';

// Run the shipped browser script with a small DOM double and synthetic host messages.
async function panel(referrer = 'https://host.example/conversation', openai) {
  const elements = new Map(), listeners = new Map(), sent = [];
  const element = () => ({ value: '', checked: true, children: [], textContent: '',
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; } });
  const document = { referrer, createElement: element, getElementById(id) {
    if (!elements.has(id)) elements.set(id, element()); return elements.get(id);
  } };
  const parent = { postMessage(message, origin) { sent.push({ message, origin }); } };
  const window = { parent, openai, addEventListener(type, listener) { listeners.set(type, listener); } };
  const html = await (await worker.fetch(new Request('https://mail.example/'))).text();
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], {
    window, document, URL, setTimeout: () => 1, clearTimeout() {}, navigator: {},
  });
  return { elements, sent, parent, deliver(data, origin = 'https://host.example', source = parent) {
    listeners.get('message')({ data, origin, source });
  } };
}
const result = { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
  structuredContent: { accounts: [], messages: [], notice: 'Synthetic tool result' },
} };
const handshake = id => ({ jsonrpc: '2.0', id, result: { protocolVersion: '2026-01-26' } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('rejects tool results and wrong/opaque/insecure handshakes before initialization', async () => {
  const p = await panel(), id = p.sent[0].message.id;
  p.deliver(result);
  p.deliver(handshake(id + 1));
  p.deliver(handshake(id), 'null');
  p.deliver(handshake(id), 'http://host.example');
  p.deliver(handshake(id), 'https://host.example', {});
  await flush();
  assert.equal(p.sent.length, 1);
  assert.notEqual(p.elements.get('status')?.textContent, 'Synthetic tool result');
  p.deliver(handshake(id)); await flush();
  assert.equal(p.sent[1].message.method, 'ui/notifications/initialized');
  assert.equal(p.sent[1].origin, 'https://host.example');
});

test('pins origin and parent for tool results and subsequent outgoing requests', async () => {
  const p = await panel(); p.deliver(handshake(p.sent[0].message.id)); await flush();
  p.deliver(result, 'https://other.example');
  p.deliver(result, 'https://host.example', {});
  assert.notEqual(p.elements.get('status')?.textContent, 'Synthetic tool result');
  p.deliver(result);
  assert.equal(p.elements.get('status')?.textContent, 'Synthetic tool result');
  p.elements.get('load').onclick(); await flush();
  assert.ok(p.sent.some(s => s.message.method === 'ui/message'));
  assert.ok(p.sent.slice(1).every(s => s.origin === 'https://host.example'));
  p.deliver(handshake(p.sent[0].message.id), 'https://other.example');
  p.deliver(result, 'https://other.example');
  assert.equal(p.sent.at(-1).origin, 'https://host.example');
});

test('missing or insecure embedding context disables the message bridge', async () => {
  for (const referrer of ['', 'null', 'http://host.example/']) {
    const p = await panel(referrer); await flush();
    p.deliver(handshake(1)); p.deliver(result); await flush();
    assert.equal(p.sent.length, 0);
    assert.notEqual(p.elements.get('status')?.textContent, 'Synthetic tool result');
  }
});

test('native initial output renders even without a referrer or a bridge handshake', async () => {
  const p = await panel('', { toolOutput: result.params.structuredContent }); await flush();
  assert.equal(p.sent.length, 0);
  assert.equal(p.elements.get('status').textContent, 'Synthetic tool result');
});
