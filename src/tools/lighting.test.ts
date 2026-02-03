import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerLightingTools } from "./lighting.js";

describe("lighting tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerLightingTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_create_light", () => {
    it("creates a light with required params", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "light-1" }]),
      );

      const result = await invokeTool(server, "foundry_create_light", {
        sceneId: "scene-1",
        x: 500,
        y: 600,
        dim: 6,
        bright: 3,
        alpha: 0.5,
        angle: 360,
        walls: true,
        hidden: false,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.created).toBe(true);
      expect(data.lightId).toBe("light-1");
      expect(data.dim).toBe(6);
      expect(data.bright).toBe(3);

      expect(client.modifyDocument).toHaveBeenCalledWith("AmbientLight", "create", {
        data: [
          {
            x: 500,
            y: 600,
            config: { dim: 6, bright: 3, angle: 360, alpha: 0.5, walls: true },
            hidden: false,
          },
        ],
        parentUuid: "Scene.scene-1",
      });
    });

    it("includes optional color and animation", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "light-2" }]),
      );

      await invokeTool(server, "foundry_create_light", {
        sceneId: "scene-1",
        x: 100,
        y: 200,
        dim: 10,
        bright: 5,
        color: "#ff9900",
        alpha: 0.7,
        angle: 90,
        animation: { type: "torch", speed: 5, intensity: 5 },
        walls: false,
        hidden: true,
      });

      const callArgs = vi.mocked(client.modifyDocument).mock.calls[0];
      const lightData = (callArgs[2] as { data: Record<string, unknown>[] }).data[0];
      const config = lightData.config as Record<string, unknown>;
      expect(config.color).toBe("#ff9900");
      expect(config.animation).toEqual({ type: "torch", speed: 5, intensity: 5 });
      expect(config.walls).toBe(false);
      expect(lightData.hidden).toBe(true);
    });
  });

  describe("foundry_create_wall", () => {
    it("creates a wall with coordinates", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "wall-1" }]),
      );

      const result = await invokeTool(server, "foundry_create_wall", {
        sceneId: "scene-1",
        c: [100, 200, 300, 400],
        move: 1,
        sight: 1,
        light: 1,
        sound: 1,
        door: 0,
        ds: 0,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.created).toBe(true);
      expect(data.wallId).toBe("wall-1");
      expect(data.door).toBeNull();
    });

    it("creates a door wall", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "wall-2" }]),
      );

      const result = await invokeTool(server, "foundry_create_wall", {
        sceneId: "scene-1",
        c: [0, 0, 100, 0],
        move: 1,
        sight: 1,
        light: 1,
        sound: 1,
        door: 1,
        ds: 0,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.door).toEqual({ type: 1, state: 0 });
    });
  });

  describe("foundry_toggle_door", () => {
    it("opens a door", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_toggle_door", {
        sceneId: "scene-1",
        wallId: "wall-1",
        state: "open",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.state).toBe("open");
      expect(data.ds).toBe(1);

      expect(client.modifyDocument).toHaveBeenCalledWith("Wall", "update", {
        updates: [{ _id: "wall-1", ds: 1 }],
        parentUuid: "Scene.scene-1",
      });
    });

    it("locks a door", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_toggle_door", {
        sceneId: "scene-1",
        wallId: "wall-1",
        state: "locked",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.ds).toBe(2);
    });
  });

  describe("foundry_update_scene_config", () => {
    it("updates scene properties", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "scene-1", darkness: 0.8 }]),
      );

      const result = await invokeTool(server, "foundry_update_scene_config", {
        sceneId: "scene-1",
        updates: { darkness: 0.8, globalLight: false },
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data._id).toBe("scene-1");

      expect(client.modifyDocument).toHaveBeenCalledWith("Scene", "update", {
        updates: [{ _id: "scene-1", darkness: 0.8, globalLight: false }],
      });
    });
  });
});
