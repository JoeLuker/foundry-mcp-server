import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, parseResponse, invokeTool } from "../test-helpers.js";
import { registerWorldTools } from "./world.js";

describe("world tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerWorldTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_get_status", () => {
    it("returns connected status with world info", async () => {
      const result = await invokeTool(server, "foundry_get_status");
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.connected).toBe(true);
      expect(data.state).toBe("ready");
      expect(data.active).toBe(true);
      expect(data.version).toBe("13.0");
      expect(data.world).toBe("test-world");
    });

    it("returns disconnected status on error", async () => {
      vi.mocked(client.ensureConnected).mockRejectedValueOnce(new Error("Connection refused"));

      const result = await invokeTool(server, "foundry_get_status");
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.connected).toBe(false);
      expect(data.error).toBe("Connection refused");
    });
  });
});
