export interface ManagedDiscordThreadInput {
  threadId: string
  parentId: string | null
  forumChannelId: string | null
  assistantThreadId: string | null
  hasSessionRecord: boolean
}

/**
 * A Discord bot may share a guild with other OpenACP bot instances.
 * Only process threads this adapter owns or already has recorded locally.
 */
export function isManagedDiscordThread(input: ManagedDiscordThreadInput): boolean {
  if (input.assistantThreadId && input.threadId === input.assistantThreadId) return true
  if (input.hasSessionRecord) return true
  if (input.forumChannelId && input.parentId === input.forumChannelId) return true
  return false
}
