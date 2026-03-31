import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import { log } from "@openacp/plugin-sdk";
import type { DiscordAdapter } from "../adapter.js";

export async function handleDangerous(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.channelId;
  const session = adapter.core.sessionManager.getSessionByThread(
    "discord",
    channelId,
  );

  if (session) {
    session.dangerousMode = !session.dangerousMode;
    adapter.core.sessionManager
      .patchRecord(session.id, { dangerousMode: session.dangerousMode })
      .catch(() => {});
    log.info(
      { sessionId: session.id, dangerousMode: session.dangerousMode },
      "[discord-admin] Dangerous mode toggled via command",
    );

    const msg = session.dangerousMode
      ? "☠️ **Dangerous mode enabled** — All permission requests will be auto-approved."
      : "🔐 **Dangerous mode disabled** — Permission requests will be shown normally.";
    await interaction.editReply(msg);
    return;
  }

  // Session not in memory — update store directly
  const record = adapter.core.sessionManager.getRecordByThread(
    "discord",
    channelId,
  );
  if (!record || record.status === "cancelled" || record.status === "error") {
    await interaction.editReply("⚠️ No active session in this channel.");
    return;
  }

  const newDangerousMode = !(record.dangerousMode ?? false);
  adapter.core.sessionManager
    .patchRecord(record.sessionId, { dangerousMode: newDangerousMode })
    .catch(() => {});
  log.info(
    { sessionId: record.sessionId, dangerousMode: newDangerousMode },
    "[discord-admin] Dangerous mode toggled via command (store-only)",
  );

  const msg = newDangerousMode
    ? "☠️ **Dangerous mode enabled** — All permission requests will be auto-approved."
    : "🔐 **Dangerous mode disabled** — Permission requests will be shown normally.";
  await interaction.editReply(msg);
}

export async function handleDangerousButton(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const sessionId = interaction.customId.slice(2); // strip 'd:'
  const session = adapter.core.sessionManager.getSession(sessionId);

  // Session live in memory — toggle directly
  if (session) {
    session.dangerousMode = !session.dangerousMode;
    adapter.core.sessionManager
      .patchRecord(sessionId, { dangerousMode: session.dangerousMode })
      .catch(() => {});
    log.info(
      { sessionId, dangerousMode: session.dangerousMode },
      "[discord-admin] Dangerous mode toggled via button",
    );

    const toastText = session.dangerousMode
      ? "☠️ Dangerous mode enabled — permissions auto-approved"
      : "🔐 Dangerous mode disabled — permissions shown normally";

    try {
      await interaction.update({
        components: [
          buildSessionControlKeyboard(
            sessionId,
            session.dangerousMode,
            session.voiceMode === "on",
          ),
        ],
      });
    } catch {
      /* ignore */
    }

    try {
      await interaction.followUp({ content: toastText, ephemeral: true });
    } catch {
      /* ignore */
    }
    return;
  }

  // Session not in memory — toggle in store
  const record = adapter.core.sessionManager.getSessionRecord(sessionId);
  if (!record || record.status === "cancelled" || record.status === "error") {
    await interaction.reply({
      content: "⚠️ Session not found or already ended.",
      ephemeral: true,
    });
    return;
  }

  const newDangerousMode = !(record.dangerousMode ?? false);
  adapter.core.sessionManager
    .patchRecord(sessionId, { dangerousMode: newDangerousMode })
    .catch(() => {});
  log.info(
    { sessionId, dangerousMode: newDangerousMode },
    "[discord-admin] Dangerous mode toggled via button (store-only)",
  );

  const toastText = newDangerousMode
    ? "☠️ Dangerous mode enabled — permissions auto-approved"
    : "🔐 Dangerous mode disabled — permissions shown normally";

  try {
    // Store-only path: voiceMode unknown, default to off
    await interaction.update({
      components: [
        buildSessionControlKeyboard(sessionId, newDangerousMode, false),
      ],
    });
  } catch {
    /* ignore */
  }

  try {
    await interaction.followUp({ content: toastText, ephemeral: true });
  } catch {
    /* ignore */
  }
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

export function buildSessionControlKeyboard(
  sessionId: string,
  dangerousMode: boolean,
  voiceMode: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`d:${sessionId}`)
      .setLabel(
        dangerousMode
          ? "🔐 Disable Dangerous Mode"
          : "☠️ Enable Dangerous Mode",
      )
      .setStyle(dangerousMode ? ButtonStyle.Secondary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`v:${sessionId}`)
      .setLabel(voiceMode ? "🔊 Text to Speech" : "🔇 Text to Speech")
      .setStyle(voiceMode ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
}

export async function handleTTS(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.channelId;
  const session = adapter.core.sessionManager.getSessionByThread(
    "discord",
    channelId,
  );

  if (!session) {
    await interaction.editReply("⚠️ No active session in this channel.");
    return;
  }

  const mode = interaction.options.getString("mode");

  if (mode === "on") {
    session.setVoiceMode("on");
    await interaction.editReply("🔊 Text to Speech enabled for this session.");
  } else if (mode === "off") {
    session.setVoiceMode("off");
    await interaction.editReply("🔇 Text to Speech disabled.");
  } else {
    session.setVoiceMode("next");
    await interaction.editReply(
      "🔊 Text to Speech enabled for the next message.",
    );
  }
}

export async function handleTTSButton(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const sessionId = interaction.customId.slice(2); // strip 'v:'
  const session = adapter.core.sessionManager.getSession(sessionId);

  if (!session) {
    await interaction.reply({
      content: "⚠️ Session not found or not active.",
      ephemeral: true,
    });
    return;
  }

  const newMode = session.voiceMode === "on" ? "off" : "on";
  session.setVoiceMode(newMode);

  const toastText =
    newMode === "on"
      ? "🔊 Text to Speech enabled"
      : "🔇 Text to Speech disabled";

  try {
    await interaction.update({
      components: [
        buildSessionControlKeyboard(
          sessionId,
          session.dangerousMode,
          newMode === "on",
        ),
      ],
    });
  } catch {
    /* ignore */
  }

  try {
    await interaction.followUp({ content: toastText, ephemeral: true });
  } catch {
    /* ignore */
  }
}

export async function handleRestart(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!adapter.core.requestRestart) {
    await interaction.editReply(
      "⚠️ Restart is not available (no restart handler registered).",
    );
    return;
  }

  await interaction.editReply(
    "🔄 **Restarting OpenACP...**\nRebuilding and restarting. Be back shortly.",
  );
  await new Promise((r) => setTimeout(r, 500));
  await adapter.core.requestRestart();
}

export async function handleUpdate(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  // Stub: not implemented yet
  await interaction.editReply(
    "⚠️ Update via Discord is not implemented yet. Run `npm install -g @openacp/cli@latest` in your terminal, then use `/restart`.",
  );
}

// ─── Output Mode ────────────────────────────────────────────────────────────

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

  if (scope === "session") {
    const threadId = interaction.channelId;
    const session = core.sessionManager.getSessionByThread("discord", threadId);
    if (!session) {
      await interaction.reply({ content: "⚠️ No active session found in this thread.", ephemeral: true });
      return;
    }
    if (level === "reset") {
      await core.sessionManager.patchRecord(session.id, { outputMode: undefined } as any);
      await interaction.reply({ content: "🔄 Session output mode reset to adapter default.", ephemeral: true });
    } else if (level === "low" || level === "medium" || level === "high") {
      await core.sessionManager.patchRecord(session.id, { outputMode: level } as any);
      await interaction.reply({ content: `${OUTPUT_MODE_LABELS[level]} Session output mode set to **${level}**.`, ephemeral: true });
    } else {
      const record = core.sessionManager.getSessionRecord(session.id);
      const current = (record as any)?.outputMode ?? "(adapter default)";
      await interaction.reply({ content: `📊 Session output mode: **${current}**`, ephemeral: true });
    }
    return;
  }

  if (level === "low" || level === "medium" || level === "high") {
    await core.configManager.save({ channels: { discord: { outputMode: level } } }, "channels.discord.outputMode");
    await interaction.reply({ content: `${OUTPUT_MODE_LABELS[level]} Output mode set to **${level}**.`, ephemeral: true });
  } else {
    const current = (core.configManager.get().channels?.discord as any)?.outputMode ?? "medium";
    await interaction.reply({
      content: `📊 Current output mode: **${current}**\n\n` +
        `\`/outputmode low|medium|high\` — Set adapter default\n` +
        `\`/outputmode session low|medium|high|reset\` — Override for this session\n\n` +
        `• **low** — icons only\n• **medium** — title + description (default)\n• **high** — full detail`,
      ephemeral: true,
    });
  }
}

/** @deprecated Use handleOutputMode instead */
export const handleVerbosity = handleOutputMode;
