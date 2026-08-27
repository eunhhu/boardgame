# ADR 0001: Authoritative room actors

Status: accepted

Each active room is owned by one server-side `RoomActor`. Membership changes and game commands are serialized through that actor before state is persisted or broadcast.

This avoids client authority, overlapping state transitions, and ad hoc locking inside individual games. The actor owns the current revision and rejects stale optimistic commands. Horizontal scaling must therefore assign exactly one process as the owner of a room, with routing or leasing added around the existing actor boundary.
