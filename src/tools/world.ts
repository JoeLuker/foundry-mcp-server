import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

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
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  connected: true,
                  state: client.state,
                  ...info,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  connected: false,
                  state: client.state,
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}
