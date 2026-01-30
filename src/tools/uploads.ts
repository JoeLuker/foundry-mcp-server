import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

export function registerUploadTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_upload_file",
    "Upload a file to the Foundry VTT data directory. Useful for uploading images, maps, tokens, etc.",
    {
      fileName: z.string().describe("File name with extension (e.g., 'dungeon-map.svg')"),
      base64Content: z.string().describe("Base64-encoded file content"),
      mimeType: z
        .string()
        .default("image/svg+xml")
        .describe("MIME type of the file (e.g., 'image/svg+xml', 'image/png')"),
      targetPath: z
        .string()
        .default("worlds/scarred-frontier/scenes")
        .describe("Destination directory path within the Foundry data source (e.g., 'worlds/scarred-frontier/scenes')"),
    },
    async ({ fileName, base64Content, mimeType, targetPath }) => {
      const nodeBuffer = Buffer.from(base64Content, "base64");
      const arrayBuffer = nodeBuffer.buffer.slice(
        nodeBuffer.byteOffset,
        nodeBuffer.byteOffset + nodeBuffer.byteLength,
      ) as ArrayBuffer;
      const result = await client.uploadFile("data", targetPath, fileName, arrayBuffer, mimeType);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                uploaded: true,
                path: result.path,
                fileName,
                mimeType,
                sizeBytes: nodeBuffer.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
