# Wire protocol

The WebSocket protocol is JSON and currently uses `version: 1`.

## Client messages

```ts
{ version: 1, type: "command", requestId, expectedRevision?, command }
{ version: 1, type: "ping", sentAt }
```

`expectedRevision` enables optimistic concurrency. A stale command receives a
`REVISION_CONFLICT` error and the client keeps the latest authoritative
snapshot.

## Server messages

```ts
{ version: 1, type: "snapshot", revision, room, state }
{ version: 1, type: "ack", requestId, revision }
{ version: 1, type: "error", requestId?, code, message, retryable }
{ version: 1, type: "pong", sentAt, receivedAt }
```

The protocol package validates messages at runtime because TypeScript types are
not a trust boundary. The shape inside `command` remains game-specific and must
be validated by the game domain.

Snapshots are complete participant-specific projections. This keeps reconnect
and recovery simple. Deltas can be added later as an optimization, not as the
only recovery mechanism.
