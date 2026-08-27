import { asGameId, defineGame } from "@bgame/core";
import type { ParticipantId, PublicParticipant } from "@bgame/core";

export type Fruit = "banana" | "strawberry" | "lime" | "plum";

export interface HalliCard {
  readonly fruit: Fruit;
  readonly count: 1 | 2 | 3 | 4 | 5;
}

export interface HalliPlayerState {
  readonly ready: boolean;
  readonly drawPile: readonly HalliCard[];
  readonly faceUp: readonly HalliCard[];
}

export interface HalliState {
  readonly phase: "lobby" | "playing" | "finished";
  readonly order: readonly ParticipantId[];
  readonly players: Readonly<Record<string, HalliPlayerState>>;
  readonly activeIndex: number;
  readonly winnerId: ParticipantId | null;
  readonly lastBell: {
    readonly playerId: ParticipantId;
    readonly correct: boolean;
  } | null;
}

export type HalliCommand =
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "start" }
  | { readonly type: "flip" }
  | { readonly type: "ring" };

export type HalliEvent =
  | { readonly type: "player.joined"; readonly playerId: ParticipantId }
  | { readonly type: "player.left"; readonly playerId: ParticipantId }
  | {
      readonly type: "ready.changed";
      readonly playerId: ParticipantId;
      readonly ready: boolean;
    }
  | {
      readonly type: "game.started";
      readonly order: readonly ParticipantId[];
      readonly decks: Readonly<Record<string, readonly HalliCard[]>>;
    }
  | {
      readonly type: "card.flipped";
      readonly playerId: ParticipantId;
      readonly card: HalliCard;
      readonly nextIndex: number;
    }
  | {
      readonly type: "bell.rung";
      readonly playerId: ParticipantId;
      readonly correct: boolean;
      readonly captured: readonly HalliCard[];
      readonly transfers: readonly {
        readonly to: ParticipantId;
        readonly card: HalliCard;
      }[];
      readonly nextIndex: number;
    }
  | { readonly type: "game.finished"; readonly winnerId: ParticipantId };

export interface HalliPlayerView {
  readonly id: ParticipantId;
  readonly displayName: string;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly cardCount: number;
  readonly faceUpCount: number;
  readonly topCard: HalliCard | null;
  readonly isSelf: boolean;
  readonly isHost: boolean;
  readonly isCurrent: boolean;
}

export interface HalliView {
  readonly phase: HalliState["phase"];
  readonly players: readonly HalliPlayerView[];
  readonly currentPlayerId: ParticipantId | null;
  readonly winnerId: ParticipantId | null;
  readonly fruitTotals: Readonly<Record<Fruit, number>>;
  readonly lastBell: HalliState["lastBell"];
  readonly canReady: boolean;
  readonly canStart: boolean;
  readonly canFlip: boolean;
  readonly canRing: boolean;
  readonly selfReady: boolean;
}

const fruits: readonly Fruit[] = ["banana", "strawberry", "lime", "plum"];
const counts: readonly HalliCard["count"][] = [
  1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5,
];

export function createDeck(): HalliCard[] {
  return fruits.flatMap((fruit) => counts.map((count) => ({ fruit, count })));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseCommand(value: unknown): HalliCommand {
  if (!isObject(value) || typeof value.type !== "string") {
    throw new Error("Command must contain a type");
  }
  switch (value.type) {
    case "ready":
      if (typeof value.ready !== "boolean") {
        throw new Error("ready command requires a boolean value");
      }
      return { type: "ready", ready: value.ready };
    case "start":
    case "flip":
    case "ring":
      return { type: value.type };
    default:
      throw new Error(`Unknown Halli Galli command: ${value.type}`);
  }
}

const playerState = (
  state: HalliState,
  playerId: ParticipantId,
): HalliPlayerState => {
  const player = state.players[playerId];
  if (!player) throw new Error("Player is not part of this game");
  return player;
};

const replacePlayer = (
  state: HalliState,
  playerId: ParticipantId,
  player: HalliPlayerState,
): HalliState => ({
  ...state,
  players: { ...state.players, [playerId]: player },
});

const cardTotal = (player: HalliPlayerState): number =>
  player.drawPile.length + player.faceUp.length;

const fruitTotals = (state: HalliState): Record<Fruit, number> => {
  const totals: Record<Fruit, number> = {
    banana: 0,
    strawberry: 0,
    lime: 0,
    plum: 0,
  };
  for (const player of Object.values(state.players)) {
    const card = player.faceUp.at(-1);
    if (card) totals[card.fruit] += card.count;
  }
  return totals;
};

const bellIsCorrect = (state: HalliState): boolean =>
  Object.values(fruitTotals(state)).some((total) => total === 5);

const nextDrawableIndex = (state: HalliState, startIndex: number): number => {
  if (state.order.length === 0) return 0;
  for (let offset = 0; offset < state.order.length; offset += 1) {
    const index = (startIndex + offset) % state.order.length;
    const id = state.order[index]!;
    if ((state.players[id]?.drawPile.length ?? 0) > 0) return index;
  }
  return Math.max(0, Math.min(startIndex, state.order.length - 1));
};

const applyBellCards = (
  state: HalliState,
  event: Extract<HalliEvent, { type: "bell.rung" }>,
): HalliState => {
  const nextPlayers: Record<string, HalliPlayerState> = { ...state.players };

  if (event.correct) {
    for (const id of state.order) {
      const player = playerState(state, id);
      nextPlayers[id] = { ...player, faceUp: [] };
    }
    const ringer = nextPlayers[event.playerId]!;
    nextPlayers[event.playerId] = {
      ...ringer,
      drawPile: [...ringer.drawPile, ...event.captured],
    };
  } else {
    const ringer = nextPlayers[event.playerId]!;
    nextPlayers[event.playerId] = {
      ...ringer,
      drawPile: ringer.drawPile.slice(event.transfers.length),
    };
    for (const transfer of event.transfers) {
      const receiver = nextPlayers[transfer.to]!;
      nextPlayers[transfer.to] = {
        ...receiver,
        drawPile: [...receiver.drawPile, transfer.card],
      };
    }
  }

  return {
    ...state,
    players: nextPlayers,
    activeIndex: event.nextIndex,
    lastBell: { playerId: event.playerId, correct: event.correct },
  };
};

const publicPlayer = (
  participants: readonly PublicParticipant[],
  id: ParticipantId,
): PublicParticipant | null =>
  participants.find((participant) => participant.id === id) ?? null;

export const haligaliGame = defineGame<
  HalliState,
  HalliCommand,
  HalliEvent,
  HalliView
>({
  id: asGameId("haligali"),
  title: "Halli Galli",
  minPlayers: 2,
  maxPlayers: 6,

  create: () => ({
    phase: "lobby",
    order: [],
    players: {},
    activeIndex: 0,
    winnerId: null,
    lastBell: null,
  }),

  validateJoin: ({ state, role }) => {
    if (role === "player" && state.phase !== "lobby") {
      throw new Error("Players cannot join after the game has started");
    }
  },

  participantJoined: ({ state, participant }) => {
    if (participant.role === "spectator" || state.players[participant.id]) return [];
    return [{ type: "player.joined", playerId: participant.id }];
  },

  participantLeft: ({ state, participant }) => {
    if (state.phase !== "lobby" || !state.players[participant.id]) return [];
    return [{ type: "player.left", playerId: participant.id }];
  },

  decide: ({ state, actor, command: rawCommand, room, random }) => {
    const command = parseCommand(rawCommand);
    const actorState = playerState(state, actor.id);

    switch (command.type) {
      case "ready": {
        if (state.phase !== "lobby") throw new Error("The game has already started");
        if (actorState.ready === command.ready) return [];
        return [
          { type: "ready.changed", playerId: actor.id, ready: command.ready },
        ];
      }

      case "start": {
        if (state.phase !== "lobby") throw new Error("The game has already started");
        if (room.hostId !== actor.id) throw new Error("Only the host can start the game");
        const order = state.order.filter((id) => Boolean(state.players[id]));
        if (order.length < 2) throw new Error("At least two players are required");
        if (!order.every((id) => state.players[id]?.ready)) {
          throw new Error("Every player must be ready");
        }

        const shuffled = random.shuffle(createDeck());
        const decks: Record<string, HalliCard[]> = Object.fromEntries(
          order.map((id) => [id, [] as HalliCard[]]),
        );
        shuffled.forEach((card, index) => {
          decks[order[index % order.length]!]!.push(card);
        });
        return [{ type: "game.started", order, decks }];
      }

      case "flip": {
        if (state.phase !== "playing") throw new Error("The game is not active");
        const currentId = state.order[state.activeIndex];
        if (currentId !== actor.id) throw new Error("It is not your turn");
        const card = actorState.drawPile[0];
        if (!card) throw new Error("You have no face-down cards to flip");

        const afterFlip = replacePlayer(state, actor.id, {
          ...actorState,
          drawPile: actorState.drawPile.slice(1),
          faceUp: [...actorState.faceUp, card],
        });
        const nextIndex = nextDrawableIndex(
          afterFlip,
          (state.activeIndex + 1) % state.order.length,
        );
        return [{ type: "card.flipped", playerId: actor.id, card, nextIndex }];
      }

      case "ring": {
        if (state.phase !== "playing") throw new Error("The game is not active");
        const correct = bellIsCorrect(state);
        const captured = correct
          ? random.shuffle(
              state.order.flatMap((id) => [...playerState(state, id).faceUp]),
            )
          : [];
        const transfers: Array<{ to: ParticipantId; card: HalliCard }> = [];
        if (!correct) {
          const available = [...actorState.drawPile];
          for (const id of state.order) {
            if (id === actor.id) continue;
            const card = available.shift();
            if (!card) break;
            transfers.push({ to: id, card });
          }
        }

        const provisionalEvent: Extract<HalliEvent, { type: "bell.rung" }> = {
          type: "bell.rung",
          playerId: actor.id,
          correct,
          captured,
          transfers,
          nextIndex: state.activeIndex,
        };
        const provisional = applyBellCards(state, provisionalEvent);
        const preferredIndex = correct
          ? Math.max(0, state.order.indexOf(actor.id))
          : state.activeIndex;
        const nextIndex = nextDrawableIndex(provisional, preferredIndex);
        const bellEvent: Extract<HalliEvent, { type: "bell.rung" }> = {
          ...provisionalEvent,
          nextIndex,
        };
        const afterBell = applyBellCards(state, bellEvent);
        const alive = state.order.filter(
          (id) => cardTotal(playerState(afterBell, id)) > 0,
        );
        return alive.length === 1
          ? [bellEvent, { type: "game.finished", winnerId: alive[0]! }]
          : [bellEvent];
      }
    }
  },

  evolve: (state, event) => {
    switch (event.type) {
      case "player.joined":
        return {
          ...state,
          order: [...state.order, event.playerId],
          players: {
            ...state.players,
            [event.playerId]: { ready: false, drawPile: [], faceUp: [] },
          },
        };

      case "player.left": {
        const players = { ...state.players };
        delete players[event.playerId];
        return {
          ...state,
          order: state.order.filter((id) => id !== event.playerId),
          players,
        };
      }

      case "ready.changed":
        return replacePlayer(state, event.playerId, {
          ...playerState(state, event.playerId),
          ready: event.ready,
        });

      case "game.started":
        return {
          ...state,
          phase: "playing",
          order: [...event.order],
          players: Object.fromEntries(
            event.order.map((id) => [
              id,
              {
                ready: true,
                drawPile: [...(event.decks[id] ?? [])],
                faceUp: [],
              },
            ]),
          ),
          activeIndex: 0,
          winnerId: null,
          lastBell: null,
        };

      case "card.flipped": {
        const player = playerState(state, event.playerId);
        return {
          ...replacePlayer(state, event.playerId, {
            ...player,
            drawPile: player.drawPile.slice(1),
            faceUp: [...player.faceUp, event.card],
          }),
          activeIndex: event.nextIndex,
        };
      }

      case "bell.rung":
        return applyBellCards(state, event);

      case "game.finished":
        return { ...state, phase: "finished", winnerId: event.winnerId };
    }
  },

  project: ({ state, viewer, room }) => {
    const totals = fruitTotals(state);
    const currentPlayerId =
      state.phase === "playing" ? (state.order[state.activeIndex] ?? null) : null;
    const players: HalliPlayerView[] = state.order.map((id) => {
      const player = playerState(state, id);
      const participant = publicPlayer(room.participants, id);
      return {
        id,
        displayName: participant?.displayName ?? "Left player",
        connected: participant?.connected ?? false,
        ready: player.ready,
        cardCount: cardTotal(player),
        faceUpCount: player.faceUp.length,
        topCard: player.faceUp.at(-1) ?? null,
        isSelf: viewer?.id === id,
        isHost: room.hostId === id,
        isCurrent: currentPlayerId === id,
      };
    });
    const self = viewer ? state.players[viewer.id] : undefined;
    const allReady =
      state.order.length >= 2 && state.order.every((id) => state.players[id]?.ready);

    return {
      phase: state.phase,
      players,
      currentPlayerId,
      winnerId: state.winnerId,
      fruitTotals: totals,
      lastBell: state.lastBell,
      canReady: Boolean(viewer && self && state.phase === "lobby"),
      canStart: Boolean(
        viewer &&
          room.hostId === viewer.id &&
          state.phase === "lobby" &&
          allReady,
      ),
      canFlip: Boolean(
        viewer &&
          state.phase === "playing" &&
          currentPlayerId === viewer.id &&
          (self?.drawPile.length ?? 0) > 0,
      ),
      canRing: Boolean(viewer && self && state.phase === "playing"),
      selfReady: self?.ready ?? false,
    };
  },
});
