import type { PublicRoom } from "@bgame/core";

export const PROTOCOL_VERSION = 1 as const;

export interface CommandMessage<Command = unknown> {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "command";
  readonly requestId: string;
  readonly expectedRevision?: number;
  readonly command: Command;
}

export interface PingMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "ping";
  readonly sentAt: number;
}

export type ClientMessage<Command = unknown> = CommandMessage<Command> | PingMessage;

export interface SnapshotMessage<View = unknown> {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "snapshot";
  readonly revision: number;
  readonly room: PublicRoom;
  readonly state: View;
}

export interface AckMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "ack";
  readonly requestId: string;
  readonly revision: number;
}

export interface ErrorMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId?: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface PongMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: "pong";
  readonly sentAt: number;
  readonly receivedAt: number;
}

export type ServerMessage<View = unknown> =
  | SnapshotMessage<View>
  | AckMessage
  | ErrorMessage
  | PongMessage;

export class ProtocolError extends Error {
  readonly code = "INVALID_PROTOCOL_MESSAGE";

  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function parseClientMessage(input: string): ClientMessage {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new ProtocolError("Message must be valid JSON");
  }

  if (!isObject(value)) throw new ProtocolError("Message must be a JSON object");
  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError(`Unsupported protocol version: ${String(value.version)}`);
  }

  if (value.type === "ping") {
    if (typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt)) {
      throw new ProtocolError("ping.sentAt must be a finite number");
    }
    return { version: PROTOCOL_VERSION, type: "ping", sentAt: value.sentAt };
  }

  if (value.type === "command") {
    if (
      typeof value.requestId !== "string" ||
      value.requestId.length < 1 ||
      value.requestId.length > 80
    ) {
      throw new ProtocolError("command.requestId is invalid");
    }
    if (value.expectedRevision !== undefined && !isRevision(value.expectedRevision)) {
      throw new ProtocolError("command.expectedRevision must be a non-negative integer");
    }
    if (!("command" in value)) throw new ProtocolError("command.command is required");

    return value.expectedRevision === undefined
      ? {
          version: PROTOCOL_VERSION,
          type: "command",
          requestId: value.requestId,
          command: value.command,
        }
      : {
          version: PROTOCOL_VERSION,
          type: "command",
          requestId: value.requestId,
          expectedRevision: value.expectedRevision,
          command: value.command,
        };
  }

  throw new ProtocolError(`Unknown message type: ${String(value.type)}`);
}

export const snapshotMessage = <View>(
  revision: number,
  room: PublicRoom,
  state: View,
): SnapshotMessage<View> => ({
  version: PROTOCOL_VERSION,
  type: "snapshot",
  revision,
  room,
  state,
});

export const ackMessage = (requestId: string, revision: number): AckMessage => ({
  version: PROTOCOL_VERSION,
  type: "ack",
  requestId,
  revision,
});

export const errorMessage = (
  code: string,
  message: string,
  retryable = false,
  requestId?: string,
): ErrorMessage =>
  requestId === undefined
    ? { version: PROTOCOL_VERSION, type: "error", code, message, retryable }
    : {
        version: PROTOCOL_VERSION,
        type: "error",
        requestId,
        code,
        message,
        retryable,
      };

export const pongMessage = (sentAt: number, receivedAt: number): PongMessage => ({
  version: PROTOCOL_VERSION,
  type: "pong",
  sentAt,
  receivedAt,
});
