// Runs Vesper and its hub on your own Node.js hosting (for example Hostinger):
// serves the app files, and the same hub code as the Cloudflare Worker (/sync, /mcp, /v1/chat/completions).
// Settings (environment variables in your host's panel):
//   APP_TOKEN       required. A long random text (30+ characters). Protects your data.
//   ORIGINS         the address of your site, e.g. https://vesper.soundmind.org.in (default below)
//   DATA_DIR        where the data file lives (default ./data). Keep it outside the public web folder if you can.
//   NVIDIA_API_KEY  optional, only for the AI proxy
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL, GOOGLE_TZ, GOOGLE_CALENDAR_ID  optional, for the Google Calendar link (see worker/README.md)
//   MODELS          optional, comma-separated model names the proxy allows
//   PORT            set by the host
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import hub from './worker/vesper-hub.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const dataFile = path.join(dataDir, 'vesper-data.json');

// A tiny stand-in for Cloudflare KV: one JSON file, written safely.
const store = {
  async get(key, type) {
    try {
      const all = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const v = all[key];
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    } catch (e) { return null; }
  },
  async put(key, value) {
    fs.mkdirSync(dataDir, { recursive: true });
    let all = {};
    try { all = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { /* first write */ }
    all[key] = value;
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, dataFile);
  },
};

store.delete = async (key) => {
  try {
    const all = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    delete all[key];
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, dataFile);
  } catch (e) { /* nothing stored yet */ }
};

const env = {
  APP_TOKEN: process.env.APP_TOKEN || '',
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || '',
  MODELS: process.env.MODELS || '',
  ORIGINS: process.env.ORIGINS || 'https://vesper.soundmind.org.in',
  PUBLIC_URL: process.env.PUBLIC_URL || (process.env.ORIGINS || 'https://vesper.soundmind.org.in').split(',')[0].trim(),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_TZ: process.env.GOOGLE_TZ || 'Asia/Kolkata',
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || '',
  VESPER: store,
};

// Only the app's own files are public. Never the server, tests, data or notes.
const PUBLIC_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const PUBLIC_DIRS = ['css', 'js', 'icons', 'img', 'fonts'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const HUB = /^\/(sync|mcp|v1|chat|google|calendar)(\/|$)/;

function serveFile(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(root, rel);
  const top = rel.split('/')[0];
  const ok = (PUBLIC_FILES.has(rel) || PUBLIC_DIRS.includes(top)) && full.startsWith(root + path.sep);
  if (!ok || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  const type = TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': rel === 'sw.js' || rel === 'index.html' ? 'no-cache' : 'public, max-age=300' });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (HUB.test(url.pathname)) {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 6000000) { res.writeHead(413); res.end(); return; } chunks.push(c); }
      const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const request = new Request(url.href, { method: req.method, headers: req.headers, body });
      const out = await hub.fetch(request, env);
      const headers = {};
      out.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(out.status, headers);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    serveFile(req, res, url.pathname);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

if (!env.APP_TOKEN) console.warn('APP_TOKEN is not set: sync and the Claude connector will refuse every request.');
server.listen(process.env.PORT || 8080, () => console.log('Vesper is running'));
