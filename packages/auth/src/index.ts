import { asParticipantId, asRoomId, asSessionId } from "@bgame/core";
import type {
  ParticipantId,
  RoomId,
  SessionId,
  SessionPrincipal,
} from "@bgame/core";

const encoder = new TextEncoder();

const encodeBase64Url = (value: Uint8Array | string): string =>
  Buffer.from(typeof value === "string" ? encoder.encode(value) : value).toString(
    "base64url",
  );

const decodeBase64Url = (value: string): ArrayBuffer => {
  const bytes = Uint8Array.from(Buffer.from(value, "base64url"));
  return bytes.buffer as ArrayBuffer;
};

export interface SessionClaims extends SessionPrincipal {
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export class SessionSigner {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #key: Promise<CryptoKey>;

  constructor(
    secret: string,
    options: { readonly ttlMs?: number; readonly now?: () => number } = {},
  ) {
    if (secret.length < 16) {
      throw new Error("BGAME_SECRET must contain at least 16 characters");
    }
    this.#ttlMs = options.ttlMs ?? 1000 * 60 * 60 * 24 * 30;
    this.#now = options.now ?? Date.now;
    this.#key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  async issue(displayName: string): Promise<{ token: string; claims: SessionClaims }> {
    const normalizedName = normalizeDisplayName(displayName);
    const issuedAt = this.#now();
    const claims: SessionClaims = {
      id: asSessionId(crypto.randomUUID()),
      displayName: normalizedName,
      issuedAt,
      expiresAt: issuedAt + this.#ttlMs,
    };
    const payload = encodeBase64Url(JSON.stringify(claims));
    const signature = encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await this.#key,
          encoder.encode(payload),
        ),
      ),
    );
    return { token: `${payload}.${signature}`, claims };
  }

  async verify(token: string): Promise<SessionClaims | null> {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await this.#key,
      decodeBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;

    try {
      const parsed = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Partial<SessionClaims>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.displayName !== "string" ||
        typeof parsed.issuedAt !== "number" ||
        typeof parsed.expiresAt !== "number" ||
        parsed.expiresAt <= this.#now()
      ) {
        return null;
      }
      return {
        id: asSessionId(parsed.id),
        displayName: normalizeDisplayName(parsed.displayName),
        issuedAt: parsed.issuedAt,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return null;
    }
  }
}

export interface JoinTicketClaims {
  readonly roomId: RoomId;
  readonly participantId: ParticipantId;
  readonly sessionId: SessionId;
  readonly expiresAt: number;
}

export class JoinTicketStore {
  readonly #tickets = new Map<string, JoinTicketClaims>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { readonly ttlMs?: number; readonly now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? 30_000;
    this.#now = options.now ?? Date.now;
  }

  issue(input: Omit<JoinTicketClaims, "expiresAt">): string {
    this.prune();
    const ticket = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    this.#tickets.set(ticket, {
      roomId: asRoomId(input.roomId),
      participantId: asParticipantId(input.participantId),
      sessionId: asSessionId(input.sessionId),
      expiresAt: this.#now() + this.#ttlMs,
    });
    return ticket;
  }

  consume(ticket: string): JoinTicketClaims | null {
    const claims = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    if (!claims || claims.expiresAt <= this.#now()) return null;
    return claims;
  }

  prune(): void {
    const now = this.#now();
    for (const [ticket, claims] of this.#tickets) {
      if (claims.expiresAt <= now) this.#tickets.delete(ticket);
    }
  }
}

export const SESSION_COOKIE = "bgame_session";

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    cookies.set(
      part.slice(0, separator).trim(),
      decodeURIComponent(part.slice(separator + 1).trim()),
    );
  }
  return cookies;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 32) {
    throw new Error("Display name must contain between 1 and 32 characters");
  }
  return normalized;
}
