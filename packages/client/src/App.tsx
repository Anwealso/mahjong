import { useEffect } from "react";
import { useStore } from "./net/store";
import { JoinScreen } from "./screens/JoinScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { Table } from "./table/Table";

/** Join → Lobby → Table, chosen from the store. */
export function App() {
  const { session, game, atTable, status, notice, dismissNotice } = useStore();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, 3000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  return (
    <>
      {!session ? <JoinScreen /> : game && atTable ? <Table game={game} /> : <LobbyScreen />}
      {status !== "open" && <div className="connection">Connecting…</div>}
      {notice && (
        <div className="notice" onClick={dismissNotice}>
          {notice.message}
        </div>
      )}
    </>
  );
}
