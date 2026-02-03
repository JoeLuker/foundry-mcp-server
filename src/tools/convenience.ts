import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { documentTypeSchema } from "../types.js";
import { jsonResponse, errorResponse, getResults, getFirstResult } from "../utils.js";

export function registerConvenienceTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_create_journal",
    "Create a journal entry with one or more pages in a single operation. Supports text (HTML), image, PDF, and video page types.",
    {
      name: z.string().describe("Journal entry name"),
      folder: z.string().optional().describe("Folder _id to place journal in"),
      pages: z
        .array(
          z.object({
            name: z.string().describe("Page title"),
            type: z
              .enum(["text", "image", "pdf", "video"])
              .optional()
              .default("text")
              .describe("Page type (default: text)"),
            text: z
              .object({
                content: z.string().optional().describe("HTML content"),
                format: z
                  .number()
                  .optional()
                  .default(1)
                  .describe("Format: 1=HTML (default), 2=Markdown"),
              })
              .optional()
              .describe("Text content (for text pages)"),
            src: z
              .string()
              .optional()
              .describe("Source path for image/pdf/video pages"),
          }),
        )
        .min(1)
        .describe("Pages to create"),
    },
    async ({ name, folder, pages }) => {
      // Step 1: Create the journal entry
      const journalData: Record<string, unknown> = { name };
      if (folder) journalData.folder = folder;

      const journalResponse = await client.modifyDocument(
        "JournalEntry",
        "create",
        { data: [journalData] },
      );

      const journal = getFirstResult(journalResponse);
      if (!journal?._id) {
        return errorResponse("Failed to create journal entry");
      }

      const journalId = journal._id as string;

      // Step 2: Create pages as embedded documents
      const pageData = pages.map((p, i) => {
        const page: Record<string, unknown> = {
          name: p.name,
          type: p.type || "text",
          sort: (i + 1) * 100000,
        };
        if (p.text) page.text = p.text;
        if (p.src) page.src = p.src;
        return page;
      });

      const pagesResponse = await client.modifyDocument(
        "JournalEntryPage",
        "create",
        {
          data: pageData,
          parentUuid: `JournalEntry.${journalId}`,
        },
      );

      const createdPages = getResults(pagesResponse);
      const pageIds = createdPages.map((p) => p._id);

      return jsonResponse({
        journalId,
        journalName: name,
        pagesCreated: pageIds.length,
        pageIds,
      });
    },
  );

  server.tool(
    "foundry_import_from_compendium",
    "Import a document from a compendium pack into the world. Creates a new world document with the compendium entry's data.",
    {
      packId: z
        .string()
        .describe(
          'Compendium pack ID (e.g., "pf1.spells", "pf1.bestiary-1")',
        ),
      documentType: documentTypeSchema.describe(
        "Document type in the pack (e.g., Item, Actor)",
      ),
      entryId: z.string().describe("Document _id within the compendium pack"),
      folder: z
        .string()
        .optional()
        .describe("Target folder _id in world"),
      updates: z
        .record(z.unknown())
        .optional()
        .describe(
          "Field overrides to apply during import (e.g., {name: 'Custom Name'})",
        ),
    },
    async ({ packId, documentType, entryId, folder, updates }) => {
      // Step 1: Fetch from compendium
      const packResponse = await client.modifyDocument(documentType, "get", {
        query: { _id: entryId },
        pack: packId,
      });

      const docs = getResults(packResponse);
      const doc = docs[0];

      if (!doc) {
        return errorResponse(`Entry "${entryId}" not found in pack "${packId}"`);
      }

      // Step 2: Prepare for world import
      const importData = { ...doc };
      delete importData._id; // Will get new ID in world
      if (folder) importData.folder = folder;
      if (updates) Object.assign(importData, updates);

      // Step 3: Create in world
      const createResponse = await client.modifyDocument(
        documentType,
        "create",
        { data: [importData] },
      );

      const created = getFirstResult(createResponse);

      return jsonResponse({
        imported: true,
        worldId: created?._id,
        packId,
        originalId: entryId,
        name: created?.name ?? doc.name,
      });
    },
  );

  server.tool(
    "foundry_modify_actor_hp",
    "Apply damage or healing to an actor's HP. Positive values heal, negative values deal damage. Clamps to 0-max range. Works with PF1e and D&D 5e (system.attributes.hp).",
    {
      actorId: z.string().describe("Actor _id"),
      amount: z
        .number()
        .describe(
          "HP change: positive for healing, negative for damage (e.g., -15 for 15 damage, 10 for 10 healing)",
        ),
      temp: z
        .boolean()
        .optional()
        .default(false)
        .describe("Apply to temporary HP instead of regular HP"),
    },
    async ({ actorId, amount, temp }) => {
      // Fetch actor
      const getResponse = await client.modifyDocument("Actor", "get", {
        query: { _id: actorId },
      });

      const actors = getResults(getResponse);
      const actor = actors.find((a) => a._id === actorId);

      if (!actor) {
        return errorResponse(`Actor with id "${actorId}" not found`);
      }

      // Navigate to HP data (works for PF1e and D&D 5e)
      const system = actor.system as Record<string, unknown> | undefined;
      const attributes = system?.attributes as
        | Record<string, unknown>
        | undefined;
      const hp = attributes?.hp as Record<string, unknown> | undefined;

      if (!hp) {
        return errorResponse(
          `Could not find HP data at system.attributes.hp for actor "${actor.name}". This actor's game system may use a different HP path.`,
        );
      }

      const field = temp ? "temp" : "value";
      const currentValue = (hp[field] as number) ?? 0;
      const maxHp = (hp.max as number) ?? currentValue;

      let newValue: number;
      if (temp) {
        // Temp HP: floor at 0, no max cap
        newValue = Math.max(0, currentValue + amount);
      } else {
        // Regular HP: clamp between 0 and max
        newValue = Math.max(0, Math.min(maxHp, currentValue + amount));
      }

      await client.modifyDocument("Actor", "update", {
        updates: [
          { _id: actorId, [`system.attributes.hp.${field}`]: newValue },
        ],
      });

      return jsonResponse({
        actorId,
        actorName: actor.name,
        field: `system.attributes.hp.${field}`,
        previousHp: currentValue,
        newHp: newValue,
        maxHp,
        change: amount,
      });
    },
  );
}
