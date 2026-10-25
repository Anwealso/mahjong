import { useEffect } from "react";
import { useRoom } from "./net/room";
import { useStore } from "./net/store";
import { SettingsMenu } from "./SettingsMenu";
import { CelebrationScreen } from "./screens/CelebrationScreen";
import { JoinScreen } from "./screens/JoinScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { WindBreakScreen } from "./screens/WindBreakScreen";
import { Table } from "./table/Table";

/** Join → Lobby → Table (→ wind break → celebration), chosen from the room's phase. */
export function App() {
  const { session, game, viewingResult, leftGame, status, notice, dismissNotice } = useStore();
  const room = useRoom();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, notice.ms ?? 3000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  let screen;
  const phase = room?.lobby.phase;
  const seated = room?.mySeat != null;
  if (!session) screen = <JoinScreen />;
  else if (!room) screen = <main className="panel muted">Joining…</main>;
  else if (phase === "gameOver" || leftGame) screen = <CelebrationScreen />;
  else if (phase === "windBreak") screen = viewingResult && game ? <Table game={game} /> : <WindBreakScreen />;
  else if ((phase === "hand" || phase === "handOver") && seated && game) screen = <Table game={game} />;
  else screen = <LobbyScreen />;

  return (
    <>
      {screen}
      <SettingsMenu />
      {status !== "open" && <div className="connection">Connecting…</div>}
      {notice && (
        <div className="notice" onClick={dismissNotice}>
          {notice.message}
        </div>
      )}
    </>
  );
}
