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

  get isReady(): boolean {
    return this._state === "ready" && this.socket?.connected === true;
  }

  async ensureConnected(): Promise<void> {
    if (this.isReady) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
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

  async modifyDocument(
    type: string,
    action: "get" | "create" | "update" | "delete",
    operation: Record<string, unknown>,
  ): Promise<DocumentSocketResponse> {
    await this.ensureConnected();

    const request: DocumentSocketRequest = { type, action, operation };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Foundry socket request timed out after 30s`));
      }, 30000);

      this.socket!.emit(
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
        // Socket.io will auto-reconnect if configured
        if (reason === "io server disconnect") {
          // Server kicked us - need to re-authenticate
          this.sessionId = null;
        }
      });

      this.socket.on("reconnect", () => {
        this._state = "ready";
      });
    });
  }
}
