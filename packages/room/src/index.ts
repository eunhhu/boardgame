import {
  CryptoRandom,
  asParticipantId,
  asRoomId,
  toPublicParticipant,
} from "@bgame/core";
import type {
  GameDefinition,
  Participant,
  ParticipantId,
  ParticipantRole,
  PublicRoom,
  RandomSource,
  RoomId,
  SessionPrincipal,
} from "@bgame/core";

export type RoomLifecycleEvent =
  | { readonly type: "participant.joined"; readonly participant: Participant }
  | { readonly type: "participant.left"; readonly participantId: ParticipantId };

export type StoredRoomEvent<Event> =
  | { readonly scope: "room"; readonly event: RoomLifecycleEvent }
  | { readonly scope: "game"; readonly event: Event };

export interface RoomEventBatch<Event> {
  readonly roomId: RoomId;
  readonly revision: number;
  readonly at: number;
  readonly actorId: ParticipantId | null;
  readonly entries: readonly StoredRoomEvent<Event>[];
}

export interface RoomEventStore<Event> {
  append(batch: RoomEventBatch<Event>): Promise<void>;
  read(roomId: RoomId): Promise<readonly RoomEventBatch<Event>[]>;
}

export class InMemoryRoomEventStore<Event> implements RoomEventStore<Event> {
  readonly #batches = new Map<RoomId, RoomEventBatch<Event>[]>();

  async append(batch: RoomEventBatch<Event>): Promise<void> {
    const existing = this.#batches.get(batch.roomId) ?? [];
    const expectedRevision = (existing.at(-1)?.revision ?? 0) + 1;
    if (batch.revision !== expectedRevision) {
      throw new Error(
        `Event store expected revision ${expectedRevision}, received ${batch.revision}`,
      );
    }
    existing.push(structuredClone(batch));
    this.#batches.set(batch.roomId, existing);
  }

  async read(roomId: RoomId): Promise<readonly RoomEventBatch<Event>[]> {
    return structuredClone(this.#batches.get(roomId) ?? []);
  }
}

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_A_PARTICIPANT"
  | "NOT_A_PLAYER"
  | "REVISION_CONFLICT"
  | "INVALID_COMMAND"
  | "JOIN_REJECTED";

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

export interface RoomSnapshot<View> {
  readonly revision: number;
  readonly room: PublicRoom;
  readonly state: View;
}

export interface RoomDispatchResult<Event> {
  readonly revision: number;
  readonly events: readonly Event[];
}

export interface RoomActorOptions<State, Command, Event, View> {
  readonly id: RoomId;
  readonly code: string;
  readonly game: GameDefinition<State, Command, Event, View>;
  readonly store?: RoomEventStore<Event>;
  readonly random?: RandomSource;
  readonly now?: () => number;
}

export class RoomActor<State, Command, Event, View> {
  readonly id: RoomId;
  readonly code: string;
  readonly game: GameDefinition<State, Command, Event, View>;
  readonly createdAt: number;

  readonly #store: RoomEventStore<Event>;
  readonly #random: RandomSource;
  readonly #now: () => number;
  readonly #subscribers = new Map<
    ParticipantId,
    Set<(snapshot: RoomSnapshot<View>) => void>
  >();

  #state: State;
  #participants = new Map<ParticipantId, Participant>();
  #hostId: ParticipantId | null = null;
  #revision = 0;
  #tail: Promise<void> = Promise.resolve();
  #lastActivityAt: number;

  constructor(options: RoomActorOptions<State, Command, Event, View>) {
    this.id = options.id;
    this.code = options.code;
    this.game = options.game;
    this.#store = options.store ?? new InMemoryRoomEventStore<Event>();
    this.#random = options.random ?? new CryptoRandom();
    this.#now = options.now ?? Date.now;
    this.createdAt = this.#now();
    this.#lastActivityAt = this.createdAt;
    this.#state = this.game.create({
      roomId: this.id,
      now: this.createdAt,
      random: this.#random,
    });
  }

  get revision(): number {
    return this.#revision;
  }

  get lastActivityAt(): number {
    return this.#lastActivityAt;
  }

  publicRoom(): PublicRoom {
    return this.#makePublicRoom(this.#participants, this.#hostId);
  }

  participant(participantId: ParticipantId): Participant | null {
    return this.#participants.get(participantId) ?? null;
  }

  participantForSession(sessionId: SessionPrincipal["id"]): Participant | null {
    return (
      [...this.#participants.values()].find(
        (participant) => participant.sessionId === sessionId,
      ) ?? null
    );
  }

  async join(
    session: SessionPrincipal,
    role: ParticipantRole = "player",
  ): Promise<Participant> {
    return this.#enqueue(async () => {
      const existing = this.participantForSession(session.id);
      if (existing) {
        if (!existing.connected) {
          const resumed = { ...existing, connected: true };
          this.#participants.set(existing.id, resumed);
          this.#touchAndBroadcast();
          return resumed;
        }
        return existing;
      }

      const playerCount = [...this.#participants.values()].filter(
        (participant) => participant.role === "player",
      ).length;
      if (role === "player" && playerCount >= this.game.maxPlayers) {
        throw new RoomError("ROOM_FULL", "The room has no available player seats");
      }

      const now = this.#now();
      const participant: Participant = {
        id: asParticipantId(crypto.randomUUID()),
        sessionId: session.id,
        displayName: session.displayName,
        role,
        joinedAt: now,
        connected: true,
      };
      const nextParticipants = new Map(this.#participants);
      nextParticipants.set(participant.id, participant);
      const nextHostId = this.#hostId ?? (role === "player" ? participant.id : null);
      const room = this.#makePublicRoom(nextParticipants, nextHostId);

      try {
        this.game.validateJoin?.({ state: this.#state, session, role, room });
      } catch (error) {
        throw new RoomError(
          "JOIN_REJECTED",
          error instanceof Error ? error.message : "The game rejected this join",
        );
      }

      const gameEvents =
        (await this.game.participantJoined?.({
          state: this.#state,
          participant,
          room,
          now,
          random: this.#random,
        })) ?? [];
      const nextState = this.#evolveMany(this.#state, gameEvents);
      const revision = this.#revision + 1;
      await this.#store.append({
        roomId: this.id,
        revision,
        at: now,
        actorId: participant.id,
        entries: [
          { scope: "room", event: { type: "participant.joined", participant } },
          ...gameEvents.map(
            (event): StoredRoomEvent<Event> => ({ scope: "game", event }),
          ),
        ],
      });

      this.#participants = nextParticipants;
      this.#hostId = nextHostId;
      this.#state = nextState;
      this.#revision = revision;
      this.#touchAndBroadcast(now);
      return participant;
    });
  }

  async leave(participantId: ParticipantId): Promise<void> {
    await this.#enqueue(async () => {
      const participant = this.#participants.get(participantId);
      if (!participant) return;
      const now = this.#now();
      const nextParticipants = new Map(this.#participants);
      nextParticipants.delete(participantId);
      const nextHostId =
        this.#hostId === participantId
          ? ([...nextParticipants.values()].find(
              (candidate) => candidate.role === "player",
            )?.id ?? null)
          : this.#hostId;
      const room = this.#makePublicRoom(nextParticipants, nextHostId);
      const gameEvents =
        (await this.game.participantLeft?.({
          state: this.#state,
          participant,
          room,
          now,
          random: this.#random,
        })) ?? [];
      const nextState = this.#evolveMany(this.#state, gameEvents);
      const revision = this.#revision + 1;
      await this.#store.append({
        roomId: this.id,
        revision,
        at: now,
        actorId: participantId,
        entries: [
          { scope: "room", event: { type: "participant.left", participantId } },
          ...gameEvents.map(
            (event): StoredRoomEvent<Event> => ({ scope: "game", event }),
          ),
        ],
      });

      this.#participants = nextParticipants;
      this.#hostId = nextHostId;
      this.#state = nextState;
      this.#revision = revision;
      this.#touchAndBroadcast(now);
    });
  }

  async setConnected(participantId: ParticipantId, connected: boolean): Promise<void> {
    await this.#enqueue(() => {
      const participant = this.#participants.get(participantId);
      if (!participant || participant.connected === connected) return;
      this.#participants.set(participantId, { ...participant, connected });
      this.#touchAndBroadcast();
    });
  }

  async dispatch(
    participantId: ParticipantId,
    command: Command,
    expectedRevision?: number,
  ): Promise<RoomDispatchResult<Event>> {
    return this.#enqueue(async () => {
      const actor = this.#participants.get(participantId);
      if (!actor) {
        throw new RoomError(
          "NOT_A_PARTICIPANT",
          "The session is not a participant in this room",
        );
      }
      if (actor.role !== "player") {
        throw new RoomError("NOT_A_PLAYER", "Spectators cannot send game commands");
      }
      if (expectedRevision !== undefined && expectedRevision !== this.#revision) {
        throw new RoomError(
          "REVISION_CONFLICT",
          `Expected revision ${expectedRevision}, current revision is ${this.#revision}`,
          true,
        );
      }

      const now = this.#now();
      let events: readonly Event[];
      try {
        events = await this.game.decide({
          state: this.#state,
          actor,
          command,
          room: this.publicRoom(),
          now,
          random: this.#random,
        });
      } catch (error) {
        if (error instanceof RoomError) throw error;
        throw new RoomError(
          "INVALID_COMMAND",
          error instanceof Error ? error.message : "The command was rejected",
        );
      }

      if (events.length === 0) {
        return { revision: this.#revision, events };
      }

      const nextState = this.#evolveMany(this.#state, events);
      const revision = this.#revision + 1;
      await this.#store.append({
        roomId: this.id,
        revision,
        at: now,
        actorId: participantId,
        entries: events.map(
          (event): StoredRoomEvent<Event> => ({ scope: "game", event }),
        ),
      });
      this.#state = nextState;
      this.#revision = revision;
      this.#touchAndBroadcast(now);
      return { revision, events };
    });
  }

  snapshotFor(participantId: ParticipantId | null): RoomSnapshot<View> {
    const viewer =
      participantId === null ? null : (this.#participants.get(participantId) ?? null);
    const room = this.publicRoom();
    return {
      revision: this.#revision,
      room,
      state: this.game.project({ state: this.#state, viewer, room }),
    };
  }

  subscribe(
    participantId: ParticipantId,
    listener: (snapshot: RoomSnapshot<View>) => void,
  ): () => void {
    if (!this.#participants.has(participantId)) {
      throw new RoomError(
        "NOT_A_PARTICIPANT",
        "Cannot subscribe an unknown participant",
      );
    }
    const listeners = this.#subscribers.get(participantId) ?? new Set();
    listeners.add(listener);
    this.#subscribers.set(participantId, listeners);
    listener(this.snapshotFor(participantId));
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#subscribers.delete(participantId);
    };
  }

  #broadcast(): void {
    for (const [participantId, listeners] of this.#subscribers) {
      const snapshot = this.snapshotFor(participantId);
      for (const listener of listeners) listener(snapshot);
    }
  }

  #touchAndBroadcast(now = this.#now()): void {
    this.#lastActivityAt = now;
    this.#broadcast();
  }

  #evolveMany(state: State, events: readonly Event[]): State {
    return events.reduce<State>(
      (current, event) => this.game.evolve(current, event),
      state,
    );
  }

  #makePublicRoom(
    participants: Map<ParticipantId, Participant>,
    hostId: ParticipantId | null,
  ): PublicRoom {
    return {
      id: this.id,
      code: this.code,
      gameId: this.game.id,
      hostId,
      createdAt: this.createdAt,
      participants: [...participants.values()].map(toPublicParticipant),
    };
  }

  #enqueue<Result>(work: () => Result | Promise<Result>): Promise<Result> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomDirectory<State, Command, Event, View> {
  readonly #rooms = new Map<RoomId, RoomActor<State, Command, Event, View>>();
  readonly #roomIdsByCode = new Map<string, RoomId>();

  create(
    game: GameDefinition<State, Command, Event, View>,
  ): RoomActor<State, Command, Event, View> {
    const id = asRoomId(crypto.randomUUID());
    const code = this.#uniqueCode();
    const room = new RoomActor({ id, code, game });
    this.#rooms.set(id, room);
    this.#roomIdsByCode.set(code, id);
    return room;
  }

  get(roomId: RoomId): RoomActor<State, Command, Event, View> | null {
    return this.#rooms.get(roomId) ?? null;
  }

  getByCode(code: string): RoomActor<State, Command, Event, View> | null {
    const roomId = this.#roomIdsByCode.get(code.trim().toUpperCase());
    return roomId ? (this.#rooms.get(roomId) ?? null) : null;
  }

  delete(roomId: RoomId): boolean {
    const room = this.#rooms.get(roomId);
    if (!room) return false;
    this.#roomIdsByCode.delete(room.code);
    return this.#rooms.delete(roomId);
  }

  list(): readonly RoomActor<State, Command, Event, View>[] {
    return [...this.#rooms.values()];
  }

  #uniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        const randomIndex =
          crypto.getRandomValues(new Uint32Array(1))[0]! % ROOM_CODE_ALPHABET.length;
        code += ROOM_CODE_ALPHABET[randomIndex];
      }
      if (!this.#roomIdsByCode.has(code)) return code;
    }
    throw new Error("Unable to allocate a unique room code");
  }
}
