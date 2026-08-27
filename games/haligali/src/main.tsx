import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
:root{--halli-table:#174b38;--halli-table-deep:#0c3427;--halli-gold:#d7b45a;--halli-red:#d65454;--halli-card:#fffaf0;--halli-ink:#20231f}
.halli-entry{width:min(38rem,100%);margin:5vh auto 0}.halli-entry__actions{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}
.halli-rules-preview{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3)}.halli-rule-chip{padding:var(--space-3);border-radius:var(--radius-md);background:var(--bg-subtle);text-align:center}.halli-rule-chip strong{display:block;margin-bottom:.25rem}
.halli-board{display:grid;gap:var(--space-4)}.halli-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap}
.halli-arena{position:relative;display:grid;gap:var(--space-4);min-height:34rem;padding:clamp(1rem,3vw,2rem);border:1px solid color-mix(in srgb,var(--halli-gold) 24%,transparent);border-radius:clamp(1.1rem,2vw,2rem);background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.08),transparent 29%),radial-gradient(circle at 50% 50%,var(--halli-table),var(--halli-table-deep));box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),0 22px 60px rgba(8,25,18,.22);overflow:hidden}
.halli-players{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(13rem,100%),1fr));gap:var(--space-3);align-items:stretch}
.halli-player{position:relative;display:grid;grid-template-columns:1fr auto;grid-template-rows:auto 1fr;gap:var(--space-3);min-height:14.5rem;padding:var(--space-4);border-color:rgba(255,255,255,.14);background:color-mix(in srgb,var(--bg-elevated) 90%,transparent);transition:opacity .18s ease,transform .18s ease,box-shadow .18s ease}.halli-player[data-current=true]{box-shadow:0 0 0 3px color-mix(in srgb,var(--halli-gold) 65%,transparent),var(--shadow-md);transform:translateY(-2px)}.halli-player[data-eliminated=true]{opacity:.55;filter:saturate(.55)}.halli-player[data-self=true]::after{content:"YOU";position:absolute;top:.7rem;right:.7rem;padding:.2rem .38rem;border-radius:999px;color:var(--accent-contrast);background:var(--accent);font-size:.62rem;font-weight:900;letter-spacing:.08em}
.halli-player__header{min-width:0;padding-right:2.6rem}.halli-player__name{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap;font-size:1rem}.halli-player__meta{display:flex;gap:.4rem;align-items:center;margin-top:.35rem;color:var(--text-muted);font-size:.78rem}.halli-player__cards{grid-column:1/-1;display:grid;grid-template-columns:minmax(4.8rem,.82fr) minmax(5.8rem,1fr);gap:var(--space-3);align-items:end}
.halli-deck{position:relative;display:grid;place-items:center;min-height:8.2rem}.halli-card-back{position:relative;width:5.2rem;aspect-ratio:.68;border:3px solid #e4d7aa;border-radius:.72rem;background:repeating-linear-gradient(45deg,#285c48 0 7px,#214d3d 7px 14px);box-shadow:0 8px 18px rgba(0,0,0,.24)}.halli-card-back::before,.halli-card-back::after{content:"";position:absolute;inset:5px;border:1px solid rgba(255,255,255,.55);border-radius:.45rem}.halli-card-back::after{inset:13px;border:2px solid var(--halli-gold);border-radius:50%}.halli-deck__count{position:absolute;right:calc(50% - 3.6rem);bottom:.1rem;display:grid;place-items:center;min-width:2rem;height:2rem;padding:0 .45rem;border-radius:999px;color:#1b211c;background:#f5e8bc;font-size:.8rem;font-weight:900;box-shadow:var(--shadow-sm)}
.halli-card{position:relative;display:grid;place-items:center;width:6.4rem;aspect-ratio:.68;margin:auto;padding:.55rem;border:1px solid rgba(31,36,31,.14);border-radius:.8rem;color:var(--halli-ink);background:linear-gradient(150deg,#fffdf8,var(--halli-card));box-shadow:0 10px 22px rgba(0,0,0,.2);overflow:hidden;transform:rotate(-1deg);animation:halli-card-in .17s ease-out}.halli-card::before{content:"";position:absolute;inset:.38rem;border:1px solid color-mix(in srgb,var(--fruit-color) 32%,transparent);border-radius:.55rem}.halli-card[data-fruit=banana]{--fruit-color:#d6a81f}.halli-card[data-fruit=strawberry]{--fruit-color:#d94f5d}.halli-card[data-fruit=lime]{--fruit-color:#66a653}.halli-card[data-fruit=plum]{--fruit-color:#8057aa}.halli-card__fruit-grid{z-index:1;display:grid;grid-template-columns:repeat(2,1fr);place-items:center;gap:.05rem;width:100%;font-family:"Apple Color Emoji","Segoe UI Emoji",sans-serif;line-height:1}.halli-card__fruit{font-size:clamp(1.45rem,4vw,2rem);filter:drop-shadow(0 2px 1px rgba(0,0,0,.12))}.halli-card__fruit-grid[data-count="1"]{grid-template-columns:1fr}.halli-card__fruit-grid[data-count="1"] .halli-card__fruit{font-size:2.8rem}.halli-card__fruit-grid[data-count="3"] .halli-card__fruit:last-child,.halli-card__fruit-grid[data-count="5"] .halli-card__fruit:last-child{grid-column:1/-1}.halli-empty-card{display:grid;place-items:center;width:6.4rem;aspect-ratio:.68;margin:auto;border:1px dashed rgba(31,36,31,.22);border-radius:.8rem;color:var(--text-muted);background:var(--bg-subtle);font-size:.75rem}
.halli-center{display:grid;grid-template-columns:1fr minmax(13rem,18rem) 1fr;align-items:center;gap:var(--space-5);padding:var(--space-2) 0}.halli-center__hint{max-width:14rem;color:rgba(255,255,255,.75);font-size:.84rem;line-height:1.45}.halli-center__hint:last-child{text-align:right;justify-self:end}
.halli-bell-wrap{position:relative;display:grid;place-items:center}.halli-bell{position:relative;width:min(16rem,58vw);aspect-ratio:1;min-height:unset;padding:0;border:0!important;border-radius:50%!important;color:#3d321a!important;background:radial-gradient(circle at 42% 30%,#fff8cf 0 7%,#f0d67a 20%,#c29a39 54%,#82611f 78%,#5c4316 100%)!important;box-shadow:inset 0 -18px 24px rgba(74,48,10,.26),inset 0 5px 7px rgba(255,255,255,.6),0 1.3rem 2rem rgba(0,0,0,.32)!important;touch-action:manipulation;user-select:none;-webkit-user-select:none;transition:transform .06s ease,filter .12s ease!important}.halli-bell::before{content:"";position:absolute;top:15%;left:50%;width:30%;height:18%;transform:translateX(-50%);border-radius:50% 50% 35% 35%;background:linear-gradient(#f8e6a1,#a87924);box-shadow:inset 0 2px 2px rgba(255,255,255,.7)}.halli-bell::after{content:"RING";position:absolute;left:50%;bottom:25%;transform:translateX(-50%);font-size:clamp(1rem,4vw,1.5rem);font-weight:950;letter-spacing:.12em}.halli-bell:active:not(:disabled){transform:translateY(7px) scale(.985)!important;filter:brightness(.95)}.halli-bell__key{position:absolute;bottom:-.9rem;padding:.3rem .55rem;border-radius:999px;color:rgba(255,255,255,.8);background:rgba(0,0,0,.22);font-size:.7rem;font-weight:800;backdrop-filter:blur(8px)}
.halli-feedback{display:flex;align-items:center;justify-content:center;min-height:2.5rem;padding:.55rem .8rem;border-radius:var(--radius-md);color:rgba(255,255,255,.88);background:rgba(0,0,0,.16);text-align:center;font-weight:700}.halli-feedback[data-correct=true]{background:rgba(33,112,74,.6)}.halli-feedback[data-correct=false]{background:rgba(155,55,55,.58)}
.halli-actions{position:sticky;bottom:1rem;z-index:5;display:flex;justify-content:center;gap:var(--space-3);width:fit-content;max-width:100%;margin:auto;padding:.65rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--bg-surface) 92%,transparent);box-shadow:var(--shadow-md);backdrop-filter:blur(18px)}.halli-actions .bgame-button{min-width:9rem}.halli-turn{color:#f8e7a8;font-weight:850}.halli-offline{color:var(--danger)}.halli-winner{width:min(34rem,100%);margin:auto;text-align:center}.halli-trophy{font-size:4rem;line-height:1}.halli-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:var(--space-2);width:100%}.halli-result{padding:.7rem;border-radius:var(--radius-md);background:var(--bg-subtle)}
.halli-connection{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:1rem;background:rgba(10,18,13,.52);backdrop-filter:blur(6px)}.halli-connection__card{width:min(24rem,100%);text-align:center}
@keyframes halli-card-in{from{opacity:.4;transform:rotate(-5deg) translateY(-8px) scale(.94)}to{opacity:1;transform:rotate(-1deg) translateY(0) scale(1)}}
@media(max-width:52rem){.halli-center{grid-template-columns:1fr}.halli-center__hint{display:none}.halli-players{grid-template-columns:repeat(2,minmax(0,1fr))}.halli-player{min-height:12.5rem}.halli-card,.halli-empty-card{width:5.7rem}.halli-card-back{width:4.7rem}}
@media(max-width:34rem){.halli-entry{margin-top:0}.halli-entry__actions,.halli-rules-preview{grid-template-columns:1fr}.halli-arena{padding:.75rem;border-radius:1rem}.halli-players{grid-template-columns:1fr 1fr;gap:.55rem}.halli-player{min-height:10.5rem;padding:.65rem}.halli-player__cards{grid-template-columns:1fr 1fr;gap:.4rem}.halli-player__name{font-size:.86rem}.halli-player__meta{font-size:.68rem}.halli-card,.halli-empty-card{width:4.7rem;border-radius:.6rem}.halli-card-back{width:4rem}.halli-card__fruit{font-size:1.3rem}.halli-card__fruit-grid[data-count="1"] .halli-card__fruit{font-size:2.2rem}.halli-deck{min-height:6.4rem}.halli-center{padding:.35rem 0}.halli-actions{bottom:.5rem;width:100%}.halli-actions .bgame-button{min-width:0;flex:1}.halli-toolbar{align-items:flex-start}}
@media(prefers-reduced-motion:reduce){.halli-card{animation:none}.halli-player,.halli-bell{transition:none!important}}
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

const fruitName: Record<Fruit, string> = {
  banana: "banana",
  strawberry: "strawberry",
  lime: "lime",
  plum: "plum",
};

let sharedAudioContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  sharedAudioContext ??= new AudioContext();
  void sharedAudioContext.resume();
  return sharedAudioContext;
}

function tone(
  frequency: number,
  duration: number,
  gainValue: number,
  offset = 0,
): void {
  const context = audioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + offset;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playBell(): void {
  tone(760, 0.28, 0.24);
  tone(1_140, 0.22, 0.12, 0.006);
  tone(1_520, 0.18, 0.07, 0.012);
  navigator.vibrate?.(28);
}

function playFlip(): void {
  tone(190, 0.045, 0.035);
}

function playSuccess(): void {
  tone(620, 0.12, 0.07);
  tone(830, 0.16, 0.06, 0.08);
}

function playError(): void {
  tone(150, 0.16, 0.08);
  tone(115, 0.2, 0.055, 0.08);
}

function FruitCard({ card, faceUpCount }: {
  readonly card: HalliCard | null;
  readonly faceUpCount: number;
}) {
  if (!card) {
    return <div className="halli-empty-card">No face-up card</div>;
  }
  return (
    <div
      key={`${card.fruit}-${card.count}-${faceUpCount}`}
      className="halli-card"
      data-fruit={card.fruit}
      role="img"
      aria-label={`${card.count} ${fruitName[card.fruit]}${card.count === 1 ? "" : "s"}`}
    >
      <div className="halli-card__fruit-grid" data-count={String(card.count)}>
        {Array.from({ length: card.count }, (_, index) => (
          <span className="halli-card__fruit" aria-hidden="true" key={index}>
            {fruitGlyph[card.fruit]}
          </span>
        ))}
      </div>
    </div>
  );
}

function DrawPile({ count }: { readonly count: number }) {
  return (
    <div className="halli-deck" aria-label={`${count} face-down cards`}>
      {count > 0 ? <div className="halli-card-back" aria-hidden="true" /> : (
        <div className="halli-empty-card">Empty</div>
      )}
      <span className="halli-deck__count">{count}</span>
    </div>
  );
}

function PlayerPanel({ player }: { readonly player: HalliPlayerView }) {
  return (
    <Card
      className="halli-player"
      data-current={String(player.isCurrent)}
      data-self={String(player.isSelf)}
      data-eliminated={String(player.eliminated)}
    >
      <div className="halli-player__header">
        <h3 className="halli-player__name">
          {player.displayName} {player.isHost ? "♛" : ""}
        </h3>
        <div className="halli-player__meta">
          <span>{player.drawCount} left</span>
          <span>·</span>
          <span>{player.faceUpCount} played</span>
          {!player.connected ? <span className="halli-offline">· offline</span> : null}
        </div>
      </div>
      <div>
        {player.eliminated ? (
          <Badge tone="danger">Out</Badge>
        ) : player.isCurrent ? (
          <Badge tone="accent">Turn</Badge>
        ) : player.ready ? (
          <Badge tone="success">Ready</Badge>
        ) : null}
      </div>
      <div className="halli-player__cards">
        <DrawPile count={player.drawCount} />
        <FruitCard card={player.topCard} faceUpCount={player.faceUpCount} />
      </div>
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
      subtitle="The real thing: count the fruit yourself and beat everyone to the bell."
    >
      <Card className="halli-entry" tone="elevated">
        <Stack gap="var(--space-5)">
          <div className="halli-rules-preview">
            <div className="halli-rule-chip">
              <strong>2–6</strong>
              <span className="bgame-muted">players</span>
            </div>
            <div className="halli-rule-chip">
              <strong>Exactly 5</strong>
              <span className="bgame-muted">same fruit</span>
            </div>
            <div className="halli-rule-chip">
              <strong>Fastest</strong>
              <span className="bgame-muted">bell wins</span>
            </div>
          </div>
          <Divider />
          <TextField
            label="Display name"
            value={name}
            maxLength={32}
            autoComplete="nickname"
            placeholder="Sunwoo"
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TextField
            label="Room code"
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            placeholder="ABC123"
            onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
            hint="Leave empty to create a room."
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

function Feedback({ view }: { readonly view: HalliView }) {
  if (!view.lastBell) {
    return (
      <div className="halli-feedback">
        Only the top card of each fruit pile counts. No totals are shown — count them.
      </div>
    );
  }
  const ringer = view.players.find((player) => player.id === view.lastBell?.playerId);
  return (
    <div
      className="halli-feedback"
      data-correct={String(view.lastBell.correct)}
      role="status"
    >
      {view.lastBell.correct ? (
        <>
          {ringer?.displayName ?? "A player"} hit exactly five
          {view.lastBell.fruit ? ` ${fruitName[view.lastBell.fruit]}` : ""} and won{" "}
          {view.lastBell.capturedCount} cards.
        </>
      ) : (
        <>
          {ringer?.displayName ?? "A player"} rang at the wrong time and paid{" "}
          {view.lastBell.penaltyCount} card{view.lastBell.penaltyCount === 1 ? "" : "s"}.
        </>
      )}
    </div>
  );
}

function Lobby({
  view,
  send,
}: {
  readonly view: HalliView;
  readonly send: (command: HalliCommand) => void;
}) {
  const readyCount = view.players.filter((player) => player.ready).length;
  return (
    <Card tone="elevated">
      <Stack align="center" gap="var(--space-4)">
        <div>
          <h2 style={{ margin: 0, textAlign: "center" }}>Room ready</h2>
          <p className="bgame-muted" style={{ marginBottom: 0, textAlign: "center" }}>
            {view.players.length < 2
              ? "Invite at least one more player."
              : `${readyCount}/${view.players.length} players ready. The host deals; the player after the host flips first.`}
          </p>
        </div>
        <Inline justify="center">
          <Button
            variant={view.selfReady ? "secondary" : "primary"}
            disabled={!view.canReady}
            onClick={() => send({ type: "ready", ready: !view.selfReady })}
          >
            {view.selfReady ? "Cancel ready" : "Ready"}
          </Button>
          <Button
            size="lg"
            disabled={!view.canStart}
            onClick={() => send({ type: "start" })}
          >
            Start
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

function Winner({
  view,
  send,
}: {
  readonly view: HalliView;
  readonly send: (command: HalliCommand) => void;
}) {
  const winner = view.players.find((player) => player.id === view.winnerId);
  return (
    <Card className="halli-winner" tone="elevated">
      <Stack align="center" gap="var(--space-4)">
        <div className="halli-trophy" aria-hidden="true">🏆</div>
        <div>
          <h2 style={{ margin: 0 }}>{winner?.displayName ?? "Winner"} wins</h2>
          <p className="bgame-muted" style={{ marginBottom: 0 }}>
            Last player standing after {Math.max(1, view.round)} round
            {view.round === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="halli-result-grid">
          {view.players.map((player) => (
            <div className="halli-result" key={player.id}>
              <strong>{player.displayName}</strong>
              <div className="bgame-muted">
                {player.drawCount} deck · {player.faceUpCount} table
              </div>
            </div>
          ))}
        </div>
        {view.canRematch ? (
          <Button size="lg" onClick={() => send({ type: "rematch" })}>
            Rematch
          </Button>
        ) : (
          <span className="bgame-muted">Waiting for the host to start a rematch.</span>
        )}
      </Stack>
    </Card>
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
  const sentRevision = useRef<number | null>(null);
  const previousBell = useRef<string | null>(null);

  useEffect(() => {
    sentRevision.current = null;
  }, [snapshot.revision]);

  useEffect(() => {
    if (!view.lastBell) {
      previousBell.current = null;
      return;
    }
    const signature = `${view.lastBell.playerId}:${view.lastBell.correct}:${snapshot.revision}`;
    if (previousBell.current === signature) return;
    previousBell.current = signature;
    if (view.lastBell.correct) playSuccess();
    else playError();
  }, [snapshot.revision, view.lastBell]);

  const sendOnce = useCallback((command: HalliCommand) => {
    if (sentRevision.current === snapshot.revision) return;
    sentRevision.current = snapshot.revision;
    send(command);
  }, [send, snapshot.revision]);

  const ring = useCallback(() => {
    if (!view.canRing) return;
    playBell();
    sendOnce({ type: "ring" });
  }, [sendOnce, view.canRing]);

  const flip = useCallback(() => {
    if (!view.canFlip) return;
    playFlip();
    sendOnce({ type: "flip" });
  }, [sendOnce, view.canFlip]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        ring();
      } else if (event.code === "KeyF") {
        event.preventDefault();
        flip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flip, ring]);

  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const subtitle =
    view.phase === "lobby"
      ? "Ready up. No hidden information leaves the server."
      : view.phase === "finished"
        ? "Game over."
        : view.selfEliminated
          ? "You are out, but your fruit pile stays on the table until somebody wins it."
          : current
            ? `${current.displayName}'s turn — watch every visible card.`
            : "Watch the table.";

  return (
    <PageShell
      title="Halli Galli"
      subtitle={subtitle}
      action={<RoomCode code={joined.code} />}
    >
      <div className="halli-board">
        <div className="halli-toolbar">
          <Inline>
            <Badge tone={status === "open" ? "success" : "neutral"}>
              {status === "open" ? "live" : status}
            </Badge>
            {view.phase === "playing" ? <Badge>round {view.round}</Badge> : null}
            {view.dealerId ? (
              <Badge>
                dealer {view.players.find((player) => player.id === view.dealerId)?.displayName ?? "—"}
              </Badge>
            ) : null}
          </Inline>
          {current && view.phase === "playing" ? (
            <span className="halli-turn">{current.displayName} flips next</span>
          ) : null}
        </div>

        {error ? <Card tone="subtle" className="bgame-error">{error}</Card> : null}

        {view.phase === "lobby" ? (
          <>
            <section className="halli-players" aria-label="Players">
              {view.players.map((player) => (
                <PlayerPanel key={player.id} player={player} />
              ))}
            </section>
            <Lobby view={view} send={sendOnce} />
          </>
        ) : null}

        {view.phase === "playing" ? (
          <>
            <div className="halli-arena">
              <section className="halli-players" aria-label="Players and visible cards">
                {view.players.map((player) => (
                  <PlayerPanel key={player.id} player={player} />
                ))}
              </section>

              <Feedback view={view} />

              <section className="halli-center" aria-label="Bell">
                <p className="halli-center__hint">
                  Flip with <strong>F</strong>. The card is revealed to everyone through the
                  authoritative room state.
                </p>
                <div className="halli-bell-wrap">
                  <Button
                    className="halli-bell"
                    disabled={!view.canRing || status !== "open"}
                    aria-label="Ring the bell"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      ring();
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) ring();
                    }}
                  />
                  <span className="halli-bell__key">SPACE</span>
                </div>
                <p className="halli-center__hint">
                  Ring only when one fruit is visible <strong>exactly five</strong> times.
                  Six is wrong.
                </p>
              </section>
            </div>

            <div className="halli-actions">
              <Button
                size="lg"
                disabled={!view.canFlip || status !== "open"}
                onClick={flip}
              >
                Flip card · F
              </Button>
              <Button
                variant="secondary"
                size="lg"
                disabled={!view.canRing || status !== "open"}
                onClick={ring}
              >
                Ring · Space
              </Button>
            </div>
          </>
        ) : null}

        {view.phase === "finished" ? (
          <>
            <section className="halli-players" aria-label="Final table">
              {view.players.map((player) => (
                <PlayerPanel key={player.id} player={player} />
              ))}
            </section>
            <Winner view={view} send={sendOnce} />
          </>
        ) : null}
      </div>

      {status === "reconnecting" || status === "connecting" ? (
        <div className="halli-connection" role="status">
          <Card className="halli-connection__card" tone="elevated">
            <Stack align="center">
              <strong>{status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</strong>
              <span className="bgame-muted">
                The server will send a fresh authoritative snapshot when the socket returns.
              </span>
            </Stack>
          </Card>
        </div>
      ) : null}
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
    const offSnapshot = client.onSnapshot((value) => {
      setSnapshot(value);
      setError(null);
    });
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