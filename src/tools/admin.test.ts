import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, parseResponse, invokeTool } from "../test-helpers.js";
import { registerAdminTools } from "./admin.js";

describe("admin tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerAdminTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_browse_files", () => {
    it("browses files in data directory", async () => {
      vi.mocked(client.emitSocketArgs).mockResolvedValueOnce({
        target: "worlds/test",
        dirs: ["assets"],
        files: ["token.png"],
      });

      const result = await invokeTool(server, "foundry_browse_files", {
        source: "data",
        target: "worlds/test",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.target).toBe("worlds/test");
      expect(data.dirs).toEqual(["assets"]);
      expect(client.emitSocketArgs).toHaveBeenCalledWith(
        "manageFiles",
        { action: "browseFiles", storage: "data", target: "worlds/test" },
        {},
      );
    });

    it("defaults to empty target for root", async () => {
      vi.mocked(client.emitSocketArgs).mockResolvedValueOnce({ target: "" });

      await invokeTool(server, "foundry_browse_files", {
        source: "data",
      });

      const call = vi.mocked(client.emitSocketArgs).mock.calls[0];
      const data = call[1] as Record<string, unknown>;
      expect(data.target).toBe("");
    });
  });

  describe("foundry_create_directory", () => {
    it("creates a directory", async () => {
      vi.mocked(client.emitSocketArgs).mockResolvedValueOnce({});

      const result = await invokeTool(server, "foundry_create_directory", {
        source: "data",
        target: "worlds/test/maps",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.created).toBe(true);
      expect(data.target).toBe("worlds/test/maps");
    });
  });

  describe("foundry_manage_compendium", () => {
    it("creates a compendium pack", async () => {
      vi.mocked(client.emitSocket).mockResolvedValueOnce({ result: {} });

      const result = await invokeTool(server, "foundry_manage_compendium", {
        action: "create",
        type: "Item",
        label: "Custom Items",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.action).toBe("create");
      expect(client.emitSocket).toHaveBeenCalledWith("manageCompendium", {
        action: "create",
        data: { type: "Item", label: "Custom Items" },
        options: {},
      });
    });

    it("returns error when creating without required params", async () => {
      const result = await invokeTool(server, "foundry_manage_compendium", {
        action: "create",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("type");
    });

    it("deletes a compendium pack", async () => {
      vi.mocked(client.emitSocket).mockResolvedValueOnce({ result: {} });

      await invokeTool(server, "foundry_manage_compendium", {
        action: "delete",
        pack: "world.custom-items",
      });

      expect(client.emitSocket).toHaveBeenCalledWith("manageCompendium", {
        action: "delete",
        data: "custom-items",
        options: {},
      });
    });

    it("returns error when delete/migrate without pack", async () => {
      const result = await invokeTool(server, "foundry_manage_compendium", {
        action: "delete",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("pack");
    });

    it("migrates a compendium pack", async () => {
      vi.mocked(client.emitSocket).mockResolvedValueOnce({ result: {} });

      await invokeTool(server, "foundry_manage_compendium", {
        action: "migrate",
        pack: "world.my-pack",
      });

      expect(client.emitSocket).toHaveBeenCalledWith("manageCompendium", {
        action: "migrate",
        type: "world.my-pack",
        data: "world.my-pack",
        options: {},
      });
    });

    it("handles error from Foundry", async () => {
      vi.mocked(client.emitSocket).mockResolvedValueOnce({
        error: { message: "Pack not found" },
      });

      const result = await invokeTool(server, "foundry_manage_compendium", {
        action: "delete",
        pack: "world.nonexistent",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Pack not found");
    });
  });

  describe("foundry_get_world_size", () => {
    it("returns size info", async () => {
      vi.mocked(client.emitSocketCallback).mockResolvedValueOnce({
        actors: 1024,
        items: 2048,
        total: 3072,
      });

      const result = await invokeTool(server, "foundry_get_world_size");
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(3072);
      expect(client.emitSocketCallback).toHaveBeenCalledWith("sizeInfo");
    });
  });
});
