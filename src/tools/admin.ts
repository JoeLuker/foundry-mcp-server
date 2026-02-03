import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, errorResponse } from "../utils.js";

export function registerAdminTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_browse_files",
    'Browse files and directories in the Foundry VTT data storage. Returns directory listings with file paths. Use source "data" for the user data directory or "public" for the core public directory.',
    {
      source: z
        .enum(["data", "public", "s3"])
        .default("data")
        .describe('Storage source to browse (default: "data")'),
      target: z
        .string()
        .optional()
        .default("")
        .describe(
          'Directory path to browse relative to source root (e.g., "worlds/myworld/assets"). Empty string for root.',
        ),
    },
    async ({ source, target }) => {
      // manageFiles signature: emit("manageFiles", data, options, callback)
      const response = (await client.emitSocketArgs("manageFiles", {
        action: "browseFiles",
        storage: source,
        target: target || "",
      }, {})) as Record<string, unknown>;

      return jsonResponse(response);
    },
  );

  server.tool(
    "foundry_create_directory",
    "Create a new directory in the Foundry VTT data storage.",
    {
      source: z
        .enum(["data", "public", "s3"])
        .default("data")
        .describe('Storage source (default: "data")'),
      target: z
        .string()
        .describe(
          'Directory path to create (e.g., "worlds/myworld/assets/maps")',
        ),
    },
    async ({ source, target }) => {
      // manageFiles signature: emit("manageFiles", data, options, callback)
      const response = (await client.emitSocketArgs("manageFiles", {
        action: "createDirectory",
        storage: source,
        target,
      }, {})) as Record<string, unknown>;

      return jsonResponse({ created: true, source, target, ...response });
    },
  );

  server.tool(
    "foundry_manage_compendium",
    "Create, delete, or migrate a world-scoped compendium pack. Only works with compendium packs belonging to the current world.",
    {
      action: z
        .enum(["create", "delete", "migrate"])
        .describe(
          "Action: create a new pack, delete an existing pack, or migrate a pack to current data model",
        ),
      type: z
        .string()
        .optional()
        .describe(
          'Document type for the pack (required for create). E.g., "Actor", "Item", "JournalEntry"',
        ),
      label: z
        .string()
        .optional()
        .describe("Display label for the pack (required for create)"),
      pack: z
        .string()
        .optional()
        .describe(
          'Pack ID for delete/migrate (e.g., "world.my-pack")',
        ),
    },
    async ({ action, type, label, pack }) => {
      if (action === "create") {
        if (!type || !label) {
          return errorResponse('Creating a compendium pack requires both "type" and "label" parameters.');
        }
      }

      if ((action === "delete" || action === "migrate") && !pack) {
        return errorResponse(`${action} requires a "pack" parameter with the pack ID.`);
      }

      // Build request matching Foundry's SocketInterface.dispatch format:
      // create: {action, data: {type, label}, options}
      // delete: {action, data: packName}  (packName is the short name, not the full ID)
      // migrate: {type: collection, action, data: collection}
      const requestData: Record<string, unknown> = { action, options: {} };

      if (action === "create") {
        requestData.data = { type, label };
      } else if (action === "delete") {
        // Extract the short pack name from "world.pack-name" format
        const packName = pack!.includes(".") ? pack!.split(".").slice(1).join(".") : pack;
        requestData.data = packName;
      } else if (action === "migrate") {
        requestData.type = pack;
        requestData.data = pack;
      }

      const response = (await client.emitSocket(
        "manageCompendium",
        requestData,
      )) as Record<string, unknown>;

      if (response.error) {
        const err = response.error as Record<string, unknown>;
        return errorResponse(`Compendium ${action} failed: ${err.message || JSON.stringify(err)}`);
      }

      return jsonResponse({ action, ...response });
    },
  );

  server.tool(
    "foundry_get_world_size",
    "Get disk usage information for the current world, including sizes of each document collection and compendium packs.",
    {},
    async () => {
      const response = await client.emitSocketCallback("sizeInfo");

      return jsonResponse(response);
    },
  );
}
