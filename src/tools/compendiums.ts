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
      // Enumerate packs by creating a temporary macro that reads game.packs
      const userId = client.userId;
      if (!userId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Not authenticated - no userId available" }),
            },
          ],
          isError: true,
        };
      }

      // Create a macro that writes pack info to a chat message
      const macroName = `_mcp_list_packs_${Date.now()}`;
      const script = `
const packs = game.packs.map(p => ({
  id: p.collection,
  label: p.metadata.label,
  type: p.metadata.type,
  packageName: p.metadata.packageName,
  packageType: p.metadata.packageType,
  count: p.index?.size ?? null,
}));
const msg = await ChatMessage.create({
  content: "MCP_PACK_LIST:" + JSON.stringify(packs),
  whisper: [game.userId],
  type: CONST.CHAT_MESSAGE_STYLES.OTHER,
});
`;

      // Step 1: Create temp macro
      const createResponse = await client.modifyDocument("Macro", "create", {
        data: [
          {
            name: macroName,
            type: "script",
            command: script,
            author: userId,
          },
        ],
      });

      const macro = (createResponse.result || [])[0] as Record<string, unknown>;
      if (!macro?._id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Failed to create pack enumeration macro" }),
            },
          ],
          isError: true,
        };
      }

      const macroId = macro._id as string;

      try {
        // Step 2: Execute via chat message
        await client.modifyDocument("ChatMessage", "create", {
          data: [
            {
              content: `<script>game.macros.get("${macroId}")?.execute();</script>`,
              author: userId,
              type: 0,
            },
          ],
        });

        // Step 3: Poll for the result message with retries
        const POLL_INTERVAL_MS = 500;
        const MAX_ATTEMPTS = 12; // 6 seconds total
        let resultMsg: Record<string, unknown> | undefined;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          const chatResponse = await client.modifyDocument("ChatMessage", "get", {
            query: {},
          });

          const messages = (chatResponse.result || []) as Record<string, unknown>[];
          resultMsg = messages
            .reverse()
            .find((m) => {
              const content = m.content as string | undefined;
              return content?.startsWith("MCP_PACK_LIST:");
            });

          if (resultMsg) break;
        }

        if (resultMsg) {
          const content = resultMsg.content as string;
          const jsonStr = content.replace("MCP_PACK_LIST:", "");
          let packs = JSON.parse(jsonStr) as Array<Record<string, unknown>>;

          // Clean up the result message
          try {
            await client.modifyDocument("ChatMessage", "delete", {
              ids: [resultMsg._id as string],
            });
          } catch {
            // Best-effort cleanup
          }

          // Apply type filter
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
        }

        // Fallback: macro execution may not have worked (no connected browser client)
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Pack enumeration timed out. This requires a connected browser client to execute the macro. Provide pack IDs directly to other compendium tools.",
                hint: 'Pack IDs follow the format "{packageName}.{packName}" (e.g., "pf1.spells", "pf1.items")',
              }, null, 2),
            },
          ],
          isError: true,
        };
      } finally {
        // Cleanup: delete temp macro
        try {
          await client.modifyDocument("Macro", "delete", {
            ids: [macroId],
          });
        } catch {
          // Best-effort cleanup
        }
      }
    },
  );

  server.tool(
    "foundry_get_compendium_index",
    "Get the index (lightweight listing) of entries in a compendium pack",
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
    "Get a full document entry from a compendium pack by ID",
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
    "Search entries in a compendium pack by name pattern and optional filters",
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
