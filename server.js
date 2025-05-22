const fs = require('fs');
const https = require('https');
const cors_proxy = require('cors-anywhere');
const express = require('express');
const sharp = require('sharp');
const fetch = require('node-fetch').default;

let credentials;
try {
  const privateKey = fs.readFileSync('/etc/letsencrypt/live/cors-0x10.online/privkey.pem', 'utf8');
  const certificate = fs.readFileSync('/etc/letsencrypt/live/cors-0x10.online/fullchain.pem', 'utf8');
  credentials = {
    key: privateKey,
    cert: certificate,
    minVersion: 'TLSv1.2',
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA',
  };
} catch (err) {
  console.error('[PM2] 証明書読み込み失敗:', err.message);
  process.exit(1);
}

const originWhitelist = ['https://kami-0x10.github.io', 'null']; 
const app = express();

// CORSミドルウェア
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

const proxy = cors_proxy.createServer({
  originWhitelist: originWhitelist,
  requireHeader: ['origin', 'x-requested-with'],
  removeHeaders: ['cookie', 'cookie2'],
  methods: ['GET', 'POST', 'OPTIONS'],
  httpProxyOptions: {
    secure: true,
    timeout: 10000,
  },
  maxRedirects: 5,
  bufferResponse: true,
  onError: (err, req, res) => {
    console.error('[PM2] CORSプロキシエラー:', err.message, 'URL:', req.url);
    res.statusCode = 500;
    res.end('Internal Server Error');
  },
});

app.get('/convert', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      console.error('[PM2] /convert: URLパラメータなし');
      res.status(400).end('Bad Request: URL parameter is required');
      return;
    }
    const response = await fetch(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; iOS 6.1.3; Safari)' },
    });
    if (!response.ok) {
      console.error(`[PM2] 画像取得失敗: ${response.status} ${response.statusText}`);
      res.status(response.status).end(`Failed to fetch image: ${response.statusText}`);
      return;
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('image')) {
      console.error(`[PM2] 非画像データ: ${contentType}`);
      res.status(400).end('Bad Request: Not an image');
      return;
    }
    const buffer = await response.arrayBuffer();
    const jpegBuffer = await sharp(Buffer.from(buffer), { failOnError: false })
      .jpeg({ quality: 80 })
      .toBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.send(jpegBuffer);
  } catch (err) {
    console.error('[PM2] WebP変換エラー:', err.message);
    res.status(500).end('Internal Server Error');
  }
});

app.use((req, res) => {
  console.log(`[PM2] プロキシリクエスト: ${req.url}`);
  proxy.emit('request', req, res);
});

const port = 4443;
https.createServer(credentials, app).listen(port, () => {
  console.log(`[PM2] HTTPS CORS and WebP conversion server running on port ${port}`);
});
