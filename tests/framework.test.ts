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
import {
  createDeck,
  haligaliGame,
  ringingFruit,
} from "../games/haligali/src/game";
import type {
  HalliCard,
  HalliPlayerState,
  HalliState,
} from "../games/haligali/src/game";

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
    const roomId = asRoomId("room");
    const ticket = tickets.issue({
      roomId,
      participantId: asParticipantId("participant"),
      sessionId: asSessionId("session"),
    });
    expect(tickets.consume(ticket)?.roomId).toBe(roomId);
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

const card = (fruit: HalliCard["fruit"], count: HalliCard["count"]): HalliCard => ({
  fruit,
  count,
});

const player = (
  drawPile: readonly HalliCard[],
  faceUp: readonly HalliCard[] = [],
  eliminated = false,
): HalliPlayerState => ({
  ready: true,
  drawPile,
  faceUp,
  eliminated,
});

const playingState = (
  order: HalliState["order"],
  players: HalliState["players"],
  activeIndex = 0,
): HalliState => ({
  phase: "playing",
  order,
  players,
  activeIndex,
  dealerId: order[0] ?? null,
  winnerId: null,
  lastBell: null,
  lastFlipperId: null,
  round: 1,
});

describe("Halli Galli", () => {
  test("contains the canonical 56-card distribution", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(56);

    for (const fruit of ["banana", "strawberry", "lime", "plum"] as const) {
      const cards = deck.filter((value) => value.fruit === fruit);
      expect(cards).toHaveLength(14);
      expect(cards.filter((value) => value.count === 1)).toHaveLength(5);
      expect(cards.filter((value) => value.count === 2)).toHaveLength(3);
      expect(cards.filter((value) => value.count === 3)).toHaveLength(3);
      expect(cards.filter((value) => value.count === 4)).toHaveLength(2);
      expect(cards.filter((value) => value.count === 5)).toHaveLength(1);
    }
  });

  test("deals all cards and never projects face-down card identities", async () => {
    const harness = new GameHarness(haligaliGame, { seed: 7 });
    const host = await harness.join("Host");
    const guest = await harness.join("Guest");
    await harness.command(host, { type: "ready", ready: true });
    await harness.command(guest, { type: "ready", ready: true });
    await harness.command(host, { type: "start" });

    const total = Object.values(harness.state.players).reduce(
      (sum, value) => sum + value.drawPile.length,
      0,
    );
    expect(total).toBe(56);

    const projection = JSON.stringify(harness.view(host));
    expect(projection).not.toContain("drawPile");
    expect(projection).not.toContain('"fruitTotals"');
  });

  test("only exactly five visible fruit is ringable", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");

    harness.state = playingState(
      [one.id, two.id],
      {
        [one.id]: player([card("lime", 1)], [card("banana", 2)]),
        [two.id]: player([card("plum", 1)], [card("banana", 3)]),
      },
    );
    expect(ringingFruit(harness.state)).toBe("banana");

    harness.state = playingState(
      [one.id, two.id],
      {
        [one.id]: player([card("lime", 1)], [card("banana", 2)]),
        [two.id]: player([card("plum", 1)], [card("banana", 4)]),
      },
    );
    expect(ringingFruit(harness.state)).toBeNull();
    const events = await harness.command(one, { type: "ring" });
    expect(events[0]).toMatchObject({ type: "bell.rung", correct: false });
  });

  test("a covering card can create a valid five", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");
    const three = await harness.join("Three");

    harness.state = playingState(
      [one.id, two.id, three.id],
      {
        [one.id]: player(
          [card("lime", 1), card("plum", 1)],
          [card("banana", 3)],
        ),
        [two.id]: player([card("plum", 1)], [card("banana", 1)]),
        [three.id]: player([card("plum", 1)], [card("banana", 4)]),
      },
    );

    expect(ringingFruit(harness.state)).toBeNull();
    await harness.command(one, { type: "flip" });
    expect(ringingFruit(harness.state)).toBe("banana");
  });

  test("correct ring captures every face-up pile and ringer starts next", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");

    harness.state = playingState(
      [one.id, two.id],
      {
        [one.id]: player(
          [card("lime", 1)],
          [card("plum", 1), card("banana", 2)],
        ),
        [two.id]: player(
          [card("plum", 1)],
          [card("strawberry", 4), card("banana", 3)],
        ),
      },
      1,
    );

    const events = await harness.command(one, { type: "ring" });
    expect(events[0]).toMatchObject({
      type: "bell.rung",
      correct: true,
      playerId: one.id,
    });
    expect(harness.state.players[one.id]?.drawPile).toHaveLength(5);
    expect(harness.state.players[one.id]?.faceUp).toHaveLength(0);
    expect(harness.state.players[two.id]?.faceUp).toHaveLength(0);
    expect(harness.state.order[harness.state.activeIndex]).toBe(one.id);
  });

  test("wrong ring pays one face-down card to each remaining opponent", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");
    const three = await harness.join("Three");

    harness.state = playingState(
      [one.id, two.id, three.id],
      {
        [one.id]: player([
          card("banana", 1),
          card("lime", 2),
          card("plum", 3),
        ]),
        [two.id]: player([card("strawberry", 1)]),
        [three.id]: player([card("strawberry", 1)]),
      },
    );

    const events = await harness.command(one, { type: "ring" });
    expect(events[0]).toMatchObject({
      type: "bell.rung",
      correct: false,
      transfers: [{ to: two.id }, { to: three.id }],
    });
    expect(harness.state.players[one.id]?.drawPile).toHaveLength(1);
    expect(harness.state.players[two.id]?.drawPile).toHaveLength(2);
    expect(harness.state.players[three.id]?.drawPile).toHaveLength(2);
  });

  test("empty draw pile eliminates a player but leaves their fruit pile on table", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");
    const three = await harness.join("Three");

    harness.state = playingState(
      [one.id, two.id, three.id],
      {
        [one.id]: player([card("lime", 2)], [card("banana", 2)]),
        [two.id]: player([card("plum", 1)], [card("banana", 3)]),
        [three.id]: player([card("strawberry", 1)], []),
      },
    );

    await harness.command(one, { type: "flip" });

    expect(harness.state.players[one.id]?.eliminated).toBe(true);
    expect(harness.state.players[one.id]?.faceUp).toHaveLength(2);
    expect(harness.state.players[one.id]?.faceUp.at(-1)).toEqual(card("lime", 2));
    expect(harness.view(one).canRing).toBe(true);
    expect(harness.view(one).canFlip).toBe(false);
  });

  test("the player who flips their last card can save themselves by winning the bell", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");
    const three = await harness.join("Three");

    harness.state = playingState(
      [one.id, two.id, three.id],
      {
        [one.id]: player([card("banana", 2)], []),
        [two.id]: player([card("lime", 1)], [card("banana", 3)]),
        [three.id]: player([card("plum", 1)], [card("strawberry", 1)]),
      },
    );

    await harness.command(one, { type: "flip" });
    expect(harness.state.players[one.id]?.eliminated).toBe(true);
    expect(ringingFruit(harness.state)).toBe("banana");

    await harness.command(one, { type: "ring" });
    expect(harness.state.players[one.id]?.eliminated).toBe(false);
    expect(harness.state.players[one.id]?.drawPile.length).toBeGreaterThan(0);
    expect(harness.state.order[harness.state.activeIndex]).toBe(one.id);
  });

  test("finishes when only one active player remains", async () => {
    const harness = new GameHarness(haligaliGame);
    const one = await harness.join("One");
    const two = await harness.join("Two");

    harness.state = playingState(
      [one.id, two.id],
      {
        [one.id]: player([card("lime", 1)]),
        [two.id]: player([card("plum", 1)], [card("banana", 1)], true),
      },
    );

    await harness.command(one, { type: "flip" });
    expect(harness.state.phase).toBe("finished");
    expect(harness.state.winnerId).toBe(one.id);
    expect(harness.state.players[two.id]?.faceUp).toHaveLength(1);
  });

  test("host can reset a finished table for a rematch", async () => {
    const harness = new GameHarness(haligaliGame);
    const host = await harness.join("Host");
    const guest = await harness.join("Guest");

    harness.state = {
      ...playingState(
        [host.id, guest.id],
        {
          [host.id]: player([card("banana", 1)]),
          [guest.id]: player([], [card("lime", 2)], true),
        },
      ),
      phase: "finished",
      winnerId: host.id,
    };

    await harness.command(host, { type: "rematch" });
    expect(harness.state.phase).toBe("lobby");
    expect(harness.state.winnerId).toBeNull();
    expect(harness.state.players[host.id]?.ready).toBe(false);
    expect(harness.state.players[guest.id]?.eliminated).toBe(false);
    expect(harness.state.players[guest.id]?.faceUp).toHaveLength(0);
  });
});