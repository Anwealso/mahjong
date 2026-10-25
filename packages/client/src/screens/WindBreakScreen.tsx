import { places, SEATS, windScores, type Seat } from "@mahjong/engine";
import { useRoom } from "../net/room";
import { useStore } from "../net/store";
import { formatPoints, Scoreboard, useCountdown, WIND_GLYPHS, WIND_NAMES } from "./Scoreboard";

/**
 * End of a wind: the finished wind's podium and the overall leaderboard. Continuing needs every seated
 * person to vote for it; anyone may leave instead (a bot takes their seat).
 */
export function WindBreakScreen() {
  const room = useRoom();
  const { send, takeSeat, leaveGame, lobbyAt } = useStore();
  const removeIn = useCountdown(room?.lobby.voteRemoveMsLeft ?? null, lobbyAt);
  if (!room?.lobby.game) return null;

  const { lobby, isHost, mySeat } = room;
  const game = lobby.game!;
  const finishedWind = ((game.prevailingWind + 3) % 4) as 0 | 1 | 2 | 3;
  const thisWind = windScores(game, game.windNumber - 1);
  const podium = [...SEATS].sort((a, b) => thisWind[b]! - thisWind[a]! || a - b).slice(0, 3);
  const place = places(thisWind);
  const voted = mySeat !== null && lobby.seatInfo[mySeat]!.voted;
  const waitingOn = SEATS.filter((s) => !room.memberAt(s)?.bot && !lobby.seatInfo[s]!.voted);

  const status = (seat: Seat) => {
    const m = room.memberAt(seat);
    if (!m || m.bot) return <span className="muted">bot</span>;
    if (lobby.seatInfo[seat]!.voted) return <span className="vote-yes">✓ continue</span>;
    return (
      <span className="muted">
        deciding…
        {isHost && m.id !== room.me?.id && removeIn === 0 && (
          <button className="subtle small" onClick={() => send({ t: "removeMember", memberId: m.id })}>
            Remove
          </button>
        )}
      </span>
    );
  };

  return (
    <main className="panel wind-break">
      <div className="wind-logo" aria-hidden>
        {WIND_GLYPHS[finishedWind]}
      </div>
      <h1>End of the {WIND_NAMES[finishedWind]} wind</h1>
      <p className="muted">Round {game.windNumber - 1} · {game.history.filter((h) => h.windNumber === game.windNumber - 1).length} hands</p>

      <div className="podium">
        {[podium[1], podium[0], podium[2]].map((seat) =>
          seat === undefined ? null : (
            <div key={seat} className={`step step-${place[seat]}`}>
              <div className="step-name">{room.nameOf(seat)}</div>
              <div className="step-points">{formatPoints(thisWind[seat]!)}</div>
              <div className="step-block">{place[seat]}</div>
            </div>
          ),
        )}
      </div>

      <h2>Leaderboard</h2>
      <Scoreboard room={room} scores={game.scores} extra={status} />

      <div className="buttons">
        {mySeat !== null ? (
          <>
            <button onClick={() => send({ t: "voteContinue" })} disabled={voted}>
              {voted ? `Waiting for ${waitingOn.map(room.nameOf).join(", ")}` : "Continue to next wind"}
            </button>
            <button className="subtle" onClick={leaveGame}>
              Leave
            </button>
          </>
        ) : (
          <>
            <span className="muted">Want to play? Take over from a bot:</span>
            {SEATS.filter((s) => room.memberAt(s)?.bot).map((s) => (
              <button key={s} className="subtle" onClick={() => takeSeat(s)}>
                {room.nameOf(s)} ({formatPoints(game.scores[s]!)})
              </button>
            ))}
          </>
        )}
      </div>
      {isHost && removeIn !== null && removeIn > 0 && waitingOn.length > 0 && (
        <p className="muted">You can remove anyone who hasn't voted in {Math.ceil(removeIn / 1000)} s.</p>
      )}
    </main>
  );
}
