import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema, embeddedDocumentTypeSchema } from "../types.js";
import { pickFields } from "../utils.js";

const parentTypeSchema = documentTypeSchema;
const embeddedTypeSchema = embeddedDocumentTypeSchema;

export function registerEmbeddedTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_list_embedded",
    "List embedded documents within a parent (e.g., Items on an Actor, Tokens on a Scene)",
    {
      parentType: parentTypeSchema.describe("Parent document type (e.g., Actor, Scene)"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type (e.g., Item, ActiveEffect, Token)"),
      fields: z
        .array(z.string())
        .optional()
        .describe('Fields to include. Default: ["_id", "name", "type"]'),
    },
    async ({ parentType, parentId, embeddedType, fields }) => {
      const response = await client.modifyDocument(embeddedType, "get", {
        query: {},
        parentUuid: `${parentType}.${parentId}`,
      });

      const docs = (response.result || []) as Record<string, unknown>[];
      const defaultFields = ["_id", "name", "type"];
      const selectedFields = fields && fields.length > 0 ? fields : defaultFields;

      const results = docs.map((d) => pickFields(d, selectedFields));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ total: results.length, documents: results }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "foundry_create_embedded",
    "Create an embedded document within a parent (e.g., add an Item to an Actor)",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      data: z.record(z.unknown()).describe("Embedded document data"),
    },
    async ({ parentType, parentId, embeddedType, data }) => {
      const response = await client.modifyDocument(embeddedType, "create", {
        data: [data],
        parentUuid: `${parentType}.${parentId}`,
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

  // === Batch operations ===

  server.tool(
    "foundry_create_embedded_batch",
    "Create multiple embedded documents in a single operation (e.g., batch-add Walls, Tiles, or Lights to a Scene). Much faster than individual creates.",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      data: z.array(z.record(z.unknown())).describe("Array of embedded document data objects"),
    },
    async ({ parentType, parentId, embeddedType, data }) => {
      const response = await client.modifyDocument(embeddedType, "create", {
        data,
        parentUuid: `${parentType}.${parentId}`,
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
    "foundry_update_embedded_batch",
    "Update multiple embedded documents in a single operation. Each object in the updates array must include _id.",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      updates: z.array(z.record(z.unknown())).describe("Array of update objects, each must include _id"),
    },
    async ({ parentType, parentId, embeddedType, updates }) => {
      for (const u of updates) {
        if (!u._id) throw new Error("Each update object must include an _id field");
      }
      const response = await client.modifyDocument(embeddedType, "update", {
        updates,
        parentUuid: `${parentType}.${parentId}`,
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
    "foundry_delete_embedded_batch",
    "Delete multiple embedded documents in a single operation.",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      ids: z.array(z.string()).describe("Array of embedded document _ids to delete"),
    },
    async ({ parentType, parentId, embeddedType, ids }) => {
      const response = await client.modifyDocument(embeddedType, "delete", {
        ids,
        parentUuid: `${parentType}.${parentId}`,
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
    "foundry_update_embedded",
    "Update an embedded document within a parent",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      id: z.string().describe("Embedded document _id"),
      updates: z.record(z.unknown()).describe("Partial update object"),
    },
    async ({ parentType, parentId, embeddedType, id, updates }) => {
      const response = await client.modifyDocument(embeddedType, "update", {
        updates: [{ _id: id, ...updates }],
        parentUuid: `${parentType}.${parentId}`,
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
    "foundry_delete_embedded",
    "Delete an embedded document from its parent",
    {
      parentType: parentTypeSchema.describe("Parent document type"),
      parentId: z.string().describe("Parent document _id"),
      embeddedType: embeddedTypeSchema.describe("Embedded document type"),
      id: z.string().describe("Embedded document _id to delete"),
    },
    async ({ parentType, parentId, embeddedType, id }) => {
      const response = await client.modifyDocument(embeddedType, "delete", {
        ids: [id],
        parentUuid: `${parentType}.${parentId}`,
      });

      const deleted = (response.result || [])[0];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted: true, id: deleted }, null, 2),
          },
        ],
      };
    },
  );
}
