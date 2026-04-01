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
  const session = await adapter.core.getOrResumeSession(
    "discord",
    channelId,
  );

  if (session) {
    const current = session.clientOverrides.bypassPermissions ?? false;
    session.clientOverrides.bypassPermissions = !current;
    adapter.core.sessionManager
      .patchRecord(session.id, { clientOverrides: session.clientOverrides })
      .catch(() => {});
    log.info(
      { sessionId: session.id, bypassPermissions: session.clientOverrides.bypassPermissions },
      "[discord-admin] Bypass permissions toggled via command",
    );

    const msg = session.clientOverrides.bypassPermissions
      ? "☠️ **Bypass enabled** — all permission requests will be auto-approved. The agent can run any action without asking."
      : "🔐 **Bypass disabled** — you will be asked to approve risky actions.";
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

  const current = record.clientOverrides?.bypassPermissions ?? record.dangerousMode ?? false;
  const newBypass = !current;
  adapter.core.sessionManager
    .patchRecord(record.sessionId, { clientOverrides: { bypassPermissions: newBypass } })
    .catch(() => {});
  log.info(
    { sessionId: record.sessionId, bypassPermissions: newBypass },
    "[discord-admin] Bypass permissions toggled via command (store-only)",
  );

  const msg = newBypass
    ? "☠️ **Bypass enabled** — all permission requests will be auto-approved. The agent can run any action without asking."
    : "🔐 **Bypass disabled** — you will be asked to approve risky actions.";
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
    const current = session.clientOverrides.bypassPermissions ?? false;
    session.clientOverrides.bypassPermissions = !current;
    adapter.core.sessionManager
      .patchRecord(sessionId, { clientOverrides: session.clientOverrides })
      .catch(() => {});
    log.info(
      { sessionId, bypassPermissions: session.clientOverrides.bypassPermissions },
      "[discord-admin] Bypass permissions toggled via button",
    );

    const toastText = session.clientOverrides.bypassPermissions
      ? "☠️ Bypass enabled — permissions auto-approved"
      : "🔐 Bypass disabled — approvals required";

    try {
      await interaction.update({
        components: [
          buildSessionControlKeyboard(
            sessionId,
            session.clientOverrides.bypassPermissions,
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

  const current = record.clientOverrides?.bypassPermissions ?? record.dangerousMode ?? false;
  const newBypass = !current;
  adapter.core.sessionManager
    .patchRecord(sessionId, { clientOverrides: { bypassPermissions: newBypass } })
    .catch(() => {});
  log.info(
    { sessionId, bypassPermissions: newBypass },
    "[discord-admin] Bypass permissions toggled via button (store-only)",
  );

  const toastText = newBypass
    ? "☠️ Bypass enabled — permissions auto-approved"
    : "🔐 Bypass disabled — approvals required";

  try {
    // Store-only path: voiceMode unknown, default to off
    await interaction.update({
      components: [
        buildSessionControlKeyboard(sessionId, newBypass, false),
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
          ? "🔐 Disable Bypass"
          : "☠️ Enable Bypass",
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
  const session = await adapter.core.getOrResumeSession(
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
          session.clientOverrides.bypassPermissions ?? false,
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
    const session = await core.getOrResumeSession("discord", threadId);
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

  if (level === "reset") {
    await core.configManager.save({ channels: { discord: { outputMode: undefined } } } as any, "channels.discord.outputMode");
    await interaction.reply({ content: "🔄 Adapter output mode reset to global default.", ephemeral: true });
  } else if (level === "low" || level === "medium" || level === "high") {
    await core.configManager.save({ channels: { discord: { outputMode: level } } }, "channels.discord.outputMode");
    await interaction.reply({ content: `${OUTPUT_MODE_LABELS[level]} Output mode set to **${level}**.`, ephemeral: true });
  } else {
    const current = (core.configManager.get().channels?.discord as any)?.outputMode ?? "medium";
    await interaction.reply({
      content: `📊 Current output mode: **${current}**\n\n` +
        `\`/outputmode low|medium|high\` — Set adapter default\n` +
        `\`/outputmode reset\` — Reset adapter to global default\n` +
        `\`/outputmode session low|medium|high|reset\` — Override for this session\n\n` +
        `• **low** — icons only\n• **medium** — title + description (default)\n• **high** — full detail`,
      ephemeral: true,
    });
  }
}

/** @deprecated Use handleOutputMode instead */
export const handleVerbosity = handleOutputMode;
