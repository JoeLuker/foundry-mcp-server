import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema } from "../types.js";
import { jsonResponse, errorResponse, getResults, getFirstResult } from "../utils.js";

export function registerSceneTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_activate_scene",
    "Activate a scene, making it the current view for all players. Automatically deactivates the previously active scene.",
    {
      sceneId: z.string().describe("Scene _id to activate"),
      showNavigation: z
        .boolean()
        .optional()
        .default(true)
        .describe("Show scene in navigation bar (default: true)"),
    },
    async ({ sceneId, showNavigation }) => {
      // Verify scene exists
      const getResponse = await client.modifyDocument("Scene", "get", {
        query: { _id: sceneId },
      });

      const scenes = getResults(getResponse);
      const scene = scenes.find((s) => s._id === sceneId);

      if (!scene) {
        return errorResponse(`Scene with id "${sceneId}" not found`);
      }

      const response = await client.modifyDocument("Scene", "update", {
        updates: [{ _id: sceneId, active: true, navigation: showNavigation }],
      });

      const updated = getFirstResult(response);
      return jsonResponse({
        activated: true,
        sceneId: updated?._id ?? sceneId,
        sceneName: scene.name,
      });
    },
  );

  server.tool(
    "foundry_preload_scene",
    "Request all connected clients to preload a scene's assets (images, sounds, etc.) so that switching to it later is faster.",
    {
      sceneId: z.string().describe("Scene _id to preload"),
    },
    async ({ sceneId }) => {
      // Verify scene exists
      const getResponse = await client.modifyDocument("Scene", "get", {
        query: { _id: sceneId },
      });
      const scenes = getResults(getResponse);
      const scene = scenes.find((s) => s._id === sceneId);

      if (!scene) {
        return errorResponse(`Scene with id "${sceneId}" not found`);
      }

      // preloadScene signature: emit("preloadScene", sceneId, callback)
      await client.emitSocketArgs("preloadScene", sceneId);

      return jsonResponse({ preloading: true, sceneId, sceneName: scene.name });
    },
  );

  server.tool(
    "foundry_pull_to_scene",
    "Force a specific player's view to navigate to a scene. Requires GM permission.",
    {
      sceneId: z.string().describe("Scene _id to pull the user to"),
      userId: z.string().describe("User _id to pull to the scene"),
    },
    async ({ sceneId, userId }) => {
      // pullToScene signature: emit("pullToScene", sceneId, userId) — fire-and-forget
      await client.emitSocketRaw("pullToScene", sceneId, userId);

      return jsonResponse({ pulled: true, sceneId, userId });
    },
  );

  server.tool(
    "foundry_reset_fog",
    "Reset (clear) the fog of war exploration data for a scene. This removes all explored areas, resetting fog to fully unexplored for all players.",
    {
      sceneId: z.string().describe("Scene _id to reset fog for"),
    },
    async ({ sceneId }) => {
      // Verify scene exists
      const getResponse = await client.modifyDocument("Scene", "get", {
        query: { _id: sceneId },
      });
      const scenes = getResults(getResponse);
      const scene = scenes.find((s) => s._id === sceneId);

      if (!scene) {
        return errorResponse(`Scene with id "${sceneId}" not found`);
      }

      // resetFog is a custom socket event — it takes sceneId as its argument
      // Server signature: socket.emit("resetFog", sceneId)
      await client.emitSocketRaw("resetFog", sceneId);

      return jsonResponse({ reset: true, sceneId, sceneName: scene.name });
    },
  );

  server.tool(
    "foundry_place_token",
    "Place an actor's token on a scene at a specific position. Reads the actor's prototype token data (artwork, size, vision) and creates a Token on the scene.",
    {
      sceneId: z.string().describe("Scene _id to place token on"),
      actorId: z.string().describe("Actor _id to create token from"),
      x: z.number().describe("X coordinate in pixels"),
      y: z.number().describe("Y coordinate in pixels"),
      overrides: z
        .record(z.unknown())
        .optional()
        .describe(
          "Token data overrides (e.g., {hidden: true, rotation: 90, elevation: 10})",
        ),
    },
    async ({ sceneId, actorId, x, y, overrides }) => {
      // Fetch actor to get prototypeToken
      const actorResponse = await client.modifyDocument("Actor", "get", {
        query: { _id: actorId },
      });

      const actors = getResults(actorResponse);
      const actor = actors.find((a) => a._id === actorId);

      if (!actor) {
        return errorResponse(`Actor with id "${actorId}" not found`);
      }

      const prototypeToken =
        (actor.prototypeToken as Record<string, unknown>) || {};

      // Build token data from prototype + position + overrides
      const tokenData: Record<string, unknown> = {
        ...prototypeToken,
        actorId,
        x,
        y,
        ...overrides,
      };

      // Remove fields that shouldn't be on placed tokens
      delete tokenData._id;

      const response = await client.modifyDocument("Token", "create", {
        data: [tokenData],
        parentUuid: `Scene.${sceneId}`,
      });

      const created = getFirstResult(response);
      return jsonResponse({
        placed: true,
        tokenId: created?._id,
        sceneId,
        actorId,
        actorName: actor.name,
        x,
        y,
      });
    },
  );
}
