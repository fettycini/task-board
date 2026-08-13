'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const api = require('./api');
const week = require('./week');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const DATA_FILE = process.env.TASKBOARD_DATA || path.join(ROOT, 'data', 'board.json');
const PORT = Number(process.env.TASKBOARD_PORT || 8080);
// Loopback by default: the board is for the Pi's own touchscreen. Set
// TASKBOARD_HOST=0.0.0.0 to open it to the home network later.
const HOST = process.env.TASKBOARD_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const store = new Store(DATA_FILE);
store.load();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Collect Buffers and decode once at the end. Decoding each chunk on its
    // own would mangle any multi-byte character (every icon is an emoji) that
    // happened to straddle a chunk boundary.
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new api.ApiError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(new api.ApiError(400, 'Malformed JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);

  // Refuse anything that escapes web/ — path traversal guard.
  if (!file.startsWith(WEB_DIR + path.sep) && file !== path.join(WEB_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // The Pi reloads on boot and after edits; stale assets are worse than
      // a few extra kilobytes read off local disk.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/**
 * Route table: [method, /path/pattern, handler]. `:id` captures a segment.
 * Handlers return a payload; anything that mutates sets `dirty`.
 */
const routes = [
  ['GET', '/api/board', (ctx) => {
    const { board, changed } = api.getBoard(store.state, ctx.query.get('week'));
    // Only dirty when opening the week actually generated new chores.
    return { payload: board, dirty: changed };
  }],

  ['POST', '/api/tasks', (ctx) => ({ payload: api.addTask(store.state, ctx.body), dirty: true })],
  ['PATCH', '/api/tasks/:id', (ctx) => ({ payload: api.updateTask(store.state, ctx.params.id, ctx.body), dirty: true })],
  ['DELETE', '/api/tasks/:id', (ctx) => ({ payload: api.deleteTask(store.state, ctx.params.id), dirty: true })],
  ['POST', '/api/week/reset', (ctx) => ({
    payload: api.resetWeek(store.state, ctx.body.weekKey || week.weekKey(new Date(), store.state.settings.weekStartsOn)),
    dirty: true,
  })],

  ['POST', '/api/templates', (ctx) => ({ payload: api.addTemplate(store.state, ctx.body), dirty: true })],
  ['PATCH', '/api/templates/:id', (ctx) => ({ payload: api.updateTemplate(store.state, ctx.params.id, ctx.body), dirty: true })],
  ['DELETE', '/api/templates/:id', (ctx) => ({ payload: api.deleteTemplate(store.state, ctx.params.id), dirty: true })],

  ['POST', '/api/shopping', (ctx) => ({ payload: api.addShopping(store.state, ctx.body), dirty: true })],
  ['PATCH', '/api/shopping/:id', (ctx) => ({ payload: api.updateShopping(store.state, ctx.params.id, ctx.body), dirty: true })],
  ['DELETE', '/api/shopping/:id', (ctx) => ({ payload: api.deleteShopping(store.state, ctx.params.id), dirty: true })],
  ['POST', '/api/shopping/clear', () => ({ payload: api.clearCheckedShopping(store.state), dirty: true })],

  ['PATCH', '/api/settings', (ctx) => ({ payload: api.updateSettings(store.state, ctx.body), dirty: true })],

  ['POST', '/api/palettes/:key/reset', (ctx) => ({ payload: api.resetPalette(store.state, ctx.params.key), dirty: true })],

  ['POST', '/api/people', (ctx) => ({ payload: api.addPerson(store.state, ctx.body), dirty: true })],
  // Must precede the /:id route, otherwise "reorder" is read as a person id.
  ['POST', '/api/people/reorder', (ctx) => ({ payload: api.reorderPeople(store.state, ctx.body), dirty: true })],
  ['PATCH', '/api/people/:id', (ctx) => ({ payload: api.updatePerson(store.state, ctx.params.id, ctx.body), dirty: true })],
  ['DELETE', '/api/people/:id', (ctx) => ({ payload: api.deletePerson(store.state, ctx.params.id, ctx.body), dirty: true })],

  ['POST', '/api/reset', (ctx) => ({ payload: api.resetAll(store.state, ctx.body), dirty: true })],
];

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    if (patternParts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (patternParts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (_) {
    return sendJson(res, 400, { error: 'Bad request' });
  }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, url.pathname);
  }

  const match = matchRoute(req.method, url.pathname);
  if (!match) return sendJson(res, 404, { error: 'No such endpoint' });

  try {
    // DELETE carries a body here: removing a person needs to say where their
    // tasks go, and that is part of the same decision, not a separate call.
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = match.handler({ body, params: match.params, query: url.searchParams });

    // Note GET /api/board can also be dirty: it materialises that week's
    // chores the first time the week is opened.
    if (result.dirty) store.touch();

    sendJson(res, 200, result.payload);
  } catch (err) {
    if (err instanceof api.ApiError) return sendJson(res, err.status, { error: err.message });
    console.error('[server]', err);
    sendJson(res, 500, { error: 'Something went wrong' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`task-board listening on http://${HOST}:${PORT}`);
  console.log(`data file: ${DATA_FILE}`);
});

// Housekeeping: trim ancient weeks once at boot and then daily.
function housekeeping() {
  const removed = week.pruneOldWeeks(store.state, 12);
  if (removed) {
    console.log(`[housekeeping] pruned ${removed} task(s) from old weeks`);
    store.touch();
  }
}
housekeeping();
setInterval(housekeeping, 24 * 60 * 60 * 1000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flushSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

module.exports = { server, store };
