# @openacp/discord-adapter

Discord adapter plugin for [OpenACP](https://github.com/Open-ACP/OpenACP). Creates forum threads for each AI session, supports slash commands, streaming messages, and permission requests.

## Installation

```bash
openacp plugin add @openacp/discord-adapter
```

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
