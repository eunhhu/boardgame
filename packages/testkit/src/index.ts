import {
  SeededRandom,
  asParticipantId,
  asRoomId,
  asSessionId,
  toPublicParticipant,
} from "@bgame/core";
import type {
  GameDefinition,
  Participant,
  ParticipantId,
  PublicRoom,
} from "@bgame/core";

export class GameHarness<State, Command, Event, View> {
  readonly game: GameDefinition<State, Command, Event, View>;
  readonly random: SeededRandom;
  readonly roomId = asRoomId("test-room");
  readonly participants: Participant[] = [];
  readonly now: number;
  state: State;

  constructor(
    game: GameDefinition<State, Command, Event, View>,
    options: { seed?: number; now?: number } = {},
  ) {
    this.game = game;
    this.random = new SeededRandom(options.seed ?? 1);
    this.now = options.now ?? 1_000;
    this.state = game.create({
      roomId: this.roomId,
      now: this.now,
      random: this.random,
    });
  }

  room(hostId: ParticipantId | null = this.participants[0]?.id ?? null): PublicRoom {
    return {
      id: this.roomId,
      code: "TEST01",
      gameId: this.game.id,
      hostId,
      createdAt: this.now,
      participants: this.participants.map(toPublicParticipant),
    };
  }

  async join(
    displayName: string,
    role: Participant["role"] = "player",
  ): Promise<Participant> {
    const participant: Participant = {
      id: asParticipantId(`participant-${this.participants.length + 1}`),
      sessionId: asSessionId(`session-${this.participants.length + 1}`),
      displayName,
      role,
      joinedAt: this.now,
      connected: true,
    };
    this.participants.push(participant);
    const events =
      (await this.game.participantJoined?.({
        state: this.state,
        participant,
        room: this.room(),
        now: this.now,
        random: this.random,
      })) ?? [];
    this.apply(events);
    return participant;
  }

  async command(actor: Participant, command: Command): Promise<readonly Event[]> {
    const events = await this.game.decide({
      state: this.state,
      actor,
      command,
      room: this.room(),
      now: this.now,
      random: this.random,
    });
    this.apply(events);
    return events;
  }

  view(viewer: Participant | null): View {
    return this.game.project({ state: this.state, viewer, room: this.room() });
  }

  apply(events: readonly Event[]): void {
    for (const event of events) {
      this.state = this.game.evolve(this.state, event);
    }
  }
}
