#!/usr/bin/env node
// Installs Agent Room into ~/.claude/agent-room and registers hooks in ~/.claude/settings.json.
// Safe to run again (updates files, never duplicates hooks). Backs up settings.json first.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const DEST = path.join(CLAUDE_DIR, 'agent-room');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const SRC = __dirname;

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'PreCompact', 'SessionEnd'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const MARK = 'agent-room/hook.js';

fs.mkdirSync(DEST, { recursive: true });
for (const f of ['hook.js', 'server.js', 'room.html', 'uninstall.js']) fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
// merge config: keep your existing values, add any new settings, apply --theme if given
const cfgPath = path.join(DEST, 'config.json');
const defaults = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
let current = {};
try { current = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
const merged = Object.assign({}, defaults, current);
const ti = process.argv.indexOf('--theme');
if (ti > -1 && process.argv[ti + 1]) merged.theme = process.argv[ti + 1];
const ai = process.argv.indexOf('--avatar');
if (ai > -1 && process.argv[ai + 1]) merged.avatar = process.argv[ai + 1];
fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2) + '\n');

const hookPath = path.join(DEST, 'hook.js').split(path.sep).join('/');
const node = process.execPath.split(path.sep).join('/');
const command = `"${node}" "${hookPath}"`;

let settings = {};
if (fs.existsSync(SETTINGS)) {
  const text = fs.readFileSync(SETTINGS, 'utf8');
  try { settings = text.trim() ? JSON.parse(text) : {}; }
  catch (e) { console.error(`Could not parse ${SETTINGS}: ${e.message}\nFix it (or move it aside) and run again.`); process.exit(1); }
  const backup = `${SETTINGS}.bak-agent-room-${Date.now()}`;
  fs.copyFileSync(SETTINGS, backup);
  console.log(`Backed up settings to ${backup}`);
}
settings.hooks = settings.hooks || {};

for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] = settings.hooks[ev] || []);
  // drop any older Agent Room entry, then add the current one
  for (const g of groups) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter(h => !String(h.command || '').includes(MARK));
  settings.hooks[ev] = groups.filter(g => !Array.isArray(g.hooks) || g.hooks.length);
  const entry = { hooks: [{ type: 'command', command, timeout: 5 }] };
  if (TOOL_EVENTS.has(ev)) entry.matcher = '*';
  settings.hooks[ev].push(entry);
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(`
Agent Room installed in ${DEST}
Hooks added to ${SETTINGS}

Next: start (or restart) claude in your terminals.
The room opens at http://127.0.0.1:4777 the first time an agent starts.
Settings: ${path.join(DEST, 'config.json')}
Uninstall: node "${path.join(DEST, 'uninstall.js')}"
`);

// restart a running room server so it picks up the new code (the next agent event starts it again)
require('http').request({ host: '127.0.0.1', port: merged.port || 4777, path: '/shutdown', method: 'POST', timeout: 1000 }, r => r.resume())
  .on('error', () => {}).on('timeout', function () { this.destroy(); }).end();
