# Creating a game

Generate a new game package from the shared template:

```bash
bgame new skull-king --title "Skull King"
bgame skull-king
```

The generated package lives at `games/<slug>` and contains:

- `src/game.ts` — pure state, commands, domain events, reducer, and viewer projection;
- `src/main.tsx` — React presentation built from `@bgame/ui` and `@bgame/client`;
- `src/server.ts` — a thin Bun server entry using `@bgame/server`;
- `package.json` — the game workspace metadata and scripts.

## Rule boundary

A game definition should keep networking, storage, React, and Bun APIs outside the rules module. Commands are interpreted by `decide`, events are reduced by `evolve`, and `project` produces the only state a viewer may receive.

Keep these invariants:

1. Put random or time-dependent results into events so replay stays deterministic.
2. Reject commands that are invalid for the current phase or actor.
3. Never return raw hidden state from `project`.
4. Treat participant IDs as stable room identities and sockets as temporary transports.
5. Keep events sufficient to reconstruct the state transition they describe.

## UI boundary

Use semantic tokens and primitives from `@bgame/ui` for typography, surfaces, form controls, spacing, focus states, and status feedback. Game-specific cards, boards, pieces, and motion can live inside the game package.

## Validation

Run the complete framework check before opening a pull request:

```bash
bun run check
```

Add deterministic rule tests through `@bgame/testkit` when the game moves beyond the starter counter example.
