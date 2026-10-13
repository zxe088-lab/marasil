// تشغيل سيرفر الإشعارات على VPS (بدون أي مكتبات خارجية)
const http = require('http');
const handler = require('./api/notify.js');
const PORT = Number(process.env.PORT || 8787);

http.createServer((req, res) => {
  const out = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(code) { res.statusCode = code; return out; },
    json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return out; },
    end(b) { res.end(b); return out; }
  };
  if (!req.url.startsWith('/api/notify')) { res.statusCode = req.url === '/' ? 200 : 404; return res.end(req.url === '/' ? 'BPB OLD push OK' : 'not found'); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
    Promise.resolve(handler(req, out)).catch(e => { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end('error'); } });
  });
}).listen(PORT, '127.0.0.1', () => console.log('BPB push listening on 127.0.0.1:' + PORT));
