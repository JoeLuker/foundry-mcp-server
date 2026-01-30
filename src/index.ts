#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FoundryClient } from "./foundry-client.js";
import { registerWorldTools } from "./tools/world.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerEmbeddedTools } from "./tools/embedded.js";
import { registerChatTools } from "./tools/chat.js";
import { registerUploadTools } from "./tools/uploads.js";
import type { FoundryConfig } from "./types.js";

const config: FoundryConfig = {
  url: process.env.FOUNDRY_URL || "http://localhost:30000",
  userId: process.env.FOUNDRY_USER_ID || "",
  password: process.env.FOUNDRY_PASSWORD || "",
};

if (!config.userId) {
  console.error(
    "Error: FOUNDRY_USER_ID environment variable is required.\n" +
      "Set it to the _id of a Foundry VTT user with Gamemaster role.",
  );
  process.exit(1);
}

const foundryClient = new FoundryClient(config);

const server = new McpServer({
  name: "foundry-vtt",
  version: "0.1.0",
});

// Register all tools
registerWorldTools(server, foundryClient);
registerDocumentTools(server, foundryClient);
registerEmbeddedTools(server, foundryClient);
registerChatTools(server, foundryClient);
registerUploadTools(server, foundryClient);

// Connect MCP transport
const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
const shutdown = async () => {
  await foundryClient.disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
