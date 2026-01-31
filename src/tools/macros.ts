import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

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

      const macro = (createResponse.result || [])[0] as Record<string, unknown>;
      if (!macro?._id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Failed to create temporary macro" }),
            },
          ],
          isError: true,
        };
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

        const chatResult = (chatResponse.result || [])[0] as Record<string, unknown>;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  executed: true,
                  macroId,
                  chatMessageId: chatResult?._id,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        // If chat execution fails, return the macro ID so it can be run manually
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  executed: false,
                  macroId,
                  error: message,
                  hint: "Macro was created but execution via ChatMessage failed. Run it manually from the Foundry macro bar.",
                },
                null,
                2,
              ),
            },
          ],
        };
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
