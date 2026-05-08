import { describe, expect, it, vi } from 'vitest'
import { ChannelType } from 'discord.js'
import type { Guild } from 'discord.js'
import { ensureForums } from '../forums.js'

function createGuildMock(features: string[] = ['COMMUNITY']) {
  const channels = new Map<string, any>()
  const created: any[] = []

  const guild = {
    features,
    channels: {
      cache: {
        get: (id: string) => channels.get(id),
        find: (predicate: (channel: any) => boolean) => [...channels.values()].find(predicate),
      },
      fetch: vi.fn(async (id: string) => channels.get(id) ?? null),
      create: vi.fn(async (opts: { name: string; type: ChannelType; parent?: string }) => {
        const channel = {
          id: `${opts.name}-${created.length + 1}`,
          name: opts.name,
          type: opts.type,
          parentId: opts.parent ?? null,
          setParent: vi.fn(async (parentId: string) => {
            channel.parentId = parentId
          }),
        }
        channels.set(channel.id, channel)
        created.push({ opts, channel })
        return channel
      }),
    },
  }

  return { guild: guild as unknown as Guild, channels, created }
}

describe('ensureForums', () => {
  it('creates session channels inside configured category name', async () => {
    const { guild, created } = createGuildMock()
    const saved: Array<[string, string]> = []

    const result = await ensureForums(
      guild,
      {
        categoryId: null,
        categoryName: 'OpenACP - Workstation',
        forumChannelId: null,
        notificationChannelId: null,
      },
      async (key, value) => {
        saved.push([key, value])
      },
    )

    expect(result.forumChannel.parentId).toBe('OpenACP - Workstation-1')
    expect(result.notificationChannel.parentId).toBe('OpenACP - Workstation-1')
    expect(created.map((item) => item.opts)).toEqual([
      { name: 'OpenACP - Workstation', type: ChannelType.GuildCategory },
      { name: 'openacp-sessions', type: ChannelType.GuildForum, parent: 'OpenACP - Workstation-1' },
      { name: 'openacp-notifications', type: ChannelType.GuildText, parent: 'OpenACP - Workstation-1' },
    ])
    expect(saved).toEqual([
      ['categoryId', 'OpenACP - Workstation-1'],
      ['forumChannelId', 'openacp-sessions-2'],
      ['notificationChannelId', 'openacp-notifications-3'],
    ])
  })

  it('moves reused session channels into configured category', async () => {
    const { guild, channels } = createGuildMock()
    const category = { id: 'cat-1', name: 'OpenACP - Server', type: ChannelType.GuildCategory }
    const forum = {
      id: 'forum-1',
      name: 'openacp-sessions',
      type: ChannelType.GuildForum,
      parentId: null as string | null,
      setParent: vi.fn(async (parentId: string) => {
        forum.parentId = parentId
      }),
    }
    const notifications = {
      id: 'notify-1',
      name: 'openacp-notifications',
      type: ChannelType.GuildText,
      parentId: null as string | null,
      setParent: vi.fn(async (parentId: string) => {
        notifications.parentId = parentId
      }),
    }
    channels.set(category.id, category)
    channels.set(forum.id, forum)
    channels.set(notifications.id, notifications)

    await ensureForums(
      guild,
      {
        categoryId: 'cat-1',
        categoryName: null,
        forumChannelId: 'forum-1',
        notificationChannelId: 'notify-1',
      },
      async () => {},
    )

    expect(forum.setParent).toHaveBeenCalledWith('cat-1')
    expect(notifications.setParent).toHaveBeenCalledWith('cat-1')
    expect(forum.parentId).toBe('cat-1')
    expect(notifications.parentId).toBe('cat-1')
  })
})
