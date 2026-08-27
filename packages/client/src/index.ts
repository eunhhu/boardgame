import type {
  ParticipantId,
  ParticipantRole,
  PublicRoom,
  RoomId,
  SessionId,
} from "@bgame/core";
import { PROTOCOL_VERSION } from "@bgame/protocol";
import type { ServerMessage } from "@bgame/protocol";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface GuestSession {
  readonly id: SessionId;
  readonly displayName: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface JoinedRoom<View = unknown> {
  readonly roomId: RoomId;
  readonly code: string;
  readonly participantId: ParticipantId;
  readonly snapshot: ClientSnapshot<View>;
}

export interface ClientSnapshot<View> {
  readonly revision: number;
  readonly room: PublicRoom;
  readonly state: View;
}

export interface ClientError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

type Listener<Value> = (value: Value) => void;

export class BgameClient<View, Command> {
  readonly #baseUrl: string;
  readonly #snapshotListeners = new Set<Listener<ClientSnapshot<View>>>();
  readonly #statusListeners = new Set<Listener<ConnectionStatus>>();
  readonly #errorListeners = new Set<Listener<ClientError>>();

  #socket: WebSocket | null = null;
  #roomId: RoomId | null = null;
  #revision = 0;
  #status: ConnectionStatus = "idle";
  #manualClose = false;
  #reconnectAttempt = 0;
  #generation = 0;

  constructor(baseUrl = globalThis.location?.origin ?? "http://localhost:3000") {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get revision(): number {
    return this.#revision;
  }

  onSnapshot(listener: Listener<ClientSnapshot<View>>): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  onStatus(listener: Listener<ConnectionStatus>): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  onError(listener: Listener<ClientError>): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  async session(): Promise<GuestSession | null> {
    const response = await this.#request<{ session: GuestSession | null }>(
      "/api/session",
    );
    return response.session;
  }

  async ensureSession(displayName: string): Promise<GuestSession> {
    const response = await this.#request<{ session: GuestSession }>(
      "/api/session",
      {
        method: "POST",
        body: JSON.stringify({ displayName }),
      },
    );
    return response.session;
  }

  async createRoom(): Promise<JoinedRoom<View>> {
    return this.#request<JoinedRoom<View>>("/api/rooms", { method: "POST" });
  }

  async joinRoom(
    code: string,
    role: ParticipantRole = "player",
  ): Promise<JoinedRoom<View>> {
    return this.#request<JoinedRoom<View>>(
      `/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`,
      {
        method: "POST",
        body: JSON.stringify({ role }),
      },
    );
  }

  async connect(room: Pick<JoinedRoom<View>, "roomId" | "participantId">): Promise<void> {
    this.#roomId = room.roomId;
    this.#manualClose = false;
    this.#reconnectAttempt = 0;
    const generation = ++this.#generation;
    await this.#openSocket(generation, false);
  }

  send(command: Command): string {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    const requestId = crypto.randomUUID();
    this.#socket.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "command",
        requestId,
        expectedRevision: this.#revision,
        command,
      }),
    );
    return requestId;
  }

  close(): void {
    this.#manualClose = true;
    this.#generation += 1;
    this.#socket?.close(1000, "Client closed");
    this.#socket = null;
    this.#setStatus("closed");
  }

  async #openSocket(generation: number, reconnecting: boolean): Promise<void> {
    const roomId = this.#roomId;
    if (!roomId || generation !== this.#generation) return;
    this.#setStatus(reconnecting ? "reconnecting" : "connecting");

    try {
      const { ticket } = await this.#request<{ ticket: string }>(
        `/api/rooms/${encodeURIComponent(roomId)}/ticket`,
        { method: "POST" },
      );
      if (generation !== this.#generation) return;

      const url = new URL(this.#baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws";
      url.search = new URLSearchParams({ ticket }).toString();
      const socket = new WebSocket(url);
      this.#socket = socket;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = globalThis.setTimeout(() => {
          if (settled) return;
          settled = true;
          socket.close();
          reject(new Error("WebSocket connection timed out"));
        }, 8_000);

        socket.addEventListener("open", () => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeout);
          this.#reconnectAttempt = 0;
          this.#setStatus("open");
          resolve();
        });

        socket.addEventListener("message", (event) => {
          this.#handleMessage(event.data);
        });

        socket.addEventListener("error", () => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        });

        socket.addEventListener("close", () => {
          globalThis.clearTimeout(timeout);
          if (generation !== this.#generation || this.#manualClose) return;
          void this.#scheduleReconnect(generation);
        });
      });
    } catch (error) {
      this.#emitError({
        code: "CONNECTION_FAILED",
        message: error instanceof Error ? error.message : "Connection failed",
        retryable: true,
      });
      if (!this.#manualClose && generation === this.#generation) {
        await this.#scheduleReconnect(generation);
      }
    }
  }

  async #scheduleReconnect(generation: number): Promise<void> {
    if (this.#manualClose || generation !== this.#generation) return;
    this.#setStatus("reconnecting");
    const delay = Math.min(10_000, 400 * 2 ** this.#reconnectAttempt);
    this.#reconnectAttempt += 1;
    await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    if (!this.#manualClose && generation === this.#generation) {
      await this.#openSocket(generation, true);
    }
  }

  #handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: ServerMessage<View>;
    try {
      message = JSON.parse(raw) as ServerMessage<View>;
    } catch {
      this.#emitError({
        code: "INVALID_SERVER_MESSAGE",
        message: "The server returned invalid JSON",
        retryable: false,
      });
      return;
    }

    if (message.version !== PROTOCOL_VERSION) {
      this.#emitError({
        code: "PROTOCOL_VERSION_MISMATCH",
        message: "Client and server protocol versions differ",
        retryable: false,
      });
      return;
    }

    if (message.type === "snapshot") {
      this.#revision = message.revision;
      const snapshot: ClientSnapshot<View> = {
        revision: message.revision,
        room: message.room,
        state: message.state,
      };
      for (const listener of this.#snapshotListeners) listener(snapshot);
      return;
    }

    if (message.type === "error") {
      this.#emitError({
        code: message.code,
        message: message.message,
        retryable: message.retryable,
      });
    }
  }

  async #request<Result>(path: string, init: RequestInit = {}): Promise<Result> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    });
    const value = (await response.json()) as unknown;
    if (!response.ok) {
      const record =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : {};
      const nested =
        typeof record.error === "object" && record.error !== null
          ? (record.error as Record<string, unknown>)
          : {};
      throw new Error(
        typeof nested.message === "string"
          ? nested.message
          : `Request failed with status ${response.status}`,
      );
    }
    return value as Result;
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  #emitError(error: ClientError): void {
    for (const listener of this.#errorListeners) listener(error);
  }
}
