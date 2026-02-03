import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, errorResponse, getResults, rollDice } from "../utils.js";

export function registerCombatTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_roll_initiative",
    "Roll initiative for combatants in a combat encounter. Can roll for specific combatants or all without initiative. Uses the actor's init modifier from system.attributes.init (PF1e: .total, D&D 5e: .bonus). Combatants with initiative already set are skipped unless explicitly targeted by combatantIds.",
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
      const combats = getResults(combatResponse);
      const combat = combats.find((c) => c._id === combatId);

      if (!combat) {
        return errorResponse(`Combat "${combatId}" not found`);
      }

      // Get combatants
      const combatantsResponse = await client.modifyDocument("Combatant", "get", {
        query: {},
        parentUuid: `Combat.${combatId}`,
      });
      const allCombatants = getResults(combatantsResponse);

      // Filter targets: specific IDs or all without initiative (null/undefined, NOT 0)
      let targets = allCombatants;
      if (combatantIds) {
        targets = allCombatants.filter((c) => combatantIds.includes(c._id as string));
      } else {
        targets = allCombatants.filter(
          (c) => c.initiative === null || c.initiative === undefined,
        );
      }

      if (targets.length === 0) {
        return jsonResponse({
          combatId,
          message: "No combatants need initiative rolled",
        });
      }

      // Batch-fetch all unique actor IDs at once instead of one-by-one
      const actorIds = [
        ...new Set(
          targets
            .map((c) => c.actorId as string | undefined)
            .filter((id): id is string => !!id),
        ),
      ];

      const actorModifiers: Map<string, number> = new Map();
      if (actorIds.length > 0) {
        const actorResponse = await client.modifyDocument("Actor", "get", {
          query: {},
        });
        const allActors = getResults(actorResponse);

        for (const actor of allActors) {
          if (!actorIds.includes(actor._id as string)) continue;
          const system = actor.system as Record<string, unknown> | undefined;
          const attributes = system?.attributes as Record<string, unknown> | undefined;
          const init = attributes?.init as Record<string, unknown> | undefined;
          // PF1e: system.attributes.init.total, D&D 5e: system.attributes.init.bonus
          const mod =
            (init?.total as number) ??
            (init?.bonus as number) ??
            (init?.value as number) ??
            0;
          if (typeof mod === "number") {
            actorModifiers.set(actor._id as string, mod);
          }
        }
      }

      // Roll initiative for each target
      const updates: Record<string, unknown>[] = [];
      const results: { id: string; name: string; initiative: number; roll: number; modifier: number }[] = [];

      for (const combatant of targets) {
        const actorId = combatant.actorId as string | undefined;
        const actorModifier = actorId ? (actorModifiers.get(actorId) ?? 0) : 0;

        const rollTotal = rollDice(formula);
        const initiativeValue = rollTotal + actorModifier;

        updates.push({ _id: combatant._id, initiative: initiativeValue });
        results.push({
          id: combatant._id as string,
          name: (combatant.name as string) || "Unknown",
          initiative: initiativeValue,
          roll: rollTotal,
          modifier: actorModifier,
        });
      }

      // Batch update combatant initiatives
      await client.modifyDocument("Combatant", "update", {
        updates,
        parentUuid: `Combat.${combatId}`,
      });

      return jsonResponse({
        combatId,
        rolled: results.length,
        combatants: results.sort((a, b) => b.initiative - a.initiative),
      });
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
      const combats = getResults(combatResponse);
      const combat = combats.find((c) => c._id === combatId);

      if (!combat) {
        return errorResponse(`Combat "${combatId}" not found`);
      }

      // Get combatant count
      const combatantsResponse = await client.modifyDocument("Combatant", "get", {
        query: {},
        parentUuid: `Combat.${combatId}`,
      });
      const combatants = getResults(combatantsResponse);
      const numCombatants = combatants.length;

      if (numCombatants === 0) {
        return errorResponse("Combat has no combatants");
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

      return jsonResponse({
        combatId,
        action,
        round,
        turn,
        currentCombatant: currentCombatant
          ? { id: currentCombatant._id, name: currentCombatant.name }
          : null,
      });
    },
  );

  server.tool(
    "foundry_control_combat",
    "Start or end a combat encounter. Starting sets round to 1 and turn to 0 (first combatant by initiative order). Ending deletes the Combat document and all Combatants permanently — this cannot be undone.",
    {
      combatId: z.string().describe("Combat _id"),
      action: z
        .enum(["start", "end"])
        .describe("Start or end the combat encounter"),
    },
    async ({ combatId, action }) => {
      if (action === "end") {
        await client.modifyDocument("Combat", "delete", { ids: [combatId] });
        return jsonResponse({ combatId, action: "end", deleted: true });
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
      const combatants = getResults(combatantsResponse);
      const sorted = combatants
        .filter((c) => c.initiative !== null && c.initiative !== undefined)
        .sort((a, b) => (b.initiative as number) - (a.initiative as number));
      const currentCombatant = sorted[0];

      return jsonResponse({
        combatId,
        action: "start",
        started: true,
        round: 1,
        turn: 0,
        currentCombatant: currentCombatant
          ? { id: currentCombatant._id, name: currentCombatant.name }
          : null,
      });
    },
  );
}
