import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { DOCUMENT_TYPES } from "../types.js";

const documentTypeSchema = z.enum(DOCUMENT_TYPES);

function pickFields(
  doc: Record<string, unknown>,
  fields?: string[],
): Record<string, unknown> {
  if (!fields || fields.length === 0) return doc;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.includes(".")) {
      // Support dot-notation access for nested fields
      const parts = field.split(".");
      let value: unknown = doc;
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          value = undefined;
          break;
        }
      }
      result[field] = value;
    } else {
      result[field] = doc[field];
    }
  }
  return result;
}

export function registerDocumentTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_list_documents",
    "List documents of a given type from the Foundry VTT world. Returns summaries by default.",
    {
      documentType: documentTypeSchema.describe(
        "Document type (Actor, Item, Scene, JournalEntry, etc.)",
      ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include. Default: ["_id", "name", "type", "folder"]. Use dot-notation for nested fields.',
        ),
      type: z
        .string()
        .optional()
        .describe(
          'Filter by sub-type (e.g., "npc" for actors, "weapon" for items)',
        ),
      folder: z.string().optional().describe("Filter by folder ID"),
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
    async ({ documentType, fields, type, folder, limit, offset }) => {
      const response = await client.modifyDocument(documentType, "get", {
        query: {},
      });

      let docs = (response.result || []) as Record<string, unknown>[];

      // Apply filters
      if (type) {
        docs = docs.filter((d) => d.type === type);
      }
      if (folder) {
        docs = docs.filter((d) => d.folder === folder);
      }

      // Paginate
      const total = docs.length;
      docs = docs.slice(offset, offset + limit);

      // Pick fields
      const defaultFields = ["_id", "name", "type", "folder"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total, count: results.length, offset, documents: results }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_get_document",
    "Get a single document by type and ID with full data",
    {
      documentType: documentTypeSchema.describe("Document type"),
      id: z.string().describe("Document _id"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Fields to return. Default: all fields."),
    },
    async ({ documentType, id, fields }) => {
      const response = await client.modifyDocument(documentType, "get", {
        query: { _id: id },
      });

      const docs = (response.result || []) as Record<string, unknown>[];
      const doc = docs.find((d) => d._id === id);

      if (!doc) {
        return {
          content: [
            {
              type: "text" as const,
              text: `${documentType} with id "${id}" not found`,
            },
          ],
          isError: true,
        };
      }

      const result =
        fields && fields.length > 0 ? pickFields(doc, fields) : doc;

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
    "foundry_search_documents",
    "Search documents by name pattern and optional field filters",
    {
      documentType: documentTypeSchema.describe("Document type"),
      namePattern: z
        .string()
        .optional()
        .describe("Substring or regex pattern to match against document name"),
      filters: z
        .record(z.unknown())
        .optional()
        .describe(
          'Key-value field filters using dot-notation (e.g., {"type": "npc", "system.details.cr": 5})',
        ),
      fields: z.array(z.string()).optional().describe("Fields to return"),
      limit: z.number().min(1).max(200).optional().default(20),
    },
    async ({ documentType, namePattern, filters, fields, limit }) => {
      const response = await client.modifyDocument(documentType, "get", {
        query: {},
      });

      let docs = (response.result || []) as Record<string, unknown>[];

      // Filter by name
      if (namePattern) {
        try {
          const regex = new RegExp(namePattern, "i");
          docs = docs.filter((d) => typeof d.name === "string" && regex.test(d.name));
        } catch {
          // Fall back to substring match
          const lower = namePattern.toLowerCase();
          docs = docs.filter(
            (d) =>
              typeof d.name === "string" &&
              d.name.toLowerCase().includes(lower),
          );
        }
      }

      // Apply field filters
      if (filters) {
        docs = docs.filter((d) => {
          for (const [key, expected] of Object.entries(filters)) {
            let value: unknown = d;
            for (const part of key.split(".")) {
              if (value && typeof value === "object" && part in value) {
                value = (value as Record<string, unknown>)[part];
              } else {
                value = undefined;
                break;
              }
            }
            if (value !== expected) return false;
          }
          return true;
        });
      }

      // Limit
      const total = docs.length;
      docs = docs.slice(0, limit);

      // Pick fields
      const defaultFields = ["_id", "name", "type", "folder"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total, count: results.length, documents: results }, null, 2),
          },
        ],
      };
    },
  );

  // === Batch operations ===

  server.tool(
    "foundry_create_document_batch",
    "Create multiple documents in a single operation.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      data: z
        .array(z.record(z.unknown()))
        .describe("Array of document data objects. Each must include 'name' at minimum."),
    },
    async ({ documentType, data }) => {
      const response = await client.modifyDocument(documentType, "create", {
        data,
      });

      const results = (response.result || []) as Record<string, unknown>[];
      const ids = results.map((r) => r._id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ created: ids.length, ids }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_update_document_batch",
    "Update multiple documents in a single operation. Each object in the updates array must include _id.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      updates: z
        .array(z.record(z.unknown()))
        .describe("Array of update objects, each must include _id"),
    },
    async ({ documentType, updates }) => {
      for (const u of updates) {
        if (!u._id) throw new Error("Each update object must include an _id field");
      }
      const response = await client.modifyDocument(documentType, "update", {
        updates,
      });

      const results = (response.result || []) as Record<string, unknown>[];
      const ids = results.map((r) => r._id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ updated: ids.length, ids }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_delete_document_batch",
    "Delete multiple documents in a single operation.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      ids: z.array(z.string()).describe("Array of document _ids to delete"),
    },
    async ({ documentType, ids }) => {
      const response = await client.modifyDocument(documentType, "delete", {
        ids,
      });

      const results = (response.result || []) as string[];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted: results.length, ids: results }, null, 2),
          },
        ],
      };
    },
  );

  // === Single-item operations ===

  server.tool(
    "foundry_create_document",
    "Create a new document in the Foundry VTT world",
    {
      documentType: documentTypeSchema.describe("Document type"),
      data: z
        .record(z.unknown())
        .describe(
          "Document data. Must include 'name' at minimum. Can include 'type', 'folder', and system-specific data.",
        ),
    },
    async ({ documentType, data }) => {
      const response = await client.modifyDocument(documentType, "create", {
        data: [data],
      });

      const created = (response.result || [])[0];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(created, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_update_document",
    "Update an existing document with partial data. Uses dot-notation for nested fields.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      id: z.string().describe("Document _id"),
      updates: z
        .record(z.unknown())
        .describe(
          'Partial update object. Use dot-notation for nested fields (e.g., {"system.attributes.hp.value": 25})',
        ),
    },
    async ({ documentType, id, updates }) => {
      const response = await client.modifyDocument(documentType, "update", {
        updates: [{ _id: id, ...updates }],
      });

      const updated = (response.result || [])[0];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(updated, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_delete_document",
    "Delete a document from the Foundry VTT world",
    {
      documentType: documentTypeSchema.describe("Document type"),
      id: z.string().describe("Document _id to delete"),
    },
    async ({ documentType, id }) => {
      const response = await client.modifyDocument(documentType, "delete", {
        ids: [id],
      });

      const deleted = (response.result || [])[0];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { deleted: true, id: deleted },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
