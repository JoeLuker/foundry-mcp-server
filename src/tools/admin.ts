import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import type { FoundryRpc } from "../rpc.js";
import { jsonResponse, errorResponse } from "../utils.js";

export function registerAdminTools(
  server: McpServer,
  client: FoundryClient,
  rpc: FoundryRpc,
): void {
  server.tool(
    "foundry_browse_files",
    'Browse files and directories in the Foundry VTT data storage. Returns {dirs: [...], files: [...]} with paths relative to Foundry data root. Use source "data" for the user data directory or "public" for the core public directory.',
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
    "Create, delete, or migrate a world-scoped compendium pack. Only works with packs belonging to the current world. 'migrate' updates the pack's data model to the current system version.",
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
    "Get disk usage information for the current world. Returns byte sizes per collection (actors, items, scenes, journals, etc.) and all compendium packs. Useful for monitoring world bloat.",
    {},
    async () => {
      const response = await client.emitSocketCallback("sizeInfo");

      return jsonResponse(response);
    },
  );

  server.tool(
    "foundry_list_modules",
    "List all available modules in Foundry VTT. Returns module ID, title, enabled status, and description.",
    {
      filterEnabled: z
        .boolean()
        .optional()
        .describe("If true, only return enabled modules"),
    },
    async ({ filterEnabled }) => {
      try {
        const response = await rpc.call("game.modules");

        if (!response.success) {
          return errorResponse(`Failed to list modules: ${response.error}`);
        }

        const modules = response.result as Record<string, any>;
        const moduleList = Object.entries(modules).map(([id, mod]: [string, any]) => ({
          id,
          title: mod.title || id,
          enabled: mod.active || false,
          description: mod.description || "",
          version: mod.version || "",
        }));

        const filtered = filterEnabled
          ? moduleList.filter(m => m.enabled)
          : moduleList;

        return jsonResponse({ modules: filtered, count: filtered.length });
      } catch (error) {
        return errorResponse(`Failed to list modules: ${error}`);
      }
    },
  );

  server.tool(
    "foundry_get_module_settings",
    "Get the configuration settings for a specific module. Returns all module settings and their current values.",
    {
      moduleId: z
        .string()
        .describe("The module ID (e.g., 'md-to-journal')"),
    },
    async ({ moduleId }) => {
      try {
        // Get all settings for the module
        const response = await rpc.call(
          `game.settings.settings.filter(s => s.namespace === '${moduleId}')`
        );

        if (!response.success) {
          return errorResponse(`Failed to get settings for module ${moduleId}: ${response.error}`);
        }

        return jsonResponse({ moduleId, settings: response.result });
      } catch (error) {
        return errorResponse(`Failed to get settings for module ${moduleId}: ${error}`);
      }
    },
  );

  server.tool(
    "foundry_set_module_setting",
    "Set a configuration value for a module setting. Use this to configure modules after installation.",
    {
      moduleId: z
        .string()
        .describe("The module ID (e.g., 'md-to-journal')"),
      setting: z
        .string()
        .describe("The setting key (e.g., 'sourcePath')"),
      value: z
        .unknown()
        .describe("The value to set (string, number, boolean, or object)"),
    },
    async ({ moduleId, setting, value }) => {
      try {
        const response = await rpc.call(
          `game.settings.set('${moduleId}', '${setting}', ${JSON.stringify(value)})`
        );

        if (!response.success) {
          return errorResponse(`Failed to set ${moduleId}.${setting}: ${response.error}`);
        }

        return jsonResponse({
          success: true,
          moduleId,
          setting,
          value
        });
      } catch (error) {
        return errorResponse(`Failed to set ${moduleId}.${setting}: ${error}`);
      }
    },
  );

  server.tool(
    "foundry_execute_module_action",
    "Execute a module-specific action or function. Use this to trigger module sync operations, imports, or other module functionality.",
    {
      expression: z
        .string()
        .describe("JavaScript expression to execute (e.g., 'game.modules.get(\"md-to-journal\").api.sync()')"),
    },
    async ({ expression }) => {
      try {
        const response = await rpc.call(expression);

        if (!response.success) {
          return errorResponse(`Failed to execute: ${response.error}`);
        }

        return jsonResponse({ success: true, result: response.result });
      } catch (error) {
        return errorResponse(`Failed to execute: ${error}`);
      }
    },
  );
}
