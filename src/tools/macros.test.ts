import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerMacroTools } from "./macros.js";

describe("macro tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerMacroTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_execute_macro", () => {
    it("creates, executes, and cleans up a macro", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "macro-1" }])) // create macro
        .mockResolvedValueOnce(mockResponse([{ _id: "chat-1" }])) // create chat
        .mockResolvedValueOnce(mockResponse([])); // delete macro

      const result = await invokeTool(server, "foundry_execute_macro", {
        script: "console.log('hello')",
        name: "Test",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.executed).toBe(true);
      expect(data.macroId).toBe("macro-1");
      expect(data.chatMessageId).toBe("chat-1");

      // Verify cleanup
      expect(client.modifyDocument).toHaveBeenCalledTimes(3);
      const deleteCall = vi.mocked(client.modifyDocument).mock.calls[2];
      expect(deleteCall[0]).toBe("Macro");
      expect(deleteCall[1]).toBe("delete");
    });

    it("returns error when not authenticated", async () => {
      const unauthClient = createMockClient({ userId: null } as unknown as Partial<typeof client>);
      const unauthServer = createMockServer();
      registerMacroTools(unauthServer, unauthClient);

      const result = await invokeTool(unauthServer, "foundry_execute_macro", {
        script: "test",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("userId");
    });

    it("returns error when macro creation fails", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_execute_macro", {
        script: "test",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to create");
    });

    it("handles chat execution failure gracefully", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "macro-1" }])) // create macro
        .mockRejectedValueOnce(new Error("Chat failed")) // create chat throws
        .mockResolvedValueOnce(mockResponse([])); // delete macro (cleanup)

      const result = await invokeTool(server, "foundry_execute_macro", {
        script: "test",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      // Returns non-error response with executed=false
      expect(result.isError).toBeUndefined();
      expect(data.executed).toBe(false);
      expect(data.macroId).toBe("macro-1");
      expect(data.error).toBe("Chat failed");
      expect(data.hint).toContain("manually");
    });
  });
});
