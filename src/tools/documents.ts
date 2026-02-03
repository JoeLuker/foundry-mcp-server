import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema } from "../types.js";
import { jsonResponse, errorResponse, getResults, getFirstResult, pickFields, filterByName, splitFilters, applyClientFilters } from "../utils.js";

export function registerDocumentTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_list_documents",
    "Primary way to browse world content. List documents of a given type from the Foundry VTT world. Returns summaries by default. Use fields param with dot-notation to access nested system data (e.g., 'system.attributes.hp.value' for PF1e actor HP). Supports pagination and filtering by sub-type and folder.",
    {
      documentType: documentTypeSchema.describe(
        "Document type (Actor, Item, Scene, JournalEntry, Macro, RollTable, etc.)",
      ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include. Default: ["_id", "name", "type", "folder"]. Dot-notation for nested: "system.attributes.hp.value", "system.details.cr", "system.details.level.value", "prototypeToken.texture.src".',
        ),
      type: z
        .string()
        .optional()
        .describe(
          'Filter by sub-type (e.g., "npc" or "character" for actors, "weapon" or "spell" for items)',
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
      // Push filters to server-side query
      const query: Record<string, unknown> = {};
      if (type) query.type = type;
      if (folder) query.folder = folder;

      const response = await client.modifyDocument(documentType, "get", {
        query,
      });

      let docs = getResults(response);

      // Paginate
      const total = docs.length;
      docs = docs.slice(offset, offset + limit);

      // Pick fields
      const defaultFields = ["_id", "name", "type", "folder"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return jsonResponse({ total, count: results.length, offset, documents: results });
    },
  );

  server.tool(
    "foundry_get_document",
    "Get a single document by type and ID. Returns the complete document including all system-specific data by default, or use fields param to select specific fields with dot-notation (e.g., 'system.attributes.hp').",
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

      const docs = getResults(response);
      const doc = docs.find((d) => d._id === id);

      if (!doc) {
        return errorResponse(`${documentType} with id "${id}" not found`);
      }

      const result =
        fields && fields.length > 0 ? pickFields(doc, fields) : doc;

      return jsonResponse(result);
    },
  );

  server.tool(
    "foundry_search_documents",
    "Search documents by name pattern (regex or substring) and optional field filters. Use this when you know part of a name — more targeted than foundry_list_documents. Supports dot-notation filters for nested system data.",
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
      // Split filters: top-level keys go to server, dot-notation stays client-side
      const { serverQuery, clientFilters } = filters
        ? splitFilters(filters)
        : { serverQuery: {}, clientFilters: {} };

      const response = await client.modifyDocument(documentType, "get", {
        query: serverQuery,
      });

      let docs = getResults(response);

      // Filter by name (client-side only -- Foundry query doesn't support regex)
      if (namePattern) {
        docs = filterByName(docs, namePattern);
      }

      // Apply remaining client-side filters (dot-notation nested fields)
      docs = applyClientFilters(docs, clientFilters);

      // Limit
      const total = docs.length;
      docs = docs.slice(0, limit);

      // Pick fields
      const defaultFields = ["_id", "name", "type", "folder"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;
      const results = docs.map((d) => pickFields(d, selectedFields));

      return jsonResponse({ total, count: results.length, documents: results });
    },
  );

  // === Batch operations ===

  server.tool(
    "foundry_create_document_batch",
    "Create multiple documents in a single operation (max 100).",
    {
      documentType: documentTypeSchema.describe("Document type"),
      data: z
        .array(z.record(z.unknown()))
        .max(100)
        .describe("Array of document data objects (max 100). Each must include 'name' at minimum."),
    },
    async ({ documentType, data }) => {
      const response = await client.modifyDocument(documentType, "create", {
        data,
      });

      const results = getResults(response);
      const ids = results.map((r) => r._id);
      return jsonResponse({ created: ids.length, ids });
    },
  );

  server.tool(
    "foundry_update_document_batch",
    "Update multiple documents in a single operation (max 100). Each object in the updates array must include _id.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      updates: z
        .array(z.record(z.unknown()))
        .max(100)
        .describe("Array of update objects (max 100), each must include _id"),
    },
    async ({ documentType, updates }) => {
      for (const u of updates) {
        if (!u._id) throw new Error("Each update object must include an _id field");
      }
      const response = await client.modifyDocument(documentType, "update", {
        updates,
      });

      const results = getResults(response);
      const ids = results.map((r) => r._id);
      return jsonResponse({ updated: ids.length, ids });
    },
  );

  server.tool(
    "foundry_delete_document_batch",
    "Delete multiple documents in a single operation (max 100).",
    {
      documentType: documentTypeSchema.describe("Document type"),
      ids: z.array(z.string()).max(100).describe("Array of document _ids to delete (max 100)"),
    },
    async ({ documentType, ids }) => {
      const response = await client.modifyDocument(documentType, "delete", {
        ids,
      });

      const results = (response.result || []) as string[];
      return jsonResponse({ deleted: results.length, ids: results });
    },
  );

  // === Single-item operations ===

  server.tool(
    "foundry_create_document",
    "Create a new document in the Foundry VTT world. Common patterns: Actor ({name, type:'npc'}), Item ({name, type:'weapon'}), Folder ({name, type:'Actor', parent:null}). Must include 'name' at minimum. Can include 'type', 'folder', and system-specific data.",
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

      const created = getFirstResult(response);
      return jsonResponse(created);
    },
  );

  server.tool(
    "foundry_update_document",
    "Update an existing document with partial data. Examples: rename ({name:'New Name'}), move to folder ({folder:'id'}), change HP ({'system.attributes.hp.value': 25}), set user role ({role:4}). Supports dot-notation for nested system fields.",
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

      const updated = getFirstResult(response);
      return jsonResponse(updated);
    },
  );

  server.tool(
    "foundry_delete_document",
    "Delete a document from the Foundry VTT world by type and ID. This is permanent and cannot be undone.",
    {
      documentType: documentTypeSchema.describe("Document type"),
      id: z.string().describe("Document _id to delete"),
    },
    async ({ documentType, id }) => {
      const response = await client.modifyDocument(documentType, "delete", {
        ids: [id],
      });

      const deleted = (response.result || [])[0];
      return jsonResponse({ deleted: true, id: deleted });
    },
  );
}
