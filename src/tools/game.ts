import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

export function registerGameTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_toggle_pause",
    "Pause or unpause the Foundry VTT game for all connected players. Requires a connected browser client.",
    {
      pause: z.boolean().describe("True to pause, false to unpause"),
    },
    async ({ pause }) => {
      const script = `
await game.togglePause(${pause}, { broadcast: true });
await ChatMessage.create({
  content: "MCP_PAUSE:" + JSON.stringify({ paused: game.paused }),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      const result = await client.executeMacroWithResult(script, "MCP_PAUSE:");

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_control_playlist",
    "Start or stop playback of a playlist or individual sound within a playlist.",
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

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { playlistId, soundId, action, playing },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Control entire playlist
      await client.modifyDocument("Playlist", "update", {
        updates: [{ _id: playlistId, playing }],
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { playlistId, action, playing },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_list_online_users",
    "List currently connected (online) users in the Foundry VTT game, including their roles and assigned characters. Requires a connected browser client.",
    {},
    async () => {
      const script = `
const users = game.users.filter(u => u.active).map(u => ({
  id: u.id,
  name: u.name,
  role: u.role,
  character: u.character ? { id: u.character.id, name: u.character.name } : null,
  color: u.color,
}));
await ChatMessage.create({
  content: "MCP_ONLINE_USERS:" + JSON.stringify({ total: users.length, users }),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      const result = await client.executeMacroWithResult(
        script,
        "MCP_ONLINE_USERS:",
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );
}
