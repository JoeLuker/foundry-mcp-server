import { io, Socket } from "socket.io-client";
import type {
  FoundryConfig,
  WorldInfo,
  ConnectionState,
  DocumentSocketRequest,
  DocumentSocketResponse,
} from "./types.js";

export class FoundryClient {
  private socket: Socket | null = null;
  private sessionId: string | null = null;
  private _state: ConnectionState = "disconnected";
  private _worldInfo: WorldInfo | null = null;
  private _userId: string | null = null;
  private config: FoundryConfig;
  private connectPromise: Promise<void> | null = null;

  constructor(config: FoundryConfig) {
    this.config = config;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get worldInfo(): WorldInfo | null {
    return this._worldInfo;
  }

  get userId(): string | null {
    return this._userId;
  }

  get isReady(): boolean {
    return this._state === "ready" && this.socket?.connected === true;
  }

  async ensureConnected(): Promise<void> {
    if (this.isReady) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async connect(): Promise<void> {
    // Step 1: Check server status
    this._state = "authenticating";
    const status = await this.fetchStatus();
    this._worldInfo = status;

    if (!status.active) {
      this._state = "disconnected";
      throw new Error(
        "Foundry VTT has no active world. Please load a world first.",
      );
    }

    // Step 2: Authenticate via HTTP POST to /join
    const sessionId = await this.authenticate();
    this.sessionId = sessionId;

    // Step 3: Connect socket.io with session
    this._state = "connecting";
    await this.connectSocket();
    this._state = "ready";
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.sessionId = null;
    this._state = "disconnected";
  }

  async uploadFile(
    source: string,
    targetPath: string,
    fileName: string,
    fileContent: ArrayBuffer,
    mimeType: string,
  ): Promise<{ path: string }> {
    await this.ensureConnected();

    const file = new File([fileContent], fileName, { type: mimeType });
    const fd = new FormData();
    fd.set("source", source);
    fd.set("target", targetPath);
    fd.set("upload", file);

    const response = await fetch(`${this.config.url}/upload`, {
      method: "POST",
      headers: { cookie: `session=${this.sessionId!}` },
      body: fd,
    });

    if (!response.ok) {
      throw new Error(`Upload failed with HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      path?: string;
      message?: string;
      error?: string;
    };

    if (result.error) {
      throw new Error(`Upload error: ${result.error}`);
    }

    if (!result.path) {
      throw new Error("Upload succeeded but no path returned");
    }

    return { path: result.path };
  }

  /**
   * Execute a JavaScript script in Foundry's game context via a temporary macro,
   * returning parsed results via a ChatMessage workaround.
   *
   * The script MUST create a ChatMessage whose content starts with `resultPrefix`
   * followed by JSON data. This method polls for that message, parses it, and
   * cleans up the temporary macro and result message.
   */
  async executeMacroWithResult(
    script: string,
    resultPrefix: string,
    timeoutMs = 6000,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    await this.ensureConnected();

    const userId = this._userId;
    if (!userId) {
      return { success: false, error: "Not authenticated — no userId available" };
    }

    const macroName = `_mcp_${Date.now()}`;

    // Step 1: Create temp macro
    const createResponse = await this.modifyDocument("Macro", "create", {
      data: [
        {
          name: macroName,
          type: "script",
          command: script,
          author: userId,
        },
      ],
    });

    const macro = (createResponse.result || [])[0] as Record<string, unknown>;
    if (!macro?._id) {
      return { success: false, error: "Failed to create temporary macro" };
    }

    const macroId = macro._id as string;

    try {
      // Step 2: Execute via ChatMessage script tag
      await this.modifyDocument("ChatMessage", "create", {
        data: [
          {
            content: `<script>game.macros.get("${macroId}")?.execute();</script>`,
            author: userId,
            type: 0,
          },
        ],
      });

      // Step 3: Poll for result message
      const POLL_INTERVAL_MS = 500;
      const maxAttempts = Math.ceil(timeoutMs / POLL_INTERVAL_MS);
      let resultMsg: Record<string, unknown> | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const chatResponse = await this.modifyDocument("ChatMessage", "get", {
          query: {},
        });

        const messages = (chatResponse.result || []) as Record<string, unknown>[];
        resultMsg = messages
          .reverse()
          .find((m) => {
            const content = m.content as string | undefined;
            return content?.startsWith(resultPrefix);
          });

        if (resultMsg) break;
      }

      if (!resultMsg) {
        return {
          success: false,
          error:
            "Macro execution timed out. This requires a connected browser client to execute macros.",
        };
      }

      // Parse result
      const content = resultMsg.content as string;
      const jsonStr = content.slice(resultPrefix.length);
      const data = JSON.parse(jsonStr);

      // Cleanup result message
      try {
        await this.modifyDocument("ChatMessage", "delete", {
          ids: [resultMsg._id as string],
        });
      } catch {
        // Best-effort cleanup
      }

      return { success: true, data };
    } finally {
      // Cleanup temp macro
      try {
        await this.modifyDocument("Macro", "delete", { ids: [macroId] });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /**
   * Emit a generic socket event with a callback response.
   * Used for non-modifyDocument events (e.g., manageCompendium).
   * Retries once on timeout/disconnect errors (same as modifyDocument).
   */
  async emitSocket(
    event: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureConnected();

    try {
      return await this._emitSocket(event, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("timed out") ||
        message.includes("disconnected") ||
        message.includes("Not connected") ||
        !this.socket?.connected
      ) {
        this._state = "disconnected";
        this.sessionId = null;
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
        await this.ensureConnected();
        return await this._emitSocket(event, data);
      }
      throw err;
    }
  }

  /**
   * Emit a socket event with multiple arguments followed by a callback.
   * Used for events like "manageFiles" where the server handler signature is
   * (data, options, callback) — i.e., more than one arg before the callback.
   * Retries once on timeout/disconnect errors.
   */
  async emitSocketArgs(
    event: string,
    ...args: unknown[]
  ): Promise<unknown> {
    await this.ensureConnected();

    try {
      return await this._emitSocketArgs(event, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("timed out") ||
        message.includes("disconnected") ||
        message.includes("Not connected") ||
        !this.socket?.connected
      ) {
        this._state = "disconnected";
        this.sessionId = null;
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
        await this.ensureConnected();
        return await this._emitSocketArgs(event, args);
      }
      throw err;
    }
  }

  private _emitSocketArgs(
    event: string,
    args: unknown[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("Not connected to Foundry VTT"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Foundry socket request "${event}" timed out after 30s`));
      }, 30000);

      this.socket.emit(event, ...args, (response: unknown) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  /**
   * Emit a socket event with arbitrary arguments (no callback expected).
   * Used for fire-and-forget events like "pause" where the server broadcasts
   * but doesn't respond via callback.
   */
  async emitSocketRaw(
    event: string,
    ...args: unknown[]
  ): Promise<void> {
    await this.ensureConnected();
    if (!this.socket?.connected) {
      throw new Error("Not connected to Foundry VTT");
    }
    this.socket.emit(event, ...args);
  }

  /**
   * Get active user activity data from Foundry's server.
   * Emits "getUserActivity" and collects the "userActivity" events the server
   * sends back for each active user.
   */
  async getActiveUsers(): Promise<
    { userId: string; activity: Record<string, unknown> }[]
  > {
    await this.ensureConnected();
    if (!this.socket?.connected) {
      throw new Error("Not connected to Foundry VTT");
    }

    const users: { userId: string; activity: Record<string, unknown> }[] = [];

    return new Promise((resolve) => {
      const handler = (userId: string, activity: Record<string, unknown>) => {
        users.push({ userId, activity });
      };

      this.socket!.on("userActivity", handler);
      this.socket!.emit("getUserActivity");

      // The server responds synchronously by emitting userActivity events
      // for each active user. Give a short window to collect them all.
      setTimeout(() => {
        this.socket?.off("userActivity", handler);
        resolve(users);
      }, 500);
    });
  }

  private _emitSocket(
    event: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("Not connected to Foundry VTT"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Foundry socket request "${event}" timed out after 30s`));
      }, 30000);

      this.socket.emit(event, data, (response: unknown) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  /**
   * Register a persistent listener for module socket events.
   * Used by the RPC bridge to receive responses from the browser module.
   */
  onModuleMessage(
    moduleName: string,
    handler: (data: unknown) => void,
  ): void {
    if (!this.socket) {
      throw new Error("Not connected to Foundry VTT");
    }
    this.socket.on(`module.${moduleName}`, handler);
  }

  /**
   * Remove a listener for module socket events.
   */
  offModuleMessage(
    moduleName: string,
    handler: (data: unknown) => void,
  ): void {
    this.socket?.off(`module.${moduleName}`, handler);
  }

  /**
   * Emit a message to a Foundry module's socket channel.
   * This broadcasts to all connected clients (browser modules).
   */
  async emitModuleMessage(
    moduleName: string,
    data: unknown,
  ): Promise<void> {
    await this.ensureConnected();
    if (!this.socket?.connected) {
      throw new Error("Not connected to Foundry VTT");
    }
    this.socket.emit(`module.${moduleName}`, data);
  }

  /**
   * Emit a socket event with only a callback (no data argument).
   * Used for events like "world" and "sizeInfo" where the server handler
   * receives just the callback function as the first argument.
   */
  async emitSocketCallback(
    event: string,
    timeoutMs = 60000,
  ): Promise<unknown> {
    await this.ensureConnected();
    if (!this.socket?.connected) {
      throw new Error("Not connected to Foundry VTT");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Foundry socket request "${event}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.socket!.emit(event, (response: unknown) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  async modifyDocument(
    type: string,
    action: "get" | "create" | "update" | "delete",
    operation: Record<string, unknown>,
  ): Promise<DocumentSocketResponse> {
    await this.ensureConnected();

    try {
      return await this._emitModifyDocument(type, action, operation);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Retry once on disconnect-related errors
      if (
        message.includes("timed out") ||
        message.includes("disconnected") ||
        message.includes("Not connected") ||
        !this.socket?.connected
      ) {
        // Force full reconnection
        this._state = "disconnected";
        this.sessionId = null;
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
        await this.ensureConnected();
        return await this._emitModifyDocument(type, action, operation);
      }
      throw err;
    }
  }

  private _emitModifyDocument(
    type: string,
    action: "get" | "create" | "update" | "delete",
    operation: Record<string, unknown>,
  ): Promise<DocumentSocketResponse> {
    const request: DocumentSocketRequest = { type, action, operation };
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("Not connected to Foundry VTT"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Foundry socket request timed out after 30s`));
      }, 30000);

      this.socket.emit(
        "modifyDocument",
        request,
        (response: DocumentSocketResponse) => {
          clearTimeout(timeout);
          if (response.error) {
            reject(
              new Error(response.error.message || "Unknown Foundry error"),
            );
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  private async fetchStatus(): Promise<WorldInfo> {
    const response = await fetch(`${this.config.url}/api/status`);
    if (!response.ok) {
      throw new Error(
        `Foundry VTT is not reachable at ${this.config.url} (HTTP ${response.status})`,
      );
    }
    return (await response.json()) as WorldInfo;
  }

  private async authenticate(): Promise<string> {
    // POST to /join to authenticate and get a session cookie
    const response = await fetch(`${this.config.url}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "join",
        userid: this.config.userId,
        password: this.config.password,
      }).toString(),
      redirect: "manual",
    });

    // Extract session cookie from Set-Cookie header
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) {
      // Check if the response body has an error message
      const body = await response.text();
      throw new Error(
        `Authentication failed: no session cookie returned. Response: ${body}`,
      );
    }

    const sessionMatch = setCookie.match(/session=([^;]+)/);
    if (!sessionMatch) {
      throw new Error(
        `Authentication failed: session cookie not found in: ${setCookie}`,
      );
    }

    return sessionMatch[1];
  }

  private connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Socket.io connection timed out after 10s"));
      }, 10000);

      this.socket = io(this.config.url, {
        query: { session: this.sessionId! },
        extraHeaders: { cookie: `session=${this.sessionId!}` },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
      });

      this.socket.on("session", (data: { sessionId: string; userId: string } | null) => {
        clearTimeout(timeout);
        if (!data || !data.userId) {
          this.socket?.disconnect();
          reject(
            new Error(
              "Foundry rejected the session. Check FOUNDRY_USER_ID and ensure the world is loaded.",
            ),
          );
          return;
        }
        this._userId = data.userId;
        resolve();
      });

      this.socket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Socket.io connection failed: ${err.message}`));
      });

      this.socket.on("disconnect", (reason: string) => {
        this._state = "disconnected";
        // Server kicked us - need to re-authenticate
        if (reason === "io server disconnect") {
          this.sessionId = null;
        }
      });

      this.socket.on("reconnect", () => {
        // Don't blindly set ready — wait for session event to confirm
        const sessionTimeout = setTimeout(() => {
          this._state = "disconnected";
          this.sessionId = null;
        }, 5000);

        this.socket!.once(
          "session",
          (data: { sessionId: string; userId: string } | null) => {
            clearTimeout(sessionTimeout);
            if (data && data.userId) {
              this._userId = data.userId;
              this._state = "ready";
            } else {
              this._state = "disconnected";
              this.sessionId = null;
            }
          },
        );
      });
    });
  }
}
