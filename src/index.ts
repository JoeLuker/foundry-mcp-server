#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FoundryClient } from "./foundry-client.js";
import { registerWorldTools } from "./tools/world.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerEmbeddedTools } from "./tools/embedded.js";
import { registerChatTools } from "./tools/chat.js";
import { registerUploadTools } from "./tools/uploads.js";
import { registerMacroTools } from "./tools/macros.js";
import { registerCompendiumTools } from "./tools/compendiums.js";
import { registerSceneTools } from "./tools/scene.js";
import { registerCombatTools } from "./tools/combat.js";
import { registerGameTools } from "./tools/game.js";
import { registerConvenienceTools } from "./tools/convenience.js";
import { registerPresentationTools } from "./tools/presentation.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerLightingTools } from "./tools/lighting.js";
import { registerEffectTools } from "./tools/effects.js";
import { registerTableTools } from "./tools/tables.js";
import { registerResources } from "./resources.js";
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
  version: "0.7.0",
});

// Register all tools
registerWorldTools(server, foundryClient);
registerDocumentTools(server, foundryClient);
registerEmbeddedTools(server, foundryClient);
registerChatTools(server, foundryClient);
registerUploadTools(server, foundryClient);
registerMacroTools(server, foundryClient);
registerCompendiumTools(server, foundryClient);
registerSceneTools(server, foundryClient);
registerCombatTools(server, foundryClient);
registerGameTools(server, foundryClient);
registerConvenienceTools(server, foundryClient);
registerPresentationTools(server, foundryClient);
registerAdminTools(server, foundryClient);
registerTokenTools(server, foundryClient);
registerLightingTools(server, foundryClient);
registerEffectTools(server, foundryClient);
registerTableTools(server, foundryClient);

// Register MCP resources
registerResources(server, foundryClient);

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
