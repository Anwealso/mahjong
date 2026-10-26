import { kindCode, kindOf, SEATS, type Seat, type TileId } from "@mahjong/engine";
import type { RoomView } from "../net/room";
import { useStore, type GameSnapshot } from "../net/store";
import { formatPoints, useCountdown, WIND_NAMES } from "../screens/Scoreboard";
import { Melds, RevealedGroups } from "./Melds";

/**
 * The result of the hand: the winning hand, everyone else's hand face up (unless the host turned that
 * off), and the payments with running totals. Between hands everyone readies up (the next hand is dealt
 * after a 10 s countdown anyway); after the last hand of a wind it leads to the wind break instead.
 */
export function HandOver(props: {
  game: GameSnapshot;
  room: RoomView;
  nameOf: (s: Seat) => string;
  /** The winner's concealed tiles, formed up into sets. */
  winningHand: TileId[][] | null;
}) {
  const { game, room, nameOf, winningHand } = props;
  const { send, set, lobbyAt } = useStore();
  const { phase } = game.view;
  const { lobby, mySeat } = room;
  const left = useCountdown(lobby.readyMsLeft, lobbyAt);
  if (phase.kind !== "handOver" || !lobby.game) return null;

  const { result } = phase;
  let headline = "Draw: the wall ran out";
  if (result.kind === "win") {
    const how = result.selfDraw
      ? "self-drawn (自摸)"
      : result.robbedKong
        ? `robbing ${nameOf(result.from!)}'s kong`
        : `on ${nameOf(result.from!)}'s discard`;
    headline = `${nameOf(result.winner)} wins ${how} with the ${kindCode(kindOf(result.tile))}`;
  }
  const windBreak = lobby.phase === "windBreak";
  const ready = mySeat !== null && lobby.seatInfo[mySeat]!.ready;
  const blocked = SEATS.filter((s) => lobby.seatInfo[s]!.issue !== null);
  // Other players' hands; the winner's is shown above, and yours is in front of you.
  const others = SEATS.filter((s) => s !== mySeat && !(result.kind === "win" && s === result.winner));
  const shown = others.filter((s) => phase.hands[s]);

  return (
    <div className="hand-over">
      <h2>{headline}</h2>
      {result.kind === "win" && winningHand && (
        <div className="winning-hand">
          <Melds melds={game.view.players[result.winner]!.melds} size="sm" />
          <RevealedGroups
            groups={winningHand}
            size="sm"
            winningTile={result.tile}
            flipDelay={result.winner === mySeat ? undefined : 0}
          />
        </div>
      )}
      {shown.length > 0 && (
        <div className="revealed-hands">
          {shown.map((seat, i) => (
            <div key={seat} className="revealed-hand">
              <span className="who">{nameOf(seat)}</span>
              <div className="revealed-tiles">
                <Melds melds={game.view.players[seat]!.melds} size="sm" />
                <RevealedGroups groups={[phase.hands[seat]!]} size="sm" flipDelay={300 * (i + 1)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <table className="scoreboard">
        <thead>
          <tr>
            <th />
            <th>This hand</th>
            <th>Total</th>
            {lobby.phase === "handOver" && <th />}
          </tr>
        </thead>
        <tbody>
          {SEATS.map((seat) => (
            <tr key={seat} className={seat === mySeat ? "mine" : undefined}>
              <td className="who">{nameOf(seat)}</td>
              <td className="points">{formatPoints(result.payments[seat]!)}</td>
              <td className="total">{formatPoints(lobby.game!.scores[seat]!)}</td>
              {lobby.phase === "handOver" && <td>{lobby.seatInfo[seat]!.ready ? "✓ ready" : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {windBreak ? (
        <div className="hand-over-buttons">
          <span>That's the end of the {WIND_NAMES[(lobby.game.prevailingWind + 3) % 4]} wind.</span>
          <button onClick={() => set({ viewingResult: false })}>See the wind results</button>
        </div>
      ) : lobby.phase === "handOver" ? (
        <>
          <p className="muted">
            {blocked.length > 0
              ? `Waiting for the host to fill ${blocked.map(nameOf).join(", ")}'s seat…`
              : left !== null
                ? `Next hand in ${Math.ceil(left / 1000)} s`
                : ""}
          </p>
          <div className="hand-over-buttons">
            <button onClick={() => send({ t: "ready" })} disabled={ready}>
              {ready ? "Ready ✓" : "Ready"}
            </button>
            <button className="subtle" onClick={() => send({ t: "returnToLobby" })}>
              Return to lobby
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
