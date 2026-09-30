#!/usr/bin/env node
// Removes Agent Room hooks from ~/.claude/settings.json and stops the server.
// Leaves the ~/.claude/agent-room folder in place (delete it yourself if you like).
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const MARK = 'agent-room/hook.js';

if (fs.existsSync(SETTINGS)) {
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-agent-room-${Date.now()}`);
  for (const ev of Object.keys(s.hooks || {})) {
    for (const g of s.hooks[ev]) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter(h => !String(h.command || '').includes(MARK));
    s.hooks[ev] = s.hooks[ev].filter(g => !Array.isArray(g.hooks) || g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  console.log('Removed Agent Room hooks from', SETTINGS);
}

let port = 4777;
try { port = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).port || port; } catch {}
const req = http.request({ host: '127.0.0.1', port, path: '/shutdown', method: 'POST', timeout: 1000 }, r => { r.resume(); console.log('Stopped the room server.'); });
req.on('error', () => {});
req.end();
