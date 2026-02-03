import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerCombatTools } from "./combat.js";

describe("combat tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerCombatTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_roll_initiative", () => {
    it("rolls initiative for combatants without initiative", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1" }])) // get combat
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "c-1", name: "Goblin", actorId: "a-1", initiative: null },
            { _id: "c-2", name: "Fighter", actorId: "a-2", initiative: 15 },
          ]),
        ) // get combatants
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "a-1", system: { attributes: { init: { total: 2 } } } },
            { _id: "a-2", system: { attributes: { init: { total: 5 } } } },
          ]),
        ) // get actors
        .mockResolvedValueOnce(mockResponse([])); // update combatants

      const result = await invokeTool(server, "foundry_roll_initiative", {
        combatId: "combat-1",
        formula: "1d20",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.combatId).toBe("combat-1");
      expect(data.rolled).toBe(1); // Only c-1 had null initiative
      const combatants = data.combatants as { modifier: number }[];
      expect(combatants[0].modifier).toBe(2);
    });

    it("rolls for specific combatant IDs", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1" }]))
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "c-1", name: "Goblin", actorId: "a-1", initiative: null },
            { _id: "c-2", name: "Fighter", actorId: "a-2", initiative: 15 },
          ]),
        )
        .mockResolvedValueOnce(mockResponse([]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_roll_initiative", {
        combatId: "combat-1",
        combatantIds: ["c-2"],
        formula: "1d20",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.rolled).toBe(1);
      const combatants = data.combatants as { id: string }[];
      expect(combatants[0].id).toBe("c-2");
    });

    it("returns error when combat not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_roll_initiative", {
        combatId: "missing",
      });
      expect(result.isError).toBe(true);
    });

    it("returns message when no combatants need initiative", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1" }]))
        .mockResolvedValueOnce(
          mockResponse([{ _id: "c-1", name: "Fighter", actorId: "a-1", initiative: 15 }]),
        );

      const result = await invokeTool(server, "foundry_roll_initiative", {
        combatId: "combat-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.message).toContain("No combatants");
    });
  });

  describe("foundry_advance_combat", () => {
    it("advances to next turn", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1", round: 1, turn: 0 }]))
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "c-1", name: "Fighter", initiative: 20 },
            { _id: "c-2", name: "Goblin", initiative: 10 },
          ]),
        )
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_advance_combat", {
        combatId: "combat-1",
        action: "next_turn",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.round).toBe(1);
      expect(data.turn).toBe(1);
      expect(client.modifyDocument).toHaveBeenCalledWith("Combat", "update", {
        updates: [{ _id: "combat-1", round: 1, turn: 1 }],
      });
    });

    it("wraps turn to next round", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1", round: 1, turn: 1 }]))
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "c-1", initiative: 20 },
            { _id: "c-2", initiative: 10 },
          ]),
        )
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_advance_combat", {
        combatId: "combat-1",
        action: "next_turn",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.round).toBe(2);
      expect(data.turn).toBe(0);
    });

    it("returns error when combat has no combatants", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1", round: 1, turn: 0 }]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_advance_combat", {
        combatId: "combat-1",
        action: "next_turn",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no combatants");
    });

    it("goes to previous round", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "combat-1", round: 3, turn: 1 }]))
        .mockResolvedValueOnce(mockResponse([{ _id: "c-1", initiative: 20 }]))
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_advance_combat", {
        combatId: "combat-1",
        action: "previous_round",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.round).toBe(2);
      expect(data.turn).toBe(0);
    });
  });

  describe("foundry_control_combat", () => {
    it("starts a combat", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([])) // update
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "c-1", name: "Fighter", initiative: 20 },
            { _id: "c-2", name: "Goblin", initiative: 10 },
          ]),
        ); // get combatants

      const result = await invokeTool(server, "foundry_control_combat", {
        combatId: "combat-1",
        action: "start",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.started).toBe(true);
      expect(data.round).toBe(1);
      expect(data.turn).toBe(0);
      expect(client.modifyDocument).toHaveBeenCalledWith("Combat", "update", {
        updates: [{ _id: "combat-1", round: 1, turn: 0, started: true, active: true }],
      });
    });

    it("ends a combat", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_control_combat", {
        combatId: "combat-1",
        action: "end",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.deleted).toBe(true);
      expect(client.modifyDocument).toHaveBeenCalledWith("Combat", "delete", {
        ids: ["combat-1"],
      });
    });
  });
});
