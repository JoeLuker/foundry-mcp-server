import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, createMockClient, parseResponse, invokeTool } from "../test-helpers.js";
import { registerUploadTools } from "./uploads.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-file-content")),
}));

describe("upload tools", () => {
  const server = createMockServer();
  const client = createMockClient();
  registerUploadTools(server, client);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundry_upload_file", () => {
    it("uploads a file from base64 content", async () => {
      const base64 = Buffer.from("test-png-data").toString("base64");

      const result = await invokeTool(server, "foundry_upload_file", {
        fileName: "map.png",
        base64Content: base64,
        mimeType: "image/png",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.uploaded).toBe(true);
      expect(data.fileName).toBe("map.png");
      expect(data.source).toBe("base64");
      expect(data.path).toBe("uploaded/file.png");
      expect(client.uploadFile).toHaveBeenCalledWith(
        "data",
        "worlds/test-world",
        "map.png",
        expect.any(ArrayBuffer),
        "image/png",
      );
    });

    it("uploads from a local file path", async () => {
      const result = await invokeTool(server, "foundry_upload_file", {
        fileName: "token.svg",
        localPath: "/tmp/token.svg",
        mimeType: "image/svg+xml",
      });
      const data = parseResponse(result) as Record<string, unknown>;

      expect(data.uploaded).toBe(true);
      expect(data.source).toBe("localPath");
    });

    it("uses custom target path", async () => {
      await invokeTool(server, "foundry_upload_file", {
        fileName: "bg.webp",
        base64Content: Buffer.from("data").toString("base64"),
        mimeType: "image/webp",
        targetPath: "worlds/my-world/scenes",
      });

      expect(client.uploadFile).toHaveBeenCalledWith(
        "data",
        "worlds/my-world/scenes",
        "bg.webp",
        expect.any(ArrayBuffer),
        "image/webp",
      );
    });

    it("returns error when neither base64 nor localPath provided", async () => {
      const result = await invokeTool(server, "foundry_upload_file", {
        fileName: "test.png",
        mimeType: "image/png",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("base64Content or localPath");
    });
  });
});
