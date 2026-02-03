import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, mockDeleteResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerDocumentTools } from "./documents.js";

describe("document tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerDocumentTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_list_documents", () => {
    it("lists documents with default fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "a-1", name: "Fighter", type: "character", folder: "f-1", system: {} },
          { _id: "a-2", name: "Goblin", type: "npc", folder: null, system: {} },
        ]),
      );

      const result = await invokeTool(server, "foundry_list_documents", {
        documentType: "Actor",
        limit: 50,
        offset: 0,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(2);
      expect(data.count).toBe(2);
      const docs = data.documents as Record<string, unknown>[];
      expect(docs[0]).toEqual({ _id: "a-1", name: "Fighter", type: "character", folder: "f-1" });
    });

    it("filters by type and folder", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      await invokeTool(server, "foundry_list_documents", {
        documentType: "Actor",
        type: "npc",
        folder: "f-1",
        limit: 50,
        offset: 0,
      });

      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "get", {
        query: { type: "npc", folder: "f-1" },
      });
    });

    it("paginates results", async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        _id: `i-${i}`,
        name: `Item ${i}`,
        type: "weapon",
        folder: null,
      }));
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse(items));

      const result = await invokeTool(server, "foundry_list_documents", {
        documentType: "Item",
        limit: 2,
        offset: 1,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(5);
      expect(data.count).toBe(2);
      expect(data.offset).toBe(1);
    });

    it("selects custom fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "a-1", name: "Fighter", system: { attributes: { hp: { value: 30 } } } }]),
      );

      const result = await invokeTool(server, "foundry_list_documents", {
        documentType: "Actor",
        fields: ["_id", "system.attributes.hp.value"],
        limit: 50,
        offset: 0,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      const docs = data.documents as Record<string, unknown>[];
      expect(docs[0]).toEqual({ _id: "a-1", "system.attributes.hp.value": 30 });
    });
  });

  describe("foundry_get_document", () => {
    it("gets a document by ID", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "a-1", name: "Fighter", type: "character" }]),
      );

      const result = await invokeTool(server, "foundry_get_document", {
        documentType: "Actor",
        id: "a-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data._id).toBe("a-1");
      expect(data.name).toBe("Fighter");
    });

    it("returns error when not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_get_document", {
        documentType: "Actor",
        id: "missing",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_search_documents", () => {
    it("searches by name pattern", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "1", name: "Longsword", type: "weapon", folder: null },
          { _id: "2", name: "Longbow", type: "weapon", folder: null },
          { _id: "3", name: "Dagger", type: "weapon", folder: null },
        ]),
      );

      const result = await invokeTool(server, "foundry_search_documents", {
        documentType: "Item",
        namePattern: "Long",
        limit: 20,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(2);
    });

    it("splits filters between server and client", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "1", name: "Goblin", type: "npc", folder: null, system: { details: { cr: 1 } } },
          { _id: "2", name: "Dragon", type: "npc", folder: null, system: { details: { cr: 20 } } },
        ]),
      );

      const result = await invokeTool(server, "foundry_search_documents", {
        documentType: "Actor",
        filters: { type: "npc", "system.details.cr": 20 },
        limit: 20,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      // type goes to server query
      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "get", {
        query: { type: "npc" },
      });
      // system.details.cr filtered client-side
      expect(data.total).toBe(1);
    });
  });

  describe("foundry_create_document", () => {
    it("creates a document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "new-1", name: "New Actor", type: "character" }]),
      );

      const result = await invokeTool(server, "foundry_create_document", {
        documentType: "Actor",
        data: { name: "New Actor", type: "character" },
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data._id).toBe("new-1");
      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "create", {
        data: [{ name: "New Actor", type: "character" }],
      });
    });
  });

  describe("foundry_update_document", () => {
    it("updates a document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "a-1", name: "Updated" }]),
      );

      const result = await invokeTool(server, "foundry_update_document", {
        documentType: "Actor",
        id: "a-1",
        updates: { name: "Updated" },
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.name).toBe("Updated");
      expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "update", {
        updates: [{ _id: "a-1", name: "Updated" }],
      });
    });
  });

  describe("foundry_delete_document", () => {
    it("deletes a document", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockDeleteResponse(["a-1"]));

      const result = await invokeTool(server, "foundry_delete_document", {
        documentType: "Actor",
        id: "a-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.deleted).toBe(true);
      expect(data.id).toBe("a-1");
    });
  });

  describe("foundry_create_document_batch", () => {
    it("creates multiple documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "new-1" }, { _id: "new-2" }]),
      );

      const result = await invokeTool(server, "foundry_create_document_batch", {
        documentType: "Item",
        data: [{ name: "Sword" }, { name: "Shield" }],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.created).toBe(2);
      expect(data.ids).toEqual(["new-1", "new-2"]);
    });
  });

  describe("foundry_update_document_batch", () => {
    it("updates multiple documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "a-1" }, { _id: "a-2" }]),
      );

      const result = await invokeTool(server, "foundry_update_document_batch", {
        documentType: "Actor",
        updates: [{ _id: "a-1", name: "A" }, { _id: "a-2", name: "B" }],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.updated).toBe(2);
    });

    it("throws if update missing _id", async () => {
      await expect(
        invokeTool(server, "foundry_update_document_batch", {
          documentType: "Actor",
          updates: [{ name: "No ID" }],
        }),
      ).rejects.toThrow("_id");
    });
  });

  describe("foundry_delete_document_batch", () => {
    it("deletes multiple documents", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockDeleteResponse(["a-1", "a-2"]));

      const result = await invokeTool(server, "foundry_delete_document_batch", {
        documentType: "Actor",
        ids: ["a-1", "a-2"],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.deleted).toBe(2);
    });
  });
});
