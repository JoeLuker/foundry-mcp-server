import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, getFirstResult } from "../utils.js";

export function registerChatTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_send_chat",
    "Send a chat message to the Foundry VTT game. Supports HTML content. Types: 0=Other, 1=OOC (out-of-character), 2=IC (in-character, use with speaker), 3=Emote, 4=Whisper (requires whisper user ID array), 5=Roll. Use foundry_list_online_users to get user IDs for whispers.",
    {
      content: z.string().describe("Message content (supports HTML)"),
      speaker: z
        .object({
          alias: z.string().optional().describe("Display name for the speaker"),
          actor: z.string().optional().describe("Actor _id for the speaker"),
        })
        .optional()
        .describe("Speaker information"),
      type: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe(
          "Message type: 0=Other, 1=OOC, 2=IC, 3=Emote, 4=Whisper, 5=Roll",
        ),
      whisper: z
        .array(z.string())
        .optional()
        .describe("User IDs to whisper to (requires type=4)"),
    },
    async ({ content, speaker, type, whisper }) => {
      const data: Record<string, unknown> = { content };
      if (speaker) data.speaker = speaker;
      if (type !== undefined) data.type = type;
      if (whisper) data.whisper = whisper;

      const response = await client.modifyDocument("ChatMessage", "create", {
        data: [data],
      });

      const created = getFirstResult(response);
      return jsonResponse({
        sent: true,
        id: created?._id,
        content: created?.content,
      });
    },
  );

  server.tool(
    "foundry_roll_dice",
    "Roll dice using Foundry VTT's dice engine via a chat message. Uses Foundry's native roller — result appears in chat for all players. Supports standard dice notation, modifiers, and Foundry-specific syntax (e.g., 4d6kh3, 1d20cs>=19).",
    {
      formula: z
        .string()
        .describe("Dice formula (e.g., '2d6+5', '1d20+12', '4d6kh3' for keep highest 3, '1d20cs>=19' for critical success range)"),
      flavor: z.string().optional().describe("Description text for the roll"),
      speaker: z
        .object({
          alias: z.string().optional(),
          actor: z.string().optional(),
        })
        .optional()
        .describe("Speaker information"),
    },
    async ({ formula, flavor, speaker }) => {
      let content = `[[/roll ${formula}]]`;
      if (flavor) {
        content = `${flavor}\n${content}`;
      }

      const data: Record<string, unknown> = {
        content,
        type: 5,
      };
      if (speaker) data.speaker = speaker;

      const response = await client.modifyDocument("ChatMessage", "create", {
        data: [data],
      });

      const created = getFirstResult(response);
      return jsonResponse({
        rolled: true,
        formula,
        id: created?._id,
        content: created?.content,
        rolls: created?.rolls,
      });
    },
  );
}
