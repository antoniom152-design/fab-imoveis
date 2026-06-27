const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(204).end(); }
  if (req.method !== 'POST')    { return res.status(405).json({ error: 'Method not allowed' }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key não configurada no servidor.' });
  }

  const bodyStr = JSON.stringify(req.body);

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':       'application/json',
        'Content-Length':     Buffer.byteLength(bodyStr),
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        try {
          res.status(proxyRes.statusCode).json(JSON.parse(data));
        } catch {
          res.status(502).json({ error: 'Resposta inválida da API.' });
        }
        resolve();
      });
    });

    proxyReq.on('error', (err) => {
      res.status(502).json({ error: 'Falha ao conectar com a API.' });
      resolve();
    });

    proxyReq.write(bodyStr);
    proxyReq.end();
  });
};
