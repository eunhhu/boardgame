# ADR 0002: Viewer-specific state projections

Status: accepted

Raw game state and domain events stay on the server. Clients receive only the value returned by `game.project(...)` for their participant identity.

Board games frequently contain hidden hands, draw piles, roles, and future information. Broadcasting one shared state object and asking the browser to hide fields is not a security boundary. Mandatory projections make information disclosure an explicit game-rule concern and allow players, spectators, and future bot clients to receive different views of the same authoritative state.
