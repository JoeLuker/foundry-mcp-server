/**
 * Bidirectional RPC layer for communicating with the foundry-mcp-bridge
 * browser module via Foundry VTT's module socket channel.
 *
 * Sends requests on "module.foundry-mcp-bridge" and correlates responses
 * by requestId. First-response-wins when multiple GM browsers are open.
 */

import { randomUUID } from "crypto";
import type { FoundryClient } from "./foundry-client.js";

const MODULE_NAME = "foundry-mcp-bridge";

// ── Protocol types ───────────────────────────────────────────────────

export interface RpcRequest {
  type: "rpc-request";
  requestId: string;
  method: string;
  args: unknown[];
}

export interface RpcResponse {
  type: "rpc-response";
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration?: number;
}

interface RpcPing {
  type: "rpc-ping";
  requestId: string;
}

export interface RpcPong {
  type: "rpc-pong";
  requestId: string;
  moduleVersion: string;
  userId: string;
}

interface PendingRequest {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── RPC Client ───────────────────────────────────────────────────────

export class FoundryRpc {
  private client: FoundryClient;
  private pending = new Map<string, PendingRequest>();
  private listenerAttached = false;
  private messageHandler: ((data: unknown) => void) | null = null;

  constructor(client: FoundryClient) {
    this.client = client;
  }

  /**
   * Attach the socket listener lazily on first RPC call.
   * Must be called after the client is connected.
   */
  private ensureListener(): void {
    if (this.listenerAttached) return;

    this.messageHandler = (data: unknown) => {
      this.handleMessage(data);
    };
    this.client.onModuleMessage(MODULE_NAME, this.messageHandler);
    this.listenerAttached = true;
  }

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    if (msg.type === "rpc-response") {
      const response = msg as unknown as RpcResponse;
      const pending = this.pending.get(response.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(response.requestId);
        pending.resolve(response);
      }
      // Duplicate responses (from multiple GM browsers) are silently ignored.
    }
  }

  /**
   * Send an RPC request to the browser module and wait for a response.
   */
  async call(
    method: string,
    args: unknown[] = [],
    timeoutMs = 15000,
  ): Promise<RpcResponse> {
    await this.client.ensureConnected();
    this.ensureListener();

    const requestId = randomUUID();

    const request: RpcRequest = {
      type: "rpc-request",
      requestId,
      method,
      args,
    };

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `RPC call "${method}" timed out after ${timeoutMs}ms. ` +
              `Ensure a GM user has the foundry-mcp-bridge module active in a browser.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      this.client.emitModuleMessage(MODULE_NAME, request).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      });
    });
  }

  /**
   * Ping the bridge module to check if any browser GM client is listening.
   * Returns { alive: true, moduleVersion, userId } on success,
   * or { alive: false } on timeout.
   */
  async ping(
    timeoutMs = 5000,
  ): Promise<{ alive: boolean; moduleVersion?: string; userId?: string }> {
    try {
      await this.client.ensureConnected();

      const requestId = randomUUID();

      return await new Promise((resolve) => {
        const pongHandler = (data: unknown) => {
          if (!data || typeof data !== "object") return;
          const msg = data as Record<string, unknown>;
          if (msg.type === "rpc-pong" && msg.requestId === requestId) {
            clearTimeout(timer);
            this.client.offModuleMessage(MODULE_NAME, pongHandler);
            resolve({
              alive: true,
              moduleVersion: msg.moduleVersion as string,
              userId: msg.userId as string,
            });
          }
        };

        const timer = setTimeout(() => {
          this.client.offModuleMessage(MODULE_NAME, pongHandler);
          resolve({ alive: false });
        }, timeoutMs);

        this.client.onModuleMessage(MODULE_NAME, pongHandler);

        const ping: RpcPing = { type: "rpc-ping", requestId };
        this.client.emitModuleMessage(MODULE_NAME, ping).catch(() => {
          clearTimeout(timer);
          this.client.offModuleMessage(MODULE_NAME, pongHandler);
          resolve({ alive: false });
        });
      });
    } catch {
      return { alive: false };
    }
  }

  /**
   * Clean up all pending requests. Call on shutdown.
   */
  destroy(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("RPC system shutting down"));
    }
    this.pending.clear();

    if (this.messageHandler) {
      this.client.offModuleMessage(MODULE_NAME, this.messageHandler);
      this.messageHandler = null;
      this.listenerAttached = false;
    }
  }
}
