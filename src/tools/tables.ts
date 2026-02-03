import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, errorResponse, getResults, getFirstResult, pickFields, rollDice } from "../utils.js";

export function registerTableTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_roll_table",
    "Roll on a RollTable and return the drawn result(s). Evaluates the table's dice formula, matches the total against each result's range [low, high], and returns the matched entries. Optionally posts results to chat. Supports simple dice formulas (NdX+M). For complex Foundry formulas, use foundry_roll_dice to roll separately.",
    {
      tableId: z.string().describe("RollTable _id"),
      postToChat: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to post each result as a chat message (default: false)"),
      rolls: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(1)
        .describe("Number of times to roll on the table (default: 1, max: 20)"),
    },
    async ({ tableId, postToChat, rolls }) => {
      // Fetch the RollTable document
      const tableResponse = await client.modifyDocument("RollTable", "get", {
        query: { _id: tableId },
      });
      const tables = getResults(tableResponse);
      const table = tables.find((t) => t._id === tableId);

      if (!table) {
        return errorResponse(`RollTable "${tableId}" not found`);
      }

      // Fetch all TableResults
      const resultsResponse = await client.modifyDocument("TableResult", "get", {
        query: {},
        parentUuid: `RollTable.${tableId}`,
      });
      const tableResults = getResults(resultsResponse);

      if (tableResults.length === 0) {
        return errorResponse(`RollTable "${table.name}" has no results`);
      }

      const formula = (table.formula as string) || "1d20";
      const drawn: {
        roll: number;
        resultId: string;
        text: string;
        type: unknown;
        range: unknown;
      }[] = [];

      for (let i = 0; i < rolls; i++) {
        const total = rollDice(formula);

        // Find matching result by range
        const match = tableResults.find((r) => {
          const range = r.range as [number, number] | undefined;
          if (!range || range.length < 2) return false;
          return total >= range[0] && total <= range[1];
        });

        if (match) {
          drawn.push({
            roll: total,
            resultId: match._id as string,
            text: (match.text as string) || "No text",
            type: match.type,
            range: match.range,
          });

          // Post to chat if requested
          if (postToChat) {
            await client.modifyDocument("ChatMessage", "create", {
              data: [
                {
                  content: `<b>${table.name}</b> (Roll: ${total})<br>${match.text}`,
                  type: 0,
                },
              ],
            });
          }
        } else {
          drawn.push({
            roll: total,
            resultId: "",
            text: `No result for roll ${total}`,
            type: null,
            range: null,
          });
        }
      }

      return jsonResponse({
        tableId,
        tableName: table.name,
        formula,
        rolls: drawn.length,
        results: drawn,
      });
    },
  );

  server.tool(
    "foundry_list_table_results",
    "List all possible results on a RollTable, including their roll ranges, result text, types, and whether they've been drawn. Use this to preview what a table can produce before rolling, or to check which results have already been drawn.",
    {
      tableId: z.string().describe("RollTable _id"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include per result. Default: ["_id", "text", "type", "range", "weight", "drawn"]',
        ),
    },
    async ({ tableId, fields }) => {
      const response = await client.modifyDocument("TableResult", "get", {
        query: {},
        parentUuid: `RollTable.${tableId}`,
      });

      const docs = getResults(response);
      const defaultFields = ["_id", "text", "type", "range", "weight", "drawn"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return jsonResponse({ total: results.length, tableId, results });
    },
  );

  server.tool(
    "foundry_shuffle_deck",
    "Shuffle a Cards deck, randomizing the order of all cards. Optionally recall already-dealt cards back into the deck first. After shuffling, all cards will have randomized sort orders and (if recallDrawn) will be marked as not drawn.",
    {
      deckId: z.string().describe("Cards _id (the deck to shuffle)"),
      recallDrawn: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to recall already-dealt cards back to the deck before shuffling (default: true)"),
    },
    async ({ deckId, recallDrawn }) => {
      // Fetch all cards in the deck
      const response = await client.modifyDocument("Card", "get", {
        query: {},
        parentUuid: `Cards.${deckId}`,
      });

      const cards = getResults(response);

      if (cards.length === 0) {
        return jsonResponse({ shuffled: true, deckId, totalCards: 0 });
      }

      // Build updates: randomize sort, optionally reset drawn
      const updates = cards.map((card) => {
        const update: Record<string, unknown> = {
          _id: card._id,
          sort: Math.floor(Math.random() * 1000000),
        };
        if (recallDrawn) {
          update.drawn = false;
        }
        return update;
      });

      await client.modifyDocument("Card", "update", {
        updates,
        parentUuid: `Cards.${deckId}`,
      });

      const drawnCount = cards.filter((c) => c.drawn).length;
      return jsonResponse({
        shuffled: true,
        deckId,
        totalCards: cards.length,
        recalled: recallDrawn ? drawnCount : 0,
      });
    },
  );

  server.tool(
    "foundry_deal_cards",
    "Deal cards from a source deck to a target hand/pile. Draws the specified number of undrawn cards from the top of the source (sorted by sort order), marks them as drawn in the source, and creates copies in the target. Non-atomic: if the target creation fails, cards may be marked drawn in the source without appearing in the target.",
    {
      deckId: z.string().describe("Source Cards _id (deck to draw from)"),
      targetId: z.string().describe("Target Cards _id (hand or pile to deal to)"),
      count: z
        .number()
        .min(1)
        .max(52)
        .optional()
        .default(1)
        .describe("Number of cards to deal (default: 1)"),
    },
    async ({ deckId, targetId, count }) => {
      // Fetch undrawn cards from source, sorted by sort order
      const response = await client.modifyDocument("Card", "get", {
        query: {},
        parentUuid: `Cards.${deckId}`,
      });

      const allCards = getResults(response);
      const undrawn = allCards
        .filter((c) => !c.drawn)
        .sort((a, b) => ((a.sort as number) || 0) - ((b.sort as number) || 0));

      if (undrawn.length === 0) {
        return errorResponse("No undrawn cards remaining in the deck");
      }

      const toDeal = undrawn.slice(0, count);

      // Mark cards as drawn in source
      const drawUpdates = toDeal.map((c) => ({ _id: c._id, drawn: true }));
      await client.modifyDocument("Card", "update", {
        updates: drawUpdates,
        parentUuid: `Cards.${deckId}`,
      });

      // Create cards in target
      const targetData = toDeal.map((c) => {
        const cardData = { ...c };
        delete cardData._id;
        cardData.drawn = false;
        cardData.sort = Math.floor(Math.random() * 1000000);
        return cardData;
      });

      const createResponse = await client.modifyDocument("Card", "create", {
        data: targetData,
        parentUuid: `Cards.${targetId}`,
      });

      const created = getResults(createResponse);

      return jsonResponse({
        dealt: created.length,
        from: deckId,
        to: targetId,
        cards: toDeal.map((c) => ({ name: c.name, face: c.face })),
        remainingInDeck: undrawn.length - toDeal.length,
      });
    },
  );

  server.tool(
    "foundry_pass_cards",
    "Move specific cards from one Cards document (hand/pile/deck) to another. Deletes the cards from the source and creates them in the target. Use this to pass cards between players, discard to a pile, or return cards to a deck. Non-atomic: partial failures are possible.",
    {
      sourceId: z.string().describe("Source Cards _id (hand/pile/deck to take from)"),
      targetId: z.string().describe("Target Cards _id (hand/pile/deck to move to)"),
      cardIds: z
        .array(z.string())
        .min(1)
        .describe("Card _ids to move from source to target"),
    },
    async ({ sourceId, targetId, cardIds }) => {
      // Fetch the specified cards from source
      const response = await client.modifyDocument("Card", "get", {
        query: {},
        parentUuid: `Cards.${sourceId}`,
      });

      const allCards = getResults(response);
      const toMove = allCards.filter((c) => cardIds.includes(c._id as string));

      if (toMove.length === 0) {
        return errorResponse("None of the specified cards were found in the source");
      }

      // Delete from source
      await client.modifyDocument("Card", "delete", {
        ids: toMove.map((c) => c._id as string),
        parentUuid: `Cards.${sourceId}`,
      });

      // Create in target
      const targetData = toMove.map((c) => {
        const cardData = { ...c };
        delete cardData._id;
        cardData.sort = Math.floor(Math.random() * 1000000);
        return cardData;
      });

      const createResponse = await client.modifyDocument("Card", "create", {
        data: targetData,
        parentUuid: `Cards.${targetId}`,
      });

      const created = getResults(createResponse);

      return jsonResponse({
        moved: created.length,
        from: sourceId,
        to: targetId,
        cards: toMove.map((c) => ({ name: c.name })),
      });
    },
  );
}
