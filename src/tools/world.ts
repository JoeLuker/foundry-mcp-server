import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse } from "../utils.js";

export function registerWorldTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_get_status",
    "Check if Foundry VTT is connected and get world metadata. Returns connection state, world name, game system ID (e.g., pf1, dnd5e), Foundry version, and active user count. Call this first to verify connectivity before using other tools.",
    {},
    async () => {
      try {
        await client.ensureConnected();
        const info = client.worldInfo;
        return jsonResponse({
          connected: true,
          state: client.state,
          ...info,
        });
      } catch (err) {
        return jsonResponse({
          connected: false,
          state: client.state,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
