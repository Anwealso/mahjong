import { SEATS } from "@mahjong/engine";
import { useStore } from "../net/store";

const WINDS = ["東 East", "南 South", "西 West", "北 North"] as const;

/** Share the code, take a seat, fill empty seats with bots if you like, and deal. */
export function LobbyScreen() {
  const { session, lobby, game, takeSeat, leaveSeat, addBots, startHand, leaveRoom } = useStore();
  if (!session || !lobby) return <main className="panel muted">Joining…</main>;

  const me = lobby.members.find((m) => m.id === session.memberId);
  const memberAt = (seat: number) => lobby.members.find((m) => m.id === lobby.seats[seat]);
  const full = lobby.seats.every((s) => s !== null);
  const watching = lobby.members.filter((m) => m.seat === null);
  const shareUrl = `${location.origin}${location.pathname}#${lobby.room}`;

  return (
    <main className="panel lobby">
      <h1>
        Room <span className="code">{lobby.room}</span>
      </h1>
      <p className="muted">
        Share the code, or this link: <a href={shareUrl}>{shareUrl}</a>
      </p>

      <div className="seats">
        {SEATS.map((seat) => {
          const m = memberAt(seat);
          const mine = m?.id === session.memberId;
          return (
            <div key={seat} className={`seat-card${mine ? " mine" : ""}`}>
              <div className="muted">
                Seat {seat + 1} · {WINDS[seat]}
              </div>
              <div className="seat-name">
                {m ? m.name : "Empty"}
                {m?.bot && <span className="tag">random bot</span>}
                {m && !m.bot && !m.connected && <span className="tag">offline</span>}
              </div>
              {!lobby.handInProgress &&
                (mine ? (
                  <button className="subtle" onClick={leaveSeat}>
                    Leave seat
                  </button>
                ) : (
                  (!m || m.bot) && <button onClick={() => takeSeat(seat)}>{m ? "Replace bot" : "Sit here"}</button>
                ))}
            </div>
          );
        })}
      </div>

      {watching.length > 0 && <p className="muted">Watching: {watching.map((m) => m.name).join(", ")}</p>}

      <div className="buttons">
        {lobby.handInProgress ? (
          <span className="muted">A hand is being played.</span>
        ) : (
          <>
            {!full && (
              <button className="subtle" onClick={addBots} title="Bots play random legal moves">
                Fill empty seats with bots
              </button>
            )}
            <button onClick={startHand} disabled={!full || me?.seat === null}>
              Deal
            </button>
          </>
        )}
        {game && me?.seat !== null && (
          <button className="subtle" onClick={() => useStore.setState({ atTable: true })}>
            Back to the table
          </button>
        )}
        <button className="subtle" onClick={leaveRoom}>
          Leave room
        </button>
      </div>
    </main>
  );
}
