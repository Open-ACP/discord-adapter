import type { Session } from '@openacp/plugin-sdk'

export interface DiscordPlatformData {
  guildId: string
  channelId: string
  threadId?: string
  messageId?: string
}

export interface DiscordChannelConfig {
  enabled: boolean
  botToken: string
  guildId: string
  forumChannelId: string | null
  notificationChannelId: string | null
  assistantThreadId: string | null
  [key: string]: unknown
}

export interface CommandsAssistantContext {
  threadId: string
  getSession: () => Session | null
  respawn: () => Promise<void>
}
