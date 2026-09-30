# Agent Room

A cartoon room with a character for each Claude Code agent you run in a terminal, plus a **Team chat** that shows what you asked each agent and what it answered.

- Start `claude` in a terminal and a character walks in. Open more terminals and more characters join.
- The room server starts by itself on the first agent event and opens your browser if no room tab is open.
- The server stops by itself after 30 minutes with no agents and no viewers.

| Character | Meaning |
|---|---|
| Typing, green antenna, tool in the bubble | working (running a tool) |
| Swaying, "…" bubble | thinking |
| Bouncing, waving, orange "!" + chime | needs you (permission request) |
| Big smile, green bubble | finished, your turn |
| Eyes closed, zzz | idle for more than 10 minutes |
| Walks out the door | session ended |

## Themes

Pixel Arcade (default), Cozy Office and Space Station. Switch themes with the buttons at the top of the page; your choice is remembered in that browser. To change the default, set `"theme"` in `config.json` to `"pixel"`, `"cozy"` or `"space"`, or run `node install.js --theme space`.

Pixel Arcade has four avatar styles: **Mix** (default: agents take turns being a bot, a person or a critter), **Bots**, **Office Crew** (people with different hair, skin tones and hats) and **Critters** (cat, bunny, bear, frog). Each agent's look comes from its color slot, so agents in the room never look alike. Switch styles with the buttons at the top, or set `"avatar"` in `config.json` (`"mix"`, `"bots"`, `"crew"`, `"critters"`), or run `node install.js --avatar crew`.

## Team chat

The panel on the right shows, with the sender's name and time:

- **You → agent:** each prompt you typed in that terminal
- **agent:** the agent's final reply when it finishes a turn (read from the session transcript on your computer)
- **Notices:** who joined, who left, and who needs permission

Click a character or a name chip to see only that agent's messages. **Clear** empties the history (the last 300 messages are kept).

## Install

Requires Node.js (you already have it if you installed Claude Code with npm).

```
cd agent-room
node install.js
```

Then restart the `claude` sessions that are already open. Hooks load when a session starts.

Room URL: http://127.0.0.1:4777

## Settings (`~/.claude/agent-room/config.json`)

- `theme`: `"pixel"` (default), `"cozy"` or `"space"`
- `avatar` (Pixel Arcade): `"mix"` (default), `"bots"`, `"crew"` or `"critters"`
- `port`: default 4777
- `openBrowser`: `"when-no-viewer"` (default) or `"never"`
- `idleShutdownMinutes`: default 30 (0 = never)
- `forgetAfterHours`: removes a character with no events for this long (for terminals closed without exiting), default 6

Hover over a character and click × to remove it by hand.

## Uninstall

```
node ~/.claude/agent-room/uninstall.js
```

## How it works

`install.js` adds a hook to `~/.claude/settings.json` for SessionStart, UserPromptSubmit, Pre/PostToolUse, Notification, Stop, PreCompact and SessionEnd. On each event, `hook.js` sends a short summary (session id, folder name, tool name, file name or first line of the command, your prompt, and the agent's final reply) to `server.js` on 127.0.0.1. If the server isn't running, the hook starts it. The hook never writes to stdout and always exits 0, so it can't block or change what your agent does. Nothing leaves your computer.
