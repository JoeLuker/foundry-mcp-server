import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema } from "../types.js";
import { pickFields, filterByName, splitFilters, applyClientFilters } from "../utils.js";

export function registerCompendiumTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_list_compendium_packs",
    'List available compendium packs. Pack IDs follow the format "{packageName}.{packName}" (e.g., "pf1.spells", "world.custom-items").',
    {
      type: z
        .string()
        .optional()
        .describe(
          'Filter by document type stored in pack (e.g., "Item", "Actor", "JournalEntry")',
        ),
    },
    async ({ type }) => {
      // Use the "world" socket event to get world data which includes pack metadata.
      // This event takes only a callback (no data argument).
      const worldData = (await client.emitSocketCallback("world")) as Record<
        string,
        unknown
      >;

      const rawPacks = (worldData.packs || []) as Array<
        Record<string, unknown>
      >;

      let packs = rawPacks.map((p) => ({
        id: p.id || `${p.packageName}.${p.name}`,
        label: p.label,
        type: p.type,
        packageName: p.packageName,
        packageType: p.packageType,
        count:
          Array.isArray(p.index) ? p.index.length : (p.index as Record<string, unknown>)?.length ?? null,
      }));

      if (type) {
        packs = packs.filter((p) => p.type === type);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total: packs.length, packs }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_get_compendium_index",
    "Get the index (lightweight listing) of entries in a compendium pack. Returns summaries with pagination. Use this to browse pack contents before fetching full entries.",
    {
      packId: z
        .string()
        .describe(
          'Compendium pack ID (e.g., "pf1.spells", "pf1.bestiary-1", "world.my-pack")',
        ),
      documentType: documentTypeSchema.describe(
        "Document type stored in the pack (e.g., Item, Actor)",
      ),
      fields: z
        .array(z.string())
        .optional()
        .describe('Fields to include. Default: ["_id", "name", "type"]'),
      limit: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Max results (default 50)"),
      offset: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe("Pagination offset"),
    },
    async ({ packId, documentType, fields, limit, offset }) => {
      const response = await client.modifyDocument(documentType, "get", {
        query: {},
        pack: packId,
      });

      let docs = (response.result || []) as Record<string, unknown>[];

      const total = docs.length;
      docs = docs.slice(offset, offset + limit);

      const defaultFields = ["_id", "name", "type"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { total, count: results.length, offset, packId, documents: results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_get_compendium_entry",
    "Get a full document entry from a compendium pack by ID. Returns complete data including system-specific fields.",
    {
      packId: z.string().describe("Compendium pack ID"),
      documentType: documentTypeSchema.describe("Document type stored in the pack"),
      id: z.string().describe("Document _id within the pack"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Fields to return. Default: all fields."),
    },
    async ({ packId, documentType, id, fields }) => {
      const response = await client.modifyDocument(documentType, "get", {
        query: { _id: id },
        pack: packId,
      });

      const docs = (response.result || []) as Record<string, unknown>[];
      const doc = docs[0];

      if (!doc) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Entry "${id}" not found in pack "${packId}"`,
            },
          ],
          isError: true,
        };
      }

      const result = fields && fields.length > 0 ? pickFields(doc, fields) : doc;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_search_compendium",
    "Search entries in a compendium pack by name pattern (substring or regex) and optional field filters. Supports dot-notation for nested system data filters.",
    {
      packId: z.string().describe("Compendium pack ID"),
      documentType: documentTypeSchema.describe("Document type stored in the pack"),
      namePattern: z
        .string()
        .optional()
        .describe("Substring or regex pattern to match against entry name"),
      filters: z
        .record(z.unknown())
        .optional()
        .describe(
          'Key-value field filters (e.g., {"type": "weapon", "system.details.cr": 5})',
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe("Fields to return"),
      limit: z
        .number()
        .min(1)
        .max(200)
        .optional()
        .default(20),
    },
    async ({ packId, documentType, namePattern, filters, fields, limit }) => {
      // Split filters: top-level to server, dot-notation stays client-side
      const { serverQuery, clientFilters } = filters
        ? splitFilters(filters)
        : { serverQuery: {}, clientFilters: {} };

      const response = await client.modifyDocument(documentType, "get", {
        query: serverQuery,
        pack: packId,
      });

      let docs = (response.result || []) as Record<string, unknown>[];

      // Client-side name filter
      if (namePattern) {
        docs = filterByName(docs, namePattern);
      }

      // Client-side dot-notation filters
      docs = applyClientFilters(docs, clientFilters);

      const total = docs.length;
      docs = docs.slice(0, limit);

      const defaultFields = ["_id", "name", "type"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { total, count: results.length, packId, documents: results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
