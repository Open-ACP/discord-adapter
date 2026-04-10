import type { ChatInputCommandInteraction } from "discord.js";
import { log } from "@openacp/plugin-sdk";
import type { DiscordAdapter } from "../adapter.js";

/**
 * Handle `/tunnel [port] [label]` or `/tunnel action:stop port:<port>`.
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

  // /tunnel action:stop port:<n>
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

  // No port → show help
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

  // Start tunnel
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
    const allTunnels: Array<{
      port: number;
      publicUrl?: string;
      label?: string;
      sessionId?: string;
      status?: string;
    }> = tunnelService.listTunnels?.() ?? [];

    // Only show tunnels that are active or starting — stopped/failed tunnels are excluded
    const tunnels = allTunnels.filter(
      (t) => !t.status || t.status === "active" || t.status === "starting",
    );

    if (tunnels.length === 0) {
      await interaction.editReply("No active tunnels.");
      return;
    }

    const lines = tunnels.map((t) => {
      const status = t.status === "active" ? "✅" : t.status === "starting" ? "⏳" : "❌";
      const label = t.label ? ` (${t.label})` : "";
      const url = t.publicUrl ?? "(pending)";
      return `${status} Port **${t.port}**${label} → ${url}`;
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
