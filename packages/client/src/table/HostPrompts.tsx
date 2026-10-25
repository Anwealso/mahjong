import { SEATS, type Seat } from "@mahjong/engine";
import type { SeatIssue } from "@mahjong/protocol";
import { useState } from "react";
import type { RoomView } from "../net/room";
import { useStore } from "../net/store";

const ISSUE_TEXT: Record<SeatIssue, string> = {
  empty: "has left the table",
  offline: "has disconnected",
  idle: "hasn't moved for a minute",
};

/**
 * Banners at the top of the table when a seat isn't being played or someone asks to join. The host gets
 * the buttons; everyone else sees what the game is waiting for.
 */
export function HostPrompts({ room, nameOf }: { room: RoomView; nameOf: (s: Seat) => string }) {
  const { send } = useStore();
  // "Wait" just hides the prompt until the problem changes.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { lobby, isHost } = room;
  const issues = SEATS.flatMap((seat) => {
    const issue = lobby.seatInfo[seat]!.issue;
    return issue ? [{ seat, issue, key: `${seat}:${issue}:${lobby.seats[seat]}` }] : [];
  });

  return (
    <div className="prompts">
      {issues
        .filter((i) => !dismissed.includes(i.key))
        .map(({ seat, issue, key }) => (
          <div key={key} className="prompt">
            <span>
              <strong>{issue === "empty" ? `Seat ${seat + 1}` : nameOf(seat)}</strong>{" "}
              {issue === "empty" ? "is empty: its player left" : ISSUE_TEXT[issue]}.
            </span>
            {isHost ? (
              <>
                <button onClick={() => send({ t: "replaceWithBot", seat })}>Replace with a bot</button>
                <button className="subtle" onClick={() => setDismissed([...dismissed, key])}>
                  Wait
                </button>
                {lobby.phase === "hand" && (
                  <button className="subtle" onClick={() => send({ t: "cancelHand" })}>
                    Cancel hand & return to lobby
                  </button>
                )}
              </>
            ) : (
              <span className="muted">Waiting for the host.</span>
            )}
          </div>
        ))}
      {isHost &&
        lobby.requests.map((r) => (
          <div key={r.id} className="prompt">
            <span>
              <strong>{r.name}</strong> would like to play (takes over a bot's seat).
            </span>
            <button onClick={() => send({ t: "answerRequest", memberId: r.id, approve: true })}>Let them in</button>
            <button className="subtle" onClick={() => send({ t: "answerRequest", memberId: r.id, approve: false })}>
              Decline
            </button>
          </div>
        ))}
    </div>
  );
}
