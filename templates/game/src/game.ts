import { asGameId, defineGame } from "@bgame/core";
import type { ParticipantId } from "@bgame/core";

export interface __GAME_IDENTIFIER__State {
  readonly value: number;
  readonly players: readonly ParticipantId[];
}

export type __GAME_IDENTIFIER__Command = { readonly type: "increment" };

export type __GAME_IDENTIFIER__Event =
  | { readonly type: "player.joined"; readonly playerId: ParticipantId }
  | { readonly type: "incremented"; readonly by: ParticipantId };

export interface __GAME_IDENTIFIER__View {
  readonly value: number;
  readonly players: readonly {
    readonly id: ParticipantId;
    readonly displayName: string;
    readonly isSelf: boolean;
  }[];
}

export const __GAME_IDENTIFIER__Game = defineGame<
  __GAME_IDENTIFIER__State,
  __GAME_IDENTIFIER__Command,
  __GAME_IDENTIFIER__Event,
  __GAME_IDENTIFIER__View
>({
  id: asGameId("__GAME_SLUG__"),
  title: "__GAME_TITLE__",
  minPlayers: 1,
  maxPlayers: 8,
  create: () => ({ value: 0, players: [] }),
  participantJoined: ({ participant, state }) =>
    participant.role === "player" && !state.players.includes(participant.id)
      ? [{ type: "player.joined", playerId: participant.id }]
      : [],
  decide: ({ actor, command }) => {
    if (
      typeof command !== "object" ||
      command === null ||
      command.type !== "increment"
    ) {
      throw new Error("Unknown command");
    }
    return [{ type: "incremented", by: actor.id }];
  },
  evolve: (state, event) =>
    event.type === "player.joined"
      ? { ...state, players: [...state.players, event.playerId] }
      : { ...state, value: state.value + 1 },
  project: ({ state, viewer, room }) => ({
    value: state.value,
    players: state.players.map((id) => ({
      id,
      displayName:
        room.participants.find((participant) => participant.id === id)?.displayName ??
        "Player",
      isSelf: viewer?.id === id,
    })),
  }),
});
