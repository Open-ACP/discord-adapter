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
        .setLabel(`🤖 ${agent.slice(0, 77)}`)
        .setStyle(ButtonStyle.Secondary),
    );
    count++;
    // Discord max 5 buttons per row; group 3 per row for readability
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
  items: any[],
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
            ? `✅ ${item.name.slice(0, 57)} — Uninstall`
            : `📦 ${item.name.slice(0, 60)} — Install`,
        )
        .setStyle(installed ? ButtonStyle.Secondary : ButtonStyle.Success),
    );
    count++;
    // 2 items per row keeps labels readable
    if (count % 2 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
      if (rows.length >= 4) break; // reserve row 5 for Back button
    }
  }
  if (currentRow.components.length > 0 && rows.length < 4) rows.push(currentRow);

  // Back button always occupies the final row
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("i:back")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return rows; // max 5 rows: 4 item rows + 1 back row
}

// ─── Slash command handler ──────────────────────────────────────────────────

export async function handleIntegrate(
  interaction: ChatInputCommandInteraction,
  _adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    // @ts-ignore — @openacp/cli/integrate is a runtime sub-path export, no TS types available
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
      } catch { /* interaction may have expired */ }
      // @ts-ignore — @openacp/cli/integrate is a runtime sub-path export, no TS types available
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

    // Show integration items for a specific agent
    const agentMatch = customId.match(/^i:agent:(.+)$/);
    if (agentMatch) {
      try {
        await interaction.deferUpdate();
      } catch { /* interaction may have expired */ }
      const agentName = agentMatch[1];
      // @ts-ignore — @openacp/cli/integrate is a runtime sub-path export, no TS types available
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
        .map((i: any) => `• **${i.name}** — ${i.description}`)
        .join("\n");
      await interaction.followUp({
        content: `🔗 **${agentName} Integrations**\n\n${itemLines}`,
        components: rows,
        ephemeral: true,
      });
      return;
    }

    // Install / uninstall item
    const actionMatch = customId.match(/^i:(install|uninstall):([^:]+):(.+)$/);
    if (!actionMatch) {
      log.warn({ customId }, "[discord-integrate] Unhandled integrate button");
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch { /* interaction may have expired */ }

    const action = actionMatch[1] as "install" | "uninstall";
    const agentName = actionMatch[2];
    const itemId = actionMatch[3];

    // @ts-ignore — @openacp/cli/integrate is a runtime sub-path export, no TS types available
    const { getIntegration } = await import("@openacp/cli/integrate");
    const integration = getIntegration(agentName);
    if (!integration) return;

    const item = integration.items.find((i: any) => i.id === itemId);
    if (!item) return;

    const result =
      action === "install" ? await item.install() : await item.uninstall();

    const statusEmoji = result.success ? "✅" : "❌";
    const actionLabel = action === "install" ? "installed" : "uninstalled";
    // Cap logs to avoid hitting Discord's 2000-char message limit
    const logsText =
      result.logs.length > 0
        ? `\n\`\`\`\n${result.logs.slice(0, 10).join("\n")}\n\`\`\``
        : "";
    const resultText = `${statusEmoji} **${item.name}** ${actionLabel}.${logsText}`;

    // Re-render the items keyboard so install/uninstall state is reflected
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
    } catch { /* ignore if follow-up also fails */ }
  }
}
