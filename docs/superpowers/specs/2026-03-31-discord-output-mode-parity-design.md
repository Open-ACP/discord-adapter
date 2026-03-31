# Discord Output Mode Parity Design Spec

**Date:** 2026-03-31
**Branch:** `develop`
**Status:** Draft

## Overview

Bring the Discord adapter to full feature parity with the Telegram adapter's output mode system. This replaces the old `displayVerbosity` pass-through approach with the principled `OutputMode` system: 3-level cascade configuration (global → adapter → session), `DisplaySpecBuilder`, `ToolCardState` debounced aggregation, `ThoughtBuffer`, and out-of-order tool update handling.

**Approach:** Rewrite Discord's activity tracking and formatting layer to use the shared `adapter-primitives` infrastructure — the same components Telegram uses — with Discord-native rendering that leverages embeds, components, and Discord's visual language.

## Discord UX Design

### Design Principles

1. **Top-to-bottom reading flow** — A Discord thread with an AI should read like a conversation: user message → agent activity → agent response → done. No jumping around.
2. **Visual separation** — Agent "work" (tools, thinking) must be visually distinct from agent "speech" (text responses). Users should instantly tell what's happening vs. what the agent is saying.
3. **Status at a glance** — Discord users scan fast. Color, icons, and compact layout tell the story without reading.
4. **Progressive disclosure** — Show the right detail level. Non-dev users see results; power users see everything.
5. **Native Discord patterns** — Use embeds, buttons, typing indicators, and ephemeral messages where Discord users expect them.

### Reading Flow Per Prompt Cycle

```
┌─────────────────────────────────────────────────┐
│ 👤 User message                                 │  ← plain message
├─────────────────────────────────────────────────┤
│ ⌨️ Bot is typing...                             │  ← native Discord typing indicator
├─────────────────────────────────────────────────┤
│ ┌─ 🔵 ───────────────────────────────────────┐  │
│ │ 🤖 Working...                    2 of 4    │  │  ← embed, edited in place
│ │                                             │  │
│ │ ✅ 📖 **Read** `src/adapter.ts`            │  │
│ │  ╰ Lines 1-80                               │  │
│ │ ✅ ✏️ **Edit** `src/index.ts`              │  │
│ │  ╰ +12/−3 · [View Diff]                    │  │
│ │ 🔄 ▶️ **Run** `pnpm test`                 │  │
│ │  ╰ Running tests...                         │  │
│ │ ⏳ 🔍 **Search** `adapter pattern`         │  │
│ │                                             │  │
│ │ 📋 Step 2/5 — Refactor handlers            │  │
│ └─────────────────────────────────────────────┘  │
│  [🔇 Low] [📊 Medium] [🔍 High] [❌ Cancel]    │  ← action row buttons
├─────────────────────────────────────────────────┤
│ 🤖 Here's what I changed: the adapter now...    │  ← plain message (streamed)
├─────────────────────────────────────────────────┤
│ ┌─ ⚫ ───────────────────────────────────────┐  │
│ │ 📊 1.2k tokens · $0.003 · 12s              │  │  ← small embed, muted color
│ └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Visual Language

| Element | Discord Feature | Why |
|---------|----------------|-----|
| Agent thinking | Native typing indicator | Users recognize this instinctively |
| Tool activity | Embed with colored sidebar | Visually distinct from conversation text |
| Running status | 🔵 Blue sidebar | Familiar "in progress" |
| Completed status | 🟢 Green sidebar | Familiar "success" |
| Error status | 🔴 Red sidebar | Familiar "error" |
| Text response | Plain message | Feels like a normal conversation reply |
| Usage stats | Small muted embed (dark gray sidebar) | Metadata, not conversation |
| Mode switching | Button row under tool card | Quick access, no commands needed |
| Cancel | Button under tool card | Visible while agent is working |
| Permissions | Embed + buttons | Structured prompt, clear actions |
| `/outputmode` | Ephemeral reply | Config change doesn't clutter thread |

### Tool Card Embed — Detail by Mode

**Low mode** — Non-developer users. Show what happened, not how.
```
┌─ 🟢 ──────────────────────────────┐
│ ✅ Done                     4/4    │
│                                    │
│ ✅ 📖 Read · ✅ ✏️ Edit          │
│ ✅ ▶️ Run  · ✅ 📖 Read          │
└────────────────────────────────────┘
```
Compact grid of icons + kind labels. No file paths, no output. Just "what tools ran."

**Medium mode** (default) — General users. Show what and where.
```
┌─ 🟢 ──────────────────────────────┐
│ ✅ Done                     4/4    │
│                                    │
│ ✅ 📖 **Read** `src/adapter.ts`   │
│  ╰ Lines 1-80                      │
│ ✅ ✏️ **Edit** `src/index.ts`    │
│  ╰ +12/−3 · [View Diff]           │
│ ✅ ▶️ **Run** `pnpm test`        │
│  ╰ 42 tests passed                │
│ ✅ 📖 **Read** `src/types.ts`    │
│  ╰ Lines 1-25                      │
│                                    │
│ 📋 Step 3/5 — Update tests        │
└────────────────────────────────────┘
```
Title + description per tool. Output summary. Viewer links for long output.

**High mode** — Developers / power users. Show everything.
```
┌─ 🟢 ──────────────────────────────┐
│ ✅ Done                     4/4    │
│                                    │
│ ✅ 📖 **Read** `src/adapter.ts`   │
│  ╰ Lines 1-80                      │
│ ✅ ✏️ **Edit** `src/index.ts`    │
│  ╰ +12/−3 · [View Diff]           │
│ ✅ ▶️ **Run** `pnpm test`        │
│  ╰ ```                             │
│    PASS src/adapter.test.ts        │
│    42 tests passed                 │
│    ```                             │
│  ╰ [View Full Output]             │
│ ✅ 📖 **Read** `src/types.ts`    │
│  ╰ Lines 1-25                      │
│ 👁️ 🔍 **Glob** `**/*.test.ts`   │
│  ╰ 8 files matched                │
│                                    │
│ 💭 [View Thinking]                │
│ 📋 Step 3/5 — Update tests        │
└────────────────────────────────────┘
```
Inline output for short results. Noise tools shown (with 👁️ instead of status icon). Thinking viewer link. Full plan.

### Action Row Buttons

Buttons appear **under the tool card embed** while the agent is working:

```
[🔇 Low] [📊 Medium] [🔍 High] [❌ Cancel]
```

- **Mode buttons**: Switch output mode for current session (instant, re-renders tool card)
- **Cancel button**: Sends cancel to session (same as `/cancel`)
- Buttons are removed when the tool card finalizes (all complete/error)
- Button state: current mode button is disabled (visually indicates active mode)

### Usage Embed

Small, muted embed with dark gray sidebar (`0x2f3136` — Discord dark theme color):

**Low:**
```
┌─ ⚫ ──────────────────────┐
│ 📊 1.2k tokens · 12s      │
└────────────────────────────┘
```

**Medium:**
```
┌─ ⚫ ──────────────────────┐
│ 📊 1.2k tokens · $0.003   │
│ ⏱️ 12s                    │
└────────────────────────────┘
```

**High:**
```
┌─ ⚫ ─────────────────────────┐
│ 📊 1.2k / 200k tokens        │
│ ▓▓░░░░░░░░ 6% context        │
│ 💰 $0.003 · ⏱️ 12s          │
└───────────────────────────────┘
```

### Ephemeral Responses

These commands reply with **ephemeral messages** (only visible to the invoker, auto-dismissed):
- `/outputmode` — confirms mode change without cluttering the thread
- `/status` — session status (transient info)

### Thinking Indicator

1. Agent starts thinking → Discord typing indicator (native `channel.sendTyping()`)
2. Typing refreshes every 8 seconds while thinking continues
3. When thinking ends:
   - Low/medium: typing stops silently
   - High: thought content stored in tunnel viewer, link appears in tool card as `💭 [View Thinking]`

### Permission Request

```
┌─ 🟡 ───────────────────────────────┐
│ 🔐 Permission Required             │
│                                     │
│ **Run command**                     │
│ `rm -rf dist/ && pnpm build`       │
│                                     │
│ Allow this tool to execute?         │
└─────────────────────────────────────┘
 [✅ Allow] [⛔ Deny] [✅ Always Allow]
```

Yellow sidebar for attention. Structured embed with clear context. Action buttons below.

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
- `commands/router.ts` — new callback routing for `vb:` prefix and action row buttons
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
| Tool icon + kind label | Yes (grid) | Yes (per line) | Yes (per line) |
| Tool title (file/command) | No | Yes | Yes |
| Tool description | No | Yes | Yes |
| Command text | No | Yes | Yes |
| Output summary | No | Yes | Yes |
| Inline output content | No | No | Yes (if short) |
| View Output link | No | Yes | Yes |
| Diff stats (+X/-Y) | No | Yes | Yes |
| Thinking viewer link | No | No | Yes |
| Noise tools | Hidden | Hidden | Shown (👁️ icon) |
| Plan progress | No | Compact (footer) | Full list |
| Action row buttons | Yes | Yes | Yes |
| Usage embed | Compact | Medium detail | Full detail |

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

**Out-of-order handling:** When `onToolUpdate()` receives an ID not in current ToolStateMap, check `previousToolStateMap`. If found, update `previousToolCard` instead.

**ToolCardState flush callback:** Receives `ToolCardSnapshot`, calls `renderToolCard(snapshot, mode)` to build Discord embed + action row, sends/edits message.

### 2. Formatting (formatting.ts — rewrite)

#### renderToolCard(snapshot, mode): { embeds, components }

Returns Discord.js message payload with embed(s) + action row.

**Embed structure:**
- **Color:** Blue (`0x3498db`) running, Green (`0x2ecc71`) done, Red (`0xe74c3c`) error
- **Author line:** Status label + completion counter (e.g. "🔄 Working... 2 of 4" or "✅ Done 4/4")
- **Description:** Rendered tool sections (mode-dependent)
- **Footer:** Plan progress (if applicable)

**Action row (while running):**
- Mode buttons: `[🔇 Low] [📊 Medium] [🔍 High]` — current mode disabled
- Cancel button: `[❌ Cancel]` — danger style
- Custom IDs: `om:{sessionId}:low`, `om:{sessionId}:medium`, `om:{sessionId}:high`, `cancel:{sessionId}`
- Removed on finalize (edit message without components)

#### renderSpecSection(spec, mode): string

**Low mode:** `{statusIcon} {kindIcon} {kindLabel}` — compact, grid layout (multiple per line separated by ` · `)

**Medium mode:**
```
{statusIcon} {kindIcon} **{title}**
 ╰ {description or summary}
 ╰ {diffStats} · [View Diff](url)
```

**High mode:** Same as medium plus:
```
 ╰ ```
   {inline output content}
   ```
 ╰ [View Full Output](url)
```

Noise tools (high only): `👁️ {kindIcon} **{title}**` with muted presentation.

#### renderUsageEmbed(usage, mode): EmbedData

Dark gray sidebar (`0x2f3136`). Content scales by mode (see UX section above).

#### renderPermissionEmbed(request): { embeds, components }

Yellow sidebar (`0xf1c40f`). Tool name, command/input display, action buttons.

#### splitToolCardEmbed(description): string[]

If embed description exceeds 4096 chars, split at section boundaries (double newline). First chunk in original embed, overflow in follow-up embed(s) with same color, no author.

### 3. Adapter Handler Updates (adapter.ts)

#### New fields:
```typescript
private _activityTrackers: Map<string, ActivityTracker>
private _outputModeResolver: OutputModeResolver
```

#### getOrCreateTracker(sessionId, threadId, mode)
Creates ActivityTracker per session with resolved OutputMode, TunnelService, SessionContext, and flush callback wired to send/edit Discord embed message.

#### Handler methods:

**handleThought(sessionId, content):**
Resolve mode → get/create tracker → `tracker.onThought(content.text)`

**handleText(sessionId, content):**
If first text chunk: `tracker.onTextStart()` (seals tool card, removes action buttons)
Get/create draft → `draft.append(content.text)`

**handleToolCall(sessionId, content):**
Finalize draft → resolve mode → get/create tracker → `tracker.onToolCall(...)`

**handleToolUpdate(sessionId, content):**
Get tracker → `tracker.onToolUpdate(...)`

**handlePlan(sessionId, content):**
Get tracker → `tracker.onPlan(content.entries)`

**handleUsage(sessionId, content):**
Finalize draft → resolve mode → render usage embed → send to thread → notify notification channel

**handleSessionEnd(sessionId):**
Finalize draft → tracker.cleanup() → delete tracker

#### Action row button handlers (adapter.ts or router.ts):

- `om:{sessionId}:{mode}` — update session outputMode, re-render current tool card with new mode
- `cancel:{sessionId}` — call `session.cancel()`, same as `/cancel`

### 4. Output Mode Command (commands/admin.ts)

```
/outputmode [low|medium|high]           — Set adapter default (ephemeral reply)
/outputmode session [low|medium|high]   — Override for current session (ephemeral reply)
/outputmode session reset               — Clear session override (ephemeral reply)
/verbosity ...                          — Deprecated alias
```

All replies are **ephemeral** — config changes don't clutter the conversation thread.

### 5. Config & Migration (index.ts)

On plugin setup, migrate legacy config:
- If `discord.displayVerbosity` exists and `discord.outputMode` doesn't → copy value

## Discord-Specific Considerations

### Message Limits
- Embed description: 4096 chars
- Embed total: 6000 chars (title + description + fields + footer)
- Regular message: 2000 chars (text drafts only)
- 10 embeds per message, 5 action rows per message

### Rate Limiting
- ToolCardState debounce (500ms) batches updates
- SendQueue with `minInterval` prevents flooding
- Edit-in-place for tool card = 1 message regardless of tool count
- Action row button interactions have 3-second ACK deadline — respond immediately

### Mode Switch Re-render
When user clicks a mode button on the tool card:
1. Update session's outputMode
2. Regenerate all ToolDisplaySpecs from current ToolStateMap with new mode
3. Re-render tool card embed
4. Edit message with new embed + updated action row (new mode disabled)
5. Respond to interaction with ephemeral "Switched to {mode} mode"

### Typing Indicator
- Discord typing lasts ~10 seconds, refresh every 8 seconds
- Already implemented — reuse approach
- High mode: store thought in viewer on text start, add link to tool card

### Embed vs Message Strategy
| Content Type | Discord Feature | Why |
|-------------|----------------|-----|
| Tool activity | Embed (colored sidebar) | Visually distinct from conversation |
| Text response | Plain message | Feels like natural conversation |
| Usage | Small embed (gray sidebar) | Metadata, unobtrusive |
| Permissions | Embed (yellow sidebar) + buttons | Attention-grabbing, actionable |
| Errors | Plain message with ❌ | Simple, clear |
| `/outputmode` reply | Ephemeral message | Doesn't clutter thread |

## Edge Cases

- **Tunnel unavailable:** No viewer links. High mode falls back to inline truncated content.
- **Out-of-order updates:** Buffered in ToolStateMap pendingUpdates, or routed to previousToolCard.
- **Large output:** Stored in viewer, link in embed. No tunnel + high mode = inline truncated.
- **Embed overflow:** Description split at section boundaries, follow-up embed(s).
- **Empty tool card:** All specs hidden (low mode, all noise) → don't send embed.
- **Mode change mid-prompt:** Re-renders current tool card immediately with new mode.
- **Button interaction timeout:** Discord requires ACK within 3 seconds. Mode switch and cancel handlers must ACK immediately, then process async.
- **Deprecated /verbosity:** Routes to same handler, works identically.

## Files Changed

### New
- None (all changes to existing files)

### Rewritten
- `src/activity.ts` — ActivityTracker using adapter-primitives
- `src/formatting.ts` — Embed-based tool card rendering with ToolDisplaySpec

### Modified
- `src/adapter.ts` — Handler methods, OutputModeResolver, tracker management, action row handlers
- `src/commands/admin.ts` — `/outputmode` command with session overrides, ephemeral replies
- `src/commands/router.ts` — `om:` and `cancel:` button routing
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
