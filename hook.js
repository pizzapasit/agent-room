#!/usr/bin/env node
// Agent Room hook — called by Claude Code on session/tool events.
// Forwards a small summary to the local Agent Room server, starting it if needed.
// Never prints to stdout (SessionStart stdout would be injected into Claude's context)
// and always exits 0 so it can never block your agent.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DIR = __dirname;
let PORT = 4777;
try { PORT = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')).port || PORT; } catch {}
if (process.env.AGENT_ROOM_PORT) PORT = +process.env.AGENT_ROOM_PORT;

setTimeout(() => process.exit(0), 4000).unref(); // hard cap

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => main().catch(() => {}).finally(() => process.exit(0)));

function summarize(tool, input) {
  if (!input || typeof input !== 'object') return '';
  const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  switch (tool) {
    case 'Bash': return String(input.command || '').split('\n')[0].slice(0, 60);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return base(input.file_path || input.notebook_path);
    case 'Grep': case 'Glob': return String(input.pattern || '').slice(0, 40);
    case 'WebFetch': try { return new URL(input.url).host; } catch { return ''; }
    case 'WebSearch': return String(input.query || '').slice(0, 40);
    case 'Task': case 'Agent': return String(input.description || '').slice(0, 40);
    default: return '';
  }
}

function post(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/event', method: 'POST', timeout: 800,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.end(body);
  });
}

function startServer() {
  const child = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: DIR,
  });
  child.unref();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Pull the agent's final reply (the text after its last tool call) out of the transcript.
function lastReply(file) {
  if (!file) return '';
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, len = Math.min(size, 1024 * 1024);
    buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  } catch { return ''; }
  const lines = buf.toString('utf8').split('\n');
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.isSidechain) continue;
    if (e.type === 'user') break;
    if (e.type !== 'assistant') continue;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    if (parts.length && content.some(b => b.type === 'tool_use')) break;
    const texts = content.filter(b => b.type === 'text' && b.text).map(b => b.text);
    if (texts.length) parts.unshift(texts.join('\n\n'));
  }
  return parts.join('\n\n').trim();
}

const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

async function main() {
  let ev = {};
  try { ev = JSON.parse(raw || '{}'); } catch {}
  if (!ev.session_id) return;
  let text = '';
  if (ev.hook_event_name === 'Stop') {
    text = typeof ev.last_assistant_message === 'string' ? ev.last_assistant_message : '';
    for (let i = 0; !text && i < 4; i++) { if (i) await sleep(250); text = lastReply(ev.transcript_path); }
  }
  const body = JSON.stringify({
    prompt: ev.hook_event_name === 'UserPromptSubmit' ? clip(ev.prompt, 2000) : undefined,
    text: text ? clip(text, 4000) : undefined,
    session_id: ev.session_id,
    event: ev.hook_event_name,
    cwd: ev.cwd,
    tool: ev.tool_name,
    detail: summarize(ev.tool_name, ev.tool_input),
    message: ev.message,
    source: ev.source,
    reason: ev.reason,
    t: Date.now(),
  });
  try {
    await post(body);
  } catch (e) {
    if (e.code !== 'ECONNREFUSED') return;
    startServer();
    for (let i = 0; i < 12; i++) {
      await sleep(200);
      try { await post(body); return; } catch {}
    }
  }
}
