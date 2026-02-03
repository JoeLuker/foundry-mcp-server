/**
 * Shared test helpers for tool unit tests.
 *
 * Provides a mock McpServer that captures registered tools and lets tests
 * invoke their handlers directly, plus a mock FoundryClient whose methods
 * can be stubbed per-test with vi.fn().
 */
import { vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FoundryClient } from "./foundry-client.js";
import type { DocumentSocketResponse } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

/** The handler signature that McpServer.tool() receives. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

/** A registered tool captured by MockMcpServer. */
export interface RegisteredTool {
  name: string;
  description: string;
  schema: unknown;
  handler: ToolHandler;
}

// ── Mock McpServer ───────────────────────────────────────────────────

export function createMockServer(): McpServer & { tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();

  const server = {
    tools,
    tool(name: string, description: string, schema: unknown, handler: ToolHandler) {
      tools.set(name, { name, description, schema, handler });
    },
  } as unknown as McpServer & { tools: Map<string, RegisteredTool> };

  return server;
}

// ── Mock FoundryClient ───────────────────────────────────────────────

export function createMockClient(overrides: Partial<FoundryClient> = {}): FoundryClient {
  const client = {
    state: "ready" as const,
    worldInfo: { active: true, version: "13.0", world: "test-world" },
    userId: "user-gm-1",
    isReady: true,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    modifyDocument: vi.fn().mockResolvedValue({ result: [] }),
    emitSocket: vi.fn().mockResolvedValue({}),
    emitSocketArgs: vi.fn().mockResolvedValue({}),
    emitSocketRaw: vi.fn().mockResolvedValue(undefined),
    emitSocketCallback: vi.fn().mockResolvedValue({}),
    getActiveUsers: vi.fn().mockResolvedValue([]),
    uploadFile: vi.fn().mockResolvedValue({ path: "uploaded/file.png" }),
    executeMacroWithResult: vi.fn().mockResolvedValue({ success: true, data: {} }),
    ...overrides,
  } as unknown as FoundryClient;

  return client;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a DocumentSocketResponse with the given result array. */
export function mockResponse(result: Record<string, unknown>[]): DocumentSocketResponse {
  return {
    type: "test",
    action: "get",
    broadcast: false,
    operation: {},
    userId: "user-gm-1",
    result,
  };
}

/** Build a DocumentSocketResponse for delete (returns string IDs). */
export function mockDeleteResponse(ids: string[]): DocumentSocketResponse {
  return {
    type: "test",
    action: "delete",
    broadcast: false,
    operation: {},
    userId: "user-gm-1",
    result: ids as unknown as Record<string, unknown>[],
  };
}

/** Parse the JSON text from a tool response. */
export function parseResponse(response: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(response.content[0].text);
}

/** Invoke a registered tool by name. Throws if tool not found. */
export function invokeTool(
  server: ReturnType<typeof createMockServer>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = server.tools.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}
