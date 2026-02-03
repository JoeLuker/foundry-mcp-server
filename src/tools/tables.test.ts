import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, mockDeleteResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerTableTools } from "./tables.js";

describe("table tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerTableTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_roll_table", () => {
    it("rolls on a table and returns matched result", async () => {
      // First call: get table
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "tbl-1", name: "Random Encounters", formula: "1d6" }]),
        )
        // Second call: get table results
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "tr-1", text: "Goblins", type: 0, range: [1, 3], weight: 1, drawn: false },
            { _id: "tr-2", text: "Wolves", type: 0, range: [4, 6], weight: 1, drawn: false },
          ]),
        );

      const result = await invokeTool(server, "foundry_roll_table", {
        tableId: "tbl-1",
        postToChat: false,
        rolls: 1,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.tableId).toBe("tbl-1");
      expect(data.tableName).toBe("Random Encounters");
      expect(data.formula).toBe("1d6");
      expect(data.rolls).toBe(1);
      const results = data.results as { roll: number; text: string }[];
      expect(results.length).toBe(1);
      expect(results[0].roll).toBeGreaterThanOrEqual(1);
      expect(results[0].roll).toBeLessThanOrEqual(6);
    });

    it("returns error when table not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_roll_table", {
        tableId: "tbl-missing",
        postToChat: false,
        rolls: 1,
      });
      expect(result.isError).toBe(true);
    });

    it("posts results to chat when requested", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "tbl-1", name: "Loot", formula: "1d4" }]),
        )
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "tr-1", text: "Gold", type: 0, range: [1, 4], weight: 1, drawn: false },
          ]),
        )
        // Chat message creation
        .mockResolvedValueOnce(mockResponse([{ _id: "msg-1" }]));

      await invokeTool(server, "foundry_roll_table", {
        tableId: "tbl-1",
        postToChat: true,
        rolls: 1,
      });

      // Should have 3 calls: get table, get results, create chat message
      expect(client.modifyDocument).toHaveBeenCalledTimes(3);
      expect(client.modifyDocument).toHaveBeenLastCalledWith("ChatMessage", "create", {
        data: [expect.objectContaining({ type: 0 })],
      });
    });
  });

  describe("foundry_list_table_results", () => {
    it("lists all results with default fields", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "tr-1", text: "Goblins", type: 0, range: [1, 3], weight: 1, drawn: false },
          { _id: "tr-2", text: "Wolves", type: 0, range: [4, 6], weight: 1, drawn: true },
        ]),
      );

      const result = await invokeTool(server, "foundry_list_table_results", {
        tableId: "tbl-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.total).toBe(2);
      const results = data.results as Record<string, unknown>[];
      expect(results[0].text).toBe("Goblins");
      expect(results[1].drawn).toBe(true);
    });
  });

  describe("foundry_shuffle_deck", () => {
    it("shuffles all cards and recalls drawn", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "card-1", name: "Ace", sort: 1, drawn: true },
            { _id: "card-2", name: "King", sort: 2, drawn: false },
          ]),
        )
        .mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_shuffle_deck", {
        deckId: "deck-1",
        recallDrawn: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.shuffled).toBe(true);
      expect(data.totalCards).toBe(2);
      expect(data.recalled).toBe(1);

      const updateCall = vi.mocked(client.modifyDocument).mock.calls[1];
      const updates = (updateCall[2] as { updates: Record<string, unknown>[] }).updates;
      expect(updates.length).toBe(2);
      expect(updates[0].drawn).toBe(false);
    });

    it("handles empty deck", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_shuffle_deck", {
        deckId: "deck-1",
        recallDrawn: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.shuffled).toBe(true);
      expect(data.totalCards).toBe(0);
    });
  });

  describe("foundry_deal_cards", () => {
    it("deals undrawn cards from deck to target", async () => {
      vi.mocked(client.modifyDocument)
        // Get cards from source
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "card-1", name: "Ace", sort: 1, drawn: false, face: 0 },
            { _id: "card-2", name: "King", sort: 2, drawn: false, face: 1 },
            { _id: "card-3", name: "Queen", sort: 3, drawn: true, face: 2 },
          ]),
        )
        // Mark drawn in source
        .mockResolvedValueOnce(mockResponse([]))
        // Create in target
        .mockResolvedValueOnce(mockResponse([{ _id: "new-1", name: "Ace" }]));

      const result = await invokeTool(server, "foundry_deal_cards", {
        deckId: "deck-1",
        targetId: "hand-1",
        count: 1,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.dealt).toBe(1);
      expect(data.from).toBe("deck-1");
      expect(data.to).toBe("hand-1");
      expect(data.remainingInDeck).toBe(1);
    });

    it("returns error when no undrawn cards", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "card-1", name: "Ace", sort: 1, drawn: true }]),
      );

      const result = await invokeTool(server, "foundry_deal_cards", {
        deckId: "deck-1",
        targetId: "hand-1",
        count: 1,
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_pass_cards", () => {
    it("moves cards from source to target", async () => {
      vi.mocked(client.modifyDocument)
        // Get cards from source
        .mockResolvedValueOnce(
          mockResponse([
            { _id: "card-1", name: "Ace", sort: 1 },
            { _id: "card-2", name: "King", sort: 2 },
          ]),
        )
        // Delete from source
        .mockResolvedValueOnce(mockDeleteResponse(["card-1"]))
        // Create in target
        .mockResolvedValueOnce(mockResponse([{ _id: "new-1", name: "Ace" }]));

      const result = await invokeTool(server, "foundry_pass_cards", {
        sourceId: "hand-1",
        targetId: "pile-1",
        cardIds: ["card-1"],
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.moved).toBe(1);
      expect(data.from).toBe("hand-1");
      expect(data.to).toBe("pile-1");
    });

    it("returns error when no matching cards found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "card-1", name: "Ace" }]),
      );

      const result = await invokeTool(server, "foundry_pass_cards", {
        sourceId: "hand-1",
        targetId: "pile-1",
        cardIds: ["card-missing"],
      });
      expect(result.isError).toBe(true);
    });
  });
});
