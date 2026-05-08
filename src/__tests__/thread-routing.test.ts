import { describe, expect, it } from 'vitest'
import { isManagedDiscordThread } from '../thread-routing.js'

describe('isManagedDiscordThread', () => {
  it('allows the configured assistant thread', () => {
    expect(isManagedDiscordThread({
      threadId: 'assistant-1',
      parentId: 'other-forum',
      forumChannelId: 'sessions-forum',
      assistantThreadId: 'assistant-1',
      hasSessionRecord: false,
    })).toBe(true)
  })

  it('allows threads with a local session record even if the thread moved', () => {
    expect(isManagedDiscordThread({
      threadId: 'thread-1',
      parentId: 'archived-parent',
      forumChannelId: 'sessions-forum',
      assistantThreadId: null,
      hasSessionRecord: true,
    })).toBe(true)
  })

  it('allows new threads under this adapter sessions forum', () => {
    expect(isManagedDiscordThread({
      threadId: 'thread-1',
      parentId: 'sessions-forum',
      forumChannelId: 'sessions-forum',
      assistantThreadId: null,
      hasSessionRecord: false,
    })).toBe(true)
  })

  it('ignores unmanaged threads from another OpenACP instance in the same guild', () => {
    expect(isManagedDiscordThread({
      threadId: 'thread-1',
      parentId: 'other-sessions-forum',
      forumChannelId: 'sessions-forum',
      assistantThreadId: null,
      hasSessionRecord: false,
    })).toBe(false)
  })
})
