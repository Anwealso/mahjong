import { places, SEATS, type Seat } from "@mahjong/engine";
import { useEffect, useState } from "react";
import type { RoomView } from "../net/room";

const PLACE_NAMES = ["1st", "2nd", "3rd", "4th"] as const;
export const WIND_GLYPHS = ["東", "南", "西", "北"] as const;
export const WIND_NAMES = ["East", "South", "West", "North"] as const;

/** Running totals per seat, best first. Scores belong to seats, so it shows whoever sits there now. */
export function Scoreboard({ room, scores, extra }: { room: RoomView; scores: number[]; extra?: (seat: Seat) => React.ReactNode }) {
  const place = places(scores);
  const order = [...SEATS].sort((a, b) => scores[b]! - scores[a]! || a - b);
  return (
    <table className="scoreboard">
      <tbody>
        {order.map((seat) => (
          <tr key={seat} className={seat === room.mySeat ? "mine" : undefined}>
            <td className="place">{PLACE_NAMES[place[seat]! - 1]}</td>
            <td className="who">
              {room.nameOf(seat)}
              {room.memberAt(seat)?.bot && <span className="tag">bot</span>}
            </td>
            <td className="points">{formatPoints(scores[seat]!)}</td>
            {extra && <td>{extra(seat)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const formatPoints = (p: number) => (p > 0 ? `+${p}` : `${p}`);

/** Milliseconds left of a server countdown, ticking down locally. Null when there's no countdown. */
export function useCountdown(msLeft: number | null, receivedAt: number): number | null {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (msLeft === null) return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [msLeft, receivedAt]);
  return msLeft === null ? null : Math.max(0, msLeft - (now - receivedAt));
}
