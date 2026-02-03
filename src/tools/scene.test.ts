import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerSceneTools } from "./scene.js";

describe("scene tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerSceneTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_activate_scene", () => {
    it("activates a scene", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([{ _id: "scene-1", name: "Dungeon" }])) // get
        .mockResolvedValueOnce(mockResponse([{ _id: "scene-1" }])); // update

      const result = await invokeTool(server, "foundry_activate_scene", {
        sceneId: "scene-1",
        showNavigation: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.activated).toBe(true);
      expect(data.sceneName).toBe("Dungeon");
      expect(client.modifyDocument).toHaveBeenCalledWith("Scene", "update", {
        updates: [{ _id: "scene-1", active: true, navigation: true }],
      });
    });

    it("returns error when scene not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_activate_scene", {
        sceneId: "bad-id",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("foundry_preload_scene", () => {
    it("preloads a scene", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "scene-1", name: "Forest" }]),
      );

      const result = await invokeTool(server, "foundry_preload_scene", {
        sceneId: "scene-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.preloading).toBe(true);
      expect(data.sceneName).toBe("Forest");
      expect(client.emitSocketArgs).toHaveBeenCalledWith("preloadScene", "scene-1");
    });

    it("returns error when scene not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_preload_scene", {
        sceneId: "missing",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_pull_to_scene", () => {
    it("pulls user to a scene", async () => {
      const result = await invokeTool(server, "foundry_pull_to_scene", {
        sceneId: "scene-1",
        userId: "user-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.pulled).toBe(true);
      expect(client.emitSocketRaw).toHaveBeenCalledWith("pullToScene", "scene-1", "user-1");
    });
  });

  describe("foundry_reset_fog", () => {
    it("resets fog for a scene", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "scene-1", name: "Cave" }]),
      );

      const result = await invokeTool(server, "foundry_reset_fog", {
        sceneId: "scene-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.reset).toBe(true);
      expect(data.sceneName).toBe("Cave");
      expect(client.emitSocketRaw).toHaveBeenCalledWith("resetFog", "scene-1");
    });
  });

  describe("foundry_place_token", () => {
    it("places a token from an actor", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{
            _id: "actor-1",
            name: "Goblin",
            prototypeToken: { name: "Goblin", texture: { src: "token.png" } },
          }]),
        )
        .mockResolvedValueOnce(mockResponse([{ _id: "token-1" }]));

      const result = await invokeTool(server, "foundry_place_token", {
        sceneId: "scene-1",
        actorId: "actor-1",
        x: 500,
        y: 300,
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.placed).toBe(true);
      expect(data.tokenId).toBe("token-1");
      expect(data.actorName).toBe("Goblin");

      const createCall = vi.mocked(client.modifyDocument).mock.calls[1];
      expect(createCall[0]).toBe("Token");
      expect(createCall[1]).toBe("create");
      const op = createCall[2] as Record<string, unknown>;
      expect(op.parentUuid).toBe("Scene.scene-1");
      const tokenData = (op.data as Record<string, unknown>[])[0];
      expect(tokenData.actorId).toBe("actor-1");
      expect(tokenData.x).toBe(500);
      expect(tokenData.y).toBe(300);
      expect(tokenData._id).toBeUndefined();
    });

    it("returns error when actor not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_place_token", {
        sceneId: "scene-1",
        actorId: "missing",
        x: 0,
        y: 0,
      });
      expect(result.isError).toBe(true);
    });

    it("applies overrides to token data", async () => {
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "actor-1", name: "Goblin", prototypeToken: {} }]),
        )
        .mockResolvedValueOnce(mockResponse([{ _id: "token-2" }]));

      await invokeTool(server, "foundry_place_token", {
        sceneId: "scene-1",
        actorId: "actor-1",
        x: 100,
        y: 200,
        overrides: { hidden: true, rotation: 90 },
      });

      const createCall = vi.mocked(client.modifyDocument).mock.calls[1];
      const tokenData = ((createCall[2] as Record<string, unknown>).data as Record<string, unknown>[])[0];
      expect(tokenData.hidden).toBe(true);
      expect(tokenData.rotation).toBe(90);
    });
  });
});
