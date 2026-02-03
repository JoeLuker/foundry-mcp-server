import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";
import { jsonResponse } from "../utils.js";

export function registerWorldTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_get_status",
    "Get Foundry VTT connection status, world info, system, and version",
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
