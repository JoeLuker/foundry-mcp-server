import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema } from "../types.js";

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

      const scenes = (getResponse.result || []) as Record<string, unknown>[];
      const scene = scenes.find((s) => s._id === sceneId);

      if (!scene) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Scene with id "${sceneId}" not found`,
            },
          ],
          isError: true,
        };
      }

      const response = await client.modifyDocument("Scene", "update", {
        updates: [{ _id: sceneId, active: true, navigation: showNavigation }],
      });

      const updated = (response.result || [])[0] as Record<string, unknown>;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                activated: true,
                sceneId: updated?._id ?? sceneId,
                sceneName: scene.name,
              },
              null,
              2,
            ),
          },
        ],
      };
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

      const actors = (actorResponse.result || []) as Record<string, unknown>[];
      const actor = actors.find((a) => a._id === actorId);

      if (!actor) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Actor with id "${actorId}" not found`,
            },
          ],
          isError: true,
        };
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

      const created = (response.result || [])[0] as Record<string, unknown>;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                placed: true,
                tokenId: created?._id,
                sceneId,
                actorId,
                actorName: actor.name,
                x,
                y,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
