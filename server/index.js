import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { createApi } from './api.js';

/**
 * Один процесс: POST /api/<method> + раздача собранного фронта (dist/) с SPA-фолбэком.
 *
 * Переменные окружения:
 *   PORT          порт (по умолчанию 8787)
 *   DATA_DIR      папка для базы (по умолчанию ./data)
 *   APP_PASSWORD  если задан — весь сайт закрыт HTTP Basic Auth (логин любой)
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PASSWORD = process.env.APP_PASSWORD || '';
const MAX_BODY = 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
const api = createApi(openDb(path.join(DATA_DIR, 'tasks.db')));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, method) {
  if (req.method !== 'POST') return send(res, 405, 'Method Not Allowed');
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return send(res, e.status || 400, JSON.stringify({ ok: false, error: e.status ? e.message : 'Некорректный JSON' }), { 'Content-Type': 'application/json' });
  }
  const result = api.call(method, payload, { actorId: String(req.headers['x-actor'] || '') });
  send(res, 200, JSON.stringify(result), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    return send(res, 404, 'Фронт не собран. Для разработки: npm run dev, для продакшена: npm run build && npm start',
      { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const file = path.join(DIST, path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, ''));
  const safe = file.startsWith(DIST + path.sep);
  if (safe && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = pathname.startsWith('/assets/');
    return send(res, 200, fs.readFileSync(file), {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
  // SPA: любой неизвестный путь без расширения отдаёт index.html
  if (path.extname(pathname)) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(path.join(DIST, 'index.html')), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/healthz') return send(res, 200, 'ok');
    if (!authorized(req)) return send(res, 401, 'Нужен пароль', { 'WWW-Authenticate': 'Basic realm="Tasks", charset="UTF-8"' });
    const m = /^\/api\/([A-Za-z]+)$/.exec(pathname);
    if (m) return await handleApi(req, res, m[1]);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Tasks: http://localhost:${PORT}  (база: ${path.join(DATA_DIR, 'tasks.db')}${PASSWORD ? ', пароль включён' : ''})`);
});
