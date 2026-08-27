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
  readonly eliminated: boolean;
}

export interface HalliBellResult {
  readonly playerId: ParticipantId;
  readonly correct: boolean;
  readonly capturedCount: number;
  readonly penaltyCount: number;
  readonly fruit: Fruit | null;
}

export interface HalliState {
  readonly phase: "lobby" | "playing" | "finished";
  readonly order: readonly ParticipantId[];
  readonly players: Readonly<Record<string, HalliPlayerState>>;
  readonly activeIndex: number;
  readonly dealerId: ParticipantId | null;
  readonly winnerId: ParticipantId | null;
  readonly lastBell: HalliBellResult | null;
  readonly lastFlipperId: ParticipantId | null;
  readonly round: number;
}

export type HalliCommand =
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "start" }
  | { readonly type: "flip" }
  | { readonly type: "ring" }
  | { readonly type: "rematch" };

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
      readonly dealerId: ParticipantId;
      readonly decks: Readonly<Record<string, readonly HalliCard[]>>;
      readonly firstIndex: number;
    }
  | {
      readonly type: "card.flipped";
      readonly playerId: ParticipantId;
      readonly card: HalliCard;
      readonly nextIndex: number;
      readonly eliminated: boolean;
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
      readonly fruit: Fruit | null;
    }
  | { readonly type: "game.finished"; readonly winnerId: ParticipantId }
  | { readonly type: "game.reset" };

export interface HalliPlayerView {
  readonly id: ParticipantId;
  readonly displayName: string;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly drawCount: number;
  readonly faceUpCount: number;
  readonly topCard: HalliCard | null;
  readonly isSelf: boolean;
  readonly isHost: boolean;
  readonly isCurrent: boolean;
  readonly eliminated: boolean;
}

export interface HalliView {
  readonly phase: HalliState["phase"];
  readonly players: readonly HalliPlayerView[];
  readonly currentPlayerId: ParticipantId | null;
  readonly dealerId: ParticipantId | null;
  readonly winnerId: ParticipantId | null;
  readonly lastBell: HalliBellResult | null;
  readonly round: number;
  readonly canReady: boolean;
  readonly canStart: boolean;
  readonly canFlip: boolean;
  readonly canRing: boolean;
  readonly canRematch: boolean;
  readonly selfReady: boolean;
  readonly selfEliminated: boolean;
}

const fruits: readonly Fruit[] = ["banana", "strawberry", "lime", "plum"];
const counts: readonly HalliCard["count"][] = [
  1, 1, 1, 1, 1,
  2, 2, 2,
  3, 3, 3,
  4, 4,
  5,
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
    case "rematch":
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

const activeIds = (state: HalliState): ParticipantId[] =>
  state.order.filter((id) => !state.players[id]?.eliminated);

const fruitTotals = (state: HalliState): Record<Fruit, number> => {
  const totals: Record<Fruit, number> = {
    banana: 0,
    strawberry: 0,
    lime: 0,
    plum: 0,
  };
  for (const id of state.order) {
    const card = state.players[id]?.faceUp.at(-1);
    if (card) totals[card.fruit] += card.count;
  }
  return totals;
};

export const ringingFruit = (state: HalliState): Fruit | null => {
  const totals = fruitTotals(state);
  return fruits.find((fruit) => totals[fruit] === 5) ?? null;
};

const nextActiveIndex = (
  state: HalliState,
  startIndex: number,
  players: Readonly<Record<string, HalliPlayerState>> = state.players,
): number => {
  if (state.order.length === 0) return 0;
  for (let offset = 0; offset < state.order.length; offset += 1) {
    const index = (startIndex + offset) % state.order.length;
    const id = state.order[index]!;
    if (!players[id]?.eliminated) return index;
  }
  return 0;
};

const capturedCards = (state: HalliState): HalliCard[] =>
  state.order.flatMap((id) => [...(state.players[id]?.faceUp ?? [])]);

const publicPlayer = (
  participants: readonly PublicParticipant[],
  id: ParticipantId,
): PublicParticipant | null =>
  participants.find((participant) => participant.id === id) ?? null;

const applyBell = (
  state: HalliState,
  event: Extract<HalliEvent, { type: "bell.rung" }>,
): HalliState => {
  const players: Record<string, HalliPlayerState> = { ...state.players };

  if (event.correct) {
    for (const id of state.order) {
      const player = players[id];
      if (!player) continue;
      players[id] = { ...player, faceUp: [] };
    }

    const ringer = players[event.playerId]!;
    const nextDrawPile = [...ringer.drawPile, ...event.captured];
    players[event.playerId] = {
      ...ringer,
      drawPile: nextDrawPile,
      eliminated: nextDrawPile.length === 0 ? ringer.eliminated : false,
    };
  } else {
    const ringer = players[event.playerId]!;
    const remaining = ringer.drawPile.slice(event.transfers.length);
    players[event.playerId] = {
      ...ringer,
      drawPile: remaining,
      eliminated: remaining.length === 0,
    };
    for (const transfer of event.transfers) {
      const receiver = players[transfer.to];
      if (!receiver || receiver.eliminated) continue;
      players[transfer.to] = {
        ...receiver,
        drawPile: [...receiver.drawPile, transfer.card],
      };
    }
  }

  return {
    ...state,
    players,
    activeIndex: event.nextIndex,
    lastBell: {
      playerId: event.playerId,
      correct: event.correct,
      capturedCount: event.captured.length,
      penaltyCount: event.transfers.length,
      fruit: event.fruit,
    },
    lastFlipperId: null,
    round: event.correct ? state.round + 1 : state.round,
  };
};

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
    dealerId: null,
    winnerId: null,
    lastBell: null,
    lastFlipperId: null,
    round: 0,
  }),

  validateJoin: ({ state, role }) => {
    if (role === "player" && state.phase === "playing") {
      throw new Error("Players cannot join while a game is in progress");
    }
  },

  participantJoined: ({ state, participant }) => {
    if (participant.role === "spectator" || state.players[participant.id]) return [];
    return [{ type: "player.joined", playerId: participant.id }];
  },

  participantLeft: ({ state, participant }) => {
    if (state.phase === "playing" || !state.players[participant.id]) return [];
    return [{ type: "player.left", playerId: participant.id }];
  },

  decide: ({ state, actor, command: rawCommand, room, random }) => {
    const command = parseCommand(rawCommand);
    const actorState = playerState(state, actor.id);

    switch (command.type) {
      case "ready": {
        if (state.phase !== "lobby") {
          throw new Error("Ready state can only change in the lobby");
        }
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
        if (order.length > 6) throw new Error("Halli Galli supports up to six players");
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

        const dealerId = actor.id;
        const dealerIndex = Math.max(0, order.indexOf(dealerId));
        const firstIndex = (dealerIndex + 1) % order.length;
        return [{ type: "game.started", order, dealerId, decks, firstIndex }];
      }

      case "flip": {
        if (state.phase !== "playing") throw new Error("The game is not active");
        if (actorState.eliminated) throw new Error("You have been eliminated");
        const currentId = state.order[state.activeIndex];
        if (currentId !== actor.id) throw new Error("It is not your turn");
        const card = actorState.drawPile[0];
        if (!card) throw new Error("You have no face-down cards left");

        const remainingDraw = actorState.drawPile.slice(1);
        const eliminated = remainingDraw.length === 0;
        const provisionalPlayers: Record<string, HalliPlayerState> = {
          ...state.players,
          [actor.id]: {
            ...actorState,
            drawPile: remainingDraw,
            faceUp: [...actorState.faceUp, card],
            eliminated,
          },
        };
        const provisional: HalliState = {
          ...state,
          players: provisionalPlayers,
          lastFlipperId: actor.id,
        };
        const nextIndex = nextActiveIndex(
          provisional,
          (state.activeIndex + 1) % state.order.length,
          provisionalPlayers,
        );
        const flipEvent: Extract<HalliEvent, { type: "card.flipped" }> = {
          type: "card.flipped",
          playerId: actor.id,
          card,
          nextIndex,
          eliminated,
        };

        const alive = state.order.filter((id) => !provisionalPlayers[id]?.eliminated);
        if (alive.length <= 1 && ringingFruit(provisional) === null) {
          return [
            flipEvent,
            { type: "game.finished", winnerId: alive[0] ?? actor.id },
          ];
        }
        return [flipEvent];
      }

      case "ring": {
        if (state.phase !== "playing") throw new Error("The game is not active");
        const hasLastFlipGrace =
          actorState.eliminated && state.lastFlipperId === actor.id;
        if (actorState.eliminated && !hasLastFlipGrace) {
          throw new Error("Eliminated players cannot ring the bell");
        }

        const fruit = ringingFruit(state);
        const correct = fruit !== null;
        const captured = correct ? capturedCards(state) : [];
        const transfers: Array<{ to: ParticipantId; card: HalliCard }> = [];

        if (!correct) {
          const recipients = activeIds(state).filter((id) => id !== actor.id);
          const available = [...actorState.drawPile];
          for (const id of recipients) {
            const card = available.shift();
            if (!card) break;
            transfers.push({ to: id, card });
          }
        }

        const playersAfter: Record<string, HalliPlayerState> = { ...state.players };
        if (correct) {
          for (const id of state.order) {
            const player = playersAfter[id];
            if (player) playersAfter[id] = { ...player, faceUp: [] };
          }
          const ringer = playersAfter[actor.id]!;
          playersAfter[actor.id] = {
            ...ringer,
            drawPile: [...ringer.drawPile, ...captured],
            eliminated: false,
          };
        } else {
          const remaining = actorState.drawPile.slice(transfers.length);
          playersAfter[actor.id] = {
            ...actorState,
            drawPile: remaining,
            eliminated: remaining.length === 0,
          };
          for (const transfer of transfers) {
            const receiver = playersAfter[transfer.to]!;
            playersAfter[transfer.to] = {
              ...receiver,
              drawPile: [...receiver.drawPile, transfer.card],
            };
          }
        }

        const preferredIndex = correct
          ? Math.max(0, state.order.indexOf(actor.id))
          : state.activeIndex;
        const afterForTurn: HalliState = { ...state, players: playersAfter };
        const nextIndex = nextActiveIndex(afterForTurn, preferredIndex, playersAfter);
        const bellEvent: Extract<HalliEvent, { type: "bell.rung" }> = {
          type: "bell.rung",
          playerId: actor.id,
          correct,
          captured,
          transfers,
          nextIndex,
          fruit,
        };

        const alive = state.order.filter((id) => !playersAfter[id]?.eliminated);
        if (alive.length === 1) {
          return [bellEvent, { type: "game.finished", winnerId: alive[0]! }];
        }
        return [bellEvent];
      }

      case "rematch": {
        if (state.phase !== "finished") throw new Error("The game is not finished");
        if (room.hostId !== actor.id) throw new Error("Only the host can start a rematch");
        return [{ type: "game.reset" }];
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
            [event.playerId]: {
              ready: false,
              drawPile: [],
              faceUp: [],
              eliminated: false,
            },
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
                eliminated: false,
              },
            ]),
          ),
          activeIndex: event.firstIndex,
          dealerId: event.dealerId,
          winnerId: null,
          lastBell: null,
          lastFlipperId: null,
          round: 1,
        };

      case "card.flipped": {
        const player = playerState(state, event.playerId);
        return {
          ...replacePlayer(state, event.playerId, {
            ...player,
            drawPile: player.drawPile.slice(1),
            faceUp: [...player.faceUp, event.card],
            eliminated: event.eliminated,
          }),
          activeIndex: event.nextIndex,
          lastBell: null,
          lastFlipperId: event.playerId,
        };
      }

      case "bell.rung":
        return applyBell(state, event);

      case "game.finished":
        return {
          ...state,
          phase: "finished",
          winnerId: event.winnerId,
          lastFlipperId: null,
        };

      case "game.reset":
        return {
          ...state,
          phase: "lobby",
          players: Object.fromEntries(
            state.order.map((id) => [
              id,
              {
                ready: false,
                drawPile: [],
                faceUp: [],
                eliminated: false,
              },
            ]),
          ),
          activeIndex: 0,
          dealerId: null,
          winnerId: null,
          lastBell: null,
          lastFlipperId: null,
          round: 0,
        };
    }
  },

  project: ({ state, viewer, room }) => {
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
        drawCount: player.drawPile.length,
        faceUpCount: player.faceUp.length,
        topCard: player.faceUp.at(-1) ?? null,
        isSelf: viewer?.id === id,
        isHost: room.hostId === id,
        isCurrent: currentPlayerId === id,
        eliminated: player.eliminated,
      };
    });

    const self = viewer ? state.players[viewer.id] : undefined;
    const allReady =
      state.order.length >= 2 && state.order.every((id) => state.players[id]?.ready);
    const ringGrace =
      Boolean(viewer && self?.eliminated && state.lastFlipperId === viewer.id);

    return {
      phase: state.phase,
      players,
      currentPlayerId,
      dealerId: state.dealerId,
      winnerId: state.winnerId,
      lastBell: state.lastBell,
      round: state.round,
      canReady: Boolean(viewer && self && state.phase === "lobby"),
      canStart: Boolean(
        viewer &&
          room.hostId === viewer.id &&
          state.phase === "lobby" &&
          allReady,
      ),
      canFlip: Boolean(
        viewer &&
          self &&
          !self.eliminated &&
          state.phase === "playing" &&
          currentPlayerId === viewer.id &&
          self.drawPile.length > 0,
      ),
      canRing: Boolean(
        viewer &&
          self &&
          state.phase === "playing" &&
          (!self.eliminated || ringGrace),
      ),
      canRematch: Boolean(
        viewer &&
          room.hostId === viewer.id &&
          state.phase === "finished",
      ),
      selfReady: self?.ready ?? false,
      selfEliminated: self?.eliminated ?? false,
    };
  },
});