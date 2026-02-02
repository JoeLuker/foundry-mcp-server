import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "./foundry-client.js";
import { pickFields } from "./utils.js";

export function registerResources(
  server: McpServer,
  client: FoundryClient,
): void {
  // === Static Resources ===

  server.registerResource(
    "world-status",
    "foundry://world/status",
    {
      description: "Current Foundry VTT world info: version, system, active status, users",
      mimeType: "application/json",
    },
    async (uri) => {
      await client.ensureConnected();
      const info = client.worldInfo;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { connected: true, state: client.state, ...info },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "folders",
    "foundry://folders",
    {
      description: "Complete folder structure of the Foundry VTT world",
      mimeType: "application/json",
    },
    async (uri) => {
      const response = await client.modifyDocument("Folder", "get", { query: {} });
      const folders = (response.result || []) as Record<string, unknown>[];
      const summary = folders.map((f) =>
        pickFields(f, ["_id", "name", "type", "folder", "sort"]),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ total: summary.length, folders: summary }, null, 2),
          },
        ],
      };
    },
  );

  // === Dynamic Resource Templates ===

  registerDocumentResource(server, client, {
    name: "actor",
    uriPattern: "foundry://actors/{actorId}",
    variableName: "actorId",
    documentType: "Actor",
    description: "Full actor data including stats, items, and effects",
  });

  registerDocumentResource(server, client, {
    name: "journal",
    uriPattern: "foundry://journals/{journalId}",
    variableName: "journalId",
    documentType: "JournalEntry",
    description: "Journal entry with all pages and content",
  });

  registerDocumentResource(server, client, {
    name: "scene",
    uriPattern: "foundry://scenes/{sceneId}",
    variableName: "sceneId",
    documentType: "Scene",
    description: "Scene data including dimensions, tokens, walls, and lights",
  });

  registerDocumentResource(server, client, {
    name: "item",
    uriPattern: "foundry://items/{itemId}",
    variableName: "itemId",
    documentType: "Item",
    description: "World item data including type, description, and system data",
  });
}

/** Register a dynamic document resource template with list + autocomplete. */
function registerDocumentResource(
  server: McpServer,
  client: FoundryClient,
  config: {
    name: string;
    uriPattern: string;
    variableName: string;
    documentType: string;
    description: string;
  },
): void {
  const template = new ResourceTemplate(config.uriPattern, {
    list: async () => {
      const response = await client.modifyDocument(config.documentType, "get", {
        query: {},
      });
      const docs = (response.result || []) as Record<string, unknown>[];
      return {
        resources: docs.map((d) => ({
          uri: config.uriPattern.replace(
            `{${config.variableName}}`,
            d._id as string,
          ),
          name: (d.name as string) || (d._id as string),
          description: `${config.documentType}: ${d.name || d._id}`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      [config.variableName]: async (value) => {
        const response = await client.modifyDocument(config.documentType, "get", {
          query: {},
        });
        const docs = (response.result || []) as Record<string, unknown>[];
        const lower = value.toLowerCase();
        return docs
          .filter((d) => {
            const name = ((d.name as string) || "").toLowerCase();
            const id = ((d._id as string) || "").toLowerCase();
            return name.includes(lower) || id.startsWith(lower);
          })
          .slice(0, 10)
          .map((d) => d._id as string);
      },
    },
  });

  server.registerResource(
    config.name,
    template,
    {
      description: config.description,
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = variables[config.variableName] as string;
      const response = await client.modifyDocument(config.documentType, "get", {
        query: { _id: id },
      });

      const docs = (response.result || []) as Record<string, unknown>[];
      const doc = docs[0];

      if (!doc) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `${config.documentType} "${id}" not found`,
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(doc, null, 2),
          },
        ],
      };
    },
  );
}
