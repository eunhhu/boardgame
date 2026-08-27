# Architecture

The framework follows one rule: **clients submit intent; the room owns truth**.

```text
React game view
    │ commands / projected snapshots
@bgame/client
    │ versioned JSON over HTTP + WebSocket
@bgame/server
    │ authenticated participant
@bgame/room ── RoomEventStore
    │ serial decision queue
pure GameDefinition
```

## Pure game packages

Each game implements `GameDefinition<State, Command, Event, View>` from
`@bgame/core`. Rule modules do not import Bun server APIs, sockets, databases,
or browser APIs. Time and randomness are injected, which keeps decisions
replayable and testable.

A command produces domain events through `decide`. Events produce the next
state through `evolve`. The server never accepts replacement state from a
browser.

## Authoritative room actor

Each active room is represented by one `RoomActor`. Joins, permanent leaves,
and game commands pass through one promise queue, so two commands cannot mutate
the same revision concurrently.

A successful event batch is appended to `RoomEventStore`, the room revision is
advanced, and every subscriber receives a new projection. Projection happens
separately for each participant; hidden cards and roles therefore have one
explicit outbound boundary.

## Identity and transport

1. HTTP creates or resumes a signed guest session.
2. The session creates a room or joins by human-readable code.
3. The room assigns a participant ID and role.
4. Authenticated HTTP issues a short-lived, one-use WebSocket ticket.
5. The socket consumes the ticket and subscribes to participant-specific
   snapshots.
6. Reconnection gets a new ticket and a complete snapshot.

## UI system

`@bgame/ui` exposes semantic variables and small React primitives rather than a
large game-specific component set. Games can override semantic variables while
retaining consistent focus, spacing, typography, states, and responsive
behavior.

## Scaling boundary

The initial runtime intentionally owns active rooms in one Bun process and uses
an in-memory event store. Before horizontal scaling, add:

- a durable event and snapshot adapter;
- room ownership leases so exactly one process writes each room;
- shared presence and routing;
- expiry and resume policies;
- rate limiting, metrics, and structured audit logs.

Scale by distributing rooms. Do not let multiple workers concurrently mutate a
single room.
