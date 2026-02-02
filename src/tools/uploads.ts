import { z } from "zod";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FoundryClient } from "../foundry-client.js";

export function registerUploadTools(
  server: McpServer,
  client: FoundryClient,
): void {
  server.tool(
    "foundry_upload_file",
    "Upload a file to the Foundry VTT data directory. Accepts base64-encoded content or a local file path (more efficient for same-machine setups). Useful for scene backgrounds, token images, and other assets.",
    {
      fileName: z.string().describe("File name with extension (e.g., 'dungeon-map.svg')"),
      base64Content: z
        .string()
        .optional()
        .describe("Base64-encoded file content. Required if localPath is not provided."),
      localPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to a file on the local filesystem. More efficient than base64 for same-machine use.",
        ),
      mimeType: z
        .string()
        .default("image/svg+xml")
        .describe("MIME type of the file (e.g., 'image/svg+xml', 'image/png')"),
      targetPath: z
        .string()
        .optional()
        .describe(
          "Destination directory path within the Foundry data source (e.g., 'worlds/my-world/scenes'). Defaults to the active world's root directory.",
        ),
    },
    async ({ fileName, base64Content, localPath, mimeType, targetPath: targetPathArg }) => {
      if (!base64Content && !localPath) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Either base64Content or localPath must be provided",
              }),
            },
          ],
          isError: true,
        };
      }

      await client.ensureConnected();
      const worldName = client.worldInfo?.world ?? "default";
      const targetPath = targetPathArg ?? `worlds/${worldName}`;

      let nodeBuffer: Buffer;

      if (localPath) {
        nodeBuffer = await readFile(localPath);
      } else {
        nodeBuffer = Buffer.from(base64Content!, "base64");
      }

      const arrayBuffer = nodeBuffer.buffer.slice(
        nodeBuffer.byteOffset,
        nodeBuffer.byteOffset + nodeBuffer.byteLength,
      ) as ArrayBuffer;

      const result = await client.uploadFile(
        "data",
        targetPath,
        fileName,
        arrayBuffer,
        mimeType,
      );

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
                source: localPath ? "localPath" : "base64",
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
