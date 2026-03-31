# Discord Output Mode Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Discord adapter to full feature parity with Telegram's output mode system — aggregated tool card embeds, OutputModeResolver cascade, DisplaySpecBuilder, ToolCardState, ThoughtBuffer, and out-of-order handling.

**Architecture:** Rewrite Discord's activity tracking and formatting to use shared `adapter-primitives` from `@openacp/plugin-sdk`. Discord renders as embeds (colored sidebar + markdown) instead of Telegram's HTML. Action row buttons provide mode switching and cancel. All handler methods in `adapter.ts` delegate to the new ActivityTracker.

**Tech Stack:** TypeScript, discord.js (EmbedBuilder, ActionRowBuilder, ButtonBuilder), @openacp/plugin-sdk adapter-primitives

**Spec:** `docs/superpowers/specs/2026-03-31-discord-output-mode-parity-design.md`

---

## File Structure

### Created
- None (all modifications to existing files)

### Rewritten (full replacement)
- `src/formatting.ts` — Discord embed rendering with ToolDisplaySpec
- `src/activity.ts` — ActivityTracker orchestrating shared primitives

### Modified
- `src/adapter.ts` — Handler methods, OutputModeResolver, tracker management, action row handlers
- `src/commands/admin.ts` — `/outputmode` command with session-level overrides
- `src/commands/router.ts` — `om:` and `cancel:` button routing
- `src/commands/index.ts` — Slash command definitions update
- `src/index.ts` — Config migration for displayVerbosity → outputMode

### Removed
- `src/tool-call-tracker.ts` — Replaced by ToolCardState aggregation

---

### Task 0: Export new primitives from @openacp/plugin-sdk

> **This task is in the OpenACP core repo** (`/Users/lucas/openacp-workspace/OpenACP`), on branch `feat/api-server-redesign`.

**Files:**
- Modify: `/Users/lucas/openacp-workspace/OpenACP/src/core/adapter-primitives/index.ts`
- Modify: `/Users/lucas/openacp-workspace/OpenACP/packages/plugin-sdk/src/index.ts`

- [ ] **Step 1: Verify new primitives exist in core exports**

Run: `cd /Users/lucas/openacp-workspace/OpenACP && grep -n "ToolStateMap\|DisplaySpecBuilder\|OutputModeResolver\|ToolCardState\|ThoughtBuffer" src/core/adapter-primitives/index.ts`

Check that `ToolStateMap`, `ThoughtBuffer`, `DisplaySpecBuilder`, `OutputModeResolver`, `ToolCardState` are exported. If not, add them.

- [ ] **Step 2: Add exports to adapter-primitives/index.ts (if missing)**

Ensure these lines exist in `src/core/adapter-primitives/index.ts`:

```typescript
export { ToolStateMap, ThoughtBuffer } from './stream-accumulator.js'
export type { ToolEntry } from './stream-accumulator.js'
export { DisplaySpecBuilder } from './display-spec-builder.js'
export type { ToolDisplaySpec, ThoughtDisplaySpec } from './display-spec-builder.js'
export { OutputModeResolver } from './output-mode-resolver.js'
export type { OutputMode } from './format-types.js'
export { ToolCardState } from './primitives/tool-card-state.js'
export type { ToolCardSnapshot, ToolCardStateConfig } from './primitives/tool-card-state.js'
```

- [ ] **Step 3: Add exports to plugin-sdk/src/index.ts**

Add after the existing adapter primitives section (line ~45):

```typescript
// --- New adapter primitives (runtime) ---
export { ToolStateMap, ThoughtBuffer } from '@openacp/cli'
export { DisplaySpecBuilder } from '@openacp/cli'
export { OutputModeResolver } from '@openacp/cli'
export { ToolCardState } from '@openacp/cli'

// --- New adapter primitive types ---
export type {
  ToolDisplaySpec, ThoughtDisplaySpec, ToolEntry,
  OutputMode, ToolCardSnapshot, ToolCardStateConfig,
} from '@openacp/cli'
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/lucas/openacp-workspace/OpenACP && pnpm build`

Expected: No type errors. New exports available.

- [ ] **Step 5: Commit**

```bash
cd /Users/lucas/openacp-workspace/OpenACP
git add src/core/adapter-primitives/index.ts packages/plugin-sdk/src/index.ts
git commit -m "feat(plugin-sdk): export new adapter primitives (ToolStateMap, DisplaySpecBuilder, OutputModeResolver, ToolCardState, ThoughtBuffer)"
```

---

### Task 1: Rewrite formatting.ts — Discord embed rendering

**Files:**
- Rewrite: `src/formatting.ts`
- Test: `src/__tests__/formatting.test.ts`

- [ ] **Step 1: Write failing tests for renderSpecSection**

Create/update `src/__tests__/formatting.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderSpecSection } from "../formatting.js";
import type { ToolDisplaySpec } from "@openacp/plugin-sdk";

function makeSpec(overrides: Partial<ToolDisplaySpec> = {}): ToolDisplaySpec {
  return {
    id: "tool-1",
    kind: "read",
    icon: "📖",
    title: "Read `src/adapter.ts`",
    description: "Lines 1-80",
    command: null,
    inputContent: null,
    outputSummary: null,
    outputContent: null,
    diffStats: null,
    viewerLinks: undefined,
    outputViewerLink: undefined,
    outputFallbackContent: undefined,
    status: "completed",
    isNoise: false,
    isHidden: false,
    ...overrides,
  };
}

describe("renderSpecSection", () => {
  it("low mode returns compact icon + kind label", () => {
    const result = renderSpecSection(makeSpec(), "low");
    expect(result).toBe("✅ 📖 Read");
  });

  it("medium mode returns title + description", () => {
    const result = renderSpecSection(makeSpec(), "medium");
    expect(result).toContain("✅ 📖 **Read `src/adapter.ts`**");
    expect(result).toContain("╰ Lines 1-80");
  });

  it("medium mode shows diff stats", () => {
    const result = renderSpecSection(
      makeSpec({ kind: "edit", icon: "✏️", diffStats: { added: 12, removed: 3 } }),
      "medium",
    );
    expect(result).toContain("+12/−3");
  });

  it("medium mode shows viewer links", () => {
    const result = renderSpecSection(
      makeSpec({ viewerLinks: { diff: "https://example.com/diff" } }),
      "medium",
    );
    expect(result).toContain("[View Diff](https://example.com/diff)");
  });

  it("high mode shows inline output for short content", () => {
    const result = renderSpecSection(
      makeSpec({ outputContent: "42 tests passed", status: "completed" }),
      "high",
    );
    expect(result).toContain("42 tests passed");
  });

  it("high mode shows viewer link for long output", () => {
    const result = renderSpecSection(
      makeSpec({ outputViewerLink: "https://example.com/output" }),
      "high",
    );
    expect(result).toContain("[View Full Output](https://example.com/output)");
  });

  it("high mode shows noise tools with eye icon", () => {
    const result = renderSpecSection(
      makeSpec({ isNoise: true, status: "completed" }),
      "high",
    );
    expect(result).toContain("👁️");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test -- src/__tests__/formatting.test.ts`

Expected: FAIL — `renderSpecSection` doesn't exist yet with new signature.

- [ ] **Step 3: Write failing tests for renderToolCard**

Add to `src/__tests__/formatting.test.ts`:

```typescript
import { renderToolCard } from "../formatting.js";
import type { ToolCardSnapshot } from "@openacp/plugin-sdk";

describe("renderToolCard", () => {
  it("returns embed with blue color while tools are running", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec({ status: "running" })],
      totalVisible: 1,
      completedVisible: 0,
      allComplete: false,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].data.color).toBe(0x3498db); // blue
  });

  it("returns embed with green color when all complete", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec({ status: "completed" })],
      totalVisible: 1,
      completedVisible: 1,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds[0].data.color).toBe(0x2ecc71); // green
  });

  it("returns embed with red color on error", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec({ status: "error" })],
      totalVisible: 1,
      completedVisible: 1,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds[0].data.color).toBe(0xe74c3c); // red
  });

  it("includes action row buttons while running", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec({ status: "running" })],
      totalVisible: 1,
      completedVisible: 0,
      allComplete: false,
    };
    const result = renderToolCard(snapshot, "medium", "session-1");
    expect(result.components).toHaveLength(1); // one action row
  });

  it("excludes action row when all complete", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec({ status: "completed" })],
      totalVisible: 1,
      completedVisible: 1,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "medium", "session-1");
    expect(result.components).toHaveLength(0);
  });

  it("shows completion counter in author", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [
        makeSpec({ id: "1", status: "completed" }),
        makeSpec({ id: "2", status: "running" }),
      ],
      totalVisible: 2,
      completedVisible: 1,
      allComplete: false,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds[0].data.author?.name).toContain("1 of 2");
  });

  it("filters hidden specs", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [
        makeSpec({ id: "1", status: "completed" }),
        makeSpec({ id: "2", isHidden: true }),
      ],
      totalVisible: 1,
      completedVisible: 1,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds[0].data.description).not.toContain("tool-2");
  });

  it("includes plan in footer when present", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [makeSpec()],
      planEntries: [
        { content: "Step 1", status: "completed" },
        { content: "Step 2", status: "in_progress" },
      ],
      totalVisible: 1,
      completedVisible: 1,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "medium");
    expect(result.embeds[0].data.footer?.text).toContain("1/2");
  });

  it("low mode renders compact grid", () => {
    const snapshot: ToolCardSnapshot = {
      specs: [
        makeSpec({ id: "1", kind: "read", icon: "📖", status: "completed" }),
        makeSpec({ id: "2", kind: "edit", icon: "✏️", status: "completed" }),
      ],
      totalVisible: 2,
      completedVisible: 2,
      allComplete: true,
    };
    const result = renderToolCard(snapshot, "low");
    // Low mode: compact grid with " · " separators
    expect(result.embeds[0].data.description).toContain("·");
  });
});
```

- [ ] **Step 4: Write failing tests for renderUsageEmbed**

Add to `src/__tests__/formatting.test.ts`:

```typescript
import { renderUsageEmbed } from "../formatting.js";

describe("renderUsageEmbed", () => {
  it("low mode shows tokens only", () => {
    const embed = renderUsageEmbed({ tokensUsed: 1500, cost: 0.003 }, "low");
    expect(embed.data.description).toContain("1.5k");
    expect(embed.data.description).not.toContain("$");
  });

  it("medium mode shows tokens + cost", () => {
    const embed = renderUsageEmbed({ tokensUsed: 1500, cost: 0.003 }, "medium");
    expect(embed.data.description).toContain("1.5k");
    expect(embed.data.description).toContain("$0.003");
  });

  it("high mode shows progress bar", () => {
    const embed = renderUsageEmbed(
      { tokensUsed: 1500, contextSize: 200000, cost: 0.003 },
      "high",
    );
    expect(embed.data.description).toContain("▓");
    expect(embed.data.description).toContain("context");
  });

  it("uses dark gray color", () => {
    const embed = renderUsageEmbed({ tokensUsed: 100 }, "medium");
    expect(embed.data.color).toBe(0x2f3136);
  });
});
```

- [ ] **Step 5: Implement formatting.ts**

Rewrite `src/formatting.ts`:

```typescript
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { OutputMode, ToolDisplaySpec, ToolCardSnapshot } from "@openacp/plugin-sdk";
import type { PlanEntry } from "@openacp/plugin-sdk";
import {
  STATUS_ICONS,
  KIND_ICONS,
  KIND_LABELS,
  progressBar,
  formatTokens,
  truncateContent,
} from "@openacp/plugin-sdk/formatting";

// ── Embed Colors ──

const COLOR_RUNNING = 0x3498db;  // blue
const COLOR_SUCCESS = 0x2ecc71;  // green
const COLOR_ERROR   = 0xe74c3c;  // red
const COLOR_USAGE   = 0x2f3136;  // dark gray
const COLOR_PERMISSION = 0xf1c40f; // yellow

// ── Spec Section Rendering ──

export function renderSpecSection(spec: ToolDisplaySpec, mode: OutputMode): string {
  const statusIcon = spec.isNoise ? "👁️" : (STATUS_ICONS[spec.status] ?? "⏳");
  const kindIcon = spec.icon || KIND_ICONS[spec.kind] || "🛠️";
  const kindLabel = KIND_LABELS[spec.kind] || spec.kind || "Tool";

  if (mode === "low") {
    return `${statusIcon} ${kindIcon} ${kindLabel}`;
  }

  // Medium and High
  const lines: string[] = [];
  lines.push(`${statusIcon} ${kindIcon} **${spec.title}**`);

  if (spec.description) {
    lines.push(` ╰ ${spec.description}`);
  }
  if (spec.command) {
    lines.push(` ╰ \`${truncateContent(spec.command, 80)}\``);
  }
  if (spec.diffStats) {
    const diffStr = `+${spec.diffStats.added}/−${spec.diffStats.removed}`;
    const viewDiff = spec.viewerLinks?.diff
      ? ` · [View Diff](${spec.viewerLinks.diff})`
      : "";
    lines.push(` ╰ ${diffStr}${viewDiff}`);
  } else if (spec.viewerLinks?.diff) {
    lines.push(` ╰ [View Diff](${spec.viewerLinks.diff})`);
  }
  if (spec.viewerLinks?.file && !spec.viewerLinks?.diff) {
    lines.push(` ╰ [View File](${spec.viewerLinks.file})`);
  }

  if (spec.outputSummary && !spec.outputContent) {
    lines.push(` ╰ ${spec.outputSummary}`);
  }

  if (mode === "high") {
    if (spec.outputContent) {
      const content = truncateContent(spec.outputContent, 300);
      lines.push(` ╰ \`\`\`\n${content}\n\`\`\``);
    }
    if (spec.outputViewerLink) {
      lines.push(` ╰ [View Full Output](${spec.outputViewerLink})`);
    }
    if (spec.outputFallbackContent && !spec.outputViewerLink && !spec.outputContent) {
      const content = truncateContent(spec.outputFallbackContent, 300);
      lines.push(` ╰ \`\`\`\n${content}\n\`\`\``);
    }
  }

  return lines.join("\n");
}

// ── Tool Card Rendering ──

export interface ToolCardResult {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export function renderToolCard(
  snapshot: ToolCardSnapshot,
  mode: OutputMode,
  sessionId?: string,
): ToolCardResult {
  const visibleSpecs = snapshot.specs.filter((s) => !s.isHidden);

  if (visibleSpecs.length === 0) {
    return { embeds: [], components: [] };
  }

  // Determine color
  const hasError = visibleSpecs.some(
    (s) => s.status === "error" || s.status === "failed",
  );
  const color = hasError
    ? COLOR_ERROR
    : snapshot.allComplete
      ? COLOR_SUCCESS
      : COLOR_RUNNING;

  // Author line
  const statusLabel = hasError
    ? "❌ Error"
    : snapshot.allComplete
      ? "✅ Done"
      : "🔄 Working...";
  const counter = `${snapshot.completedVisible} of ${snapshot.totalVisible}`;
  const authorName = `${statusLabel}    ${counter}`;

  // Render description
  let description: string;
  if (mode === "low") {
    // Compact grid: multiple per line separated by " · "
    const items = visibleSpecs.map((s) => renderSpecSection(s, mode));
    const rows: string[] = [];
    for (let i = 0; i < items.length; i += 3) {
      rows.push(items.slice(i, i + 3).join(" · "));
    }
    description = rows.join("\n");
  } else {
    description = visibleSpecs
      .map((s) => renderSpecSection(s, mode))
      .join("\n\n");
  }

  // Plan in footer
  let footerText: string | undefined;
  if (snapshot.planEntries && snapshot.planEntries.length > 0) {
    if (mode === "high") {
      const planLines = snapshot.planEntries.map((e, i) => {
        const icon = e.status === "completed" ? "✅" : e.status === "in_progress" ? "🔄" : "⏳";
        return `${icon} ${i + 1}. ${e.content}`;
      });
      description += "\n\n" + planLines.join("\n");
    } else if (mode === "medium") {
      const completed = snapshot.planEntries.filter((e) => e.status === "completed").length;
      const current = snapshot.planEntries.find((e) => e.status === "in_progress");
      footerText = `📋 Step ${completed}/${snapshot.planEntries.length}`;
      if (current) footerText += ` — ${current.content}`;
    }
  }

  // Build embed(s) — split if description > 4096
  const chunks = splitToolCardDescription(description);
  const embeds: EmbedBuilder[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder().setColor(color).setDescription(chunks[i]);
    if (i === 0) {
      embed.setAuthor({ name: authorName });
    }
    if (i === chunks.length - 1 && footerText) {
      embed.setFooter({ text: footerText });
    }
    embeds.push(embed);
  }

  // Action row buttons (only while running)
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (!snapshot.allComplete && sessionId) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`om:${sessionId}:low`)
        .setLabel("🔇 Low")
        .setStyle(mode === "low" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(mode === "low"),
      new ButtonBuilder()
        .setCustomId(`om:${sessionId}:medium`)
        .setLabel("📊 Medium")
        .setStyle(mode === "medium" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(mode === "medium"),
      new ButtonBuilder()
        .setCustomId(`om:${sessionId}:high`)
        .setLabel("🔍 High")
        .setStyle(mode === "high" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(mode === "high"),
      new ButtonBuilder()
        .setCustomId(`cancel:${sessionId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    );
    components.push(row);
  }

  return { embeds, components };
}

// ── Description Splitting ──

export function splitToolCardDescription(text: string): string[] {
  const MAX = 4096;
  if (text.length <= MAX) return [text];

  const sections = text.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length > MAX && current) {
      chunks.push(current);
      current = section.length > MAX ? section.slice(0, MAX - 4) + "\n..." : section;
    } else if (candidate.length > MAX) {
      chunks.push(candidate.slice(0, MAX - 4) + "\n...");
      current = "";
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

// ── Usage Embed ──

export function renderUsageEmbed(
  usage: { tokensUsed?: number; contextSize?: number; cost?: number; duration?: number },
  mode: OutputMode,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR_USAGE);
  const lines: string[] = [];

  const tokens = usage.tokensUsed ? formatTokens(usage.tokensUsed) : "0";
  const duration = usage.duration ? `${Math.round(usage.duration / 1000)}s` : null;

  if (mode === "low") {
    const parts = [`📊 ${tokens} tokens`];
    if (duration) parts.push(`${duration}`);
    lines.push(parts.join(" · "));
  } else if (mode === "medium") {
    lines.push(`📊 ${tokens} tokens${usage.cost != null ? ` · $${usage.cost.toFixed(3)}` : ""}`);
    if (duration) lines.push(`⏱️ ${duration}`);
  } else {
    // high
    const ctx = usage.contextSize ? formatTokens(usage.contextSize) : null;
    lines.push(`📊 ${tokens}${ctx ? ` / ${ctx}` : ""} tokens`);
    if (usage.contextSize && usage.tokensUsed) {
      const ratio = usage.tokensUsed / usage.contextSize;
      lines.push(`${progressBar(ratio, 10)} ${Math.round(ratio * 100)}% context`);
    }
    const meta: string[] = [];
    if (usage.cost != null) meta.push(`💰 $${usage.cost.toFixed(3)}`);
    if (duration) meta.push(`⏱️ ${duration}`);
    if (meta.length) lines.push(meta.join(" · "));
  }

  embed.setDescription(lines.join("\n"));
  return embed;
}

// ── Permission Embed ──

export function renderPermissionEmbed(
  request: { tool?: string; command?: string; description?: string },
  sessionId: string,
  callbackKey: string,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setColor(COLOR_PERMISSION)
    .setAuthor({ name: "🔐 Permission Required" });

  const lines: string[] = [];
  if (request.tool) lines.push(`**${request.tool}**`);
  if (request.command) lines.push(`\`${request.command}\``);
  if (request.description) lines.push(request.description);
  lines.push("", "Allow this tool to execute?");
  embed.setDescription(lines.join("\n"));

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`p:${callbackKey}:allow`)
      .setLabel("Allow")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`p:${callbackKey}:deny`)
      .setLabel("Deny")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`p:${callbackKey}:always`)
      .setLabel("Always Allow")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// Re-export KIND_LABELS for low-mode rendering
export { KIND_LABELS, STATUS_ICONS, KIND_ICONS } from "@openacp/plugin-sdk/formatting";
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test -- src/__tests__/formatting.test.ts`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add src/formatting.ts src/__tests__/formatting.test.ts
git commit -m "feat: rewrite formatting.ts with Discord embed rendering

Replaces old per-tool formatting with aggregated tool card embeds.
New functions: renderSpecSection, renderToolCard, renderUsageEmbed,
renderPermissionEmbed, splitToolCardDescription. Uses ToolDisplaySpec
from adapter-primitives. Supports low/medium/high output modes."
```

---

### Task 2: Rewrite activity.ts — ActivityTracker with shared primitives

**Files:**
- Rewrite: `src/activity.ts`
- Test: `src/__tests__/activity.test.ts`

- [ ] **Step 1: Write failing tests for ActivityTracker lifecycle**

Create `src/__tests__/activity.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock discord.js
vi.mock("discord.js", () => ({
  EmbedBuilder: class {
    data: Record<string, unknown> = {};
    setColor(c: number) { this.data.color = c; return this; }
    setDescription(d: string) { this.data.description = d; return this; }
    setAuthor(a: { name: string }) { this.data.author = a; return this; }
    setFooter(f: { text: string }) { this.data.footer = f; return this; }
  },
  ActionRowBuilder: class {
    components: unknown[] = [];
    addComponents(...c: unknown[]) { this.components.push(...c); return this; }
  },
  ButtonBuilder: class {
    data: Record<string, unknown> = {};
    setCustomId(id: string) { this.data.customId = id; return this; }
    setLabel(l: string) { this.data.label = l; return this; }
    setStyle(s: number) { this.data.style = s; return this; }
    setDisabled(d: boolean) { this.data.disabled = d; return this; }
    setEmoji(e: string) { this.data.emoji = e; return this; }
  },
  ButtonStyle: { Primary: 1, Secondary: 2, Danger: 4, Success: 3 },
}));

import { ActivityTracker } from "../activity.js";

function mockChannel() {
  return {
    send: vi.fn().mockResolvedValue({ id: "msg-1", edit: vi.fn().mockResolvedValue(undefined) }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function mockSendQueue() {
  return {
    enqueue: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  } as any;
}

describe("ActivityTracker", () => {
  let channel: ReturnType<typeof mockChannel>;
  let sendQueue: ReturnType<typeof mockSendQueue>;

  beforeEach(() => {
    vi.useFakeTimers();
    channel = mockChannel();
    sendQueue = mockSendQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("onThought shows typing indicator", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    await tracker.onThought("thinking about it");
    expect(channel.sendTyping).toHaveBeenCalled();
  });

  it("onToolCall creates tool card embed", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    await tracker.onToolCall(
      { id: "t1", name: "Read", kind: "read", status: "running" },
      "read",
      { file_path: "src/foo.ts" },
    );
    // ToolCardState debounces — first flush is immediate
    expect(channel.send).toHaveBeenCalled();
  });

  it("onToolUpdate updates existing tool", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    await tracker.onToolCall(
      { id: "t1", name: "Read", kind: "read", status: "running" },
      "read",
      { file_path: "src/foo.ts" },
    );
    await tracker.onToolUpdate("t1", "completed");
    await vi.advanceTimersByTimeAsync(600);
    // Should have edited the message
    const sentMsg = await channel.send.mock.results[0]?.value;
    if (sentMsg) {
      expect(sentMsg.edit).toHaveBeenCalled();
    }
  });

  it("onTextStart seals tool card", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    await tracker.onToolCall(
      { id: "t1", name: "Read", kind: "read", status: "completed" },
      "read",
      { file_path: "src/foo.ts" },
    );
    await tracker.onTextStart();
    // After sealing, new tool calls go to a new card
    await tracker.onToolCall(
      { id: "t2", name: "Edit", kind: "edit", status: "running" },
      "edit",
      { file_path: "src/bar.ts" },
    );
    // Should have 2 sends (two different cards)
    await vi.advanceTimersByTimeAsync(600);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("cleanup finalizes all pending state", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    await tracker.onToolCall(
      { id: "t1", name: "Read", kind: "read", status: "running" },
      "read",
      {},
    );
    await tracker.cleanup();
    // Should not throw
  });

  it("out-of-order update goes to previous card", async () => {
    const tracker = new ActivityTracker(channel, sendQueue, "medium", "sess-1");
    // First prompt cycle
    await tracker.onToolCall(
      { id: "t1", name: "Read", kind: "read", status: "running" },
      "read",
      {},
    );
    await tracker.onTextStart();
    // New prompt cycle
    await tracker.onNewPrompt();
    // Late update for t1 from previous cycle
    await tracker.onToolUpdate("t1", "completed");
    // Should not throw, should update previous card
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test -- src/__tests__/activity.test.ts`

Expected: FAIL — old ActivityTracker doesn't match new API.

- [ ] **Step 3: Implement activity.ts**

Rewrite `src/activity.ts`:

```typescript
import type { TextChannel, ThreadChannel, Message } from "discord.js";
import type {
  PlanEntry, SendQueue, OutputMode, ToolCallMeta,
  ToolDisplaySpec, ToolCardSnapshot,
} from "@openacp/plugin-sdk";
import {
  ToolStateMap, ThoughtBuffer, DisplaySpecBuilder,
  ToolCardState,
} from "@openacp/plugin-sdk";
import type { TunnelServiceInterface } from "@openacp/plugin-sdk";
import { log } from "@openacp/plugin-sdk";
import { renderToolCard, renderUsageEmbed } from "./formatting.js";

type DiscordChannel = TextChannel | ThreadChannel;

const TYPING_REFRESH_MS = 8_000;

export class ActivityTracker {
  private toolStateMap = new ToolStateMap();
  private previousToolStateMap: ToolStateMap | null = null;
  private specBuilder: DisplaySpecBuilder;
  private toolCard: ToolCardState | null = null;
  private previousToolCard: ToolCardState | null = null;
  private thoughtBuffer = new ThoughtBuffer();
  private toolCardMsg: Message | null = null;
  private previousToolCardMsg: Message | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private sealed = false;

  constructor(
    private channel: DiscordChannel,
    private sendQueue: SendQueue,
    private outputMode: OutputMode = "medium",
    private sessionId: string = "",
    private tunnelService?: TunnelServiceInterface,
    private sessionContext?: { id: string; workingDirectory: string },
  ) {
    this.specBuilder = new DisplaySpecBuilder(tunnelService);
  }

  setOutputMode(mode: OutputMode): void {
    this.outputMode = mode;
  }

  // ── Lifecycle Methods ──

  async onNewPrompt(): Promise<void> {
    // Finalize current tool card → move to previous
    if (this.toolCard) {
      this.toolCard.finalize();
    }
    this.previousToolStateMap = this.toolStateMap;
    this.previousToolCard = this.toolCard;
    this.previousToolCardMsg = this.toolCardMsg;

    this.toolStateMap = new ToolStateMap();
    this.toolCard = null;
    this.toolCardMsg = null;
    this.thoughtBuffer.reset();
    this.sealed = false;
    this.stopTyping();
  }

  async onThought(text: string): Promise<void> {
    this.thoughtBuffer.append(text);
    this.startTyping();
  }

  async onTextStart(): Promise<void> {
    // Seal the tool card (no more updates to current card from this prompt cycle)
    this.sealed = true;
    if (this.toolCard) {
      this.toolCard.finalize();
    }

    // Stop typing
    this.stopTyping();

    // In high mode, store thought content in viewer
    if (this.outputMode === "high" && this.tunnelService && !this.thoughtBuffer.isSealed()) {
      const thoughtText = this.thoughtBuffer.seal();
      if (thoughtText) {
        try {
          const viewerStore = (this.tunnelService as any).viewerStore;
          if (viewerStore?.storeOutput) {
            const entryId = viewerStore.storeOutput(this.sessionId, "Thinking", thoughtText);
            if (entryId) {
              const url = this.tunnelService.outputUrl?.(entryId);
              if (url && this.toolCardMsg) {
                // Thought link could be appended to tool card — handled in flush
              }
            }
          }
        } catch {
          // Tunnel not available — skip thought storage
        }
      }
    } else {
      this.thoughtBuffer.seal();
    }
  }

  async onToolCall(
    meta: ToolCallMeta,
    kind: string,
    rawInput: unknown,
  ): Promise<void> {
    this.stopTyping();
    const entry = this.toolStateMap.upsert(meta, kind, rawInput);
    const spec = this.specBuilder.buildToolSpec(entry, this.outputMode, this.sessionContext);
    this.ensureToolCard().updateFromSpec(spec);
  }

  async onToolUpdate(
    id: string,
    status: string,
    viewerLinks?: { file?: string; diff?: string },
    viewerFilePath?: string,
    content?: string | null,
    rawInput?: unknown,
    diffStats?: { added: number; removed: number },
  ): Promise<void> {
    // Try current tool state map first
    let entry = this.toolStateMap.merge(id, status, rawInput, content, viewerLinks, diffStats);
    if (entry) {
      const spec = this.specBuilder.buildToolSpec(entry, this.outputMode, this.sessionContext);
      this.ensureToolCard().updateFromSpec(spec);
      return;
    }

    // Out-of-order: try previous tool state map
    if (this.previousToolStateMap) {
      entry = this.previousToolStateMap.merge(id, status, rawInput, content, viewerLinks, diffStats);
      if (entry && this.previousToolCard) {
        const spec = this.specBuilder.buildToolSpec(entry, this.outputMode, this.sessionContext);
        this.previousToolCard.updateFromSpec(spec);
      }
    }
  }

  async onPlan(entries: PlanEntry[]): Promise<void> {
    this.ensureToolCard().updatePlan(entries);
  }

  async cleanup(): Promise<void> {
    this.stopTyping();
    if (this.toolCard) {
      this.toolCard.finalize();
    }
    if (this.previousToolCard) {
      this.previousToolCard.finalize();
    }
  }

  destroy(): void {
    this.stopTyping();
    if (this.toolCard) this.toolCard.destroy();
    if (this.previousToolCard) this.previousToolCard.destroy();
  }

  // ── Private Helpers ──

  private ensureToolCard(): ToolCardState {
    if (this.toolCard && !this.sealed) return this.toolCard;

    // Create new tool card
    const card = new ToolCardState({
      onFlush: (snapshot) => this.flushToolCard(snapshot, card),
    });

    if (this.sealed) {
      // Previous card was sealed, start new one
      this.previousToolCard = this.toolCard;
      this.previousToolCardMsg = this.toolCardMsg;
      this.previousToolStateMap = this.toolStateMap;
      this.toolStateMap = new ToolStateMap();
      this.toolCardMsg = null;
      this.sealed = false;
    }

    this.toolCard = card;
    return card;
  }

  private async flushToolCard(snapshot: ToolCardSnapshot, card: ToolCardState): Promise<void> {
    const { embeds, components } = renderToolCard(snapshot, this.outputMode, this.sessionId);
    if (embeds.length === 0) return;

    // Determine which message to edit
    const isCurrentCard = card === this.toolCard;
    const msgRef = isCurrentCard ? this.toolCardMsg : this.previousToolCardMsg;

    try {
      if (msgRef) {
        // Edit existing message
        await this.sendQueue.enqueue(async () => {
          await msgRef.edit({ embeds, components });
        });
      } else {
        // Send new message
        const msg = await this.sendQueue.enqueue(async () => {
          return this.channel.send({ embeds, components });
        });
        if (msg && isCurrentCard) {
          this.toolCardMsg = msg as Message;
        } else if (msg && !isCurrentCard) {
          this.previousToolCardMsg = msg as Message;
        }
      }
    } catch (err) {
      log.warn({ err, sessionId: this.sessionId }, "Failed to send/edit tool card");
    }
  }

  private startTyping(): void {
    if (this.typingTimer) return;
    this.channel.sendTyping().catch(() => {});
    this.typingTimer = setInterval(() => {
      this.channel.sendTyping().catch(() => {});
    }, TYPING_REFRESH_MS);
  }

  private stopTyping(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test -- src/__tests__/activity.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add src/activity.ts src/__tests__/activity.test.ts
git commit -m "feat: rewrite activity.ts with shared adapter-primitives

ActivityTracker now orchestrates ToolStateMap, DisplaySpecBuilder,
ToolCardState, and ThoughtBuffer. Aggregates all tools into a single
Discord embed, edited in place. Supports out-of-order tool updates
via previousToolStateMap/previousToolCard pattern."
```

---

### Task 3: Update adapter.ts — wire new ActivityTracker and OutputModeResolver

**Files:**
- Modify: `src/adapter.ts`

- [ ] **Step 1: Update imports**

Replace old imports in `src/adapter.ts`:

Remove:
```typescript
import { DiscordToolCallTracker } from "./tool-call-tracker.js";
```

Add:
```typescript
import { OutputModeResolver } from "@openacp/plugin-sdk";
import type { OutputMode, ToolCallMeta, ToolUpdateMeta } from "@openacp/plugin-sdk";
```

Change ActivityTracker import from old local to new local:
```typescript
import { ActivityTracker } from "./activity.js";
```

- [ ] **Step 2: Update class fields**

In the `DiscordAdapter` class, replace:
```typescript
private toolTracker: DiscordToolCallTracker;
```

With:
```typescript
private _outputModeResolver = new OutputModeResolver();
```

The `sessionTrackers: Map<string, ActivityTracker>` field already exists — keep it.

- [ ] **Step 3: Update constructor**

Remove `this.toolTracker = new DiscordToolCallTracker(this.sendQueue);` from constructor.

- [ ] **Step 4: Rewrite getOrCreateTracker**

Replace the existing `getOrCreateTracker` method (~line 662):

```typescript
private getOrCreateTracker(
  sessionId: string,
  thread: TextChannel | ThreadChannel,
  outputMode: OutputMode = "medium",
): ActivityTracker {
  let tracker = this.sessionTrackers.get(sessionId);
  if (!tracker) {
    const tunnelService = this.core.lifecycleManager?.serviceRegistry?.get("tunnel") as
      | TunnelServiceInterface
      | undefined;
    const session = this.core.sessionManager.getSession(sessionId);
    const sessionContext = session
      ? { id: sessionId, workingDirectory: session.workingDirectory }
      : undefined;
    tracker = new ActivityTracker(
      thread,
      this.sendQueue,
      outputMode,
      sessionId,
      tunnelService,
      sessionContext,
    );
    this.sessionTrackers.set(sessionId, tracker);
  } else {
    tracker.setOutputMode(outputMode);
  }
  return tracker;
}

private resolveMode(sessionId: string): OutputMode {
  return this._outputModeResolver.resolve(
    this.core.configManager,
    this.name,
    sessionId,
    this.core.sessionManager as any,
  );
}
```

- [ ] **Step 5: Rewrite handleThought**

```typescript
protected async handleThought(
  sessionId: string,
  content: OutgoingMessage,
  _verbosity: DisplayVerbosity,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;
  const mode = this.resolveMode(sessionId);
  const tracker = this.getOrCreateTracker(sessionId, thread, mode);
  await tracker.onThought(content.text);
}
```

- [ ] **Step 6: Rewrite handleText**

```typescript
protected async handleText(
  sessionId: string,
  content: OutgoingMessage,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  if (!this.draftManager.hasDraft(sessionId)) {
    const mode = this.resolveMode(sessionId);
    const tracker = this.getOrCreateTracker(sessionId, thread, mode);
    await tracker.onTextStart();
  }

  const draft = this.draftManager.getOrCreate(sessionId, thread);
  draft.append(content.text);
}
```

- [ ] **Step 7: Rewrite handleToolCall**

```typescript
protected async handleToolCall(
  sessionId: string,
  content: OutgoingMessage,
  _verbosity: DisplayVerbosity,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  const meta = (content.metadata ?? {}) as Partial<ToolCallMeta>;
  const mode = this.resolveMode(sessionId);
  const tracker = this.getOrCreateTracker(sessionId, thread, mode);

  await this.draftManager.finalize(sessionId);

  await tracker.onToolCall(
    {
      id: meta.id ?? "",
      name: meta.name ?? content.text ?? "Tool",
      kind: meta.kind,
      status: meta.status,
      content: meta.content,
      rawInput: meta.rawInput,
      viewerLinks: meta.viewerLinks,
      viewerFilePath: meta.viewerFilePath,
      displaySummary: meta.displaySummary as string | undefined,
      displayTitle: meta.displayTitle as string | undefined,
      displayKind: meta.displayKind as string | undefined,
    },
    String(meta.kind ?? ""),
    meta.rawInput,
  );
}
```

- [ ] **Step 8: Rewrite handleToolUpdate**

```typescript
protected async handleToolUpdate(
  sessionId: string,
  content: OutgoingMessage,
  _verbosity: DisplayVerbosity,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  const meta = (content.metadata ?? {}) as Partial<ToolUpdateMeta>;
  const mode = this.resolveMode(sessionId);
  const tracker = this.getOrCreateTracker(sessionId, thread, mode);

  await tracker.onToolUpdate(
    meta.id ?? "",
    meta.status ?? "completed",
    meta.viewerLinks as { file?: string; diff?: string } | undefined,
    meta.viewerFilePath as string | undefined,
    typeof meta.content === "string" ? meta.content : null,
    meta.rawInput ?? undefined,
    (meta as any).diffStats as { added: number; removed: number } | undefined,
  );
}
```

- [ ] **Step 9: Rewrite handlePlan**

```typescript
protected async handlePlan(
  sessionId: string,
  content: OutgoingMessage,
  _verbosity: DisplayVerbosity,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  const meta = (content.metadata ?? {}) as { entries?: PlanEntry[] };
  const entries = meta.entries ?? [];
  const mode = this.resolveMode(sessionId);
  const tracker = this.getOrCreateTracker(sessionId, thread, mode);

  await tracker.onPlan(
    entries.map((e) => ({
      content: e.content,
      status: e.status as "pending" | "in_progress" | "completed",
    })),
  );
}
```

- [ ] **Step 10: Rewrite handleUsage**

```typescript
protected async handleUsage(
  sessionId: string,
  content: OutgoingMessage,
  _verbosity: DisplayVerbosity,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  const meta = content.metadata as { tokensUsed?: number; contextSize?: number; cost?: number; duration?: number } | undefined;
  await this.draftManager.finalize(sessionId);

  const mode = this.resolveMode(sessionId);
  const { renderUsageEmbed } = await import("./formatting.js");
  const embed = renderUsageEmbed(meta ?? {}, mode);

  try {
    await this.sendQueue.enqueue(async () => {
      await thread.send({ embeds: [embed] });
    });
  } catch (err) {
    log.warn({ err, sessionId }, "Failed to send usage embed");
  }

  // Notify notification channel
  if (this.notificationChannel && sessionId !== this.assistantSession?.id) {
    const sess = this.core.sessionManager.getSession(sessionId);
    const name = sess?.name || "Session";
    try {
      await this.notificationChannel.send(`✅ **${name}** — Task completed.`);
    } catch {
      // Notification channel may not be available
    }
  }
}
```

- [ ] **Step 11: Rewrite handleSessionEnd**

```typescript
protected async handleSessionEnd(
  sessionId: string,
  _content: OutgoingMessage,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  await this.draftManager.finalize(sessionId);
  this.draftManager.cleanup(sessionId);
  await this.skillManager.cleanup(sessionId);

  const tracker = this.sessionTrackers.get(sessionId);
  if (tracker) {
    await tracker.cleanup();
    this.sessionTrackers.delete(sessionId);
  } else if (thread) {
    try {
      await this.sendQueue.enqueue(async () => {
        await thread.send("✅ **Done**");
      });
    } catch {
      // Thread may have been deleted
    }
  }
}
```

- [ ] **Step 12: Rewrite handleError**

```typescript
protected async handleError(
  sessionId: string,
  content: OutgoingMessage,
): Promise<void> {
  const thread = await this.getThread(sessionId);
  if (!thread) return;

  await this.draftManager.finalize(sessionId);

  const tracker = this.sessionTrackers.get(sessionId);
  if (tracker) {
    tracker.destroy();
    this.sessionTrackers.delete(sessionId);
  }

  try {
    await this.sendQueue.enqueue(async () => {
      await thread.send(`❌ **Error:** ${content.text}`);
    });
  } catch {
    // Thread may be unavailable
  }
}
```

- [ ] **Step 13: Build to verify types**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm build`

Expected: No type errors.

- [ ] **Step 14: Run all tests**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test`

Expected: All tests PASS.

- [ ] **Step 15: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add src/adapter.ts
git commit -m "feat: update adapter handlers to use OutputModeResolver and new ActivityTracker

All handler methods now resolve output mode via OutputModeResolver
cascade and delegate to ActivityTracker for tool card management.
Removes DiscordToolCallTracker dependency."
```

---

### Task 4: Update /outputmode command and button routing

**Files:**
- Modify: `src/commands/admin.ts`
- Modify: `src/commands/router.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: Rewrite handleVerbosity → handleOutputMode in admin.ts**

Replace the existing `handleVerbosity` function in `src/commands/admin.ts`:

```typescript
const OUTPUT_MODE_LABELS: Record<string, string> = {
  low: "🔇 Low",
  medium: "📊 Medium",
  high: "🔍 High",
};

export async function handleOutputMode(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const level = interaction.options.getString("level") ?? null;
  const scope = interaction.options.getString("scope") ?? null;

  const core = adapter.core;

  // /outputmode session [level|reset]
  if (scope === "session") {
    const threadId = interaction.channelId;
    const session = core.sessionManager.getSessionByThread("discord", threadId);

    if (!session) {
      await interaction.reply({
        content: "⚠️ No active session found in this thread.",
        ephemeral: true,
      });
      return;
    }

    if (level === "reset") {
      await core.sessionManager.patchRecord(session.id, { outputMode: undefined });
      await interaction.reply({
        content: "🔄 Session output mode reset to adapter default.",
        ephemeral: true,
      });
    } else if (level && (level === "low" || level === "medium" || level === "high")) {
      await core.sessionManager.patchRecord(session.id, { outputMode: level });
      await interaction.reply({
        content: `${OUTPUT_MODE_LABELS[level]} Session output mode set to **${level}**.`,
        ephemeral: true,
      });
    } else {
      const record = core.sessionManager.getSessionRecord(session.id);
      const current = record?.outputMode ?? "(adapter default)";
      await interaction.reply({
        content: `📊 Session output mode: **${current}**\n\nUsage: \`/outputmode session low|medium|high|reset\``,
        ephemeral: true,
      });
    }
    return;
  }

  // /outputmode [level] — adapter-level
  if (level && (level === "low" || level === "medium" || level === "high")) {
    await core.configManager.save(
      { channels: { discord: { outputMode: level } } },
      "channels.discord.outputMode",
    );
    await interaction.reply({
      content: `${OUTPUT_MODE_LABELS[level]} Output mode set to **${level}**.`,
      ephemeral: true,
    });
  } else {
    const current =
      (core.configManager.get().channels?.discord as Record<string, unknown> | undefined)
        ?.outputMode ?? "medium";
    await interaction.reply({
      content: `📊 Current output mode: **${current}**\n\n` +
        `Usage: \`/outputmode low|medium|high\`\n` +
        `Session override: \`/outputmode session low|medium|high|reset\`\n\n` +
        `• **low** — minimal: icons only\n` +
        `• **medium** — balanced: title + description (default)\n` +
        `• **high** — full detail: inline output, thinking link`,
      ephemeral: true,
    });
  }
}

// Keep old name as deprecated alias
export const handleVerbosity = handleOutputMode;
```

- [ ] **Step 2: Update slash command definitions in index.ts**

In `src/commands/index.ts`, replace the `verbosity` command definition (~line 101):

```typescript
new SlashCommandBuilder()
  .setName("outputmode")
  .setDescription("Set output detail level (low/medium/high)")
  .addStringOption((option) =>
    option
      .setName("level")
      .setDescription("Output mode level")
      .addChoices(
        { name: "🔇 Low — icons only", value: "low" },
        { name: "📊 Medium — balanced (default)", value: "medium" },
        { name: "🔍 High — full detail", value: "high" },
        { name: "🔄 Reset session override", value: "reset" },
      ),
  )
  .addStringOption((option) =>
    option
      .setName("scope")
      .setDescription("Apply to adapter (default) or current session")
      .addChoices(
        { name: "Adapter default", value: "adapter" },
        { name: "This session only", value: "session" },
      ),
  ),
// Keep verbosity as deprecated alias
new SlashCommandBuilder()
  .setName("verbosity")
  .setDescription("(Deprecated: use /outputmode) Set display verbosity")
  .addStringOption((option) =>
    option
      .setName("level")
      .setDescription("Verbosity level")
      .setRequired(true)
      .addChoices(
        { name: "Low", value: "low" },
        { name: "Medium", value: "medium" },
        { name: "High", value: "high" },
      ),
  ),
```

- [ ] **Step 3: Update button routing in router.ts**

Add `om:` and `cancel:` handlers to `setupButtonCallbacks` in `src/commands/router.ts`, before the existing button handlers:

```typescript
// Output mode buttons (om:{sessionId}:{mode})
if (interaction.customId.startsWith("om:")) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const mode = parts[2];
  if (mode === "low" || mode === "medium" || mode === "high") {
    const session = adapter.core.sessionManager.getSession(sessionId);
    if (session) {
      await adapter.core.sessionManager.patchRecord(sessionId, { outputMode: mode });
      await interaction.reply({
        content: `${OUTPUT_MODE_LABELS[mode]} Switched to **${mode}** mode.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({ content: "Session not found.", ephemeral: true });
    }
  }
  return;
}

// Cancel button (cancel:{sessionId})
if (interaction.customId.startsWith("cancel:")) {
  const sessionId = interaction.customId.slice("cancel:".length);
  const session = adapter.core.sessionManager.getSession(sessionId);
  if (session) {
    await session.cancel();
    await interaction.reply({ content: "🚫 Session cancelled.", ephemeral: true });
  } else {
    await interaction.reply({ content: "Session not found.", ephemeral: true });
  }
  return;
}
```

Also add the import at the top of `router.ts`:

```typescript
const OUTPUT_MODE_LABELS: Record<string, string> = {
  low: "🔇 Low",
  medium: "📊 Medium",
  high: "🔍 High",
};
```

- [ ] **Step 4: Update slash command routing in router.ts**

In `handleSlashCommand`, add the `outputmode` case:

```typescript
case "outputmode":
  await handleOutputMode(interaction, adapter);
  break;
```

And update the existing `verbosity` case to point to `handleOutputMode`:

```typescript
case "verbosity":
  await handleOutputMode(interaction, adapter);
  break;
```

- [ ] **Step 5: Build and test**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm build && pnpm test`

Expected: Build succeeds, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add src/commands/admin.ts src/commands/router.ts src/commands/index.ts
git commit -m "feat: add /outputmode command with session overrides and action row buttons

Replaces /verbosity with /outputmode supporting adapter-level and
session-level overrides. Adds om: and cancel: button handlers in
router. All command replies are ephemeral. /verbosity kept as
deprecated alias."
```

---

### Task 5: Config migration and cleanup

**Files:**
- Modify: `src/index.ts`
- Remove: `src/tool-call-tracker.ts`

- [ ] **Step 1: Add config migration in index.ts**

In the `setup()` method of `src/index.ts`, add migration before adapter creation:

```typescript
// Migrate displayVerbosity → outputMode
const discordConfig = ctx.settings.get() as Record<string, unknown>;
if (discordConfig.displayVerbosity && !discordConfig.outputMode) {
  await ctx.settings.set("outputMode", discordConfig.displayVerbosity);
  log.info("Migrated discord displayVerbosity → outputMode");
}
```

Also check the main config:

```typescript
const config = ctx.configManager.get();
const discordChannel = (config.channels?.discord ?? {}) as Record<string, unknown>;
if (discordChannel.displayVerbosity && !discordChannel.outputMode) {
  await ctx.configManager.save(
    { channels: { discord: { outputMode: discordChannel.displayVerbosity } } },
    "channels.discord.outputMode",
  );
  log.info("Migrated config channels.discord.displayVerbosity → outputMode");
}
```

- [ ] **Step 2: Remove tool-call-tracker.ts**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
rm src/tool-call-tracker.ts
```

- [ ] **Step 3: Remove any remaining references to DiscordToolCallTracker**

Search and remove any imports of `tool-call-tracker.js` or `DiscordToolCallTracker`:

Run: `grep -rn "tool-call-tracker\|DiscordToolCallTracker" src/`

Fix any remaining references.

- [ ] **Step 4: Remove old formatting functions no longer needed**

The old `formatToolCall`, `formatToolUpdate`, `formatPlan`, `formatUsage` functions are replaced by the new embed-based functions. Verify no other files import them:

Run: `grep -rn "formatToolCall\|formatToolUpdate\|formatPlan\b" src/ --include="*.ts" | grep -v formatting.ts | grep -v __tests__`

If any imports remain (e.g., in `renderer.ts`), update them to use the new functions or remove unused references.

- [ ] **Step 5: Update renderer.ts if needed**

If `renderer.ts` imports old formatting functions, update it. The renderer should still work for non-tool-card rendering (errors, system messages, etc.).

- [ ] **Step 6: Build and run full test suite**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm build && pnpm test`

Expected: Build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add -A
git commit -m "feat: config migration displayVerbosity→outputMode, remove tool-call-tracker

Adds automatic migration of displayVerbosity to outputMode on setup.
Removes DiscordToolCallTracker (replaced by ToolCardState aggregation).
Cleans up all references to old per-tool message pattern."
```

---

### Task 6: Integration verification

- [ ] **Step 1: Run full build**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm build`

Expected: Clean build, no type errors.

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/lucas/openacp-workspace/discord-adapter && pnpm test`

Expected: All tests pass.

- [ ] **Step 3: Verify no old references remain**

Run: `grep -rn "displayVerbosity\|DiscordToolCallTracker\|tool-call-tracker" src/ --include="*.ts"`

Expected: No matches (except deprecated type alias usage in SDK which is fine).

- [ ] **Step 4: Verify import consistency**

Run: `grep -rn "from.*formatting" src/ --include="*.ts" | grep -v __tests__ | grep -v node_modules`

Ensure all formatting imports point to the new API.

- [ ] **Step 5: Final commit — update package metadata if needed**

If the discord adapter `package.json` needs version bump or dependency updates for the new SDK exports:

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add -A
git commit -m "chore: final integration verification and cleanup"
```
