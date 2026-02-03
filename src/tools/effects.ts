import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, getResults, getFirstResult, pickFields } from "../utils.js";

export function registerEffectTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_list_active_effects",
    "List all active effects on an actor, including buffs, debuffs, conditions, and spell effects. Shows each effect's name, icon, enabled/disabled state, duration, attribute changes, and status IDs. Use this to check what conditions or modifiers are currently applied to an actor.",
    {
      actorId: z.string().describe("Actor _id"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include. Default: ["_id", "name", "icon", "disabled", "duration", "changes", "statuses"]. Use dot-notation for nested fields.',
        ),
    },
    async ({ actorId, fields }) => {
      const response = await client.modifyDocument("ActiveEffect", "get", {
        query: {},
        parentUuid: `Actor.${actorId}`,
      });

      const docs = getResults(response);
      const defaultFields = ["_id", "name", "icon", "disabled", "duration", "changes", "statuses"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return jsonResponse({ total: results.length, actorId, effects: results });
    },
  );

  server.tool(
    "foundry_apply_active_effect",
    "Apply a new active effect to an actor. Active effects modify actor data through attribute changes — each change specifies a key (dot-notation attribute path), mode (how to apply), and value. Use this for buffs, debuffs, spells, conditions, or any temporary/permanent stat modification. Change modes: 0=Custom, 1=Multiply, 2=Add, 3=Downgrade (use lower), 4=Upgrade (use higher), 5=Override.",
    {
      actorId: z.string().describe("Actor _id to apply the effect to"),
      name: z
        .string()
        .describe('Effect name displayed in the UI (e.g., "Bless", "Haste", "Poisoned", "Shield of Faith")'),
      icon: z
        .string()
        .optional()
        .describe('Icon path for the effect (e.g., "icons/svg/aura.svg", "icons/magic/defensive/shield-barrier-blue.webp")'),
      changes: z
        .array(
          z.object({
            key: z
              .string()
              .describe(
                'Attribute path using dot-notation (e.g., "system.attributes.ac.bonus", "system.abilities.str.mod", "system.bonuses.mwak.attack")',
              ),
            mode: z
              .number()
              .min(0)
              .max(5)
              .describe("How to apply: 0=Custom, 1=Multiply, 2=Add, 3=Downgrade, 4=Upgrade, 5=Override"),
            value: z
              .string()
              .describe('Value to apply (always a string, even for numbers: "2", "-1", "1.5")'),
          }),
        )
        .optional()
        .describe("Array of attribute modifications this effect applies"),
      duration: z
        .object({
          rounds: z.number().optional().describe("Duration in combat rounds"),
          seconds: z.number().optional().describe("Duration in seconds (outside combat)"),
          turns: z.number().optional().describe("Duration in combat turns"),
          startRound: z.number().optional().describe("Combat round when the effect started"),
          startTurn: z.number().optional().describe("Combat turn when the effect started"),
        })
        .optional()
        .describe("Effect duration. Omit for permanent effects."),
      statuses: z
        .array(z.string())
        .optional()
        .describe(
          'Status condition IDs this effect represents (e.g., ["poisoned"], ["prone", "restrained"]). These show as token overlay icons.',
        ),
      disabled: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the effect starts disabled (present but not applying changes). Default: false"),
      origin: z
        .string()
        .optional()
        .describe('UUID of the source document (e.g., "Actor.abc123.Item.def456" for an item-granted effect)'),
    },
    async ({ actorId, name, icon, changes, duration, statuses, disabled, origin }) => {
      const effectData: Record<string, unknown> = { name, disabled };
      if (icon) effectData.icon = icon;
      if (changes) effectData.changes = changes;
      if (duration) effectData.duration = duration;
      if (statuses) effectData.statuses = statuses;
      if (origin) effectData.origin = origin;

      const response = await client.modifyDocument("ActiveEffect", "create", {
        data: [effectData],
        parentUuid: `Actor.${actorId}`,
      });

      const created = getFirstResult(response);
      return jsonResponse({
        applied: true,
        effectId: created?._id,
        actorId,
        name,
        disabled,
      });
    },
  );

  server.tool(
    "foundry_remove_active_effect",
    "Remove an active effect from an actor by effect ID. Permanently deletes the effect, immediately reversing any attribute changes it was applying. Use foundry_list_active_effects first to find the effect ID.",
    {
      actorId: z.string().describe("Actor _id"),
      effectId: z.string().describe("ActiveEffect _id to remove"),
    },
    async ({ actorId, effectId }) => {
      await client.modifyDocument("ActiveEffect", "delete", {
        ids: [effectId],
        parentUuid: `Actor.${actorId}`,
      });

      return jsonResponse({ removed: true, actorId, effectId });
    },
  );

  server.tool(
    "foundry_toggle_active_effect",
    "Enable or disable an existing active effect on an actor without removing it. Disabled effects remain visible on the actor but do not apply their attribute changes. Useful for temporarily suppressing a buff, pausing a condition, or toggling concentration effects.",
    {
      actorId: z.string().describe("Actor _id"),
      effectId: z.string().describe("ActiveEffect _id to toggle"),
      disabled: z
        .boolean()
        .describe("true to disable the effect (stop applying changes), false to enable it"),
    },
    async ({ actorId, effectId, disabled }) => {
      await client.modifyDocument("ActiveEffect", "update", {
        updates: [{ _id: effectId, disabled }],
        parentUuid: `Actor.${actorId}`,
      });

      return jsonResponse({ actorId, effectId, disabled });
    },
  );
}
