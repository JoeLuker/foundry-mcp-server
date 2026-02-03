import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, parseResponse, invokeTool } from "../test-helpers.js";
import { registerPresentationTools } from "./presentation.js";

describe("presentation tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerPresentationTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_show_journal", () => {
    it("shows a journal to all users", async () => {
      const result = await invokeTool(server, "foundry_show_journal", {
        journalId: "j-1",
        force: false,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.shown).toBe(true);
      expect(data.journalId).toBe("j-1");
      expect(data.targetUsers).toBe("all");
      expect(client.emitSocketArgs).toHaveBeenCalledWith(
        "showEntry",
        "JournalEntry.j-1",
        { force: false },
      );
    });

    it("shows a journal to specific users with force", async () => {
      await invokeTool(server, "foundry_show_journal", {
        journalId: "j-1",
        force: true,
        users: ["u-1", "u-2"],
      });

      expect(client.emitSocketArgs).toHaveBeenCalledWith(
        "showEntry",
        "JournalEntry.j-1",
        { force: true, users: ["u-1", "u-2"] },
      );
    });
  });

  describe("foundry_share_image", () => {
    it("shares an image with all users", async () => {
      const result = await invokeTool(server, "foundry_share_image", {
        image: "worlds/test/map.webp",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.shared).toBe(true);
      expect(data.image).toBe("worlds/test/map.webp");
      expect(data.targetUsers).toBe("all");
      expect(client.emitSocketRaw).toHaveBeenCalledWith("shareImage", {
        image: "worlds/test/map.webp",
      });
    });

    it("shares an image with title and specific users", async () => {
      await invokeTool(server, "foundry_share_image", {
        image: "worlds/test/handout.jpg",
        title: "Ancient Map",
        users: ["u-1"],
      });

      expect(client.emitSocketRaw).toHaveBeenCalledWith("shareImage", {
        image: "worlds/test/handout.jpg",
        title: "Ancient Map",
        users: ["u-1"],
      });
    });
  });
});
