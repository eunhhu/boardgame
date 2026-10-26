# boardgame

A Bun-native monorepo framework for authoritative multiplayer board games: rooms, guest identity, WebSocket transport, client sync and React UI primitives are shared, so a new title only has to implement a pure game state machine.

**Status:** Prototype — the framework packages and one game (Halli Galli) exist. Halli Galli is playable end-to-end with the full card rules; everything else is scaffolding. Rooms live in a single process with an in-memory event store; there is no durable storage, rate limiting, room expiry or multi-process routing yet.

## Features

- `defineGame({ create, canJoin?, participantJoined?, decide, evolve, project })` — games are pure, deterministic state machines that never touch Bun, WebSocket, React, `Date.now()` or `Math.random()`
- Authoritative `RoomActor` that serializes membership changes and game commands through one revision queue; stale commands are rejected rather than applied out of order
- Mandatory viewer-specific projections so hidden information (face-down cards, roles) never reaches browser snapshots or reconnect payloads
- Signed guest sessions (cookie `bgame_session`) and one-use WebSocket join tickets
- Versioned, runtime-validated JSON wire protocol (`docs/protocol.md`)
- Browser client with ticket refresh and automatic reconnect
- `bgame` CLI: run a game, scaffold a new game from `templates/game`, delete, list
- Deterministic test harness (`@bgame/testkit`) for game logic
- Halli Galli: 2–6 players, 56-card deck, bell/penalty/elimination rules, host rematch, keyboard controls (see `games/haligali/README.md`)

## How it works

`bgame <slug>` (`packages/cli`) spawns `games/<slug>/src/server.ts`, which calls `createBoardgameServer({ game, clientEntry, port })` from `packages/server`. The server uses `Bun.serve` to expose `/health`, `GET|POST /api/session`, `POST /api/rooms`, `POST /api/rooms/:id/join`, `POST /api/rooms/:id/ticket` and the `/ws` upgrade, and bundles the game's `main.tsx` with `Bun.build` to serve it as `/app.js`. `packages/room` hosts a `RoomDirectory` of `RoomActor`s backed by `InMemoryRoomEventStore`; each actor runs the game's `decide`/`evolve` and sends every viewer their `project`ed view. `packages/auth` signs sessions and join tickets with Web Crypto using `BGAME_SECRET`; `packages/protocol` validates envelopes on both ends; `packages/client` and `packages/ui` are consumed by the game's React entry.

Design notes: `docs/architecture.md`, `docs/security.md`, `docs/protocol.md`, `docs/creating-a-game.md`, and ADRs in `docs/adr/`.

## Tech stack

- Runtime/Language: Bun 1.4, TypeScript (strict, path aliases `@bgame/*` in `tsconfig.json`)
- Server: `Bun.serve` HTTP + WebSocket, `Bun.build` for the client bundle
- UI: React 19
- Storage: in-memory event store (interface `RoomEventStore` for future adapters)
- Tooling: `bun test`, `tsc --noEmit`, GitHub Actions (`ci.yml` runs `bun run check`)

## Getting started

### Requirements

- Bun 1.4+

### Install

```bash
git clone https://github.com/eunhhu/boardgame.git
cd boardgame
bun install
cp .env.example .env     # set BGAME_SECRET to a long random string
bun run link:cli         # optional: makes `bgame` available on PATH
```

### Run

```bash
bun run dev              # same as: bun run bgame haligali
bgame haligali           # if linked
bgame haligali --port 4000

bgame new skull-king --title "Skull King"   # scaffold games/skull-king from templates/game
bgame del skull-king [--force]
bgame list

bun run check            # typecheck + bun test
bun test                 # tests/framework.test.ts (protocol, auth, room concurrency, Halli Galli)
```

Open the printed URL in two browser windows, create a room in one and join from the other.

## Project structure

```
games/
  haligali/        game.ts (rules), main.tsx (React view), server.ts, README.md
packages/
  auth/            signed guest sessions, one-time WS join tickets, cookie helpers
  cli/             bgame run / new / del / list
  client/          browser WS client, ticket refresh, reconnect, REST helpers
  core/            defineGame contracts, branded IDs, deterministic random source
  protocol/        validated JSON wire envelopes
  room/            RoomActor, RoomDirectory, RoomEventStore (in-memory impl)
  server/          Bun.serve HTTP + WebSocket adapter, client bundling
  testkit/         deterministic game harness
  ui/              React primitives and design tokens
templates/game/    source copied by `bgame new`
docs/              architecture, protocol, security, creating-a-game, ADRs
tests/             framework test suite
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BGAME_SECRET` | — | HMAC secret for session cookies and join tickets (use ≥32 random characters) |
| `PORT` | `3000` | listen port; `--port` on the command line overrides it |
| `NODE_ENV` | `development` | `production` requires a real `BGAME_SECRET`, sets the secure cookie flag, minifies the client bundle and hides error details |

Terminate TLS in front of the Bun process when deploying. Before scaling past one process you would need a durable event/snapshot store, a room-ownership lease, cross-process presence and room expiry — none of these exist yet.

## License

No license file yet.
