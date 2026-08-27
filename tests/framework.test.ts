import { describe, expect, test } from "bun:test";
import {
  SeededRandom,
  asGameId,
  asParticipantId,
  asRoomId,
  asSessionId,
  defineGame,
} from "@bgame/core";
import { JoinTicketStore, SessionSigner } from "@bgame/auth";
import { ProtocolError, parseClientMessage } from "@bgame/protocol";
import {
  InMemoryRoomEventStore,
  RoomActor,
  RoomError,
} from "@bgame/room";
import { GameHarness } from "@bgame/testkit";
import { createDeck, haligaliGame } from "../games/haligali/src/game";
import type { HalliState } from "../games/haligali/src/game";

describe("protocol", () => {
  test("validates commands and rejects invalid revisions", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          version: 1,
          type: "command",
          requestId: "r1",
          expectedRevision: 3,
          command: { type: "flip" },
        }),
      ),
    ).toMatchObject({ type: "command", expectedRevision: 3 });

    expect(() =>
      parseClientMessage(
        JSON.stringify({
          version: 1,
          type: "command",
          requestId: "r1",
          expectedRevision: -1,
          command: {},
        }),
      ),
    ).toThrow(ProtocolError);
  });
});

describe("auth", () => {
  test("signs expiring sessions and consumes tickets once", async () => {
    let now = 1_000;
    const signer = new SessionSigner("0123456789abcdef0123456789abcdef", {
      ttlMs: 100,
      now: () => now,
    });
    const issued = await signer.issue("  Sunwoo  ");
    expect((await signer.verify(issued.token))?.displayName).toBe("Sunwoo");
    now = 1_101;
    expect(await signer.verify(issued.token)).toBeNull();

    const tickets = new JoinTicketStore();
    const ticket = tickets.issue({
      roomId: asRoomId("room"),
      participantId: asParticipantId("participant"),
      sessionId: asSessionId("session"),
    });
    expect(tickets.consume(ticket)?.roomId).toBe("room");
    expect(tickets.consume(ticket)).toBeNull();
  });
});

describe("room actor", () => {
  type State = { value: number };
  type Command = { type: "add"; amount: number };
  type Event = { type: "added"; amount: number };

  const game = defineGame<State, Command, Event, State>({
    id: asGameId("counter"),
    title: "Counter",
    minPlayers: 1,
    maxPlayers: 4,
    create: () => ({ value: 0 }),
    decide: async ({ command }) => {
      await Bun.sleep(5);
      return [{ type: "added", amount: command.amount }];
    },
    evolve: (state, event) => ({ value: state.value + event.amount }),
    project: ({ state }) => ({ ...state }),
  });

  test("serializes commands and rejects stale revisions", async () => {
    const store = new InMemoryRoomEventStore<Event>();
    const room = new RoomActor({
      id: asRoomId("room"),
      code: "ABC123",
      game,
      store,
      random: new SeededRandom(1),
      now: () => 100,
    });
    const participant = await room.join({
      id: asSessionId("one"),
      displayName: "one",
    });

    await Promise.all([
      room.dispatch(participant.id, { type: "add", amount: 2 }),
      room.dispatch(participant.id, { type: "add", amount: 3 }),
    ]);
    expect(room.snapshotFor(participant.id).state.value).toBe(5);
    expect(room.revision).toBe(3);

    try {
      await room.dispatch(participant.id, { type: "add", amount: 1 }, 1);
      throw new Error("Expected a revision conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(RoomError);
      expect((error as RoomError).code).toBe("REVISION_CONFLICT");
    }
  });
});

describe("Halli Galli", () => {
  test("builds and distributes a 56-card deck without projecting draw piles", async () => {
    expect(createDeck()).toHaveLength(56);
    const harness = new GameHarness(haligaliGame, { seed: 7 });
    const host = await harness.join("Host");
    const guest = await harness.join("Guest");
    await harness.command(host, { type: "ready", ready: true });
    await harness.command(guest, { type: "ready", ready: true });
    await harness.command(host, { type: "start" });

    const total = Object.values(harness.state.players).reduce(
      (sum, player) => sum + player.drawPile.length,
      0,
    );
    expect(total).toBe(56);
    expect(JSON.stringify(harness.view(host))).not.toContain("drawPile");
  });

  test("awards visible stacks when a fruit total is five", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");
    harness.state = {
      phase: "playing",
      order: [one.id, two.id],
      players: {
        [one.id]: {
          ready: true,
          drawPile: [{ fruit: "lime", count: 1 }],
          faceUp: [{ fruit: "banana", count: 2 }],
        },
        [two.id]: {
          ready: true,
          drawPile: [{ fruit: "plum", count: 1 }],
          faceUp: [{ fruit: "banana", count: 3 }],
        },
      },
      activeIndex: 0,
      winnerId: null,
      lastBell: null,
    } satisfies HalliState;

    const events = await harness.command(one, { type: "ring" });
    expect(events[0]).toMatchObject({ type: "bell.rung", correct: true });
    expect(harness.state.players[one.id]?.drawPile).toHaveLength(3);
    expect(harness.state.players[two.id]?.faceUp).toHaveLength(0);
  });
});
