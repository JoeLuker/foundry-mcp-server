import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, mockDeleteResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerEmbeddedTools } from "./embedded.js";

describe("embedded tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerEmbeddedTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_list_embedded", () => {
    it("lists embedded documents with default fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "item-1", name: "Sword", type: "weapon", system: {} },
          { _id: "item-2", name: "Shield", type: "armor", system: {} },
        ]),
      );

      const result = await invokeTool(server, "foundry_list_embedded", {
        parentType: "Actor",
        parentId: "actor-1",
        embeddedType: "Item",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(2);
      const docs = data.documents as Record<string, unknown>[];
      expect(docs[0]).toEqual({ _id: "item-1", name: "Sword", type: "weapon" });
      expect(client.modifyDocument).toHaveBeenCalledWith("Item", "get", {
        query: {},
        parentUuid: "Actor.actor-1",
      });
    });
  });

  describe("foundry_create_embedded", () => {
    it("creates an embedded document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "new-item", name: "Potion" }]),
      );

      const result = await invokeTool(server, "foundry_create_embedded", {
        parentType: "Actor",
        parentId: "actor-1",
        embeddedType: "Item",
        data: { name: "Potion", type: "consumable" },
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data._id).toBe("new-item");
      expect(client.modifyDocument).toHaveBeenCalledWith("Item", "create", {
        data: [{ name: "Potion", type: "consumable" }],
        parentUuid: "Actor.actor-1",
      });
    });
  });

  describe("foundry_create_embedded_batch", () => {
    it("creates multiple embedded documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "w-1" }, { _id: "w-2" }]),
      );

      const result = await invokeTool(server, "foundry_create_embedded_batch", {
        parentType: "Scene",
        parentId: "scene-1",
        embeddedType: "Wall",
        data: [{ c: [0, 0, 100, 100] }, { c: [100, 100, 200, 200] }],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.created).toBe(2);
    });
  });

  describe("foundry_update_embedded", () => {
    it("updates an embedded document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "token-1", x: 200, y: 300 }]),
      );

      const result = await invokeTool(server, "foundry_update_embedded", {
        parentType: "Scene",
        parentId: "scene-1",
        embeddedType: "Token",
        id: "token-1",
        updates: { x: 200, y: 300 },
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.x).toBe(200);
      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "update", {
        updates: [{ _id: "token-1", x: 200, y: 300 }],
        parentUuid: "Scene.scene-1",
      });
    });
  });

  describe("foundry_update_embedded_batch", () => {
    it("updates multiple embedded documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "t-1" }, { _id: "t-2" }]),
      );

      const result = await invokeTool(server, "foundry_update_embedded_batch", {
        parentType: "Scene",
        parentId: "scene-1",
        embeddedType: "Token",
        updates: [{ _id: "t-1", x: 100 }, { _id: "t-2", x: 200 }],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.updated).toBe(2);
    });

    it("throws if update missing _id", async () => {
      await expect(
        invokeTool(server, "foundry_update_embedded_batch", {
          parentType: "Scene",
          parentId: "scene-1",
          embeddedType: "Token",
          updates: [{ x: 100 }],
        }),
      ).rejects.toThrow("_id");
    });
  });

  describe("foundry_delete_embedded", () => {
    it("deletes an embedded document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockDeleteResponse(["item-1"]));

      const result = await invokeTool(server, "foundry_delete_embedded", {
        parentType: "Actor",
        parentId: "actor-1",
        embeddedType: "Item",
        id: "item-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.deleted).toBe(true);
      expect(data.id).toBe("item-1");
    });
  });

  describe("foundry_delete_embedded_batch", () => {
    it("deletes multiple embedded documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockDeleteResponse(["w-1", "w-2"]));

      const result = await invokeTool(server, "foundry_delete_embedded_batch", {
        parentType: "Scene",
        parentId: "scene-1",
        embeddedType: "Wall",
        ids: ["w-1", "w-2"],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.deleted).toBe(2);
    });
  });
});
