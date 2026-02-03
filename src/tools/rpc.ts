/**
 * MCP tools for the foundry-mcp-bridge RPC system.
 *
 * Provides `foundry_rpc` for executing methods in the browser game context,
 * and `foundry_rpc_ping` for checking bridge availability.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FoundryClient } from "../foundry-client.js";
import type { FoundryRpc } from "../rpc.js";
import { jsonResponse, errorResponse } from "../utils.js";

export function registerRpcTools(
  server: McpServer,
  _client: FoundryClient,
  rpc: FoundryRpc,
): void {
  server.tool(
    "foundry_rpc",
    "Execute a method in the Foundry VTT browser context via the foundry-mcp-bridge companion module. " +
      "Provides full access to game, canvas, UI, and installed module APIs — capabilities not available " +
      "through standard document tools. Built-in methods: 'eval' (arbitrary JS with top-level await), " +
      "'getCanvasDimensions', 'getTokensOnCanvas', 'rollFormula' (native Foundry Roll), 'fromUuid', " +
      "'getModuleApis', 'callModuleApi'. Requires a GM browser tab with the foundry-mcp-bridge module " +
      "active — use foundry_rpc_ping to check availability first.",
    {
      method: z.string().describe(
        "RPC method name. Built-in: 'eval' (arbitrary JS), 'getCanvasDimensions', " +
          "'getTokensOnCanvas', 'rollFormula', 'fromUuid', 'getModuleApis', 'callModuleApi'.",
      ),
      args: z
        .array(z.unknown())
        .optional()
        .default([])
        .describe(
          "Method arguments as an array. First element is the params object. " +
            "Examples: eval → [{script: 'return game.system.id'}], " +
            "rollFormula → [{formula: '2d6+3', flavor: 'Damage'}], " +
            "fromUuid → [{uuid: 'Actor.abc123'}], " +
            "callModuleApi → [{moduleId: 'my-module', method: 'doThing', args: [1, 2]}].",
        ),
      timeout: z
        .number()
        .optional()
        .default(15000)
        .describe(
          "Timeout in milliseconds (default 15000). Increase for long-running eval scripts.",
        ),
    },
    async ({ method, args, timeout }) => {
      try {
        const response = await rpc.call(method, args, timeout);

        if (response.success) {
          return jsonResponse({
            method,
            result: response.result,
            duration: response.duration,
          });
        } else {
          return errorResponse(
            `RPC method "${method}" failed: ${response.error}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(message);
      }
    },
  );

  server.tool(
    "foundry_rpc_ping",
    "Check if the foundry-mcp-bridge companion module is active and responding " +
      "in a GM's browser. Returns whether a GM client is connected and ready to " +
      "handle foundry_rpc calls. Use this to verify the bridge is available before " +
      "making RPC calls.",
    {},
    async () => {
      const result = await rpc.ping();
      return jsonResponse(result);
    },
  );
}
