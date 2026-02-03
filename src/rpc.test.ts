/**
 * Unit tests for the FoundryRpc class.
 *
 * Tests the request/response correlation, timeout handling,
 * duplicate response handling, and ping mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FoundryRpc } from "./rpc.js";
import { createMockClient } from "./test-helpers.js";
import type { FoundryClient } from "./foundry-client.js";

// Helper: capture the handler registered via onModuleMessage
function captureHandler(client: FoundryClient) {
  const calls = (client.onModuleMessage as ReturnType<typeof vi.fn>).mock.calls;
  // Find the handler registered for "foundry-mcp-bridge"
  const call = calls.find((c) => c[0] === "foundry-mcp-bridge");
  return call?.[1] as ((data: unknown) => void) | undefined;
}

describe("FoundryRpc", () => {
  let client: FoundryClient;
  let rpc: FoundryRpc;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    rpc = new FoundryRpc(client);
  });

  afterEach(() => {
    rpc.destroy();
    vi.useRealTimers();
  });

  it("should send an RPC request and resolve on response", async () => {
    // Intercept emitModuleMessage to capture the request and simulate a response
    let sentRequest: Record<string, unknown> | null = null;
    (client.emitModuleMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_module: string, data: unknown) => {
        sentRequest = data as Record<string, unknown>;
        // Simulate async response from browser module
        queueMicrotask(() => {
          const handler = captureHandler(client);
          handler?.({
            type: "rpc-response",
            requestId: sentRequest!.requestId,
            success: true,
            result: { systemId: "pf1" },
            duration: 42,
          });
        });
      },
    );

    const responsePromise = rpc.call("eval", [{ script: "return game.system.id" }]);
    // Flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    const response = await responsePromise;

    expect(response.success).toBe(true);
    expect(response.result).toEqual({ systemId: "pf1" });
    expect(response.duration).toBe(42);
    expect(sentRequest).toMatchObject({
      type: "rpc-request",
      method: "eval",
      args: [{ script: "return game.system.id" }],
    });
  });

  it("should reject with timeout when no response arrives", async () => {
    const responsePromise = rpc.call("eval", [{ script: "slow" }], 5000);
    // Attach catch handler early to prevent unhandled rejection warning
    const caught = responsePromise.catch((e) => e);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(5001);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/timed out after 5000ms/);
  });

  it("should ignore duplicate responses for the same requestId", async () => {
    let sentRequestId: string | null = null;
    (client.emitModuleMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_module: string, data: unknown) => {
        sentRequestId = (data as Record<string, unknown>).requestId as string;
        // Simulate two responses (from multiple GM browsers)
        queueMicrotask(() => {
          const handler = captureHandler(client);
          handler?.({
            type: "rpc-response",
            requestId: sentRequestId,
            success: true,
            result: "first",
            duration: 10,
          });
          handler?.({
            type: "rpc-response",
            requestId: sentRequestId,
            success: true,
            result: "second",
            duration: 20,
          });
        });
      },
    );

    const responsePromise = rpc.call("ping", []);
    await vi.advanceTimersByTimeAsync(0);

    const response = await responsePromise;
    // Should get the first response, second is silently dropped
    expect(response.result).toBe("first");
  });

  it("should ignore responses with unknown requestIds", async () => {
    let realRequestId: string | null = null;
    (client.emitModuleMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_module: string, data: unknown) => {
        realRequestId = (data as Record<string, unknown>).requestId as string;
        queueMicrotask(() => {
          const handler = captureHandler(client);
          // Send a response with a bogus requestId — should be ignored
          handler?.({
            type: "rpc-response",
            requestId: "unknown-id",
            success: true,
            result: "stray",
          });
          // Then send the real response so the test doesn't time out
          handler?.({
            type: "rpc-response",
            requestId: realRequestId,
            success: true,
            result: "real",
            duration: 5,
          });
        });
      },
    );

    const responsePromise = rpc.call("eval", [{ script: "test" }], 1000);
    await vi.advanceTimersByTimeAsync(0);

    // The stray response was ignored, the real response was accepted
    const response = await responsePromise;
    expect(response.result).toBe("real");
  });

  it("should reject on emitModuleMessage failure", async () => {
    vi.useRealTimers();

    const localClient = createMockClient();
    const localRpc = new FoundryRpc(localClient);

    (localClient.emitModuleMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Not connected to Foundry VTT"),
    );

    await expect(localRpc.call("eval", [{ script: "test" }], 5000))
      .rejects.toThrow("Not connected to Foundry VTT");

    localRpc.destroy();
    vi.useFakeTimers();
  });

  it("should resolve ping with alive:true when pong arrives", async () => {
    (client.emitModuleMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_module: string, data: unknown) => {
        const ping = data as Record<string, unknown>;
        queueMicrotask(() => {
          // Find the pong handler (separate from the main RPC handler)
          const calls = (client.onModuleMessage as ReturnType<typeof vi.fn>).mock.calls;
          const pongCall = calls.find(
            (c) => c[0] === "foundry-mcp-bridge" && c !== calls[0],
          );
          const pongHandler = (pongCall ?? calls[calls.length - 1])?.[1] as
            | ((data: unknown) => void)
            | undefined;
          pongHandler?.({
            type: "rpc-pong",
            requestId: ping.requestId,
            moduleVersion: "0.1.0",
            userId: "gm-user-1",
          });
        });
      },
    );

    const pingPromise = rpc.ping(5000);
    await vi.advanceTimersByTimeAsync(0);

    const result = await pingPromise;
    expect(result).toEqual({
      alive: true,
      moduleVersion: "0.1.0",
      userId: "gm-user-1",
    });
  });

  it("should resolve ping with alive:false on timeout", async () => {
    const pingPromise = rpc.ping(2000);
    await vi.advanceTimersByTimeAsync(2001);

    const result = await pingPromise;
    expect(result).toEqual({ alive: false });
  });

  it("should reject all pending requests on destroy", async () => {
    // Use a fresh rpc instance so afterEach destroy doesn't double-reject
    const localClient = createMockClient();
    const localRpc = new FoundryRpc(localClient);

    const p1 = localRpc.call("method1", [], 30000);
    const p2 = localRpc.call("method2", [], 30000);

    // Flush microtasks so ensureConnected() resolves and pending entries are registered
    await vi.advanceTimersByTimeAsync(0);

    localRpc.destroy();

    await expect(p1).rejects.toThrow("RPC system shutting down");
    await expect(p2).rejects.toThrow("RPC system shutting down");
  });
});
