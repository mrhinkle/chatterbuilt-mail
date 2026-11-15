import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { once } from 'node:events';

// Run the actual preview in a disposable directory, with a disposable TLS certificate.
test('HTTPS preview restricts routes, bounds bodies, and serves hostile RPC text as inert JSON', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-preview-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const folder of ['scripts', 'worker', '.preview-tls']) await mkdir(join(dir, folder));
  for (const file of ['scripts/preview.mjs', 'worker/index.js', 'package.json']) {
    await copyFile(new URL('../' + file, import.meta.url), join(dir, file));
  }
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, '.preview-tls/key.pem'), '-out', join(dir, '.preview-tls/cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const ca = await readFile(join(dir, '.preview-tls/cert.pem'));
  const server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(Error('Preview exited: ' + code))); });
  const call = (path, method = 'GET', body = '', headers = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 4387, path, method, ca, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal((await call('/test-host')).status, 200);
  const page = await call('/'); assert.equal(page.status, 200); assert.match(page.body, /Chatterbuilt Mail/);
  assert.equal((await call('/?q=%3Cscript%3E')).status, 404);
  assert.equal((await call('/mcp')).status, 405);
  const malicious = '</script><img src=x onerror=alert(1)>';
  const rpc = await call('/mcp', 'POST', JSON.stringify({ jsonrpc: '2.0', id: malicious, method: 'tools/list' }), { 'content-type': 'application/json', 'x-test': malicious });
  assert.equal(rpc.status, 200); assert.match(rpc.headers['content-type'], /^application\/json/);
  assert.equal(rpc.headers['x-content-type-options'], 'nosniff');
  assert.equal(JSON.parse(rpc.body).id, malicious);
  assert.ok(!rpc.body.includes('<')); assert.ok(JSON.parse(rpc.body).result.tools.length > 0);
  assert.equal((await call('/mcp', 'POST', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  assert.equal((await call('/mcp', 'POST', 'x'.repeat(900001))).status, 413);
});
