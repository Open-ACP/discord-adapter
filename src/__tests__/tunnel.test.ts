import { describe, it, expect, vi } from "vitest";
import { handleTunnel, handleTunnels } from "../commands/tunnel.js";

const mockInteraction = (opts: Record<string, string | number | null> = {}) => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  options: {
    getString: (name: string) => (typeof opts[name] === "string" ? opts[name] : null),
    getInteger: (name: string) => (typeof opts[name] === "number" ? opts[name] : null),
  },
  deferred: true,
  replied: false,
  channelId: "ch1",
} as any);

const mockAdapter = (tunnelService?: any) => ({
  core: {
    lifecycleManager: {
      serviceRegistry: {
        get: vi.fn((key: string) => (key === "tunnel" ? tunnelService : undefined)),
      },
    },
    sessionManager: {
      getSessionByThread: vi.fn().mockReturnValue(null),
    },
  },
} as any);

describe("handleTunnel", () => {
  it("replies with error when tunnel service is not enabled", async () => {
    const interaction = mockInteraction();
    const adapter = mockAdapter(undefined);
    await handleTunnel(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("not enabled"),
    );
  });

  it("shows help when no port specified", async () => {
    const interaction = mockInteraction({ port: null });
    const tunnelService = { addTunnel: vi.fn(), stopTunnel: vi.fn() };
    const adapter = mockAdapter(tunnelService);
    await handleTunnel(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("/tunnel"),
    );
  });

  it("starts tunnel when port is provided", async () => {
    const interaction = mockInteraction({ port: 3000 });
    const tunnelService = {
      addTunnel: vi.fn().mockResolvedValue({ publicUrl: "https://abc.trycloudflare.com" }),
      stopTunnel: vi.fn(),
    };
    const adapter = mockAdapter(tunnelService);
    await handleTunnel(interaction, adapter);
    expect(tunnelService.addTunnel).toHaveBeenCalledWith(3000, expect.any(Object));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("abc.trycloudflare.com"),
    );
  });
});

describe("handleTunnels", () => {
  it("shows no tunnels message when list is empty", async () => {
    const interaction = mockInteraction();
    const tunnelService = { listTunnels: vi.fn().mockReturnValue([]) };
    const adapter = mockAdapter(tunnelService);
    await handleTunnels(interaction, adapter);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("No active tunnels"),
    );
  });
});
