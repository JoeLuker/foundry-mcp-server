import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, getFirstResult } from "../utils.js";

export function registerLightingTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_create_light",
    "Create an ambient light source on a scene. Lights illuminate areas for tokens with vision enabled. Configure bright and dim radii (in grid units, not pixels), color, intensity, emission angle, and optional animation. Lights are blocked by walls unless walls=false.",
    {
      sceneId: z.string().describe("Scene _id to place the light on"),
      x: z.number().describe("X position in pixels"),
      y: z.number().describe("Y position in pixels"),
      dim: z
        .number()
        .describe("Dim light radius in grid units (e.g., 6 for 6 squares)"),
      bright: z
        .number()
        .describe("Bright light radius in grid units (e.g., 3 for 3 squares)"),
      color: z
        .string()
        .optional()
        .describe('Light color as hex string (e.g., "#ff9900" for warm orange, "#ffffff" for white)'),
      alpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.5)
        .describe("Light intensity/opacity from 0 (invisible) to 1 (full). Default: 0.5"),
      angle: z
        .number()
        .optional()
        .default(360)
        .describe("Emission angle in degrees. 360 = omnidirectional (default). Use smaller values for directional light (e.g., 90 for a spotlight)."),
      animation: z
        .object({
          type: z.string().describe('Animation type: "torch", "pulse", "chroma", "wave", "fog", "sunburst", "dome", "emanation", "hexa", "ghost", "energy", "vortex", "witchwave", "rainbowswirl", "radialrainbow", "fairy", "grid", "starlight", "smokepatch"'),
          speed: z.number().min(1).max(10).describe("Animation speed (1-10)"),
          intensity: z.number().min(1).max(10).describe("Animation intensity (1-10)"),
        })
        .optional()
        .describe("Light animation settings"),
      walls: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether walls block this light (default: true)"),
      hidden: z
        .boolean()
        .optional()
        .default(false)
        .describe("Start hidden / GM-only (default: false)"),
    },
    async ({ sceneId, x, y, dim, bright, color, alpha, angle, animation, walls, hidden }) => {
      const lightData: Record<string, unknown> = {
        x,
        y,
        config: {
          dim,
          bright,
          angle,
          alpha,
          walls,
          ...(color ? { color } : {}),
          ...(animation ? { animation } : {}),
        },
        hidden,
      };

      const response = await client.modifyDocument("AmbientLight", "create", {
        data: [lightData],
        parentUuid: `Scene.${sceneId}`,
      });

      const created = getFirstResult(response);
      return jsonResponse({
        created: true,
        lightId: created?._id,
        sceneId,
        x,
        y,
        dim,
        bright,
      });
    },
  );

  server.tool(
    "foundry_create_wall",
    "Create a wall segment on a scene. Walls block token movement, vision, light, and/or sound depending on their restriction settings. Coordinates are in pixels — use grid size (default 100px/square) to convert from grid positions. Wall types via restriction combos: normal (all=1), ethereal (move=0, sight/light/sound=1), invisible (move=1, sight/light=0), terrain (move=1, sight=2). Set door > 0 to make it a door.",
    {
      sceneId: z.string().describe("Scene _id"),
      c: z
        .array(z.number())
        .length(4)
        .describe("Wall coordinates as [x1, y1, x2, y2] in pixels. The wall runs from (x1,y1) to (x2,y2)."),
      move: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(1)
        .describe("Movement restriction: 0=none, 1=normal (blocks), 2=limited (half-speed). Default: 1"),
      sight: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(1)
        .describe("Vision restriction: 0=none, 1=normal (blocks sight), 2=limited (dim). Default: 1"),
      light: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(1)
        .describe("Light restriction: 0=none, 1=normal (blocks light), 2=limited. Default: 1"),
      sound: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(1)
        .describe("Sound restriction: 0=none, 1=normal (blocks sound), 2=limited. Default: 1"),
      door: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(0)
        .describe("Door type: 0=none (regular wall), 1=door (clickable), 2=secret door (GM-only). Default: 0"),
      ds: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(0)
        .describe("Door state: 0=closed, 1=open, 2=locked. Only relevant when door > 0. Default: 0"),
    },
    async ({ sceneId, c, move, sight, light, sound, door, ds }) => {
      const wallData: Record<string, unknown> = {
        c,
        move,
        sight,
        light,
        sound,
        door,
        ds,
      };

      const response = await client.modifyDocument("Wall", "create", {
        data: [wallData],
        parentUuid: `Scene.${sceneId}`,
      });

      const created = getFirstResult(response);
      return jsonResponse({
        created: true,
        wallId: created?._id,
        sceneId,
        c,
        door: door > 0 ? { type: door, state: ds } : null,
      });
    },
  );

  server.tool(
    "foundry_toggle_door",
    "Open, close, or lock a door wall on a scene. The wall must have door > 0 (be a door or secret door). Players can open/close doors they can see; only GMs can lock doors.",
    {
      sceneId: z.string().describe("Scene _id containing the door"),
      wallId: z.string().describe("Wall _id (must be a door wall, i.e., door > 0)"),
      state: z
        .enum(["open", "closed", "locked"])
        .describe("Door state to set"),
    },
    async ({ sceneId, wallId, state }) => {
      const stateMap: Record<string, number> = { closed: 0, open: 1, locked: 2 };
      const ds = stateMap[state];

      await client.modifyDocument("Wall", "update", {
        updates: [{ _id: wallId, ds }],
        parentUuid: `Scene.${sceneId}`,
      });

      return jsonResponse({ sceneId, wallId, state, ds });
    },
  );

  server.tool(
    "foundry_update_scene_config",
    "Update scene configuration properties. Use this for dynamic scene changes like day/night transitions (darkness), grid adjustments, background/foreground swaps, weather effects, and more. Supports dot-notation for nested fields.",
    {
      sceneId: z.string().describe("Scene _id to configure"),
      updates: z
        .record(z.unknown())
        .describe(
          'Scene properties to update. Common fields: "darkness" (0=day, 1=night), "grid.size" (pixels per square, default 100), "grid.type" (0=gridless, 1=square, 2=hex-odd-r), "background.src" (image path), "foreground" (image path), "globalLight" (boolean), "fogExploration" (boolean), "tokenVision" (boolean), "weather" (effect ID), "width", "height", "padding", "initial.x", "initial.y", "initial.scale"',
        ),
    },
    async ({ sceneId, updates }) => {
      const response = await client.modifyDocument("Scene", "update", {
        updates: [{ _id: sceneId, ...updates }],
      });

      const updated = getFirstResult(response);
      return jsonResponse(updated);
    },
  );
}
