const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT     = 3000;
const BASE_DIR = __dirname;

/* ── API KEY ──────────────────────────────────────────────────
   Lê de variável de ambiente OU de um arquivo local api-key.txt
   Para usar: set ANTHROPIC_API_KEY=sk-ant-... antes de node server.js
   Ou crie um arquivo api-key.txt na raiz com apenas a chave
──────────────────────────────────────────────────────────────── */
function lerApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const keyFile = path.join(BASE_DIR, 'api-key.txt');
  try { return fs.readFileSync(keyFile, 'utf8').trim(); } catch (_) {}
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
};

/* ── PROXY ANTHROPIC ──────────────────────────────────────── */
function proxyAnthropic(reqBody, res) {
  const apiKey = lerApiKey();
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Chave de API não configurada no servidor.' }));
    return;
  }

  const bodyStr = JSON.stringify(reqBody);
  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':        'application/json',
      'Content-Length':      Buffer.byteLength(bodyStr),
      'x-api-key':           apiKey,
      'anthropic-version':   '2023-06-01',
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Erro proxy Anthropic:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Falha ao conectar com a API.' }));
  });

  proxyReq.write(bodyStr);
  proxyReq.end();
}

/* ── SERVIDOR ─────────────────────────────────────────────── */
http.createServer((req, res) => {

  /* CORS para desenvolvimento local */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* ── POST /api/chat ── */
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido.' }));
        return;
      }
      proxyAnthropic(parsed, res);
    });
    return;
  }

  /* ── Arquivos estáticos ── */
  const urlPath  = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(BASE_DIR, urlPath);
  const ext      = path.extname(filePath).toLowerCase();
  const mime     = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 — Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });

}).listen(PORT, '127.0.0.1', () => {
  const apiKey = lerApiKey();
  console.log('Servidor rodando em http://localhost:' + PORT);
  console.log('API Key:', apiKey ? '✅ configurada' : '❌ NÃO configurada (crie api-key.txt ou defina ANTHROPIC_API_KEY)');
});
