# Discord Output Mode Parity Design Spec

**Date:** 2026-03-31
**Branch:** `develop`
**Status:** Draft

## Overview

Bring the Discord adapter to full feature parity with the Telegram adapter's output mode system. This replaces the old `displayVerbosity` pass-through approach with the principled `OutputMode` system: 3-level cascade configuration (global → adapter → session), `DisplaySpecBuilder`, `ToolCardState` debounced aggregation, `ThoughtBuffer`, and out-of-order tool update handling.

**Approach:** Rewrite Discord's activity tracking and formatting layer to use the shared `adapter-primitives` infrastructure — the same components Telegram uses — with Discord-specific rendering (embeds + markdown instead of HTML).

## What Changes

### Removed
- `tool-call-tracker.ts` — replaced by `ToolCardState` aggregated rendering
- Old per-tool separate message pattern
- Raw `displayVerbosity` parameter threading through handlers

### Rewritten
- `activity.ts` — new `ActivityTracker` orchestrator (mirrors Telegram's)
- `formatting.ts` — new `renderToolCard()` / `renderSpecSection()` using Discord embeds
- `adapter.ts` handler methods — new flow with OutputModeResolver + tracker delegation

### Updated
- `commands/admin.ts` — `/verbosity` → `/outputmode` with session-level overrides
- `commands/router.ts` — new callback routing for `vb:` prefix buttons
- `index.ts` — config migration for `displayVerbosity → outputMode`

### Unchanged
- `draft-manager.ts` / `streaming.ts` — text streaming works well as-is
- `forums.ts`, `permissions.ts`, `media.ts` — infrastructure unchanged
- `action-detect.ts`, `skill-command-manager.ts`, `assistant.ts` — unchanged
- All other commands — unchanged

## Architecture

### Data Flow

```
ACP Event → adapter.sendMessage()
         → OutputModeResolver.resolve(configManager, "discord", sessionId)
         → getOrCreateTracker(sessionId, threadId, mode)
         → ActivityTracker orchestrates:
              ├── ToolStateMap (accumulate tool state)
              ├── DisplaySpecBuilder (mode-aware spec)
              ├── ToolCardState (debounced render → Discord embed)
              ├── ThoughtBuffer (accumulate thoughts)
              └── ThinkingIndicator (typing + thought viewer link)
         → SendQueue → Discord API
```

### Output Mode Cascade

```
Session override → Adapter override → Global default → "medium"
```

Resolved via `OutputModeResolver.resolve(configManager, "discord", sessionId, sessionManager)`.

### Per-Mode Display Matrix

| Element | Low | Medium | High |
|---------|-----|--------|------|
| Tool icon + title | Yes | Yes | Yes |
| Tool description | No | Yes | Yes |
| Command (terminal cmd) | No | Yes | Yes |
| Output summary | No | Yes | Yes |
| Inline output content | No | No | Yes (if short) |
| View Output link (long output) | No | Yes | Yes |
| Diff stats (+X/-Y) | No | Yes | Yes |
| Thinking content | No | No | Yes (viewer link) |
| Noise tools | Hidden | Hidden | Shown |
| Plan progress | No | Compact count | Full list |

## Component Design

### 1. ActivityTracker (activity.ts — rewrite)

Constructor: `(outputMode, tunnelService?, sessionContext?)`

Internal components (from adapter-primitives):
- `ToolStateMap` + `previousToolStateMap`
- `DisplaySpecBuilder`
- `ToolCardState` + `previousToolCard`
- `ThoughtBuffer`

Lifecycle methods:
- `onNewPrompt()` — reset state, finalize previous tool card, swap current → previous
- `onThought(text)` — buffer in ThoughtBuffer, show Discord typing indicator
- `onTextStart()` — seal tool card, dismiss thinking, store thought to viewer (high mode)
- `onToolCall(meta, kind, rawInput)` — upsert ToolStateMap → build spec → update ToolCardState
- `onToolUpdate(id, status, content, viewerLinks, diffStats)` — merge in current or previous ToolStateMap, update corresponding ToolCardState
- `onPlan(entries)` — update ToolCardState with plan entries
- `cleanup()` — finalize all, destroy timers

**Out-of-order handling:** When `onToolUpdate()` receives an ID not in current ToolStateMap, check `previousToolStateMap`. If found, update `previousToolCard` instead. This handles late-arriving updates from the previous prompt cycle.

**ToolCardState flush callback:** Receives `ToolCardSnapshot`, calls `renderToolCard(snapshot)` to build Discord embed, sends/edits message via channel.

### 2. Formatting (formatting.ts — rewrite)

#### Discord Embed Tool Card

Tool cards render as **Discord embeds** with:
- **Color sidebar:** Blue (`0x3498db`) while running, Green (`0x2ecc71`) when all done, Red (`0xe74c3c`) on error
- **Title:** "Agent Activity" (or agent name if available)
- **Description:** Rendered tool sections joined by newlines
- **Footer:** Plan progress if applicable

#### renderToolCard(snapshot: ToolCardSnapshot): EmbedData

Main renderer. Takes snapshot from ToolCardState, produces Discord.js `EmbedData`:
1. Filter non-hidden specs
2. Render each spec via `renderSpecSection(spec)`
3. Join sections with newlines
4. Determine color from completion state
5. Add plan as footer or inline if present
6. Handle embed description limit (4096 chars) — truncate and add overflow indicator

#### renderSpecSection(spec: ToolDisplaySpec): string

Per-tool Discord markdown section:

```markdown
✅ 📖 **Read** `src/adapter.ts`
> Lines 1-50

🔄 ✏️ **Edit** `src/index.ts`
> +5/-2 · [View Diff](url)

⏳ ▶️ **Run** `pnpm test`
> Running tests...
> [View Output](url)
```

Rules:
- Line 1: `{statusIcon} {kindIcon} **{title}**`
- Line 2+ (medium/high): `> {description}` or `> {command}`
- Output summary (medium/high): `> {summary}`
- Diff stats (medium/high): `> +X/-Y`
- Viewer links (medium/high): `> [View Diff](url) · [View Output](url)`
- Inline output (high only, short output): `> \`\`\`{content}\`\`\``

#### splitToolCardEmbed(description: string): string[]

If embed description exceeds 4096 chars, split at section boundaries (double newline). First chunk stays in original embed, overflow goes as follow-up embed(s).

#### renderUsageEmbed(usage, mode): EmbedData

Small embed for usage stats:
- Low: tokens only
- Medium: tokens + cost
- High: tokens + cost + progress bar + context ratio

### 3. Adapter Handler Updates (adapter.ts)

#### New fields on DiscordAdapter:
```typescript
private _activityTrackers: Map<string, ActivityTracker>
private _outputModeResolver: OutputModeResolver
```

#### getOrCreateTracker(sessionId, threadId, mode)
Creates ActivityTracker per session with:
- Resolved OutputMode
- TunnelService (from ServiceRegistry, optional)
- SessionContext (sessionId, threadId, adapterName)
- Flush callback wired to send/edit Discord message

#### Handler method changes:

**handleThought(sessionId, content)**
```
mode = resolver.resolve(configManager, "discord", sessionId, sessionManager)
tracker = getOrCreateTracker(sessionId, threadId, mode)
tracker.onThought(content.text)
```

**handleText(sessionId, content)**
```
tracker = getTracker(sessionId)
if (tracker && !textStarted) tracker.onTextStart()
draft = draftManager.getOrCreate(sessionId, threadId)
draft.append(content.text)
```

**handleToolCall(sessionId, content)**
```
draftManager.finalize(sessionId)
mode = resolver.resolve(...)
tracker = getOrCreateTracker(sessionId, threadId, mode)
tracker.onToolCall(content.meta, content.kind, content.rawInput)
```

**handleToolUpdate(sessionId, content)**
```
tracker = getTracker(sessionId)
tracker.onToolUpdate(content.id, content.status, content.content, content.viewerLinks, content.diffStats)
```

**handlePlan(sessionId, content)**
```
tracker = getTracker(sessionId)
tracker.onPlan(content.entries)
```

**handleUsage(sessionId, content)**
```
draftManager.finalize(sessionId)
mode = resolver.resolve(...)
embed = renderUsageEmbed(content, mode)
send embed to thread
send completion notification to notification channel
```

**handleSessionEnd(sessionId)**
```
draftManager.finalize(sessionId)
tracker = getTracker(sessionId)
tracker.cleanup()
delete tracker
```

### 4. Output Mode Command (commands/admin.ts)

Replace `/verbosity` with `/outputmode`:

```
/outputmode [low|medium|high]           — Set adapter default
/outputmode session [low|medium|high]   — Override for current session
/outputmode session reset               — Clear session override
/verbosity ...                          — Deprecated alias (same handler)
```

Slash command definition update:
- Rename command to `outputmode`
- Add `session` subcommand option
- Keep `verbosity` as alias

Callback buttons (in router.ts):
- `vb:low`, `vb:medium`, `vb:high` — quick mode switching buttons
- Attached to `/outputmode` response message

### 5. Config & Migration (index.ts)

On plugin setup, migrate legacy config:
- If `discord.displayVerbosity` exists and `discord.outputMode` doesn't → copy value
- Uses same pattern as Telegram's migration in `config-migrations.ts`

## Discord-Specific Considerations

### Message Limits
- Embed description: 4096 chars (same as Telegram message limit — convenient)
- Regular message: 2000 chars (affects text drafts, not tool cards)
- Embed total: 6000 chars (title + description + fields + footer)
- 10 embeds per message

### Rate Limiting
- Discord rate limits per route, more restrictive than Telegram
- ToolCardState debounce (500ms) helps batch updates
- SendQueue with `minInterval` prevents flooding
- Tool card edits instead of new messages reduces API calls significantly

### Typing Indicator
- Discord typing indicator lasts ~10 seconds, needs refresh every 8 seconds
- Already implemented in current ThinkingIndicator — reuse approach
- On high mode: when thinking ends, store thought content in viewer, post link

### Embed vs Message Split Strategy
- Tool card: always an embed (visually distinct)
- Text response: always a plain message (via DraftManager)
- Usage: always an embed (compact footer style)
- Errors: plain message with ❌ prefix (consistent with current behavior)

## Edge Cases

- **Tunnel unavailable:** Falls back to inline content if mode=high, no viewer links otherwise
- **Out-of-order updates:** Buffered in ToolStateMap pendingUpdates, or routed to previousToolCard
- **Large output:** Stored in viewer, link in embed. If no tunnel and high mode, inline truncated content
- **Embed overflow:** Description split at section boundaries, overflow in follow-up embed
- **Empty tool card:** If all specs are hidden (low mode, all noise), don't send embed
- **Session mode change mid-prompt:** New mode applies to next tracker creation (next prompt cycle)
- **Deprecated /verbosity command:** Routes to same handler, logs deprecation warning

## Files Changed

### New
- None (all changes to existing files)

### Rewritten
- `src/activity.ts` — ActivityTracker using adapter-primitives
- `src/formatting.ts` — Embed-based tool card rendering with ToolDisplaySpec

### Modified
- `src/adapter.ts` — Handler methods, OutputModeResolver, tracker management
- `src/commands/admin.ts` — `/outputmode` command with session overrides
- `src/commands/router.ts` — `vb:` callback button routing
- `src/commands/index.ts` — Slash command definitions update
- `src/index.ts` — Config migration for displayVerbosity → outputMode

### Removed
- `src/tool-call-tracker.ts` — Replaced by ToolCardState aggregation

## Dependencies

### Prerequisite: Export new primitives from @openacp/plugin-sdk

The new adapter-primitives (`ToolStateMap`, `DisplaySpecBuilder`, `OutputModeResolver`, `ToolCardState`, `ThoughtBuffer`, `ToolDisplaySpec`) are **not yet exported** from `@openacp/plugin-sdk`. The SDK currently only exports the old primitives (`ToolCallTracker`, `ActivityTracker`, `DraftManager`, `SendQueue`).

**Required changes in OpenACP core** (on `feat/api-server-redesign` branch):

In `packages/plugin-sdk/src/index.ts`, add:
```typescript
// --- New adapter primitives (runtime) ---
export { ToolStateMap, ThoughtBuffer } from '@openacp/cli'
export { DisplaySpecBuilder } from '@openacp/cli'
export { OutputModeResolver } from '@openacp/cli'
export { ToolCardState } from '@openacp/cli'

// --- New adapter primitive types ---
export type { ToolDisplaySpec, ToolCardSnapshot, ToolEntry, OutputMode } from '@openacp/cli'
```

These must be exported from `@openacp/cli`'s main index first (verify they are on the `feat/api-server-redesign` branch).

### Discord adapter imports

After the prerequisite, Discord imports from `@openacp/plugin-sdk`:
- `ToolStateMap`, `ThoughtBuffer`
- `DisplaySpecBuilder`, `ToolDisplaySpec`
- `OutputModeResolver`, `OutputMode`
- `ToolCardState`, `ToolCardSnapshot`
