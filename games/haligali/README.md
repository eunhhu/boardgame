# Halli Galli

A complete playable implementation of classic Halli Galli on the shared `bgame`
runtime.

## Rules implemented

- 2–6 players.
- 56 cards total: banana, strawberry, lime, and plum.
- Each fruit has 14 cards: five `1`s, three `2`s, three `3`s, two `4`s, and one `5`.
- The host acts as dealer. The player after the host flips first.
- Players flip one face-down card at a time in seat order.
- Only the top card of every face-up fruit pile is visible for the bell condition.
- The bell is correct only when **exactly five** of one fruit are visible.
- A correct bell collects every face-up pile and puts those cards under the
  winner's draw pile. The bell winner flips first in the next round.
- A wrong bell pays one face-down card to every other active player, as far as
  the ringer has cards available.
- A player whose draw pile is exhausted is immediately eliminated; their face-up
  pile stays on the table and still counts until somebody captures it.
- Eliminated players cannot ring the bell or flip another card.
- The last player with cards in their draw pile wins.
- The host can reset the table for a rematch without creating a new room.

## Digital fairness

The server is authoritative. Every game command carries the room revision that
the client saw. The room actor serializes commands. If several players ring from
the same visible table state, the first ring accepted by the authoritative room
changes the revision; later rings from that same state become stale instead of
being treated as additional wrong bells.

There is intentionally no client-visible `fruitTotals` field. Players have to
count the cards themselves.

This is still an internet game: network latency cannot be made identical between
players without a more complicated synchronized-input/latency-compensation
protocol. For a casual room, server-arrival order is the predictable and
cheat-resistant rule.

## Controls

- Click/tap the bell, or press `Space`, to ring.
- Click **Flip card**, or press `F`, on your turn.
- Mobile uses the same authoritative WebSocket path as desktop.

## State boundaries

Face-down card identities exist only in `HalliState`. `HalliView` exposes only:

- face-down card counts;
- each visible top card;
- face-up pile sizes;
- turn/ready/elimination/connection status;
- the last resolved bell result.

This keeps hidden card order out of browser snapshots and reconnect payloads.
