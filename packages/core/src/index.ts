export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type GameId = Brand<string, "GameId">;
export type RoomId = Brand<string, "RoomId">;
export type ParticipantId = Brand<string, "ParticipantId">;
export type SessionId = Brand<string, "SessionId">;

export const asGameId = (value: string): GameId => value as GameId;
export const asRoomId = (value: string): RoomId => value as RoomId;
export const asParticipantId = (value: string): ParticipantId => value as ParticipantId;
export const asSessionId = (value: string): SessionId => value as SessionId;

export type ParticipantRole = "player" | "spectator";

export interface SessionPrincipal {
  readonly id: SessionId;
  readonly displayName: string;
}

export interface Participant {
  readonly id: ParticipantId;
  readonly sessionId: SessionId;
  readonly displayName: string;
  readonly role: ParticipantRole;
  readonly joinedAt: number;
  readonly connected: boolean;
}

export interface PublicParticipant {
  readonly id: ParticipantId;
  readonly displayName: string;
  readonly role: ParticipantRole;
  readonly joinedAt: number;
  readonly connected: boolean;
}

export interface PublicRoom {
  readonly id: RoomId;
  readonly code: string;
  readonly gameId: GameId;
  readonly hostId: ParticipantId | null;
  readonly createdAt: number;
  readonly participants: readonly PublicParticipant[];
}

export interface RandomSource {
  next(): number;
  int(maxExclusive: number): number;
  shuffle<Value>(values: readonly Value[]): Value[];
}

export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed = 0x6d2b79f5) {
    this.#state = seed >>> 0;
  }

  next(): number {
    let value = (this.#state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle<Value>(values: readonly Value[]): Value[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(index + 1);
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  }
}

export class CryptoRandom implements RandomSource {
  next(): number {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return data[0]! / 4_294_967_296;
  }

  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle<Value>(values: readonly Value[]): Value[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(index + 1);
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  }
}

export interface RuntimeContext {
  readonly now: number;
  readonly random: RandomSource;
}

export interface GameCreateContext extends RuntimeContext {
  readonly roomId: RoomId;
}

export interface JoinValidationContext<State> {
  readonly state: Readonly<State>;
  readonly session: SessionPrincipal;
  readonly role: ParticipantRole;
  readonly room: PublicRoom;
}

export interface MembershipContext<State> extends RuntimeContext {
  readonly state: Readonly<State>;
  readonly participant: Participant;
  readonly room: PublicRoom;
}

export interface DecisionContext<State, Command> extends RuntimeContext {
  readonly state: Readonly<State>;
  readonly actor: Participant;
  readonly command: Readonly<Command>;
  readonly room: PublicRoom;
}

export interface ProjectionContext<State> {
  readonly state: Readonly<State>;
  readonly viewer: Participant | null;
  readonly room: PublicRoom;
}

export type MaybePromise<Value> = Value | Promise<Value>;

export interface GameDefinition<State, Command, Event, View> {
  readonly id: GameId;
  readonly title: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  create(context: GameCreateContext): State;
  validateJoin?(context: JoinValidationContext<State>): void;
  participantJoined?(context: MembershipContext<State>): MaybePromise<readonly Event[]>;
  participantLeft?(context: MembershipContext<State>): MaybePromise<readonly Event[]>;
  decide(context: DecisionContext<State, Command>): MaybePromise<readonly Event[]>;
  evolve(state: Readonly<State>, event: Readonly<Event>): State;
  project(context: ProjectionContext<State>): View;
}

export const defineGame = <State, Command, Event, View>(
  definition: GameDefinition<State, Command, Event, View>,
): GameDefinition<State, Command, Event, View> => definition;

export const toPublicParticipant = (participant: Participant): PublicParticipant => ({
  id: participant.id,
  displayName: participant.displayName,
  role: participant.role,
  joinedAt: participant.joinedAt,
  connected: participant.connected,
});
