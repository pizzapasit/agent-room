#!/usr/bin/env node
// Agent Room server — tracks Claude Code sessions and streams them to room.html.
// Started automatically by hook.js; listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DIR = __dirname;
const STATE_FILE = path.join(DIR, 'state.json');
const LOG_FILE = path.join(DIR, 'server.log');

const cfg = Object.assign(
  { port: 4777, openBrowser: 'when-no-viewer', idleShutdownMinutes: 30, forgetAfterHours: 6 },
  (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')); } catch { return {}; } })()
);
if (process.env.AGENT_ROOM_PORT) cfg.port = +process.env.AGENT_ROOM_PORT;
if (process.env.AGENT_ROOM_OPEN) cfg.openBrowser = process.env.AGENT_ROOM_OPEN;

const log = (...a) => { try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} };

let sessions = {}, messages = [], nextId = 1;
try {
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  if (st.sessions) { sessions = st.sessions; messages = st.messages || []; nextId = st.nextId || messages.length + 1; }
  else sessions = st; // older format
} catch {}
const MAX_MESSAGES = 300;
const readAvatar = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')).avatar || 'mix'; } catch { return 'mix'; } };
const readTheme = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')).theme || 'pixel'; } catch { return 'pixel'; } };
const clients = new Set();
const PALETTE_SIZE = 8;

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ sessions, messages, nextId })); } catch {} }, 300);
}
const list = () => Object.values(sessions).sort((a, b) => a.seat - b.seat);
function send(event, obj) {
  const data = `event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`;
  for (const c of clients) c.write(data);
}
function broadcast() { send('sessions', { sessions: list(), now: Date.now() }); saveSoon(); }
function say(s, from, text, kind) {
  if (!text) return;
  const m = { id: nextId++, sid: s.id, name: s.name, color: s.color, from, kind, text, t: Date.now() };
  messages.push(m);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  send('msg', m); saveSoon();
}
function firstFree(key, limit = Infinity) {
  const used = new Set(Object.values(sessions).map(s => s[key]));
  let i = 0; while (used.has(i) && i < limit) i++;
  return i >= limit ? Object.keys(sessions).length % limit : i;
}
function uniqueName(cwd) {
  const base = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'agent';
  const same = Object.values(sessions).filter(s => s.base === base).length;
  return { base, name: same ? `${base} #${same + 1}` : base };
}

let lastOpen = 0;
function maybeOpenBrowser() {
  if (cfg.openBrowser === 'never' || clients.size > 0 || Date.now() - lastOpen < 10000) return;
  lastOpen = Date.now();
  const url = `http://127.0.0.1:${cfg.port}/`;
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, err => err && log('open browser failed:', err.message));
}

function handleEvent(ev) {
  const id = ev.session_id;
  if (!id) return;
  let s = sessions[id];
  if (!s) {
    if (ev.event === 'SessionEnd') return;
    const { base, name } = uniqueName(ev.cwd);
    s = sessions[id] = {
      id, base, name, cwd: ev.cwd || '', seat: firstFree('seat'), color: firstFree('color', PALETTE_SIZE),
      since: Date.now(), state: 'idle', label: 'Just arrived', tools: 0,
    };
    log('new session', name, id);
    maybeOpenBrowser();
  }
  s.last = Date.now();
  switch (ev.event) {
    case 'SessionStart':
      s.state = 'idle'; s.label = ev.source === 'resume' ? 'Resumed' : ev.source === 'clear' ? 'Fresh start' : 'Ready';
      if (ev.source === 'startup' || ev.source === 'resume') { maybeOpenBrowser(); say(s, 'system', ev.source === 'resume' ? 'came back' : 'joined the room'); }
      break;
    case 'UserPromptSubmit': s.state = 'thinking'; s.label = 'Thinking…'; say(s, 'user', ev.prompt); break;
    case 'PreToolUse':
      s.state = 'working'; s.tools++;
      s.label = ev.tool ? `${ev.tool}${ev.detail ? ': ' + ev.detail : ''}` : 'Working';
      break;
    case 'PostToolUse': s.state = 'thinking'; s.label = 'Thinking…'; break;
    case 'Notification': {
      const m = String(ev.message || '');
      if (/waiting for your input/i.test(m)) { if (s.state !== 'done') { s.state = 'done'; s.label = 'Your turn'; } }
      else {
        s.state = 'waiting';
        const perm = m.match(/permission to use (.+)$/i);
        s.label = perm ? `Permission: ${perm[1]}` : (m || 'Needs you');
        say(s, 'system', perm ? `needs permission: ${perm[1]}` : (m || 'needs you'), 'warn');
      }
      break;
    }
    case 'Stop': s.state = 'done'; s.label = 'Done — your turn'; say(s, 'agent', ev.text); break;
    case 'PreCompact': s.state = 'thinking'; s.label = 'Tidying up memory…'; break;
    case 'SessionEnd':
      s.state = 'leaving'; s.label = 'Bye!'; say(s, 'system', 'left the room');
      broadcast();
      setTimeout(() => { delete sessions[id]; broadcast(); }, 2600);
      return;
  }
  broadcast();
}

function readBody(req) {
  return new Promise(resolve => {
    let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/event') {
    try { handleEvent(JSON.parse(await readBody(req))); } catch (e) { log('bad event', e.message); }
    res.writeHead(204).end(); return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/dismiss/')) {
    const id = decodeURIComponent(url.pathname.slice(9));
    if (sessions[id]) { delete sessions[id]; broadcast(); }
    res.writeHead(204).end(); return;
  }
  if (req.method === 'POST' && url.pathname === '/shutdown') {
    res.writeHead(204).end(); log('shutdown requested'); setTimeout(() => process.exit(0), 100); return;
  }
  if (url.pathname === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify({ sessions: list(), messages, theme: readTheme(), avatar: readAvatar(), now: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/clear-chat') {
    messages = []; saveSoon(); send('snapshot', { sessions: list(), messages, theme: readTheme(), avatar: readAvatar(), now: Date.now() });
    res.writeHead(204).end(); return;
  }
  if (url.pathname === '/messages') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(messages)); return;
  }
  if (url.pathname === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list())); return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(path.join(DIR, 'room.html')).pipe(res); return;
  }
  res.writeHead(404).end();
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') process.exit(0); // another copy already running — fine
  log('server error', e.message); process.exit(1);
});
server.listen(cfg.port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${cfg.port}`));

// heartbeat, forgetting stale sessions, and idle shutdown
let emptySince = Date.now();
setInterval(() => {
  for (const c of clients) c.write(': ping\n\n');
  const cutoff = Date.now() - cfg.forgetAfterHours * 3600e3;
  let changed = false;
  for (const [id, s] of Object.entries(sessions)) if ((s.last || 0) < cutoff) { delete sessions[id]; changed = true; }
  if (changed) broadcast();
  if (Object.keys(sessions).length || clients.size) emptySince = Date.now();
  else if (cfg.idleShutdownMinutes > 0 && Date.now() - emptySince > cfg.idleShutdownMinutes * 60e3) {
    log('idle shutdown'); process.exit(0);
  }
}, 25000);
