import { runAdapterConformanceTests } from '@openacp/plugin-sdk/testing'
import { MessagingAdapter, BaseRenderer } from '@openacp/plugin-sdk'
import type { AdapterCapabilities } from '@openacp/plugin-sdk'

class TestAdapter extends MessagingAdapter {
  readonly name = 'discord'
  readonly renderer = new BaseRenderer()
  readonly capabilities: AdapterCapabilities = {
    streaming: true, richFormatting: true, threads: true,
    reactions: false, fileUpload: false, voice: false,
  }
  async start() {}
  async stop() {}
  async createSessionThread() { return 'thread-1' }
  async renameSessionThread() {}
  async sendPermissionRequest() {}
  async sendNotification() {}
}

runAdapterConformanceTests(
  () => new TestAdapter(
    { configManager: { get: () => ({}) } },
    { enabled: true, maxMessageLength: 4096 },
  ),
)
