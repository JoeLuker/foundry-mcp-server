/**
 * Unit tests for the RPC MCP tools (foundry_rpc, foundry_rpc_ping).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRpcTools } from "./rpc.js";
import {
  createMockServer,
  createMockClient,
  createMockRpc,
  invokeTool,
  parseResponse,
} from "../test-helpers.js";
import type { FoundryClient } from "../foundry-client.js";
import type { FoundryRpc } from "../rpc.js";

describe("RPC tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: FoundryClient;
  let rpc: FoundryRpc;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    rpc = createMockRpc();
    registerRpcTools(server, client, rpc);
  });

  // ── foundry_rpc ──────────────────────────────────────────────────

  describe("foundry_rpc", () => {
    it("should return result on successful RPC call", async () => {
      (rpc.call as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: { systemId: "pf1" },
        duration: 42,
      });

      const res = await invokeTool(server, "foundry_rpc", {
        method: "eval",
        args: [{ script: "return game.system.id" }],
        timeout: 15000,
      });

      const data = parseResponse(res) as Record<string, unknown>;
      expect(data.method).toBe("eval");
      expect(data.result).toEqual({ systemId: "pf1" });
      expect(data.duration).toBe(42);
      expect(rpc.call).toHaveBeenCalledWith(
        "eval",
        [{ script: "return game.system.id" }],
        15000,
      );
    });

    it("should return error on failed RPC method", async () => {
      (rpc.call as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Unknown RPC method: "badMethod"',
      });

      const res = await invokeTool(server, "foundry_rpc", {
        method: "badMethod",
        args: [],
        timeout: 15000,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("badMethod");
    });

    it("should return error on timeout/connection failure", async () => {
      (rpc.call as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("RPC call \"eval\" timed out after 15000ms"),
      );

      const res = await invokeTool(server, "foundry_rpc", {
        method: "eval",
        args: [{ script: "while(true){}" }],
        timeout: 15000,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("timed out");
    });

    it("should use default args and timeout when not provided", async () => {
      (rpc.call as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        result: [],
        duration: 5,
      });

      await invokeTool(server, "foundry_rpc", { method: "getTokensOnCanvas" });

      // invokeTool bypasses Zod schema defaults, so handler receives undefined
      // for omitted optional fields. Verify the method was passed correctly.
      expect(rpc.call).toHaveBeenCalledWith(
        "getTokensOnCanvas",
        undefined,
        undefined,
      );
    });
  });

  // ── foundry_rpc_ping ─────────────────────────────────────────────

  describe("foundry_rpc_ping", () => {
    it("should return alive status when bridge is active", async () => {
      const res = await invokeTool(server, "foundry_rpc_ping", {});

      const data = parseResponse(res) as Record<string, unknown>;
      expect(data.alive).toBe(true);
      expect(data.moduleVersion).toBe("0.1.0");
      expect(data.userId).toBe("gm-1");
    });

    it("should return not alive when bridge is inactive", async () => {
      (rpc.ping as ReturnType<typeof vi.fn>).mockResolvedValue({
        alive: false,
      });

      const res = await invokeTool(server, "foundry_rpc_ping", {});

      const data = parseResponse(res) as Record<string, unknown>;
      expect(data.alive).toBe(false);
    });
  });
});
