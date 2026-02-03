import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

export function registerCombatTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_roll_initiative",
    "Roll initiative for combatants in a combat encounter. Can roll for specific combatants or all without initiative. Uses the combatant's actor initiative modifier when available.",
    {
      combatId: z.string().describe("Combat _id"),
      combatantIds: z
        .array(z.string())
        .optional()
        .describe(
          "Specific combatant _ids to roll for. If omitted, rolls for all combatants without initiative.",
        ),
      formula: z
        .string()
        .optional()
        .default("1d20")
        .describe(
          "Initiative dice formula (default: '1d20'). The combatant's actor initiative modifier is added automatically.",
        ),
    },
    async ({ combatId, combatantIds, formula }) => {
      // Fetch combat
      const combatResponse = await client.modifyDocument("Combat", "get", {
        query: { _id: combatId },
      });
      const combats = (combatResponse.result || []) as Record<string, unknown>[];
      const combat = combats.find((c) => c._id === combatId);

      if (!combat) {
        return {
          content: [
            { type: "text" as const, text: `Combat "${combatId}" not found` },
          ],
          isError: true,
        };
      }

      // Get combatants
      const combatantsResponse = await client.modifyDocument("Combatant", "get", {
        query: {},
        parentUuid: `Combat.${combatId}`,
      });
      const allCombatants = (combatantsResponse.result || []) as Record<string, unknown>[];

      // Filter targets
      let targets = allCombatants;
      if (combatantIds) {
        targets = allCombatants.filter((c) => combatantIds.includes(c._id as string));
      } else {
        targets = allCombatants.filter(
          (c) => c.initiative === null || c.initiative === undefined,
        );
      }

      if (targets.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                combatId,
                message: "No combatants need initiative rolled",
              }, null, 2),
            },
          ],
        };
      }

      // Roll initiative for each target
      const updates: Record<string, unknown>[] = [];
      const results: { id: string; name: string; initiative: number }[] = [];

      for (const combatant of targets) {
        // Get actor's initiative modifier
        let actorModifier = 0;
        const actorId = combatant.actorId as string | undefined;
        if (actorId) {
          try {
            const actorResponse = await client.modifyDocument("Actor", "get", {
              query: { _id: actorId },
            });
            const actors = (actorResponse.result || []) as Record<string, unknown>[];
            const actor = actors[0];
            if (actor) {
              const system = actor.system as Record<string, unknown> | undefined;
              const attributes = system?.attributes as Record<string, unknown> | undefined;
              const init = attributes?.init as Record<string, unknown> | undefined;
              // PF1e: system.attributes.init.total, D&D 5e: system.attributes.init.bonus
              actorModifier =
                (init?.total as number) ??
                (init?.bonus as number) ??
                (init?.value as number) ??
                0;
            }
          } catch {
            // Use 0 modifier
          }
        }

        // Roll dice locally (Foundry's server doesn't expose a dice-roll socket event)
        const diceMatch = formula.match(/(\d+)?d(\d+)/);
        let rollTotal = 0;
        if (diceMatch) {
          const count = parseInt(diceMatch[1] || "1", 10);
          const sides = parseInt(diceMatch[2], 10);
          for (let i = 0; i < count; i++) {
            rollTotal += Math.floor(Math.random() * sides) + 1;
          }
        } else {
          rollTotal = parseInt(formula, 10) || 0;
        }
        const initiativeValue = rollTotal + actorModifier;

        updates.push({ _id: combatant._id, initiative: initiativeValue });
        results.push({
          id: combatant._id as string,
          name: (combatant.name as string) || "Unknown",
          initiative: initiativeValue,
        });
      }

      // Batch update combatant initiatives
      await client.modifyDocument("Combatant", "update", {
        updates,
        parentUuid: `Combat.${combatId}`,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              combatId,
              rolled: results.length,
              combatants: results.sort((a, b) => b.initiative - a.initiative),
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_advance_combat",
    "Navigate combat turns and rounds. Advance to the next turn or round, or go back to a previous one.",
    {
      combatId: z.string().describe("Combat _id"),
      action: z
        .enum(["next_turn", "previous_turn", "next_round", "previous_round"])
        .describe("Combat advancement action"),
    },
    async ({ combatId, action }) => {
      // Fetch current combat state
      const combatResponse = await client.modifyDocument("Combat", "get", {
        query: { _id: combatId },
      });
      const combats = (combatResponse.result || []) as Record<string, unknown>[];
      const combat = combats.find((c) => c._id === combatId);

      if (!combat) {
        return {
          content: [
            { type: "text" as const, text: `Combat "${combatId}" not found` },
          ],
          isError: true,
        };
      }

      // Get combatant count
      const combatantsResponse = await client.modifyDocument("Combatant", "get", {
        query: {},
        parentUuid: `Combat.${combatId}`,
      });
      const combatants = (combatantsResponse.result || []) as Record<string, unknown>[];
      const numCombatants = combatants.length;

      if (numCombatants === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Combat has no combatants" }, null, 2),
            },
          ],
          isError: true,
        };
      }

      let round = (combat.round as number) || 0;
      let turn = (combat.turn as number) || 0;

      switch (action) {
        case "next_turn":
          turn++;
          if (turn >= numCombatants) {
            turn = 0;
            round++;
          }
          break;
        case "previous_turn":
          turn--;
          if (turn < 0) {
            turn = Math.max(0, numCombatants - 1);
            round = Math.max(0, round - 1);
          }
          break;
        case "next_round":
          round++;
          turn = 0;
          break;
        case "previous_round":
          round = Math.max(0, round - 1);
          turn = 0;
          break;
      }

      await client.modifyDocument("Combat", "update", {
        updates: [{ _id: combatId, round, turn }],
      });

      // Determine current combatant from initiative order
      const sorted = combatants
        .filter((c) => c.initiative !== null && c.initiative !== undefined)
        .sort((a, b) => (b.initiative as number) - (a.initiative as number));
      const currentCombatant = sorted[turn];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              combatId,
              action,
              round,
              turn,
              currentCombatant: currentCombatant
                ? { id: currentCombatant._id, name: currentCombatant.name }
                : null,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_control_combat",
    "Start or end a combat encounter. Starting sets round to 1, turn 0. Ending deletes the combat.",
    {
      combatId: z.string().describe("Combat _id"),
      action: z
        .enum(["start", "end"])
        .describe("Start or end the combat encounter"),
    },
    async ({ combatId, action }) => {
      if (action === "end") {
        await client.modifyDocument("Combat", "delete", { ids: [combatId] });

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

      // Start combat: set round=1, turn=0, started=true, active=true
      await client.modifyDocument("Combat", "update", {
        updates: [{ _id: combatId, round: 1, turn: 0, started: true, active: true }],
      });

      // Fetch updated state
      const combatantsResponse = await client.modifyDocument("Combatant", "get", {
        query: {},
        parentUuid: `Combat.${combatId}`,
      });
      const combatants = (combatantsResponse.result || []) as Record<string, unknown>[];
      const sorted = combatants
        .filter((c) => c.initiative !== null && c.initiative !== undefined)
        .sort((a, b) => (b.initiative as number) - (a.initiative as number));
      const currentCombatant = sorted[0];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              combatId,
              action: "start",
              started: true,
              round: 1,
              turn: 0,
              currentCombatant: currentCombatant
                ? { id: currentCombatant._id, name: currentCombatant.name }
                : null,
            }, null, 2),
          },
        ],
      };
    },
  );
}
