import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerConvenienceTools } from "./convenience.js";

describe("convenience tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerConvenienceTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_create_journal", () => {
    it("creates a journal with pages", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "j-1" }])) // create journal
        .mockResolvedValueOnce(mockResponse([{ _id: "p-1" }, { _id: "p-2" }])); // create pages

      const result = await invokeTool(server, "foundry_create_journal", {
        name: "Session Notes",
        pages: [
          { name: "Page 1", type: "text", text: { content: "<p>Hello</p>" } },
          { name: "Page 2", type: "text" },
        ],
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.journalId).toBe("j-1");
      expect(data.pagesCreated).toBe(2);

      // Verify pages were created as embedded docs
      const pageCall = vi.mocked(client.modifyDocument).mock.calls[1];
      expect(pageCall[0]).toBe("JournalEntryPage");
      expect(pageCall[1]).toBe("create");
      const op = pageCall[2] as Record<string, unknown>;
      expect(op.parentUuid).toBe("JournalEntry.j-1");
    });

    it("returns error if journal creation fails", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_create_journal", {
        name: "Failed",
        pages: [{ name: "P1" }],
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_import_from_compendium", () => {
    it("imports a compendium entry into the world", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "comp-1", name: "Fireball", type: "spell", system: { level: 3 } }]),
        ) // get from compendium
        .mockResolvedValueOnce(
          mockResponse([{ _id: "world-1", name: "Fireball", type: "spell" }]),
        ); // create in world

      const result = await invokeTool(server, "foundry_import_from_compendium", {
        packId: "pf1.spells",
        documentType: "Item",
        entryId: "comp-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.imported).toBe(true);
      expect(data.worldId).toBe("world-1");
      expect(data.originalId).toBe("comp-1");

      // Verify _id was stripped for world creation
      const createCall = vi.mocked(client.modifyDocument).mock.calls[1];
      const createData = (createCall[2] as Record<string, unknown>).data as Record<string, unknown>[];
      expect(createData[0]._id).toBeUndefined();
    });

    it("applies folder and update overrides", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "comp-1", name: "Original", type: "spell" }]),
        )
        .mockResolvedValueOnce(
          mockResponse([{ _id: "world-1", name: "Custom Name" }]),
        );

      await invokeTool(server, "foundry_import_from_compendium", {
        packId: "pf1.spells",
        documentType: "Item",
        entryId: "comp-1",
        folder: "folder-1",
        updates: { name: "Custom Name" },
      });

      const createCall = vi.mocked(client.modifyDocument).mock.calls[1];
      const createData = (createCall[2] as Record<string, unknown>).data as Record<string, unknown>[];
      expect(createData[0].folder).toBe("folder-1");
      expect(createData[0].name).toBe("Custom Name");
    });

    it("returns error when entry not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_import_from_compendium", {
        packId: "pf1.spells",
        documentType: "Item",
        entryId: "missing",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_modify_actor_hp", () => {
    const makeActor = (hp: number, max: number, temp = 0) => ({
      _id: "actor-1",
      name: "Fighter",
      system: { attributes: { hp: { value: hp, max, temp } } },
    });

    it("applies damage (negative amount)", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([makeActor(30, 50)]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "actor-1",
        amount: -15,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.previousHp).toBe(30);
      expect(data.newHp).toBe(15);
      expect(data.change).toBe(-15);
    });

    it("applies healing (positive amount)", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([makeActor(20, 50)]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "actor-1",
        amount: 40,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      // Clamped to max
      expect(data.newHp).toBe(50);
    });

    it("clamps damage to 0", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([makeActor(10, 50)]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "actor-1",
        amount: -100,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.newHp).toBe(0);
    });

    it("modifies temp HP when temp=true", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([makeActor(30, 50, 5)]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "actor-1",
        amount: 10,
        temp: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.field).toBe("system.attributes.hp.temp");
      expect(data.previousHp).toBe(5);
      expect(data.newHp).toBe(15);
    });

    it("returns error when actor not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "missing",
        amount: -10,
      });
      expect(result.isError).toBe(true);
    });

    it("returns error when HP path not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "actor-1", name: "Vehicle", system: { details: {} } }]),
      );

      const result = await invokeTool(server, "foundry_modify_actor_hp", {
        actorId: "actor-1",
        amount: -10,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("HP data");
    });
  });
});
