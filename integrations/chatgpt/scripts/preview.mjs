// Local preview and a synthetic MCP host. /test-host is never included in deployment.
import { createServer } from 'node:http';
import worker from '../worker/index.js';
const fixture = { accounts: [{ id: 'example-work', label: 'Work', email: 'owner@example.com' }, { id: 'example-home', label: 'Personal', email: 'owner@home.example' }], messages: [{ accountId: 'example-work', messageId: 'message-1', threadId: 'thread-1', from: 'Dana Chen <dana@example.com>', subject: 'Wednesday’s workshop', snippet: 'Can we move our planning call to Wednesday at 10?', date: '2026-11-04T12:00:00Z', unread: true }], fetchedAt: '2026-11-04T13:00:00Z', hasMore: true, selected: { accountId: 'example-work', threadId: 'thread-1', subject: 'Wednesday’s workshop', messages: [{ from: 'Dana Chen <dana@example.com>', to: 'owner@example.com', date: 'November 4, 2026', body: 'Hi Mark,\n\nCan we move our planning call to Wednesday at 10? Please bring the workshop outline.\n\nThanks,\nDana' }] }, draft: { accountId: 'example-work', threadId: 'thread-1', to: 'dana@example.com', subject: 'Re: Wednesday’s workshop', body: 'Dana,\n\nWednesday at 10 works. I’ll bring the workshop outline.\n\nMark' } };
const host = `<!doctype html><html><head><meta charset="utf-8"><title>Chatterbuilt Mail · synthetic host test</title></head><body style="margin:0;font:14px system-ui"><iframe id="panel" title="Mail panel" src="/" style="width:100%;height:92vh;border:0"></iframe><pre id="result" style="white-space:pre-wrap">Synthetic host · no real mail or actions</pre><script>
const frame=document.querySelector('#panel'), fixture=${JSON.stringify(fixture)};
window.addEventListener('message', event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const m=event.data;if(m.method==='ui/initialize'){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'Test host',version:'1'},hostCapabilities:{}}},location.origin);}else if(m.method==='ui/notifications/initialized'){frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:fixture}},location.origin);}else if(m.method==='ui/message'){document.querySelector('#result').textContent=m.params.content[0].text;frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);}else if(m.id){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);}});
</script></body></html>`;
createServer(async (req, res) => {
  try {
    if (req.url === '/test-host') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(host); return; }
    const request = new Request('http://127.0.0.1:4387' + req.url, { method: req.method, headers: req.headers });
    const response = await worker.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Preview error'); }
}).listen(4387, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4387/test-host'));
