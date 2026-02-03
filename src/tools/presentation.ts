import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse } from "../utils.js";

export function registerPresentationTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_show_journal",
    "Display a journal entry to players as a popup window. Can target specific users or show to everyone. Users need Observer permission on the journal unless force=true bypasses permission checks.",
    {
      journalId: z.string().describe("JournalEntry _id to show"),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Force the journal to pop up immediately (true) or just notify (false, default)",
        ),
      users: z
        .array(z.string())
        .optional()
        .describe(
          "User _ids to show the journal to. If omitted, shows to all connected users.",
        ),
    },
    async ({ journalId, force, users }) => {
      const uuid = `JournalEntry.${journalId}`;
      const options: Record<string, unknown> = { force };
      if (users && users.length > 0) {
        options.users = users;
      }

      await client.emitSocketArgs("showEntry", uuid, options);

      return jsonResponse({
        shown: true,
        journalId,
        force,
        targetUsers: users || "all",
      });
    },
  );

  server.tool(
    "foundry_share_image",
    "Share an image with players as a popup. Accepts both relative paths within Foundry data (e.g., 'worlds/myworld/handout.webp') and external URLs. Useful for showing handouts, maps, or artwork during a session.",
    {
      image: z
        .string()
        .describe(
          'Image path or URL to share (e.g., "worlds/myworld/assets/map.webp")',
        ),
      title: z
        .string()
        .optional()
        .describe("Title to display with the image"),
      users: z
        .array(z.string())
        .optional()
        .describe(
          "User _ids to share with. If omitted, shares with all connected users.",
        ),
    },
    async ({ image, title, users }) => {
      const data: Record<string, unknown> = { image };
      if (title) data.title = title;
      if (users && users.length > 0) data.users = users;

      await client.emitSocketRaw("shareImage", data);

      return jsonResponse({
        shared: true,
        image,
        title: title || null,
        targetUsers: users || "all",
      });
    },
  );
}
