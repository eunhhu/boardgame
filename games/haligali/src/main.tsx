import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BgameClient } from "@bgame/client";
import type {
  ClientSnapshot,
  ConnectionStatus,
  JoinedRoom,
} from "@bgame/client";
import {
  Badge,
  Button,
  Card,
  Divider,
  Inline,
  PageShell,
  RoomCode,
  Stack,
  TextField,
  injectBgameStyles,
} from "@bgame/ui";
import type {
  Fruit,
  HalliCard,
  HalliCommand,
  HalliPlayerView,
  HalliView,
} from "./game";

injectBgameStyles();

const gameStyles = `
.halli-entry{width:min(34rem,100%);margin:7vh auto 0}.halli-entry__actions{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}
.halli-board{display:grid;gap:var(--space-5)}.halli-status{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap}
.halli-players{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(12rem,100%),1fr));gap:var(--space-3)}
.halli-player{position:relative;display:grid;gap:var(--space-3);min-height:13rem;overflow:hidden}.halli-player[data-current=true]{border-color:color-mix(in srgb,var(--accent) 58%,var(--border));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent),var(--shadow-sm)}.halli-player[data-self=true]::after{content:"YOU";position:absolute;top:.7rem;right:.7rem;color:var(--accent-strong);font-size:.68rem;font-weight:900;letter-spacing:.09em}.halli-player__name{margin:0;padding-right:2.5rem;font-size:1rem}.halli-player__meta{color:var(--text-muted);font-size:.84rem}
.halli-card{display:grid;place-items:center;width:6.2rem;aspect-ratio:.72;margin:auto;border:1px solid rgba(0,0,0,.13);border-radius:1rem;color:#1b201b;background:linear-gradient(150deg,rgba(255,255,255,.96),rgba(247,244,232,.92));box-shadow:0 12px 28px rgba(20,24,20,.15);transform:rotate(-1.5deg)}.halli-card[data-fruit=banana]{--fruit-color:#d89f00}.halli-card[data-fruit=strawberry]{--fruit-color:#d64552}.halli-card[data-fruit=lime]{--fruit-color:#5d9f42}.halli-card[data-fruit=plum]{--fruit-color:#7851a9}.halli-card__fruit{font-size:2.55rem}.halli-card__count{color:var(--fruit-color);font-size:1.3rem;font-weight:950}.halli-card--empty{color:var(--text-muted);border-style:dashed;background:var(--bg-subtle);box-shadow:none}
.halli-center{display:grid;grid-template-columns:1fr minmax(11rem,16rem) 1fr;align-items:center;gap:var(--space-4)}.halli-bell{width:min(15rem,60vw);aspect-ratio:1;min-height:unset;margin:auto;border-radius:50%;font-size:clamp(1.4rem,5vw,2.2rem);box-shadow:inset 0 -12px 0 rgba(0,0,0,.12),0 18px 35px rgba(0,0,0,.18)}.halli-bell:active:not(:disabled){transform:translateY(5px)}
.halli-fruits{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-2)}.halli-fruit-total{display:flex;align-items:center;justify-content:space-between;padding:.65rem .75rem;border-radius:var(--radius-md);background:var(--bg-subtle)}.halli-fruit-total[data-five=true]{outline:3px solid var(--focus);color:var(--accent-strong);font-weight:900}.halli-controls{position:sticky;bottom:1rem;z-index:3;display:flex;justify-content:center;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--bg-surface) 90%,transparent);box-shadow:var(--shadow-md);backdrop-filter:blur(18px)}.halli-message{margin:0;text-align:center;color:var(--text-muted)}
@media(max-width:46rem){.halli-entry{margin-top:1rem}.halli-entry__actions{grid-template-columns:1fr}.halli-center{grid-template-columns:1fr}.halli-fruits{grid-template-columns:repeat(4,1fr);order:2}.halli-fruit-total{display:grid;place-items:center;padding:.5rem .3rem}.halli-controls{flex-wrap:wrap}}
`;
const style = document.createElement("style");
style.textContent = gameStyles;
document.head.append(style);

const fruitGlyph: Record<Fruit, string> = {
  banana: "🍌",
  strawberry: "🍓",
  lime: "🍋",
  plum: "🟣",
};

function FruitCard({ card }: { readonly card: HalliCard | null }) {
  if (!card) return <div className="halli-card halli-card--empty">No card</div>;
  return (
    <div className="halli-card" data-fruit={card.fruit}>
      <span className="halli-card__fruit" aria-hidden="true">
        {fruitGlyph[card.fruit]}
      </span>
      <span className="halli-card__count">× {card.count}</span>
    </div>
  );
}

function PlayerPanel({ player }: { readonly player: HalliPlayerView }) {
  return (
    <Card
      className="halli-player"
      data-current={String(player.isCurrent)}
      data-self={String(player.isSelf)}
    >
      <Inline justify="space-between" wrap={false}>
        <div>
          <h3 className="halli-player__name">
            {player.displayName} {player.isHost ? "♛" : ""}
          </h3>
          <span className="halli-player__meta">
            {player.cardCount} cards · {player.connected ? "online" : "offline"}
          </span>
        </div>
        {player.ready ? <Badge tone="success">Ready</Badge> : null}
      </Inline>
      <FruitCard card={player.topCard} />
      <p className="halli-message">Face-up stack: {player.faceUpCount}</p>
    </Card>
  );
}

function EntryScreen({
  busy,
  error,
  onCreate,
  onJoin,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreate: (name: string) => Promise<void>;
  readonly onJoin: (name: string, code: string) => Promise<void>;
}) {
  const [name, setName] = useState(() => localStorage.getItem("bgame:name") ?? "");
  const [code, setCode] = useState("");
  return (
    <PageShell
      title="Halli Galli"
      subtitle="Create a room, share the code, and race for the bell."
    >
      <Card className="halli-entry" tone="elevated">
        <Stack gap="var(--space-5)">
          <TextField
            label="Display name"
            value={name}
            maxLength={32}
            placeholder="Sunwoo"
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Divider />
          <TextField
            label="Room code"
            value={code}
            maxLength={8}
            placeholder="ABC123"
            onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
            hint="Leave it empty when creating a new room."
          />
          {error ? <p className="bgame-error">{error}</p> : null}
          <div className="halli-entry__actions">
            <Button
              size="lg"
              disabled={busy || !name.trim()}
              onClick={() => void onCreate(name)}
            >
              Create room
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={busy || !name.trim() || !code.trim()}
              onClick={() => void onJoin(name, code)}
            >
              Join room
            </Button>
          </div>
        </Stack>
      </Card>
    </PageShell>
  );
}

function GameScreen({
  joined,
  snapshot,
  status,
  error,
  send,
}: {
  readonly joined: JoinedRoom<HalliView>;
  readonly snapshot: ClientSnapshot<HalliView>;
  readonly status: ConnectionStatus;
  readonly error: string | null;
  readonly send: (command: HalliCommand) => void;
}) {
  const view = snapshot.state;
  const winner = view.players.find((player) => player.id === view.winnerId);
  const bellPlayer = view.players.find(
    (player) => player.id === view.lastBell?.playerId,
  );
  return (
    <PageShell
      title="Halli Galli"
      subtitle={
        view.phase === "lobby"
          ? "Everyone readies up, then the host starts."
          : "Flip on your turn. Ring when a visible fruit totals five."
      }
      action={<RoomCode code={joined.code} />}
    >
      <div className="halli-board">
        <div className="halli-status">
          <Inline>
            <Badge tone={status === "open" ? "success" : "neutral"}>{status}</Badge>
            <Badge>revision {snapshot.revision}</Badge>
          </Inline>
          {view.lastBell ? (
            <span className={view.lastBell.correct ? "" : "bgame-error"}>
              {bellPlayer?.displayName ?? "A player"}{" "}
              {view.lastBell.correct ? "won the bell" : "rang incorrectly"}
            </span>
          ) : null}
        </div>
        {error ? <Card tone="subtle" className="bgame-error">{error}</Card> : null}
        <section className="halli-players" aria-label="Players">
          {view.players.map((player) => (
            <PlayerPanel key={player.id} player={player} />
          ))}
        </section>

        {view.phase === "lobby" ? (
          <Card tone="elevated">
            <Stack align="center">
              <h2 style={{ margin: 0 }}>Lobby</h2>
              <p className="halli-message">
                {view.players.length < 2
                  ? "Waiting for another player…"
                  : "Ready up. The crown marks the host."}
              </p>
              <Inline justify="center">
                <Button
                  variant={view.selfReady ? "secondary" : "primary"}
                  disabled={!view.canReady}
                  onClick={() => send({ type: "ready", ready: !view.selfReady })}
                >
                  {view.selfReady ? "Not ready" : "Ready"}
                </Button>
                <Button disabled={!view.canStart} onClick={() => send({ type: "start" })}>
                  Start game
                </Button>
              </Inline>
            </Stack>
          </Card>
        ) : null}

        {view.phase === "playing" ? (
          <>
            <section className="halli-center">
              <div className="halli-fruits">
                {(Object.keys(view.fruitTotals) as Fruit[]).map((fruit) => (
                  <div
                    key={fruit}
                    className="halli-fruit-total"
                    data-five={String(view.fruitTotals[fruit] === 5)}
                  >
                    <span>{fruitGlyph[fruit]}</span>
                    <strong>{view.fruitTotals[fruit]}</strong>
                  </div>
                ))}
              </div>
              <Button
                className="halli-bell"
                disabled={!view.canRing}
                onClick={() => send({ type: "ring" })}
              >
                🔔 RING
              </Button>
              <Card tone="subtle">
                <Stack gap="var(--space-2)">
                  <strong>Rule</strong>
                  <span className="bgame-muted">
                    Ring when any visible fruit adds up to exactly five.
                  </span>
                </Stack>
              </Card>
            </section>
            <div className="halli-controls">
              <Button
                size="lg"
                disabled={!view.canFlip}
                onClick={() => send({ type: "flip" })}
              >
                Flip card
              </Button>
              <Button
                variant="secondary"
                size="lg"
                disabled={!view.canRing}
                onClick={() => send({ type: "ring" })}
              >
                Ring bell
              </Button>
            </div>
          </>
        ) : null}

        {view.phase === "finished" ? (
          <Card tone="elevated">
            <Stack align="center">
              <span style={{ fontSize: "3rem" }}>🏆</span>
              <h2 style={{ margin: 0 }}>{winner?.displayName ?? "A player"} wins</h2>
            </Stack>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}

function App() {
  const client = useMemo(() => new BgameClient<HalliView, HalliCommand>(), []);
  const [joined, setJoined] = useState<JoinedRoom<HalliView> | null>(null);
  const [snapshot, setSnapshot] = useState<ClientSnapshot<HalliView> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const offSnapshot = client.onSnapshot(setSnapshot);
    const offStatus = client.onStatus(setStatus);
    const offError = client.onError((value) => setError(value.message));
    return () => {
      offSnapshot();
      offStatus();
      offError();
      client.close();
    };
  }, [client]);

  const enter = async (
    name: string,
    action: () => Promise<JoinedRoom<HalliView>>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("bgame:name", name.trim());
      await client.ensureSession(name);
      const room = await action();
      setJoined(room);
      setSnapshot(room.snapshot);
      await client.connect(room);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enter the room");
    } finally {
      setBusy(false);
    }
  };

  if (!joined || !snapshot) {
    return (
      <EntryScreen
        busy={busy}
        error={error}
        onCreate={(name) => enter(name, () => client.createRoom())}
        onJoin={(name, code) => enter(name, () => client.joinRoom(code))}
      />
    );
  }

  return (
    <GameScreen
      joined={joined}
      snapshot={snapshot}
      status={status}
      error={error}
      send={(command) => {
        try {
          setError(null);
          client.send(command);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Could not send command");
        }
      }}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
