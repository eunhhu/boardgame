# Security model

## Identity

The starter uses pseudonymous guest sessions signed with HMAC-SHA-256. The
session token lives in an `HttpOnly`, `SameSite=Lax` cookie. Production must set
a long random `BGAME_SECRET`, terminate TLS, and use secure cookies.

A room participant is distinct from a session: one session can join several
rooms while each room assigns its own participant ID and role.

## WebSocket upgrade

The long-lived session token is never placed in a WebSocket URL. Authenticated
HTTP issues a random ticket bound to `{session, room, participant}`. A ticket
expires quickly and is consumed exactly once during upgrade.

## Authority and hidden state

Clients submit commands, never replacement state. The server checks membership,
role, expected revision, and domain legality before applying a command.

Internal state is never broadcast directly. Every outbound snapshot passes
through the game's `project` function with the viewing participant, preventing
accidental leaks of decks, private hands, secret roles, and hidden choices.

## Included baseline

- runtime validation of WebSocket envelopes;
- same-origin checks on state-changing HTTP and WebSocket upgrades;
- signed expiring guest sessions;
- one-use expiring join tickets;
- authoritative membership and role checks;
- serial room decisions and revision conflicts;
- conservative response headers and request body limits.

## Required before public production

- per-IP and per-session rate limits;
- command-specific payload and cost limits;
- durable room cleanup and abuse reporting;
- structured audit logs and metrics;
- dependency and secret scanning;
- load, reconnect-storm, and fuzz testing;
- moderation and recovery if persistent accounts are added.
