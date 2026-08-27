import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BgameClient } from "@bgame/client";
import type { ClientSnapshot, JoinedRoom } from "@bgame/client";
import {
  Button,
  Card,
  Inline,
  PageShell,
  RoomCode,
  Stack,
  TextField,
  injectBgameStyles,
} from "@bgame/ui";
import type {
  __GAME_IDENTIFIER__Command,
  __GAME_IDENTIFIER__View,
} from "./game";

injectBgameStyles();

function App() {
  const client = useMemo(
    () => new BgameClient<__GAME_IDENTIFIER__View, __GAME_IDENTIFIER__Command>(),
    [],
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState<JoinedRoom<__GAME_IDENTIFIER__View> | null>(null);
  const [snapshot, setSnapshot] = useState<ClientSnapshot<__GAME_IDENTIFIER__View> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offSnapshot = client.onSnapshot(setSnapshot);
    const offError = client.onError((value) => setError(value.message));
    return () => {
      offSnapshot();
      offError();
      client.close();
    };
  }, [client]);

  const enter = async (mode: "create" | "join") => {
    try {
      setError(null);
      await client.ensureSession(name);
      const room =
        mode === "create" ? await client.createRoom() : await client.joinRoom(code);
      setJoined(room);
      setSnapshot(room.snapshot);
      await client.connect(room);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enter room");
    }
  };

  if (!joined || !snapshot) {
    return (
      <PageShell title="__GAME_TITLE__" subtitle="Generated with bgame new">
        <Card style={{ width: "min(32rem, 100%)", margin: "8vh auto" }}>
          <Stack>
            <TextField
              label="Display name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <TextField
              label="Room code"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
            />
            {error ? <p className="bgame-error">{error}</p> : null}
            <Inline>
              <Button disabled={!name.trim()} onClick={() => void enter("create")}>
                Create
              </Button>
              <Button
                variant="secondary"
                disabled={!name.trim() || !code.trim()}
                onClick={() => void enter("join")}
              >
                Join
              </Button>
            </Inline>
          </Stack>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="__GAME_TITLE__"
      subtitle={`${snapshot.state.players.length} player(s)`}
      action={<RoomCode code={joined.code} />}
    >
      <Card style={{ width: "min(32rem, 100%)", margin: "8vh auto", textAlign: "center" }}>
        <Stack align="center" gap="var(--space-5)">
          <strong style={{ fontSize: "clamp(4rem, 18vw, 8rem)" }}>
            {snapshot.state.value}
          </strong>
          <Button size="lg" onClick={() => client.send({ type: "increment" })}>
            Increment
          </Button>
          {error ? <p className="bgame-error">{error}</p> : null}
        </Stack>
      </Card>
    </PageShell>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
