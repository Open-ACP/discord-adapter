# Discord–Telegram Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Discord adapter to full feature parity with the Telegram adapter by implementing missing commands, fixing broken handlers, and wiring up missing plumbing.

**Architecture:** Discord adapter lives in `discord-adapter/src/`. It uses discord.js slash commands routed via `commands/router.ts`. Commands are also intercepted by the core `CommandRegistry` before reaching the router. The Telegram adapter is the reference implementation in `OpenACP/src/plugins/telegram/`.

**Tech Stack:** TypeScript, discord.js, @openacp/plugin-sdk, pnpm, vitest

---

## Gap Analysis (what this plan fixes)

After reading both adapters end-to-end:

| Feature | Telegram | Discord | Status |
|---------|----------|---------|--------|
| `/switch` | Full (rich inline keyboard) | Missing from SLASH_COMMANDS; CommandRegistry has basic handler but it's never reachable | **Fix** |
| `/tunnel` / `/tunnels` | Full | Not in SLASH_COMMANDS, no handler | **Implement** |
| `/integrate` | Full (agent list + install/uninstall buttons) | Stub — returns "not yet implemented" | **Implement** |
| ActivityTracker tunnelService + sessionContext | Passed (viewer links work) | Not passed in `getOrCreateTracker` | **Fix** |
| Control message persistence | Stored in session record (survives restart) | Lost on restart | **Fix** |

Commands **not** in this plan (already work or intentionally different):
- `/mode`, `/model`, `/thought` — handled by CommandRegistry + Discord adapter correctly extracts args from command string. Work today.
- `/resume` — CommandRegistry returns text directing to assistant. Entire.io integration is out-of-scope.
- `/update` — stub is acceptable; users use CLI.
- `/archive` — cleanup buttons in `/sessions` cover this for Discord.

---

## File Map

| File | Change |
|------|--------|
| `src/commands/index.ts` | Add `/switch`, `/tunnel`, `/tunnels` slash command definitions |
| `src/commands/router.ts` | Add cases for `tunnel`, `tunnels`, `switch`; add `tw:`, `swc:`, `sw:` button callbacks |
| `src/commands/switch.ts` | **New** — Discord `/switch` handler + button callbacks |
| `src/commands/tunnel.ts` | **New** — Discord `/tunnel` + `/tunnels` handlers |
| `src/commands/integrate.ts` | Replace stub with full implementation |
| `src/adapter.ts` | Pass `tunnelService` + `sessionContext` to `ActivityTracker`; expose `storeControlMsgId`; add `persistControlMsgId` helper |
| `src/commands/new-session.ts` | After sending control message, persist `controlMsgId` to session record |

---

## Task 1: Add `/switch` slash command and wire to CommandRegistry

**Files:**
- Modify: `src/commands/index.ts`
- Modify: `src/commands/router.ts`

The core `CommandRegistry` already has `/switch` registered (via `OpenACP/src/core/commands/switch.ts`). Discord just needs:
1. The slash command definition so Discord's UI shows it to users
2. The router to **not** intercept it (let CommandRegistry handle it before the router)
3. Button callbacks for `c/switch <agent>` already work via the `c/` prefix routing in adapter.ts

- [ ] **Step 1: Add `/switch` slash command definition**

In `src/commands/index.ts`, add to the `SLASH_COMMANDS` array after the `thought` entry (line ~75):

```typescript
new SlashCommandBuilder()
  .setName("switch")
  .setDescription("Switch to a different agent for this session")
  .addStringOption((o) =>
    o
      .setName("agent")
      .setDescription("Agent name to switch to (omit to see menu)")
      .setRequired(false),
  ),
```

- [ ] **Step 2: Verify CommandRegistry handles `/switch` in router**

In `src/commands/router.ts`, the switch statement must NOT have a `case "switch"` — the adapter's CommandRegistry dispatch runs first (in `adapter.ts` `setupInteractionHandler`). Confirm no case for `switch` exists (it should not). No code change needed if absent.

- [ ] **Step 3: Build and test slash command appears in Discord**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm build
```

Expected: TypeScript compiles with no errors.

- [ ] **Step 4: Verify `/switch` shows menu and direct switch works**

When bot restarts, `/switch` should appear in Discord's slash command menu. Verify via Discord UI that:
- `/switch` shows a button menu of agents
- `/switch claude-code` (with value) directly switches
- Clicking a "Switch" button from the menu switches correctly

- [ ] **Step 5: Commit**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
git add src/commands/index.ts
git commit -m "feat: add /switch slash command to Discord"
```

---

## Task 2: Implement `/integrate` command in Discord

**Files:**
- Modify: `src/commands/integrate.ts`
- No changes needed to router.ts (already has `handleIntegrate` and `handleIntegrateButton` wired)

The Telegram integrate flow: show list of agents with integrations → tap agent → see install/uninstall items → tap to install/uninstall. Discord adapts this with buttons (same pattern, different API).

- [ ] **Step 1: Write failing test**

Create `src/__tests__/integrate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleIntegrate } from "../commands/integrate.js";

const mockInteraction = (channelId = "ch1") => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
  reply: vi.fn().mockResolvedValue({ id: "msg1" }),
  deferred: false,
  replied: false,
  channelId,
  guildId: "guild1",
  customId: "",
} as any);

const mockAdapter = () => ({
  core: {
    agentCatalog: { getInstalledEntries: vi.fn().mockReturnValue({}) },
  },
} as any);

describe("handleIntegrate", () => {
  it("shows agent list when integrations are available", async () => {
    const interaction = mockInteraction();
    const adapter = mockAdapter();

    // Mock listIntegrations to return an agent
    vi.doMock("@openacp/cli/integrate", () => ({
      listIntegrations: () => ["claude-code"],
    }));

    await handleIntegrate(interaction, adapter);
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("shows 'no integrations available' when list is empty", async () => {
    const interaction = mockInteraction();
    const adapter = mockAdapter();

    vi.doMock("@openacp/cli/integrate", () => ({
      listIntegrations: () => [],
    }));

    await handleIntegrate(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("No integrations") }),
    );
  });
});
```

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm test src/__tests__/integrate.test.ts
```

Expected: FAIL (current implementation is stub).

- [ ] **Step 2: Implement `handleIntegrate` and `handleIntegrateButton`**

Replace the entire content of `src/commands/integrate.ts`:

```typescript
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import { log } from "@openacp/plugin-sdk";
import type { DiscordAdapter } from "../adapter.js";

// ─── Keyboard builders ──────────────────────────────────────────────────────

function buildAgentListKeyboard(
  agents: string[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let count = 0;

  for (const agent of agents) {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`i:agent:${agent}`)
        .setLabel(`🤖 ${agent}`)
        .setStyle(ButtonStyle.Secondary),
    );
    count++;
    // Discord max 5 buttons per row, max 5 rows
    if (count % 3 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  return rows.slice(0, 5);
}

function buildAgentItemsKeyboard(
  agentName: string,
  items: import("@openacp/cli/integrate").IntegrationItem[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let count = 0;

  for (const item of items) {
    const installed = item.isInstalled();
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          installed
            ? `i:uninstall:${agentName}:${item.id}`
            : `i:install:${agentName}:${item.id}`,
        )
        .setLabel(
          installed
            ? `✅ ${item.name} — Uninstall`
            : `📦 ${item.name} — Install`,
        )
        .setStyle(installed ? ButtonStyle.Secondary : ButtonStyle.Success),
    );
    count++;
    if (count % 2 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  // Back button
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("i:back")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return rows.slice(0, 5);
}

// ─── Slash command handler ──────────────────────────────────────────────────

export async function handleIntegrate(
  interaction: ChatInputCommandInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const { listIntegrations } = await import("@openacp/cli/integrate");
    const agents = listIntegrations();

    if (agents.length === 0) {
      await interaction.editReply({
        content:
          "🔗 **Integrations**\n\nNo agent integrations are available.",
      });
      return;
    }

    const rows = buildAgentListKeyboard(agents);
    await interaction.editReply({
      content:
        "🔗 **Integrations**\n\nSelect an agent to manage its integrations:",
      components: rows,
    });
  } catch (err) {
    log.error({ err }, "[discord-integrate] handleIntegrate failed");
    await interaction.editReply(
      `❌ Failed to load integrations: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Button callbacks ───────────────────────────────────────────────────────

export async function handleIntegrateButton(
  interaction: ButtonInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  const { customId } = interaction;

  try {
    // Back → agent list
    if (customId === "i:back") {
      try {
        await interaction.deferUpdate();
      } catch { /* expired */ }
      const { listIntegrations } = await import("@openacp/cli/integrate");
      const agents = listIntegrations();
      const rows = buildAgentListKeyboard(agents);
      await interaction.followUp({
        content:
          "🔗 **Integrations**\n\nSelect an agent to manage its integrations:",
        components: rows,
        ephemeral: true,
      });
      return;
    }

    // Show agent integration items
    const agentMatch = customId.match(/^i:agent:(.+)$/);
    if (agentMatch) {
      try {
        await interaction.deferUpdate();
      } catch { /* expired */ }
      const agentName = agentMatch[1];
      const { getIntegration } = await import("@openacp/cli/integrate");
      const integration = getIntegration(agentName);
      if (!integration) {
        await interaction.followUp({
          content: `❌ No integration available for '${agentName}'.`,
          ephemeral: true,
        });
        return;
      }
      const rows = buildAgentItemsKeyboard(agentName, integration.items);
      const itemLines = integration.items
        .map((i) => `• **${i.name}** — ${i.description}`)
        .join("\n");
      await interaction.followUp({
        content: `🔗 **${agentName} Integrations**\n\n${itemLines}`,
        components: rows,
        ephemeral: true,
      });
      return;
    }

    // Install / uninstall
    const actionMatch = customId.match(/^i:(install|uninstall):([^:]+):(.+)$/);
    if (!actionMatch) {
      log.warn({ customId }, "[discord-integrate] Unhandled integrate button");
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch { /* expired */ }

    const action = actionMatch[1] as "install" | "uninstall";
    const agentName = actionMatch[2];
    const itemId = actionMatch[3];

    const { getIntegration } = await import("@openacp/cli/integrate");
    const integration = getIntegration(agentName);
    if (!integration) return;

    const item = integration.items.find((i) => i.id === itemId);
    if (!item) return;

    const result =
      action === "install" ? await item.install() : await item.uninstall();

    const statusEmoji = result.success ? "✅" : "❌";
    const actionLabel = action === "install" ? "installed" : "uninstalled";
    const logsText =
      result.logs.length > 0
        ? `\n\`\`\`\n${result.logs.slice(0, 10).join("\n")}\n\`\`\``
        : "";
    const resultText = `${statusEmoji} **${item.name}** ${actionLabel}.${logsText}`;

    // Re-render updated items keyboard
    const updatedRows = buildAgentItemsKeyboard(agentName, integration.items);
    await interaction.followUp({
      content: `🔗 **${agentName} Integrations**\n\n${resultText}`,
      components: updatedRows,
      ephemeral: true,
    });
  } catch (err) {
    log.error({ err, customId }, "[discord-integrate] Button handler failed");
    try {
      await interaction.followUp({
        content: `❌ Action failed: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      });
    } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm test src/__tests__/integrate.test.ts
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/integrate.ts src/__tests__/integrate.test.ts
git commit -m "feat: implement /integrate command for Discord"
```

---

## Task 3: Add `/tunnel` and `/tunnels` commands

**Files:**
- Create: `src/commands/tunnel.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/commands/router.ts`

Port from Telegram's `commands/tunnel.ts`. Key differences: Discord uses `interaction.options` instead of `ctx.match`; response via `interaction.editReply`/`followUp` instead of `ctx.reply`.

- [ ] **Step 1: Write failing test**

Create `src/__tests__/tunnel.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleTunnel, handleTunnels } from "../commands/tunnel.js";

const mockInteraction = (opts: Record<string, string | null> = {}) => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  options: {
    getString: (name: string) => opts[name] ?? null,
    getInteger: (name: string) => (opts[name] ? parseInt(opts[name]!) : null),
  },
  deferred: true,
  replied: false,
  channelId: "ch1",
} as any);

const mockAdapter = (tunnelService?: any) => ({
  core: {
    tunnelService,
    sessionManager: {
      getSessionByThread: vi.fn().mockReturnValue(null),
    },
  },
} as any);

describe("handleTunnel", () => {
  it("replies with error when tunnel service is not enabled", async () => {
    const interaction = mockInteraction();
    const adapter = mockAdapter(undefined); // no tunnel service

    await handleTunnel(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("not enabled"),
    );
  });

  it("shows help when no port specified", async () => {
    const interaction = mockInteraction({ port: null });
    const tunnelService = {
      addTunnel: vi.fn(),
      stopTunnel: vi.fn(),
    };
    const adapter = mockAdapter(tunnelService);

    await handleTunnel(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("/tunnel"),
    );
  });

  it("starts tunnel when port is provided", async () => {
    const interaction = mockInteraction({ port: "3000" });
    const tunnelService = {
      addTunnel: vi.fn().mockResolvedValue({ publicUrl: "https://abc.trycloudflare.com" }),
      stopTunnel: vi.fn(),
    };
    const adapter = mockAdapter(tunnelService);

    await handleTunnel(interaction, adapter);
    expect(tunnelService.addTunnel).toHaveBeenCalledWith(3000, expect.any(Object));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("abc.trycloudflare.com"),
    );
  });
});

describe("handleTunnels", () => {
  it("shows no tunnels message when list is empty", async () => {
    const interaction = mockInteraction();
    const tunnelService = { listTunnels: vi.fn().mockReturnValue([]) };
    const adapter = mockAdapter(tunnelService);

    await handleTunnels(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("No active tunnels"),
    );
  });
});
```

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm test src/__tests__/tunnel.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 2: Create `src/commands/tunnel.ts`**

```typescript
import type { ChatInputCommandInteraction } from "discord.js";
import { log } from "@openacp/plugin-sdk";
import type { DiscordAdapter } from "../adapter.js";

/**
 * Handle `/tunnel [port] [label]` or `/tunnel stop <port>`.
 *
 * Requires the tunnel service plugin to be enabled in OpenACP.
 * Associates the tunnel with the current session thread if one exists.
 */
export async function handleTunnel(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const tunnelService = (adapter.core as any).tunnelService;
  if (!tunnelService) {
    await interaction.editReply("❌ Tunnel service is not enabled.");
    return;
  }

  const action = interaction.options.getString("action");
  const port = interaction.options.getInteger("port");
  const label = interaction.options.getString("label") ?? undefined;

  // /tunnel stop <port>
  if (action === "stop") {
    if (!port) {
      await interaction.editReply("❌ Port is required to stop a tunnel.");
      return;
    }
    try {
      await tunnelService.stopTunnel(port);
      await interaction.editReply(`🔌 Tunnel stopped: port ${port}`);
    } catch (err) {
      log.error({ err, port }, "[discord-tunnel] stopTunnel failed");
      await interaction.editReply(
        `❌ ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /tunnel (no port) → show help
  if (!port) {
    await interaction.editReply(
      `**Tunnel commands:**\n\n` +
        `\`/tunnel port:3000\` — Create tunnel for port 3000\n` +
        `\`/tunnel port:3000 label:frontend\` — Create with label\n` +
        `\`/tunnel action:stop port:3000\` — Stop tunnel\n` +
        `\`/tunnels\` — List active tunnels`,
    );
    return;
  }

  // /tunnel <port> [label] → start tunnel
  // Find session for this thread
  const channelId = interaction.channelId;
  const session = adapter.core.sessionManager.getSessionByThread("discord", channelId);
  const sessionId = session?.id;

  try {
    await interaction.editReply(`⏳ Starting tunnel for port ${port}...`);
    const entry = await tunnelService.addTunnel(port, { label, sessionId });
    await interaction.editReply(
      `🔗 **Tunnel active**\n\n` +
        `Port: **${port}**${label ? ` (${label})` : ""}\n` +
        `URL: ${entry.publicUrl || "(pending)"}`,
    );
  } catch (err) {
    log.error({ err, port }, "[discord-tunnel] addTunnel failed");
    await interaction.editReply(
      `❌ ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Handle `/tunnels` — list all active tunnels.
 */
export async function handleTunnels(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const tunnelService = (adapter.core as any).tunnelService;
  if (!tunnelService) {
    await interaction.editReply("❌ Tunnel service is not enabled.");
    return;
  }

  try {
    const tunnels: Array<{ port: number; publicUrl?: string; label?: string; sessionId?: string }> =
      tunnelService.listTunnels?.() ?? [];

    if (tunnels.length === 0) {
      await interaction.editReply("No active tunnels.");
      return;
    }

    const lines = tunnels.map((t) => {
      const label = t.label ? ` (${t.label})` : "";
      const url = t.publicUrl ?? "(pending)";
      return `• **Port ${t.port}**${label} → ${url}`;
    });

    await interaction.editReply(
      `🔗 **Active Tunnels** (${tunnels.length})\n\n${lines.join("\n")}`,
    );
  } catch (err) {
    log.error({ err }, "[discord-tunnel] handleTunnels failed");
    await interaction.editReply(
      `❌ ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
```

- [ ] **Step 3: Add slash command definitions in `src/commands/index.ts`**

Add to the `SLASH_COMMANDS` array after the `outputmode` entry:

```typescript
new SlashCommandBuilder()
  .setName("tunnel")
  .setDescription("Create or stop a port tunnel")
  .addIntegerOption((o) =>
    o.setName("port").setDescription("Local port to tunnel").setRequired(false),
  )
  .addStringOption((o) =>
    o
      .setName("action")
      .setDescription("Action to perform")
      .setRequired(false)
      .addChoices({ name: "stop", value: "stop" }),
  )
  .addStringOption((o) =>
    o.setName("label").setDescription("Optional label for this tunnel").setRequired(false),
  ),

new SlashCommandBuilder()
  .setName("tunnels")
  .setDescription("List active port tunnels"),
```

- [ ] **Step 4: Add router cases in `src/commands/router.ts`**

Add the import at the top:

```typescript
import { handleTunnel, handleTunnels } from "./tunnel.js";
```

Add cases in the `handleSlashCommand` switch:

```typescript
case "tunnel":
  await handleTunnel(interaction, adapter);
  break;
case "tunnels":
  await handleTunnels(interaction, adapter);
  break;
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm test src/__tests__/tunnel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build**

```bash
pnpm build
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/tunnel.ts src/commands/index.ts src/commands/router.ts src/__tests__/tunnel.test.ts
git commit -m "feat: add /tunnel and /tunnels commands to Discord adapter"
```

---

## Task 4: Pass tunnelService and sessionContext to ActivityTracker

**Files:**
- Modify: `src/adapter.ts` (method `getOrCreateTracker`)

The `ActivityTracker.DisplaySpecBuilder` accepts a `tunnelService` to generate viewer links for long command outputs. Without it, output from long-running commands is truncated even when a public tunnel is active.

- [ ] **Step 1: Check ActivityTracker constructor signature**

In `src/activity.ts`, confirm `ActivityTracker` constructor accepts `tunnelService` and `sessionContext` as optional args (it does — look at lines 532–548).

The current `getOrCreateTracker` in `src/adapter.ts` (lines 682–700) creates `ActivityTracker` without these:

```typescript
tracker = new ActivityTracker(
  thread,
  this.sendQueue,
  outputMode,
  sessionId,  // missing: tunnelService, sessionContext
);
```

- [ ] **Step 2: Update `getOrCreateTracker` in `src/adapter.ts`**

Replace the `getOrCreateTracker` method body (around line 688):

```typescript
private getOrCreateTracker(
  sessionId: string,
  thread: TextChannel | ThreadChannel,
  outputMode: OutputMode = "medium",
): ActivityTracker {
  let tracker = this.sessionTrackers.get(sessionId);
  if (!tracker) {
    const tunnelService = this.core.lifecycleManager?.serviceRegistry?.get("tunnel") as
      | import("./activity.js").TunnelServiceInterface
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
```

- [ ] **Step 3: Build**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm build
```

Expected: No errors. The ActivityTracker constructor signature accepts those params.

- [ ] **Step 4: Commit**

```bash
git add src/adapter.ts
git commit -m "fix: pass tunnelService and sessionContext to Discord ActivityTracker"
```

---

## Task 5: Persist control message ID after restart

**Files:**
- Modify: `src/commands/new-session.ts`
- Modify: `src/adapter.ts` (add public helper `persistControlMsgId`)

Currently, when a new session is created in Discord, the welcome message with bypass/TTS buttons is sent. The message ID is not stored anywhere. After an OpenACP restart, if the user clicks the bypass or TTS button, it still works because the button handler uses `sessionId` from the `customId` directly. However, when session config changes (e.g. bypass toggled from another source), the adapter cannot update the button state in the existing control message because it doesn't know the message ID.

This matches the Telegram adapter's `storeControlMsgId` pattern which stores the ID both in-memory and in the session record, then retrieves it after restart via `getControlMsgId`.

- [ ] **Step 1: Add `persistControlMsgId` to `DiscordAdapter`**

In `src/adapter.ts`, add a new public method after `getAssistantThreadId()`:

```typescript
/**
 * Persist the control message ID to the session record so it survives restart.
 * Called by new-session.ts after sending the welcome/control message.
 */
async persistControlMsgId(sessionId: string, messageId: string): Promise<void> {
  const record = this.core.sessionManager.getSessionRecord(sessionId);
  if (!record) return;
  await this.core.sessionManager.patchRecord(sessionId, {
    platform: { ...(record.platform ?? {}), controlMsgId: messageId },
  }).catch((err) => {
    log.warn({ err, sessionId }, "[DiscordAdapter] Failed to persist controlMsgId");
  });
}

/**
 * Retrieve stored control message ID for a session (survives restart via session record).
 */
getControlMsgId(sessionId: string): string | undefined {
  const record = this.core.sessionManager.getSessionRecord(sessionId);
  const platform = record?.platform as { controlMsgId?: string } | undefined;
  return platform?.controlMsgId;
}
```

- [ ] **Step 2: Persist after sending control message in `new-session.ts`**

In `src/commands/new-session.ts`, in `executeNewSession`, after the `thread.send(...)` call that sends the control message (around line 127–135), add:

```typescript
// Send welcome message in the new thread
const controlMsg = await thread.send({
  content:
    `✅ **Session started**\n` +
    `**Agent:** ${session.agentName}\n` +
    `**Workspace:** \`${session.workingDirectory}\`\n\n` +
    `This is your coding session — chat here to work with the agent.`,
  components: [controlRow],
});

// Persist control message ID for post-restart button updates
await adapter.persistControlMsgId(session.id, controlMsg.id).catch(() => {});
```

Note: Change the `await thread.send(...)` to capture its return value `controlMsg`, then persist.

- [ ] **Step 3: Build**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/adapter.ts src/commands/new-session.ts
git commit -m "fix: persist control message ID to session record for post-restart recovery"
```

---

## Task 6: Update control message when session config changes

**Files:**
- Modify: `src/adapter.ts`
- Modify: `src/commands/admin.ts` (export `isBypassActive` helper)

**Depends on:** Task 5 (requires `getControlMsgId` / `persistControlMsgId`)

When the user runs `/mode`, `/model`, `/bypass`, or any command that changes session config, the control message in the thread (with bypass/TTS buttons) should be re-rendered. Telegram does this via `_configChangedHandler` (on the `session:configChanged` bus event) and via `handleConfigUpdate` (called by the base class when the agent emits `config_update`). Discord currently ignores both.

- [ ] **Step 1: Add `updateControlMessage` method to `DiscordAdapter`**

In `src/adapter.ts`, import `buildSessionControlKeyboard` at the top:

```typescript
import { buildSessionControlKeyboard } from './commands/admin.js';
```

Then add the method after `updateSessionOutputMode`:

```typescript
/**
 * Edit the control message to reflect current session state (bypass, voice mode).
 * No-op if the control message ID is unknown (session created before this fix).
 */
async updateControlMessage(sessionId: string): Promise<void> {
  const controlMsgId = this.getControlMsgId(sessionId);
  if (!controlMsgId) return;

  const thread = await this.getThread(sessionId);
  if (!thread) return;

  const session = this.core.sessionManager.getSession(sessionId);
  if (!session) return;

  const keyboard = buildSessionControlKeyboard(
    sessionId,
    session.clientOverrides?.bypassPermissions ?? false,
    session.voiceMode === 'on',
  );

  try {
    const msg = await thread.messages.fetch(controlMsgId);
    await msg.edit({ components: [keyboard] });
  } catch {
    // Message deleted or inaccessible — ignore
  }
}
```

- [ ] **Step 2: Override `handleConfigUpdate` in `DiscordAdapter`**

Add after `handleSessionEnd`:

```typescript
protected async handleConfigUpdate(sessionId: string, _content: OutgoingMessage): Promise<void> {
  await this.updateControlMessage(sessionId);
}
```

- [ ] **Step 3: Register `_configChangedHandler` in `start()` and remove it in `stop()`**

Add private field declarations near the top of the class:

```typescript
private _configChangedHandler?: (data: { sessionId: string }) => void;
```

In `start()`, in the `client.once("ready", ...)` callback, after `setupAssistant()`:

```typescript
// Update control message when session config changes via commands
this._configChangedHandler = ({ sessionId }) => {
  this.updateControlMessage(sessionId).catch(() => {});
};
this.core.eventBus.on('session:configChanged', this._configChangedHandler);
```

In `stop()`, before `this.client.destroy()`:

```typescript
if (this._configChangedHandler) {
  this.core.eventBus.off('session:configChanged', this._configChangedHandler);
  this._configChangedHandler = undefined;
}
```

- [ ] **Step 4: Build**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/adapter.ts
git commit -m "feat: update Discord control message when session config changes"
```

---

## Task 7: Send welcome + control messages for API-created sessions

**Files:**
- Modify: `src/adapter.ts`

**Depends on:** Task 5 (requires `persistControlMsgId`), Task 6 (requires `updateControlMessage`, `buildSessionControlKeyboard` already imported)

When a session is created via the OpenACP REST API or CLI (not via a Discord `/new` command), the `SESSION_THREAD_READY` bus event fires with the new session's threadId. Without a handler, the Discord thread stays empty — no welcome message, no control buttons. Telegram handles this with `_threadReadyHandler`.

- [ ] **Step 1: Add `_threadReadyHandler` private field**

```typescript
private _threadReadyHandler?: (data: { sessionId: string; channelId: string; threadId: string }) => void;
```

- [ ] **Step 2: Register handler in `start()`**

In the `client.once("ready", ...)` callback, after registering `_configChangedHandler`:

```typescript
// Send welcome + control messages for sessions created via API/CLI
this._threadReadyHandler = ({ sessionId, channelId, threadId }) => {
  if (channelId !== 'discord') return;
  const session = this.core.sessionManager.getSession(sessionId);
  if (!session) return;
  // Assistant manages its own welcome message
  if (this.assistantSession && sessionId === this.assistantSession.id) return;

  this.guild.channels.fetch(threadId)
    .then((channel) => {
      if (!channel || !channel.isThread()) return;
      const thread = channel as import('discord.js').ThreadChannel;
      return thread.send({ content: '⏳ Setting up session, please wait...' })
        .then(() =>
          thread.send({
            content:
              `✅ **Session started**\n` +
              `**Agent:** ${session.agentName}\n` +
              `**Workspace:** \`${session.workingDirectory}\`\n\n` +
              `This is your coding session — chat here to work with the agent.`,
            components: [buildSessionControlKeyboard(sessionId, false, false)],
          }),
        )
        .then((controlMsg) => this.persistControlMsgId(sessionId, controlMsg.id));
    })
    .catch((err) => {
      log.warn({ err, sessionId, threadId }, '[DiscordAdapter] Failed to send initial messages for API-created session');
    });
};
this.core.eventBus.on('session:threadReady', this._threadReadyHandler);
```

- [ ] **Step 3: Deregister handler in `stop()`**

```typescript
if (this._threadReadyHandler) {
  this.core.eventBus.off('session:threadReady', this._threadReadyHandler);
  this._threadReadyHandler = undefined;
}
```

- [ ] **Step 4: Build**

```bash
cd /Users/lucas/openacp-workspace/discord-adapter
pnpm build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/adapter.ts
git commit -m "feat: handle SESSION_THREAD_READY for API-created sessions in Discord"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task | Status |
|-------------|------|--------|
| `/switch` accessible in Discord UI | Task 1 | ✅ |
| `/integrate` fully implemented | Task 2 | ✅ |
| `/tunnel` + `/tunnels` implemented | Task 3 | ✅ |
| ActivityTracker gets tunnelService + sessionContext | Task 4 | ✅ |
| Control message ID persisted | Task 5 | ✅ |
| Control message updated on config change | Task 6 | ✅ |
| Welcome + control for API-created sessions | Task 7 | ✅ |

### Placeholder Scan

No TBDs, no "implement later", no missing code blocks in this plan.

### Type Consistency

- `TunnelServiceInterface` is imported from `./activity.js` in Task 4 — matches the type already defined there.
- `persistControlMsgId(sessionId: string, messageId: string)` — message IDs in Discord are strings; consistent with `thread.id` usage throughout.
- `buildAgentItemsKeyboard` returns `ActionRowBuilder<ButtonBuilder>[]` — consistent with router.ts usage.

### Import paths to verify

Before executing Task 2, verify that `@openacp/cli/integrate` is importable from the discord-adapter. Check if it's in `node_modules/@openacp/` or if it's the core package referenced differently. If the path is different, adjust the import to match what Telegram's adapter uses:

```bash
# Check how Telegram imports integrate
grep -n "integrate" /Users/lucas/openacp-workspace/OpenACP/src/plugins/telegram/commands/integrate.ts | head -5
# Expected: import("../../../cli/integrate.js")
```

If the discord-adapter doesn't have access to the core `cli/integrate.js` module, use the SDK's exported type instead, or adjust the import path to reference the published package.

---

## Execution Handoff

Plan complete and saved to `discord-adapter/docs/superpowers/plans/2026-04-10-discord-telegram-parity.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans skill with checkpoints

**Which approach?**
