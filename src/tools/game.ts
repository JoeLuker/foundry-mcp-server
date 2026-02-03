import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, getResults } from "../utils.js";

export function registerGameTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_toggle_pause",
    "Pause or unpause the Foundry VTT game for all connected players. When paused, players cannot move tokens or take actions. GMs are unaffected by pause.",
    {
      pause: z.boolean().describe("True to pause, false to unpause"),
    },
    async ({ pause }) => {
      // Use the server-side "pause" socket event directly.
      // Signature: socket.emit("pause", paused: boolean, userData: object)
      // The server sets game.paused and broadcasts to all clients.
      await client.emitSocketRaw("pause", pause, {});

      return jsonResponse({ paused: pause });
    },
  );

  server.tool(
    "foundry_control_playlist",
    "Start or stop playback of a playlist or individual sound within a playlist. To find playlists, use foundry_list_documents with documentType='Playlist'. To find sounds within a playlist, use foundry_list_embedded.",
    {
      playlistId: z.string().describe("Playlist _id"),
      action: z.enum(["play", "stop"]).describe("Play or stop"),
      soundId: z
        .string()
        .optional()
        .describe(
          "Specific PlaylistSound _id to target. If omitted, controls the entire playlist.",
        ),
    },
    async ({ playlistId, action, soundId }) => {
      const playing = action === "play";

      if (soundId) {
        // Control individual sound
        await client.modifyDocument("PlaylistSound", "update", {
          updates: [{ _id: soundId, playing }],
          parentUuid: `Playlist.${playlistId}`,
        });

        return jsonResponse({ playlistId, soundId, action, playing });
      }

      // Control entire playlist
      await client.modifyDocument("Playlist", "update", {
        updates: [{ _id: playlistId, playing }],
      });

      return jsonResponse({ playlistId, action, playing });
    },
  );

  server.tool(
    "foundry_list_online_users",
    "List currently connected (online) users in the Foundry VTT game, including their roles and assigned characters. Roles: 0=None, 1=Player, 2=Trusted, 3=Assistant GM, 4=GM. User IDs from this list work with foundry_send_chat whisper, foundry_pull_to_scene, and foundry_show_journal.",
    {},
    async () => {
      // Use getUserActivity socket event to get active user IDs,
      // then fetch their User documents for names/roles.
      const activeUsers = await client.getActiveUsers();
      const activeUserIds = activeUsers.map((u) => u.userId);

      if (activeUserIds.length === 0) {
        return jsonResponse({ total: 0, users: [] });
      }

      // Fetch User documents for the active users
      const response = await client.modifyDocument("User", "get", {
        query: {},
      });

      const allUsers = getResults(response);
      const onlineUsers = allUsers
        .filter((u) => activeUserIds.includes(u._id as string))
        .map((u) => ({
          id: u._id,
          name: u.name,
          role: u.role,
          character: u.character || null,
          color: u.color || null,
        }));

      return jsonResponse({ total: onlineUsers.length, users: onlineUsers });
    },
  );
}
