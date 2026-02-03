import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, mockDeleteResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerTokenTools } from "./tokens.js";

describe("token tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerTokenTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_get_token", () => {
    it("returns token data", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "tok-1", name: "Goblin", x: 300, y: 400, hidden: false }]),
      );

      const result = await invokeTool(server, "foundry_get_token", {
        sceneId: "scene-1",
        tokenId: "tok-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.name).toBe("Goblin");
      expect(data.x).toBe(300);
    });

    it("returns selected fields only", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "tok-1", name: "Goblin", x: 300, y: 400, hidden: false }]),
      );

      const result = await invokeTool(server, "foundry_get_token", {
        sceneId: "scene-1",
        tokenId: "tok-1",
        fields: ["x", "y"],
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data).toEqual({ x: 300, y: 400 });
    });

    it("returns error when token not found", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_get_token", {
        sceneId: "scene-1",
        tokenId: "tok-missing",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("foundry_move_token", () => {
    it("moves token to new position", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_move_token", {
        sceneId: "scene-1",
        tokenId: "tok-1",
        x: 500,
        y: 600,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.moved).toBe(true);
      expect(data.x).toBe(500);
      expect(data.y).toBe(600);

      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "update", {
        updates: [{ _id: "tok-1", x: 500, y: 600 }],
        parentUuid: "Scene.scene-1",
      });
    });

    it("includes optional elevation and rotation", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_move_token", {
        sceneId: "scene-1",
        tokenId: "tok-1",
        x: 100,
        y: 200,
        elevation: 30,
        rotation: 90,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.elevation).toBe(30);
      expect(data.rotation).toBe(90);

      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "update", {
        updates: [{ _id: "tok-1", x: 100, y: 200, elevation: 30, rotation: 90 }],
        parentUuid: "Scene.scene-1",
      });
    });
  });

  describe("foundry_toggle_token_visibility", () => {
    it("hides a token", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_toggle_token_visibility", {
        sceneId: "scene-1",
        tokenId: "tok-1",
        hidden: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.hidden).toBe(true);

      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "update", {
        updates: [{ _id: "tok-1", hidden: true }],
        parentUuid: "Scene.scene-1",
      });
    });
  });

  describe("foundry_update_token", () => {
    it("applies arbitrary updates", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "tok-1", "light.dim": 30 }]),
      );

      const result = await invokeTool(server, "foundry_update_token", {
        sceneId: "scene-1",
        tokenId: "tok-1",
        updates: { "light.dim": 30, "light.bright": 15 },
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data._id).toBe("tok-1");

      expect(client.modifyDocument).toHaveBeenCalledWith("Token", "update", {
        updates: [{ _id: "tok-1", "light.dim": 30, "light.bright": 15 }],
        parentUuid: "Scene.scene-1",
      });
    });
  });

  describe("foundry_toggle_token_status", () => {
    it("applies a status when not present", async () => {
      // First call: get existing effects (none with target status)
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(mockResponse([]))
        .mockResolvedValueOnce(mockResponse([{ _id: "eff-new", name: "Poisoned", statuses: ["poisoned"] }]));

      const result = await invokeTool(server, "foundry_toggle_token_status", {
        actorId: "actor-1",
        statusId: "poisoned",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.action).toBe("applied");
      expect(data.active).toBe(true);
    });

    it("removes a status when present", async () => {
      // First call: get existing effects with target status
      vi.mocked(client.modifyDocument)
        .mockResolvedValueOnce(
          mockResponse([{ _id: "eff-1", name: "Poisoned", statuses: ["poisoned"] }]),
        )
        .mockResolvedValueOnce(mockDeleteResponse(["eff-1"]));

      const result = await invokeTool(server, "foundry_toggle_token_status", {
        actorId: "actor-1",
        statusId: "poisoned",
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.action).toBe("removed");
      expect(data.active).toBe(false);
    });

    it("returns unchanged when already in desired state", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([{ _id: "eff-1", name: "Poisoned", statuses: ["poisoned"] }]),
      );

      const result = await invokeTool(server, "foundry_toggle_token_status", {
        actorId: "actor-1",
        statusId: "poisoned",
        active: true,
      });
      const data = parseResponse(result) as Record<string, unknown>;
      expect(data.action).toBe("unchanged");
    });
  });
});
