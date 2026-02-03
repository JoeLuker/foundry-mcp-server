import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, mockResponse, parseResponse, invokeTool } from "../test-helpers.js";
import { registerGameTools } from "./game.js";

describe("game tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerGameTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_toggle_pause", () => {
    it("pauses the game", async () => {
      const result = await invokeTool(server, "foundry_toggle_pause", { pause: true });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.paused).toBe(true);
      expect(client.emitSocketRaw).toHaveBeenCalledWith("pause", true, {});
    });

    it("unpauses the game", async () => {
      const result = await invokeTool(server, "foundry_toggle_pause", { pause: false });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.paused).toBe(false);
      expect(client.emitSocketRaw).toHaveBeenCalledWith("pause", false, {});
    });
  });

  describe("foundry_control_playlist", () => {
    it("plays an entire playlist", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_control_playlist", {
        playlistId: "pl-1",
        action: "play",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.playing).toBe(true);
      expect(data.playlistId).toBe("pl-1");
      expect(client.modifyDocument).toHaveBeenCalledWith("Playlist", "update", {
        updates: [{ _id: "pl-1", playing: true }],
      });
    });

    it("stops an individual sound", async () => {
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(mockResponse([]));

      const result = await invokeTool(server, "foundry_control_playlist", {
        playlistId: "pl-1",
        action: "stop",
        soundId: "snd-1",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.playing).toBe(false);
      expect(data.soundId).toBe("snd-1");
      expect(client.modifyDocument).toHaveBeenCalledWith("PlaylistSound", "update", {
        updates: [{ _id: "snd-1", playing: false }],
        parentUuid: "Playlist.pl-1",
      });
    });
  });

  describe("foundry_list_online_users", () => {
    it("returns online users with details", async () => {
      vi.mocked(client.getActiveUsers).mockResolvedValueOnce([
        { userId: "u-1", activity: {} },
        { userId: "u-2", activity: {} },
      ]);
      vi.mocked(client.modifyDocument).mockResolvedValueOnce(
        mockResponse([
          { _id: "u-1", name: "GM", role: 4, character: null, color: "#ff0000" },
          { _id: "u-2", name: "Player1", role: 1, character: "actor-1", color: "#00ff00" },
          { _id: "u-3", name: "Offline", role: 1, character: null, color: "#0000ff" },
        ]),
      );

      const result = await invokeTool(server, "foundry_list_online_users");
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(2);
      const users = data.users as Record<string, unknown>[];
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe("GM");
      expect(users[1].character).toBe("actor-1");
    });

    it("returns empty list when no users active", async () => {
      vi.mocked(client.getActiveUsers).mockResolvedValueOnce([]);

      const result = await invokeTool(server, "foundry_list_online_users");
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.total).toBe(0);
      expect(data.users).toEqual([]);
      expect(client.modifyDocument).not.toHaveBeenCalled();
    });
  });
});
