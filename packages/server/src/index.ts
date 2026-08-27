import {
  JoinTicketStore,
  SESSION_COOKIE,
  SessionSigner,
  parseCookies,
  sessionCookie,
} from "@bgame/auth";
import { asRoomId } from "@bgame/core";
import type {
  GameDefinition,
  ParticipantId,
  ParticipantRole,
  RoomId,
  SessionPrincipal,
} from "@bgame/core";
import {
  PROTOCOL_VERSION,
  ProtocolError,
  ackMessage,
  errorMessage,
  parseClientMessage,
  pongMessage,
  snapshotMessage,
} from "@bgame/protocol";
import { RoomDirectory, RoomError } from "@bgame/room";

interface SocketData {
  readonly roomId: RoomId;
  readonly participantId: ParticipantId;
  readonly sessionId: SessionPrincipal["id"];
}

export interface BoardgameServerOptions<State, Command, Event, View> {
  readonly game: GameDefinition<State, Command, Event, View>;
  readonly clientEntry: string;
  readonly port?: number;
  readonly hostname?: string;
  readonly secret?: string;
  readonly production?: boolean;
  readonly directory?: RoomDirectory<State, Command, Event, View>;
}

const json = (value: unknown, status = 200, extra?: HeadersInit): Response => {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (extra) {
    for (const [name, headerValue] of new Headers(extra)) {
      headers.set(name, headerValue);
    }
  }
  return new Response(JSON.stringify(value), { status, headers });
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 32_768) {
    throw new Error("Request body is too large");
  }
  const value = (await request.json()) as unknown;
  if (!isObject(value)) throw new Error("Request body must be a JSON object");
  return value;
}

const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
};

const roomStatus = (error: RoomError): number => {
  switch (error.code) {
    case "ROOM_NOT_FOUND":
      return 404;
    case "NOT_A_PARTICIPANT":
    case "NOT_A_PLAYER":
      return 403;
    case "ROOM_FULL":
    case "REVISION_CONFLICT":
    case "JOIN_REJECTED":
      return 409;
    case "INVALID_COMMAND":
      return 400;
  }
};

const errorResponse = (error: unknown, production: boolean): Response => {
  if (error instanceof RoomError) {
    return json(
      { error: { code: error.code, message: error.message, retryable: error.retryable } },
      roomStatus(error),
    );
  }
  return json(
    {
      error: {
        code: "BAD_REQUEST",
        message:
          production || !(error instanceof Error)
            ? "The server could not process the request"
            : error.message,
        retryable: false,
      },
    },
    400,
  );
};

async function bundleClient(entrypoint: string, production: boolean): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "esm",
    minify: production,
    sourcemap: production ? "none" : "inline",
  });
  if (!result.success || result.outputs.length === 0) {
    throw new Error(
      `Browser bundle failed:\n${result.logs.map((log) => String(log)).join("\n")}`,
    );
  }
  return result.outputs[0]!.text();
}

export function portFromArgs(args = Bun.argv.slice(2), fallback = 3000): number {
  const index = args.indexOf("--port");
  const raw = index >= 0 ? args[index + 1] : Bun.env.PORT;
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid port: ${String(raw)}`);
  }
  return value;
}

export async function createBoardgameServer<State, Command, Event, View>(
  options: BoardgameServerOptions<State, Command, Event, View>,
) {
  const production = options.production ?? Bun.env.NODE_ENV === "production";
  const fallbackSecret = "boardgame-development-secret-change-me";
  const secret = options.secret ?? Bun.env.BGAME_SECRET ?? fallbackSecret;
  if (production && secret === fallbackSecret) {
    throw new Error("BGAME_SECRET is required in production");
  }

  const signer = new SessionSigner(secret);
  const tickets = new JoinTicketStore();
  const directory =
    options.directory ?? new RoomDirectory<State, Command, Event, View>();
  const bundle = await bundleClient(options.clientEntry, production);
  const subscriptions = new WeakMap<object, () => void>();

  const sessionFromRequest = async (request: Request) => {
    const token = parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE);
    return token ? signer.verify(token) : null;
  };

  const requireSession = async (request: Request) => {
    const session = await sessionFromRequest(request);
    if (!session) {
      throw new RoomError("NOT_A_PARTICIPANT", "A guest session is required");
    }
    return session;
  };

  const requireRoom = (roomId: string) => {
    const room = directory.get(asRoomId(roomId));
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "Room not found");
    return room;
  };

  const server = Bun.serve<SocketData>({
    port: options.port ?? 3000,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    async fetch(request, bunServer) {
      const url = new URL(request.url);

      if (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        !sameOrigin(request)
      ) {
        return json(
          {
            error: {
              code: "ORIGIN_REJECTED",
              message: "Cross-origin request rejected",
            },
          },
          403,
        );
      }

      if (url.pathname === "/health") {
        return json({ ok: true, game: options.game.id, protocol: PROTOCOL_VERSION });
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return json({ session: await sessionFromRequest(request) });
      }

      if (url.pathname === "/api/session" && request.method === "POST") {
        try {
          const existing = await sessionFromRequest(request);
          if (existing) return json({ session: existing });
          const body = await readJson(request);
          if (typeof body.displayName !== "string") {
            throw new Error("displayName is required");
          }
          const issued = await signer.issue(body.displayName);
          const maxAge = Math.floor((issued.claims.expiresAt - Date.now()) / 1000);
          return json(
            { session: issued.claims },
            201,
            {
              "set-cookie": sessionCookie(issued.token, maxAge, production),
            },
          );
        } catch (error) {
          return errorResponse(error, production);
        }
      }

      if (url.pathname === "/api/rooms" && request.method === "POST") {
        try {
          const session = await requireSession(request);
          const room = directory.create(options.game);
          const participant = await room.join(session, "player");
          return json(
            {
              roomId: room.id,
              code: room.code,
              participantId: participant.id,
              snapshot: room.snapshotFor(participant.id),
            },
            201,
          );
        } catch (error) {
          return errorResponse(error, production);
        }
      }

      const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
      if (joinMatch && request.method === "POST") {
        try {
          const session = await requireSession(request);
          const body = await readJson(request);
          const role: ParticipantRole =
            body.role === "spectator" ? "spectator" : "player";
          const room = directory.getByCode(decodeURIComponent(joinMatch[1]!));
          if (!room) throw new RoomError("ROOM_NOT_FOUND", "Room code not found");
          const participant = await room.join(session, role);
          return json({
            roomId: room.id,
            code: room.code,
            participantId: participant.id,
            snapshot: room.snapshotFor(participant.id),
          });
        } catch (error) {
          return errorResponse(error, production);
        }
      }

      const ticketMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ticket$/);
      if (ticketMatch && request.method === "POST") {
        try {
          const session = await requireSession(request);
          const room = requireRoom(decodeURIComponent(ticketMatch[1]!));
          const participant = room.participantForSession(session.id);
          if (!participant) {
            throw new RoomError(
              "NOT_A_PARTICIPANT",
              "Join the room before requesting a socket ticket",
            );
          }
          const ticket = tickets.issue({
            roomId: room.id,
            participantId: participant.id,
            sessionId: session.id,
          });
          return json({ ticket, expiresInMs: 30_000 });
        } catch (error) {
          return errorResponse(error, production);
        }
      }

      if (url.pathname === "/ws") {
        if (!sameOrigin(request)) {
          return new Response("Cross-origin WebSocket rejected", { status: 403 });
        }
        const ticket = url.searchParams.get("ticket");
        const claims = ticket ? tickets.consume(ticket) : null;
        if (!claims) return new Response("Invalid or expired ticket", { status: 401 });
        const room = directory.get(claims.roomId);
        const participant = room?.participant(claims.participantId);
        if (!room || !participant || participant.sessionId !== claims.sessionId) {
          return new Response("Ticket does not match an active participant", {
            status: 403,
          });
        }
        const upgraded = bunServer.upgrade(request, { data: claims });
        return upgraded
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/app.js") {
        return new Response(bundle, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": production ? "public, max-age=3600" : "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${options.game.title}</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
              "content-security-policy":
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }

      return json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404);
    },
    websocket: {
      open(socket) {
        const room = directory.get(socket.data.roomId);
        if (!room) {
          socket.close(4404, "Room not found");
          return;
        }
        const unsubscribe = room.subscribe(
          socket.data.participantId,
          (snapshot) => {
            socket.send(
              JSON.stringify(
                snapshotMessage(snapshot.revision, snapshot.room, snapshot.state),
              ),
            );
          },
        );
        subscriptions.set(socket as object, unsubscribe);
        void room.setConnected(socket.data.participantId, true);
      },
      async message(socket, rawMessage) {
        const room = directory.get(socket.data.roomId);
        if (!room) {
          socket.send(
            JSON.stringify(errorMessage("ROOM_NOT_FOUND", "Room no longer exists")),
          );
          return;
        }
        let requestId: string | undefined;
        try {
          const message = parseClientMessage(rawMessage.toString());
          if (message.type === "ping") {
            socket.send(JSON.stringify(pongMessage(message.sentAt, Date.now())));
            return;
          }
          requestId = message.requestId;
          const result = await room.dispatch(
            socket.data.participantId,
            message.command as Command,
            message.expectedRevision,
          );
          socket.send(JSON.stringify(ackMessage(message.requestId, result.revision)));
        } catch (error) {
          const code =
            error instanceof RoomError
              ? error.code
              : error instanceof ProtocolError
                ? error.code
                : "INTERNAL_ERROR";
          const message =
            production || !(error instanceof Error)
              ? "The command could not be processed"
              : error.message;
          const retryable = error instanceof RoomError ? error.retryable : false;
          socket.send(JSON.stringify(errorMessage(code, message, retryable, requestId)));
        }
      },
      close(socket) {
        subscriptions.get(socket as object)?.();
        subscriptions.delete(socket as object);
        const room = directory.get(socket.data.roomId);
        if (room) void room.setConnected(socket.data.participantId, false);
      },
    },
  });

  return { server, directory };
}
