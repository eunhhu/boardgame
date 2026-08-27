# boardgame

A Bun-native monorepo for shipping many authoritative multiplayer board games
without rebuilding rooms, identity, WebSockets, client synchronization, or UI
primitives for every title.

The repository currently contains a framework vertical slice and a Halli Galli
smoke-test game. It does **not** implement the full Halli Galli card rules yet.

## Start

```bash
bun install
bun run link:cli
bgame haligali
```

The CLI can also be used without linking:

```bash
bun run bgame haligali
```

Open the printed URL in two browser windows, create a room in one, and join it
from the other. The first `bun install` creates `bun.lock`; commit that lockfile
before relying on reproducible CI or deployment installs.

## CLI

```bash
bgame haligali
bgame new skull-king --title "Skull King"
bgame del skull-king
bgame del skull-king --force
bgame list
```

`bgame <game>` starts that game's thin Bun server. `bgame new` copies the
framework-aware template into `games/<slug>`. Workspaces use globs, so no
central registry file needs editing.

## Repository map

```text
games/
  haligali/          game definition, React view, assets, game tests

packages/
  auth/              signed guest sessions and one-time WS join tickets
  cli/               bgame new/del/list/<game>
  client/            browser WS client, ticket refresh, reconnect, REST helpers
  core/              pure game contracts, IDs, deterministic random source
  protocol/          validated JSON wire envelopes
  room/              serial authoritative room actor and event-store seam
  server/            Bun.serve HTTP + WebSocket adapter
  testkit/           deterministic game harness
  ui/                React primitives and semantic design tokens

templates/game/       source copied by bgame new
docs/                 architecture, protocol, security, and ADRs
```

## Core rule

A game is a pure state machine:

```ts
defineGame({
  create(context) => state,
  canJoin?({ state, session, role }) => void,
  participantJoined?({ state, participant, now, random }) => events,
  decide({ state, actor, command, now, random }) => events,
  evolve(state, event) => nextState,
  project({ state, viewer, room }) => viewerSafeState,
});
```

The room actor serializes durable membership changes and game commands through
the same revision queue. The game never imports Bun, WebSocket, React, a
database, `Date.now()`, or `Math.random()`.

`project(...)` is mandatory because raw internal state may contain hidden cards,
roles, or other player-only information.

## Current storage and scaling boundary

The initial runtime keeps active rooms in one process and exposes an append-only
`RoomEventStore` interface for room membership and game event batches. This
keeps local development and a first deployment simple without baking in a
database choice.

Before horizontal scaling, add:

1. a durable event/snapshot adapter (SQLite for local, PostgreSQL for hosted);
2. a room-directory/lease adapter so one process owns each room;
3. Redis presence/routing between processes;
4. room expiry and resume policies.

See [docs/architecture.md](docs/architecture.md) and
[docs/security.md](docs/security.md).

## Production baseline

Copy `.env.example`, replace `BGAME_SECRET` with a long random secret, terminate
TLS in front of the Bun process, and set `NODE_ENV=production`. The scaffold
intentionally leaves rate limiting, durable room storage, cleanup, and
clustered room ownership as explicit next-stage adapters rather than pretending
the in-memory development runtime is production-complete.
