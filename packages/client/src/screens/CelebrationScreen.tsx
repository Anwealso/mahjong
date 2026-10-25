import { places, SEATS } from "@mahjong/engine";
import { useMemo } from "react";
import { useRoom } from "../net/room";
import { useStore } from "../net/store";
import { formatPoints, Scoreboard } from "./Scoreboard";

const CONFETTI_COLORS = ["#ffd76a", "#ff6b6b", "#4cc9f0", "#80ed99", "#c77dff", "#ff9f1c"];

/** The end of the game (or of your part in it): confetti for 1st and 2nd, and the full scoreboard. */
export function CelebrationScreen() {
  const room = useRoom();
  const { send, set } = useStore();
  const confetti = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 3,
        duration: 3 + Math.random() * 3,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 6,
      })),
    [],
  );
  if (!room?.lobby.game) return null;

  const { lobby, isHost } = room;
  const scores = lobby.game!.scores;
  const place = places(scores);
  const winners = (p: number) => SEATS.filter((s) => place[s] === p);
  const first = winners(1);
  // With a tie for first there's no separate 2nd place.
  const second = first.length > 1 ? [] : winners(2);

  return (
    <main className="panel celebration">
      <div className="confetti" aria-hidden>
        {confetti.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.left}%`,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              background: c.color,
              width: c.size,
              height: c.size * 0.45,
            }}
          />
        ))}
      </div>
      <h1>🎉 Game over 🎉</h1>
      <div className="winners">
        <div className="winner first">
          <div className="medal">🥇</div>
          <div className="winner-name">{first.map(room.nameOf).join(" & ")}</div>
          <div className="winner-points">{formatPoints(scores[first[0]!]!)}</div>
        </div>
        {second.length > 0 && (
          <div className="winner second">
            <div className="medal">🥈</div>
            <div className="winner-name">{second.map(room.nameOf).join(" & ")}</div>
            <div className="winner-points">{formatPoints(scores[second[0]!]!)}</div>
          </div>
        )}
      </div>
      <h2>Final scores</h2>
      <Scoreboard room={room} scores={scores} />
      <p className="muted">{lobby.game!.history.length} hands played.</p>
      <div className="buttons">
        {lobby.phase === "gameOver" ? (
          isHost ? (
            <button onClick={() => send({ t: "newGame" })}>New game</button>
          ) : (
            <span className="muted">The host can start a new game.</span>
          )
        ) : (
          <button className="subtle" onClick={() => set({ leftGame: false })}>
            Back to the room
          </button>
        )}
      </div>
    </main>
  );
}
