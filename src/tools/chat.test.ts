import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerChatTools } from "./chat.js";

describe("chat tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerChatTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_send_chat", () => {
    it("sends a basic chat message", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "msg-1", content: "Hello world" }]),
      );

      const result = await invokeTool(server, "foundry_send_chat", {
        content: "Hello world",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.sent).toBe(true);
      expect(data.id).toBe("msg-1");
      expect(data.content).toBe("Hello world");
      expect(client.modifyDocument).toHaveBeenCalledWith("ChatMessage", "create", {
        data: [{ content: "Hello world" }],
      });
    });

    it("includes speaker, type, and whisper when provided", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "msg-2", content: "Secret" }]),
      );

      await invokeTool(server, "foundry_send_chat", {
        content: "Secret",
        speaker: { alias: "GM" },
        type: 4,
        whisper: ["user-1"],
      });

      expect(client.modifyDocument).toHaveBeenCalledWith("ChatMessage", "create", {
        data: [{ content: "Secret", speaker: { alias: "GM" }, type: 4, whisper: ["user-1"] }],
      });
    });
  });

  describe("foundry_roll_dice", () => {
    it("sends a roll chat message", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "roll-1", content: "[[/roll 2d6+5]]", rolls: [{ total: 12 }] }]),
      );

      const result = await invokeTool(server, "foundry_roll_dice", {
        formula: "2d6+5",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.rolled).toBe(true);
      expect(data.formula).toBe("2d6+5");
      expect(data.id).toBe("roll-1");
    });

    it("includes flavor text before the roll", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "roll-2", content: "Attack Roll\n[[/roll 1d20+5]]" }]),
      );

      await invokeTool(server, "foundry_roll_dice", {
        formula: "1d20+5",
        flavor: "Attack Roll",
      });

      const call = vi.mocked(client.modifyDocument).mock.calls[0];
      const data = (call[2] as Record<string, unknown>).data as Record<string, unknown>[];
      expect(data[0].content).toBe("Attack Roll\n[[/roll 1d20+5]]");
      expect(data[0].type).toBe(5);
    });

    it("passes speaker info when provided", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "roll-3" }]),
      );

      await invokeTool(server, "foundry_roll_dice", {
        formula: "1d20",
        speaker: { alias: "Fighter", actor: "actor-1" },
      });

      const call = vi.mocked(client.modifyDocument).mock.calls[0];
      const data = (call[2] as Record<string, unknown>).data as Record<string, unknown>[];
      expect(data[0].speaker).toEqual({ alias: "Fighter", actor: "actor-1" });
    });
  });
});
