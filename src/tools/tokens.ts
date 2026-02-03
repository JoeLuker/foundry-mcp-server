import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, errorResponse, getResults, getFirstResult, pickFields } from "../utils.js";

export function registerTokenTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_get_token",
    "Get detailed information about a specific token on a scene, including position (x, y), visibility, elevation, linked actor ID, light emission settings, vision/sight config, and status effects. Use the fields parameter to select specific data and reduce response size.",
    {
      sceneId: z.string().describe("Scene _id containing the token"),
      tokenId: z.string().describe("Token _id to fetch"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to return. Default: all. Common: "x", "y", "hidden", "elevation", "rotation", "actorId", "name", "sight", "light", "texture.src"',
        ),
    },
    async ({ sceneId, tokenId, fields }) => {
      const response = await client.modifyDocument("Token", "get", {
        query: { _id: tokenId },
        parentUuid: `Scene.${sceneId}`,
      });

      const docs = getResults(response);
      const token = docs.find((d) => d._id === tokenId);

      if (!token) {
        return errorResponse(`Token "${tokenId}" not found on scene "${sceneId}"`);
      }

      const result = fields && fields.length > 0 ? pickFields(token, fields) : token;
      return jsonResponse(result);
    },
  );

  server.tool(
    "foundry_move_token",
    "Move a token to a new pixel position on the scene. This is an instant reposition (not animated). Optionally update elevation and rotation in the same operation. Coordinates are in pixels — multiply grid square index by grid size (default 100px) to convert.",
    {
      sceneId: z.string().describe("Scene _id containing the token"),
      tokenId: z.string().describe("Token _id to move"),
      x: z.number().describe("New X coordinate in pixels"),
      y: z.number().describe("New Y coordinate in pixels"),
      elevation: z.number().optional().describe("New elevation value (in distance units)"),
      rotation: z.number().optional().describe("New rotation in degrees (0-360)"),
    },
    async ({ sceneId, tokenId, x, y, elevation, rotation }) => {
      const updates: Record<string, unknown> = { _id: tokenId, x, y };
      if (elevation !== undefined) updates.elevation = elevation;
      if (rotation !== undefined) updates.rotation = rotation;

      await client.modifyDocument("Token", "update", {
        updates: [updates],
        parentUuid: `Scene.${sceneId}`,
      });

      return jsonResponse({
        moved: true,
        sceneId,
        tokenId,
        x,
        y,
        ...(elevation !== undefined ? { elevation } : {}),
        ...(rotation !== undefined ? { rotation } : {}),
      });
    },
  );

  server.tool(
    "foundry_toggle_token_visibility",
    "Toggle a token's visibility on the scene. Hidden tokens are visible only to GMs, not players. Use this to hide/reveal enemies, secret NPCs, or hidden objects before a dramatic reveal.",
    {
      sceneId: z.string().describe("Scene _id containing the token"),
      tokenId: z.string().describe("Token _id to show/hide"),
      hidden: z.boolean().describe("true to hide the token, false to reveal it"),
    },
    async ({ sceneId, tokenId, hidden }) => {
      await client.modifyDocument("Token", "update", {
        updates: [{ _id: tokenId, hidden }],
        parentUuid: `Scene.${sceneId}`,
      });

      return jsonResponse({ sceneId, tokenId, hidden });
    },
  );

  server.tool(
    "foundry_update_token",
    "Update any properties on a token. Supports all Foundry Token fields including display settings (displayName, displayBars), light emission (light.dim, light.bright, light.color, light.alpha), sight/vision (sight.enabled, sight.range, sight.visionMode), bar attributes (bar1.attribute, bar2.attribute), texture (texture.src, texture.scaleX), and name. Use dot-notation for nested fields.",
    {
      sceneId: z.string().describe("Scene _id containing the token"),
      tokenId: z.string().describe("Token _id to update"),
      updates: z
        .record(z.unknown())
        .describe(
          'Partial update object with dot-notation support. Examples: {"light.dim": 30, "light.bright": 15, "light.color": "#ff9900"} or {"sight.enabled": true, "sight.range": 60}',
        ),
    },
    async ({ sceneId, tokenId, updates }) => {
      const response = await client.modifyDocument("Token", "update", {
        updates: [{ _id: tokenId, ...updates }],
        parentUuid: `Scene.${sceneId}`,
      });

      const updated = getFirstResult(response);
      return jsonResponse(updated);
    },
  );

  server.tool(
    "foundry_toggle_token_status",
    "Toggle a status effect (condition) on a token's linked actor. Creates or removes an ActiveEffect with the given status ID. Common statuses: 'dead', 'unconscious', 'poisoned', 'blind', 'deaf', 'prone', 'stunned', 'paralysis', 'sleep', 'fear', 'invisible', 'restrained'. NOTE: Only works for tokens linked to a world actor. Unlinked (synthetic) tokens are not supported.",
    {
      actorId: z
        .string()
        .describe("Actor _id (the token's linked actor, not the token ID)"),
      statusId: z
        .string()
        .describe(
          'Status effect ID to toggle (e.g., "dead", "unconscious", "poisoned", "blind", "prone", "stunned", "invisible")',
        ),
      active: z
        .boolean()
        .optional()
        .describe(
          "true to apply the status, false to remove it. If omitted, toggles: removes if present, applies if absent.",
        ),
    },
    async ({ actorId, statusId, active }) => {
      // Fetch current ActiveEffects on the actor
      const effectsResponse = await client.modifyDocument("ActiveEffect", "get", {
        query: {},
        parentUuid: `Actor.${actorId}`,
      });

      const effects = getResults(effectsResponse);

      // Find an existing effect with this status
      const existing = effects.find((e) => {
        const statuses = e.statuses as string[] | undefined;
        return Array.isArray(statuses) && statuses.includes(statusId);
      });

      const shouldBeActive = active !== undefined ? active : !existing;

      if (shouldBeActive && !existing) {
        // Apply: create a new ActiveEffect with this status
        const effectData: Record<string, unknown> = {
          name: statusId.charAt(0).toUpperCase() + statusId.slice(1),
          statuses: [statusId],
          icon: `icons/svg/status/${statusId}.svg`,
        };

        const createResponse = await client.modifyDocument("ActiveEffect", "create", {
          data: [effectData],
          parentUuid: `Actor.${actorId}`,
        });

        const created = getFirstResult(createResponse);
        return jsonResponse({
          actorId,
          statusId,
          active: true,
          action: "applied",
          effectId: created?._id,
        });
      } else if (!shouldBeActive && existing) {
        // Remove: delete the existing ActiveEffect
        await client.modifyDocument("ActiveEffect", "delete", {
          ids: [existing._id as string],
          parentUuid: `Actor.${actorId}`,
        });

        return jsonResponse({
          actorId,
          statusId,
          active: false,
          action: "removed",
          effectId: existing._id,
        });
      }

      // Already in desired state
      return jsonResponse({
        actorId,
        statusId,
        active: shouldBeActive,
        action: "unchanged",
      });
    },
  );
}
