import { SEATS, seatWind } from "@mahjong/engine";
import { useRoom } from "../net/room";
import { useStore } from "../net/store";
import { Scoreboard, WIND_GLYPHS, WIND_NAMES } from "./Scoreboard";

/**
 * The room outside the table: before a game (take seats, bots, start), while a game is paused (scores,
 * swap people and bots, resume), and for watchers while a hand is being played (ask to play).
 */
export function LobbyScreen() {
  const room = useRoom();
  const { send, takeSeat, leaveRoom } = useStore();
  if (!room) return <main className="panel muted">Joining…</main>;

  const { lobby, isHost, mySeat, me } = room;
  const { phase, game } = lobby;
  const full = lobby.seats.every((s) => s !== null);
  const watching = lobby.members.filter((m) => m.seat === null && !m.bot);
  const shareUrl = `${location.origin}${location.pathname}#${lobby.room}`;
  const playing = phase === "hand" || phase === "handOver";
  const requested = lobby.requests.some((r) => r.id === me?.id);
  const canRequest = playing && mySeat === null && SEATS.some((s) => !room.memberAt(s) || room.memberAt(s)!.bot);
  const mine = SEATS.find((s) => lobby.seatInfo[s]!.reservedFor === me?.id);

  return (
    <main className="panel lobby">
      <h1>
        Room <span className="code">{lobby.room}</span>
      </h1>
      <p className="muted">
        Share the code, or this link: <a href={shareUrl}>{shareUrl}</a>
      </p>

      {game && (
        <section>
          <h2>
            {phase === "paused" ? "Game paused" : playing ? "Game in progress" : "Scores"} · Round {game.windNumber} ·{" "}
            {WIND_GLYPHS[game.prevailingWind]} · hand {game.handNumber}
          </h2>
          <Scoreboard room={room} scores={game.scores} />
        </section>
      )}

      <div className="seats">
        {SEATS.map((seat) => {
          const m = room.memberAt(seat);
          const isMine = m?.id === me?.id;
          // Before a game you can move freely; while paused, watchers can fill a seat or replace a bot.
          const free = !m || m.bot;
          const canTake = free && (phase === "lobby" || (phase === "paused" && mySeat === null));
          // During a game seat winds follow the dealer; before one, name the seats in turn order.
          const wind = game ? seatWind(seat, game.dealer) : seat;
          return (
            <div key={seat} className={`seat-card${isMine ? " mine" : ""}`}>
              <div className="muted">
                Seat {seat + 1} · {WIND_GLYPHS[wind]} {WIND_NAMES[wind]}
              </div>
              <div className="seat-name">
                {m?.id === lobby.hostId && <span title="Host">👑</span>}
                {m ? m.name : "Empty"}
                {m?.bot && <span className="tag">random bot</span>}
                {m && !m.bot && !m.connected && <span className="tag">offline</span>}
                {game && <span className="seat-score">{game.scores[seat]! > 0 ? `+${game.scores[seat]}` : game.scores[seat]}</span>}
              </div>
              <div className="seat-actions">
                {isMine && (phase === "lobby" || phase === "paused") && (
                  <button className="subtle" onClick={() => send({ t: "leaveSeat" })}>
                    Leave seat
                  </button>
                )}
                {canTake && (
                  <button onClick={() => takeSeat(seat)}>{m ? "Replace bot" : "Sit here"}</button>
                )}
                {isHost && m && !m.bot && !isMine && (phase === "lobby" || phase === "paused") && (
                  <button className="subtle" onClick={() => send({ t: "removeMember", memberId: m.id })}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {watching.length > 0 && <p className="muted">Watching: {watching.map((m) => m.name).join(", ")}</p>}

      <div className="buttons">
        {phase === "lobby" &&
          (isHost ? (
            <>
              {!full && (
                <button className="subtle" onClick={() => send({ t: "addBots" })} title="Bots play random legal moves">
                  Fill empty seats with bots
                </button>
              )}
              <button onClick={() => send({ t: "startGame" })} disabled={!full}>
                Start game
              </button>
            </>
          ) : (
            <span className="muted">Waiting for the host to start the game.</span>
          ))}
        {phase === "paused" &&
          (isHost ? (
            <>
              {!full && (
                <button className="subtle" onClick={() => send({ t: "addBots" })}>
                  Fill empty seats with bots
                </button>
              )}
              <button onClick={() => send({ t: "resumeGame" })} disabled={!full}>
                Resume game
              </button>
            </>
          ) : (
            <span className="muted">Waiting for the host to resume.</span>
          ))}
        {playing && mine !== undefined && (
          <button onClick={() => takeSeat(mine)}>Take my seat back</button>
        )}
        {canRequest && mine === undefined && (
          <button onClick={() => send({ t: "requestSeat" })} disabled={requested}>
            {requested ? "Asked the host…" : "Request to play"}
          </button>
        )}
        <button className="subtle" onClick={leaveRoom}>
          Leave room
        </button>
      </div>

      {/* Side column, just right of the centred lobby. */}
      <aside className="lobby-aside">
        {(phase === "lobby" || phase === "paused") && (
          <section className="game-settings">
            <h2>Game settings</h2>
            <label className={isHost && phase === "lobby" ? undefined : "muted"}>
              <input
                type="checkbox"
                checked={(game?.settings ?? lobby.settings).dealerKeepsDeal}
                disabled={!isHost || phase !== "lobby"}
                onChange={(e) => send({ t: "updateSettings", settings: { dealerKeepsDeal: e.target.checked } })}
              />
              Dealer keeps the deal after a dealer win or a draw
            </label>
            <p className="muted small">
              {(game?.settings ?? lobby.settings).dealerKeepsDeal
                ? "Traditional: winds last until every seat has lost the deal."
                : "The deal passes on after every hand, so each wind is exactly four hands."}
              {phase === "lobby" ? (isHost ? "" : " Only the host can change settings.") : " Fixed for this game."}
            </p>
          </section>
        )}
      </aside>
    </main>
  );
}
