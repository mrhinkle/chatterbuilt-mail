// Local preview and a synthetic MCP host. /test-host is never included in deployment.
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
const fixture = { accounts: [{ id: 'example-work', label: 'Work', email: 'owner@example.com' }, { id: 'example-home', label: 'Personal', email: 'owner@home.example' }], messages: [{ accountId: 'example-work', messageId: 'message-1', threadId: 'thread-1', from: 'Dana Chen <dana@example.com>', subject: 'Wednesday’s workshop', snippet: 'Can we move our planning call to Wednesday at 10?', date: '2026-11-04T12:00:00Z', unread: true }], fetchedAt: '2026-11-04T13:00:00Z', hasMore: true, selected: { accountId: 'example-work', threadId: 'thread-1', subject: 'Wednesday’s workshop', messages: [{ from: 'Dana Chen <dana@example.com>', to: 'owner@example.com', date: 'November 4, 2026', body: 'Hi Mark,\n\nCan we move our planning call to Wednesday at 10? Please bring the workshop outline.\n\nThanks,\nDana' }] }, draft: { accountId: 'example-work', threadId: 'thread-1', to: 'dana@example.com', subject: 'Re: Wednesday’s workshop', body: 'Dana,\n\nWednesday at 10 works. I’ll bring the workshop outline.\n\nMark' } };
const host = `<!doctype html><html><head><meta charset="utf-8"><title>Chatterbuilt Mail · synthetic host test</title></head><body style="margin:0;font:14px system-ui"><iframe id="panel" title="Mail panel" src="/" style="width:100%;height:92vh;border:0"></iframe><pre id="result" style="white-space:pre-wrap">Synthetic host · no real mail or actions</pre><script>
const frame=document.querySelector('#panel'), fixture=${JSON.stringify(fixture)};
window.addEventListener('message', event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const m=event.data;if(m.method==='ui/initialize'){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'Test host',version:'1'},hostCapabilities:{}}},location.origin);}else if(m.method==='ui/notifications/initialized'){frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:fixture}},location.origin);}else if(m.method==='ui/message'){document.querySelector('#result').textContent=m.params.content[0].text;frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);}else if(m.id){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);}});
</script></body></html>`;
// Supply a development-only certificate; never use production credentials here.
const keyPath = new URL('../.preview-tls/key.pem', import.meta.url);
const certPath = new URL('../.preview-tls/cert.pem', import.meta.url);
const panel = await (await worker.fetch(new Request('https://preview.invalid/'))).text();
createServer({ key: await readFile(keyPath), cert: await readFile(certPath), minVersion: 'TLSv1.2' }, async (req, res) => {
  try {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    // Only these two static pages may be returned as HTML. Never reflect a URL into a page.
    if (req.method === 'GET' && (req.url === '/' || req.url === '/test-host')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(req.url === '/' ? panel : host); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 900000) { res.writeHead(413); res.end('Request too large'); return; }
      chunks.push(chunk);
    }
    const request = new Request('https://preview.invalid/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(req.headers['oai-authenticated-user-id'] ? { 'oai-authenticated-user-id': 'synthetic-preview-user' } : {}) }, body: Buffer.concat(chunks) });
    const response = await worker.fetch(request);
    // The MCP endpoint returns data, never executable HTML, including for errors.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(response.status);
    if (response.status === 202 || response.status === 204) { res.end(); return; }
    const body = await response.text();
    const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(body) : { error: body };
    // Escape HTML delimiters as valid JSON escapes as defense in depth.
    res.end(JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
  } catch { res.writeHead(500); res.end('Preview error'); }
}).listen(4387, '127.0.0.1', () => console.log('Local: https://127.0.0.1:4387/test-host'));
