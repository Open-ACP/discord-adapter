import { ChannelType } from 'discord.js'
import type { CategoryChannel, ForumChannel, ThreadChannel, Guild, TextChannel } from 'discord.js'
import { log } from '@openacp/plugin-sdk'

type RuntimeChannelKey = 'categoryId' | 'forumChannelId' | 'notificationChannelId'

function normalizeCategoryName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 100)
}

async function ensureCategory(
  guild: Guild,
  config: { categoryId: string | null; categoryName?: string | null },
  saveConfig: (key: RuntimeChannelKey, value: string) => Promise<void>,
): Promise<CategoryChannel | null> {
  let categoryId = config.categoryId
  const categoryName = normalizeCategoryName(config.categoryName)
  if (!categoryId && !categoryName) return null

  if (categoryId) {
    try {
      const ch = guild.channels.cache.get(categoryId)
        ?? await guild.channels.fetch(categoryId)
      if (ch && ch.type === ChannelType.GuildCategory) {
        log.info({ categoryId }, '[forums] Reusing existing category')
        return ch as CategoryChannel
      }
    } catch {
      log.warn({ categoryId }, '[forums] Saved category not found, recreating...')
    }
  }

  if (!categoryName) return null

  const cached = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName,
  )
  if (cached) {
    await saveConfig('categoryId', cached.id)
    log.info({ categoryId: cached.id, categoryName }, '[forums] Reusing category by name')
    return cached as CategoryChannel
  }

  const category = await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory,
  })
  await saveConfig('categoryId', category.id)
  log.info({ categoryId: category.id, categoryName }, '[forums] Created category')
  return category as CategoryChannel
}

async function ensureChannelParent(
  channel: ForumChannel | TextChannel,
  category: CategoryChannel | null,
): Promise<void> {
  if (!category || channel.parentId === category.id) return
  try {
    await channel.setParent(category.id)
  } catch (err) {
    log.warn({ err, channelId: channel.id, categoryId: category.id }, '[forums] Failed to move channel into category')
  }
}

// ─── ensureForums ─────────────────────────────────────────────────────────────

/**
 * Ensures both the forum channel and notification channel exist.
 * Creates them if their IDs are null, then persists the IDs via saveConfig.
 */
export async function ensureForums(
  guild: Guild,
  config: {
    categoryId: string | null
    categoryName?: string | null
    forumChannelId: string | null
    notificationChannelId: string | null
  },
  saveConfig: (key: RuntimeChannelKey, value: string) => Promise<void>,
): Promise<{ forumChannel: ForumChannel | TextChannel; notificationChannel: TextChannel }> {
  const category = await ensureCategory(guild, config, saveConfig)
  let forumChannelId = config.forumChannelId
  let notificationChannelId = config.notificationChannelId

  // Ensure forum/sessions channel exists — fetch existing or create new
  let forumChannel: ForumChannel | TextChannel | null = null
  if (forumChannelId) {
    try {
      const ch = guild.channels.cache.get(forumChannelId)
        ?? await guild.channels.fetch(forumChannelId)
      if (ch && (ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildText)) {
        forumChannel = ch as ForumChannel | TextChannel
        await ensureChannelParent(forumChannel, category)
        log.info({ forumChannelId, type: ch.type }, '[forums] Reusing existing sessions channel')
      }
    } catch {
      log.warn({ forumChannelId }, '[forums] Saved sessions channel not found, recreating...')
    }
  }
  if (!forumChannel) {
    // Prefer Forum Channel (requires Community mode), fallback to Text Channel with threads
    if (guild.features.includes('COMMUNITY')) {
      const channel = await guild.channels.create({
        name: 'openacp-sessions',
        type: ChannelType.GuildForum,
        parent: category?.id,
      })
      forumChannel = channel as ForumChannel
      log.info({ forumChannelId: channel.id }, '[forums] Created forum channel')
    } else {
      const channel = await guild.channels.create({
        name: 'openacp-sessions',
        type: ChannelType.GuildText,
        parent: category?.id,
      })
      forumChannel = channel as TextChannel
      log.info({ forumChannelId: channel.id }, '[forums] Created text channel (Community mode not enabled, using threads fallback)')
    }
    await saveConfig('forumChannelId', forumChannel.id)
  }

  // Ensure notification channel exists — fetch existing or create new
  let notificationChannel: TextChannel | null = null
  if (notificationChannelId) {
    try {
      const ch = guild.channels.cache.get(notificationChannelId)
        ?? await guild.channels.fetch(notificationChannelId)
      if (ch && ch.type === ChannelType.GuildText) {
        notificationChannel = ch as TextChannel
        await ensureChannelParent(notificationChannel, category)
        log.info({ notificationChannelId }, '[forums] Reusing existing notification channel')
      }
    } catch {
      log.warn({ notificationChannelId }, '[forums] Saved notification channel not found, recreating...')
    }
  }
  if (!notificationChannel) {
    const channel = await guild.channels.create({
      name: 'openacp-notifications',
      type: ChannelType.GuildText,
      parent: category?.id,
    })
    notificationChannel = channel as TextChannel
    await saveConfig('notificationChannelId', channel.id)
    log.info({ notificationChannelId: channel.id }, '[forums] Created notification channel')
  }

  return { forumChannel, notificationChannel }
}

// ─── createSessionThread ──────────────────────────────────────────────────────

/**
 * Creates a new thread for a session.
 * - Forum Channel: creates a forum post (thread with initial message)
 * - Text Channel: creates a public thread
 */
export async function createSessionThread(
  forumChannel: ForumChannel | TextChannel,
  name: string,
): Promise<ThreadChannel> {
  if (forumChannel.type === ChannelType.GuildForum) {
    // Forum channel: create a post (thread with initial message)
    const thread = await (forumChannel as ForumChannel).threads.create({
      name,
      message: { content: '⏳ Setting up...' },
    })
    return thread
  }

  // Text channel fallback: send a message first, then create a thread on it
  const textChannel = forumChannel as TextChannel
  const msg = await textChannel.send({ content: `📂 **${name}** — ⏳ Setting up...` })
  const thread = await msg.startThread({ name })
  return thread
}

// ─── renameSessionThread ──────────────────────────────────────────────────────

/**
 * Fetches and renames a thread. Ignores all errors (thread may be deleted/archived).
 */
export async function renameSessionThread(
  guild: Guild,
  threadId: string,
  newName: string,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(threadId)
      ?? await guild.channels.fetch(threadId)
    if (channel && 'setName' in channel) {
      await (channel as ThreadChannel).setName(newName)
    }
  } catch {
    // Ignore — thread may be deleted or archived
  }
}

// ─── deleteSessionThread ──────────────────────────────────────────────────────

/**
 * Archives and locks a thread instead of permanently deleting it.
 * Unlike Telegram (which just closes a topic), Discord delete is permanent
 * and destroys all messages. Archiving preserves the conversation history.
 */
export async function deleteSessionThread(
  guild: Guild,
  threadId: string,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(threadId)
      ?? await guild.channels.fetch(threadId)
    if (channel && channel.isThread()) {
      const thread = channel as ThreadChannel
      if (!thread.archived) {
        await thread.setArchived(true)
      }
      if (!thread.locked) {
        await thread.setLocked(true)
      }
    }
  } catch {
    // Ignore — thread may already be deleted or inaccessible
  }
}

// ─── ensureUnarchived ─────────────────────────────────────────────────────────

/**
 * If the thread is archived, unarchives it.
 */
export async function ensureUnarchived(thread: ThreadChannel): Promise<void> {
  if (thread.archived) {
    try {
      await thread.setArchived(false)
    } catch (err) {
      log.warn({ err, threadId: thread.id }, '[forums] Failed to unarchive thread')
    }
  }
}

// ─── buildDeepLink ────────────────────────────────────────────────────────────

/**
 * Builds a Discord deep link URL to a channel/thread, optionally to a specific message.
 */
export function buildDeepLink(
  guildId: string,
  channelId: string,
  messageId?: string,
): string {
  const base = `https://discord.com/channels/${guildId}/${channelId}`
  return messageId ? `${base}/${messageId}` : base
}
