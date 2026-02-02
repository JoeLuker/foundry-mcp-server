import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

export function registerCombatTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_roll_initiative",
    "Roll initiative for combatants in a combat encounter. Can roll for specific combatants or all at once. Requires a connected browser client.",
    {
      combatId: z.string().describe("Combat _id"),
      combatantIds: z
        .array(z.string())
        .optional()
        .describe(
          "Specific combatant _ids to roll for. If omitted, rolls for all combatants.",
        ),
      formula: z
        .string()
        .optional()
        .describe(
          "Custom initiative formula (overrides system default, e.g., '1d20+5')",
        ),
    },
    async ({ combatId, combatantIds, formula }) => {
      const idsArg = combatantIds
        ? JSON.stringify(combatantIds)
        : "null";
      const optionsArg = formula
        ? `{ formula: ${JSON.stringify(formula)} }`
        : "{}";

      const script = `
const combat = game.combats.get("${combatId}");
if (!combat) throw new Error("Combat not found: ${combatId}");

const ids = ${idsArg};
const options = ${optionsArg};
const result = ids ? await combat.rollInitiative(ids, options) : await combat.rollAll(options);

const combatants = result.combatants.map(c => ({
  id: c.id,
  name: c.name,
  initiative: c.initiative,
}));

await ChatMessage.create({
  content: "MCP_INITIATIVE:" + JSON.stringify({
    combatId: combat.id,
    round: combat.round,
    combatants,
  }),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      const result = await client.executeMacroWithResult(
        script,
        "MCP_INITIATIVE:",
        8000,
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_advance_combat",
    "Navigate combat turns and rounds. Advance to the next turn or round, or go back to a previous one. Requires a connected browser client.",
    {
      combatId: z.string().describe("Combat _id"),
      action: z
        .enum(["next_turn", "previous_turn", "next_round", "previous_round"])
        .describe("Combat advancement action"),
    },
    async ({ combatId, action }) => {
      const methodMap: Record<string, string> = {
        next_turn: "nextTurn",
        previous_turn: "previousTurn",
        next_round: "nextRound",
        previous_round: "previousRound",
      };

      const script = `
const combat = game.combats.get("${combatId}");
if (!combat) throw new Error("Combat not found: ${combatId}");

await combat.${methodMap[action]}();

const current = combat.combatant;
await ChatMessage.create({
  content: "MCP_COMBAT_ADV:" + JSON.stringify({
    combatId: combat.id,
    round: combat.round,
    turn: combat.turn,
    currentCombatant: current ? { id: current.id, name: current.name } : null,
  }),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      const result = await client.executeMacroWithResult(
        script,
        "MCP_COMBAT_ADV:",
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_control_combat",
    "Start or end a combat encounter. Starting advances to round 1, turn 1. Ending deletes the combat. Requires a connected browser client.",
    {
      combatId: z.string().describe("Combat _id"),
      action: z
        .enum(["start", "end"])
        .describe("Start or end the combat encounter"),
    },
    async ({ combatId, action }) => {
      if (action === "end") {
        // End combat by deleting it directly (combat.endCombat() shows a dialog)
        await client.modifyDocument("Combat", "delete", {
          ids: [combatId],
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { combatId, action: "end", deleted: true },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Start combat via macro (needs game context)
      const script = `
const combat = game.combats.get("${combatId}");
if (!combat) throw new Error("Combat not found: ${combatId}");

await combat.startCombat();

const current = combat.combatant;
await ChatMessage.create({
  content: "MCP_COMBAT_CTRL:" + JSON.stringify({
    combatId: combat.id,
    action: "start",
    started: combat.started,
    round: combat.round,
    turn: combat.turn,
    currentCombatant: current ? { id: current.id, name: current.name } : null,
  }),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      const result = await client.executeMacroWithResult(
        script,
        "MCP_COMBAT_CTRL:",
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );
}
