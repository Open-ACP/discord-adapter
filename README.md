# @openacp/discord-adapter

Discord adapter plugin for [OpenACP](https://github.com/Open-ACP/OpenACP). Creates forum threads for each AI session, supports slash commands, streaming messages, and permission requests.

## Installation

```bash
openacp plugin add @openacp/discord-adapter
```

## Features

- **Forum threads** — each session gets its own thread in a dedicated `#openacp-sessions` forum channel
- **Tool card embeds** — agent activity rendered as Discord embeds with colored sidebar (🔵 running, 🟢 done, 🔴 error)
- **Action row buttons** — `[🔇 Low] [📊 Medium] [🔍 High] [❌ Cancel]` appear inline under the tool card while the agent is working
- **Output modes** — three detail levels (low/medium/high) with a 3-level cascade: session override → adapter default → global default
- **Streaming messages** — responses stream in real-time with debounced edits
- **Permission buttons** — Allow/Reject buttons for agent permission requests
- **File and image support** — attach files and screenshots directly in threads

## Slash Commands

| Command | Description |
|---------|-------------|
| `/new [agent] [workspace]` | Create a new session |
| `/newchat` | New session, same agent and workspace |
| `/cancel` | Cancel the current session |
| `/status` | Show session or system status |
| `/sessions` | List all sessions |
| `/menu` | Open the session control panel |
| `/handoff` | Get a command to resume locally |
| `/agents` | Browse available agents |
| `/install <name>` | Install an agent |
| `/outputmode [low\|medium\|high\|reset] [session]` | Set output detail level |
| `/dangerous` | Toggle auto-approval of permissions |
| `/tts [on\|off]` | Toggle text-to-speech |
| `/settings` | Change config in-chat |
| `/doctor` | Run diagnostics |
| `/help` | Show help |

## Output Mode

Controls how much detail is shown while the agent is working:

| Mode | Description |
|------|-------------|
| `low` | Compact icon grid — minimal noise |
| `medium` | Tool titles, descriptions, output summaries (default) |
| `high` | Full inline output, plan list, thinking viewer links |

Switch adapter default: `/outputmode high`
Override per session: `/outputmode session high`
Reset to global default: `/outputmode reset`

Or click the mode buttons in the tool card action row — no command needed.

## Development

```bash
git clone https://github.com/Open-ACP/discord-adapter.git
cd discord-adapter
pnpm install
pnpm build
pnpm test

# Hot-reload development
openacp dev .
```

## Configuration

After installing the plugin, run `openacp plugin configure @openacp/discord-adapter` to set up:

- Discord bot token
- Guild ID
- Forum channel ID
