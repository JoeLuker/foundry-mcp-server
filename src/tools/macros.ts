import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse, errorResponse, getFirstResult } from "../utils.js";

export function registerMacroTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_execute_macro",
    "Execute a JavaScript macro in the Foundry VTT server context. Creates a temporary Macro document and executes it. Note: execution depends on Foundry v13 server-side macro support.",
    {
      script: z.string().describe("JavaScript code to execute in Foundry's context"),
      name: z
        .string()
        .optional()
        .default("MCP Macro")
        .describe("Name for the temporary macro"),
    },
    async ({ script, name }) => {
      const userId = client.userId;
      if (!userId) {
        return errorResponse("Not authenticated - no userId available");
      }

      // Step 1: Create a temporary script macro
      const createResponse = await client.modifyDocument("Macro", "create", {
        data: [
          {
            name: `_mcp_temp_${name}_${Date.now()}`,
            type: "script",
            command: script,
            author: userId,
          },
        ],
      });

      const macro = getFirstResult(createResponse);
      if (!macro?._id) {
        return errorResponse("Failed to create temporary macro");
      }

      const macroId = macro._id as string;

      try {
        // Step 2: Execute via ChatMessage with proper author
        const chatResponse = await client.modifyDocument("ChatMessage", "create", {
          data: [
            {
              content: `<script>game.macros.get("${macroId}")?.execute();</script>`,
              author: userId,
              type: 0,
            },
          ],
        });

        const chatResult = getFirstResult(chatResponse);

        return jsonResponse({
          executed: true,
          macroId,
          chatMessageId: chatResult?._id,
        });
      } catch (err) {
        // If chat execution fails, return the macro ID so it can be run manually
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({
          executed: false,
          macroId,
          error: message,
          hint: "Macro was created but execution via ChatMessage failed. Run it manually from the Foundry macro bar.",
        });
      } finally {
        // Step 3: Clean up - delete the temporary macro
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
}
