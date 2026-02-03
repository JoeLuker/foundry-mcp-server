import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerCompendiumTools } from "./compendiums.js";

describe("compendium tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerCompendiumTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_list_compendium_packs", () => {
    it("lists all packs", async () => {
      vi.mocked(client.emitSocketCallback).mockResolvedValueOnce({
        packs: [
          { id: "pf1.spells", label: "Spells", type: "Item", packageName: "pf1", packageType: "system" },
          { id: "pf1.bestiary", label: "Bestiary", type: "Actor", packageName: "pf1", packageType: "system" },
        ],
      });

      const result = await invokeTool(server, "foundry_list_compendium_packs", {});
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(2);
      const packs = data.packs as Record<string, unknown>[];
      expect(packs[0].id).toBe("pf1.spells");
    });

    it("filters by type", async () => {
      vi.mocked(client.emitSocketCallback).mockResolvedValueOnce({
        packs: [
          { id: "pf1.spells", label: "Spells", type: "Item", packageName: "pf1", packageType: "system" },
          { id: "pf1.bestiary", label: "Bestiary", type: "Actor", packageName: "pf1", packageType: "system" },
        ],
      });

      const result = await invokeTool(server, "foundry_list_compendium_packs", { type: "Actor" });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(1);
      const packs = data.packs as Record<string, unknown>[];
      expect(packs[0].label).toBe("Bestiary");
    });
  });

  describe("foundry_get_compendium_index", () => {
    it("returns paginated index", async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        _id: `id-${i}`,
        name: `Item ${i}`,
        type: "weapon",
      }));
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse(items));

      const result = await invokeTool(server, "foundry_get_compendium_index", {
        packId: "pf1.spells",
        documentType: "Item",
        limit: 3,
        offset: 2,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(10);
      expect(data.count).toBe(3);
      expect(data.offset).toBe(2);
      expect(data.packId).toBe("pf1.spells");
    });
  });

  describe("foundry_get_compendium_entry", () => {
    it("gets a full entry", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "spell-1", name: "Fireball", type: "spell", system: { level: 3 } }]),
      );

      const result = await invokeTool(server, "foundry_get_compendium_entry", {
        packId: "pf1.spells",
        documentType: "Item",
        id: "spell-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.name).toBe("Fireball");
      expect(client.modifyDocument).toHaveBeenCalledWith("Item", "get", {
        query: { _id: "spell-1" },
        pack: "pf1.spells",
      });
    });

    it("returns error when not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_get_compendium_entry", {
        packId: "pf1.spells",
        documentType: "Item",
        id: "missing",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_search_compendium", () => {
    it("searches by name pattern and filters", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "1", name: "Fireball", type: "spell", system: { level: 3 } },
          { _id: "2", name: "Fire Shield", type: "spell", system: { level: 4 } },
          { _id: "3", name: "Ice Storm", type: "spell", system: { level: 4 } },
        ]),
      );

      const result = await invokeTool(server, "foundry_search_compendium", {
        packId: "pf1.spells",
        documentType: "Item",
        namePattern: "Fire",
        filters: { "system.level": 3 },
        limit: 20,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(1); // Only Fireball matches name + level=3
      expect(data.packId).toBe("pf1.spells");
    });
  });
});
