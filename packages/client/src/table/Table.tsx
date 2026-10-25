import { kindCode, kindOf, type PublicPlayer, type Seat, type TileId, type Wind } from "@mahjong/engine";
import { useEffect, useState } from "react";
import { useStore, type GameSnapshot } from "../net/store";
import { Tile } from "../Tile";
import { Melds } from "./Melds";
import { MyHand } from "./MyHand";
import { useTableControls, type Command } from "./useTableControls";

const WIND_GLYPHS = ["東", "南", "西", "北"] as const;
const WIND_NAMES = ["East", "South", "West", "North"] as const;
/** Where each seat sits relative to you. Play goes counter-clockwise: the next player is on your right. */
const POSITIONS = ["bottom", "right", "top", "left"] as const;
const position = (seat: Seat, me: Seat) => POSITIONS[(seat - me + 4) % 4]!;

export function Table({ game }: { game: GameSnapshot }) {
  const session = useStore((s) => s.session)!;
  const lobby = useStore((s) => s.lobby);
  const act = useStore((s) => s.act);
  const lastDiscard = useStore((s) => s.lastDiscard);
  const { view } = game;
  const me = view.seat;
  const controls = useTableControls(game, `mahjong.hand.${session.room}.${session.memberId}`, act);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => controls.onKey(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nameOf = (seat: Seat) => {
    const id = lobby?.seats[seat];
    const name = lobby?.members.find((m) => m.id === id)?.name ?? `Seat ${seat + 1}`;
    return seat === me ? `${name} (you)` : name;
  };
  const turnSeat =
    view.phase.kind === "awaitDiscard" || view.phase.kind === "claimed" ? view.phase.seat : null;
  const revealed = view.phase.kind === "handOver" ? view.phase.hands : null;
  const offer = view.phase.kind === "claimWindow" ? view.phase.tile : null;
  const canClaim = game.legalActions.some((a) => a.type === "claim");

  return (
    <div className="table">
      {view.players.map((p) => {
        const pos = position(p.seat, me);
        return (
          <div key={p.seat} className={`seat seat-${pos}${turnSeat === p.seat ? " seat-turn" : ""}`}>
            <SeatLabel name={nameOf(p.seat)} wind={p.wind} dealer={p.seat === view.dealer} />
            {pos === "bottom" ? (
              <MyHand controls={controls} melds={p.melds} lastDrawn={view.lastDrawn} />
            ) : (
              <OpponentHand player={p} revealed={revealed?.[p.seat] ?? null} />
            )}
          </div>
        );
      })}

      <div className="center">
        {view.players.map((p) => (
          <Pond
            key={p.seat}
            position={position(p.seat, me)}
            discards={p.discards}
            latest={lastDiscard}
            offer={offer}
            onClaim={canClaim ? () => act({ type: "claim" }) : null}
          />
        ))}
        <CenterInfo game={game} nameOf={nameOf} canClaim={canClaim} onClaim={() => act({ type: "claim" })} />
      </div>

      <ActionBar commands={controls.barCommands} status={statusLine(game, nameOf)} onSort={controls.sort} />
      {view.phase.kind === "handOver" && <HandOver game={game} nameOf={nameOf} />}
    </div>
  );
}

function SeatLabel({ name, wind, dealer }: { name: string; wind: Wind; dealer: boolean }) {
  return (
    <div className="seat-label">
      <span className="wind" title={`${WIND_NAMES[wind]} seat`}>
        {WIND_GLYPHS[wind]}
      </span>
      {name}
      {dealer && <span className="dealer">dealer</span>}
    </div>
  );
}

/**
 * Another player: locked sets face up, then their complete concealed sets as face-down groups of three,
 * then the rest face down and loose. At the end of the hand, their tiles are shown face up.
 */
function OpponentHand({ player, revealed }: { player: PublicPlayer; revealed: TileId[] | null }) {
  const loose = player.handCount - 3 * player.concealedSets;
  return (
    <div className="opponent-hand">
      <Melds melds={player.melds} size="sm" />
      {revealed ? (
        <div className="meld">
          {revealed.map((t) => (
            <Tile key={t} kind={kindOf(t)} size="sm" />
          ))}
        </div>
      ) : (
        <>
          {Array.from({ length: player.concealedSets }, (_, i) => (
            <div key={i} className="meld concealed-set" title="A complete set (hidden)">
              <Tile size="sm" />
              <Tile size="sm" />
              <Tile size="sm" />
            </div>
          ))}
          <div className="meld loose-backs">
            {Array.from({ length: loose }, (_, i) => (
              <Tile key={i} size="sm" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Pond(props: {
  position: string;
  discards: TileId[];
  latest: TileId | null;
  offer: TileId | null;
  onClaim: (() => void) | null;
}) {
  return (
    <div className={`pond pond-${props.position}`}>
      {props.discards.map((t) => {
        const claimable = t === props.offer && props.onClaim !== null;
        return (
          <div key={t} className={claimable ? "claimable" : undefined} onClick={claimable ? props.onClaim! : undefined}>
            <Tile kind={kindOf(t)} size="xs" latest={t === props.latest} glow={claimable} />
          </div>
        );
      })}
    </div>
  );
}

function CenterInfo(props: { game: GameSnapshot; nameOf: (s: Seat) => string; canClaim: boolean; onClaim(): void }) {
  const { view } = props.game;
  const { phase } = view;
  return (
    <div className="center-info">
      <div className="prevailing" title="Prevailing wind">
        {WIND_GLYPHS[view.prevailingWind]} round
      </div>
      <div className="wall-count">{view.wallCount} tiles left</div>
      {phase.kind === "claimWindow" && (
        <div
          className={`offer${props.canClaim ? " claimable" : ""}`}
          onClick={props.canClaim ? props.onClaim : undefined}
          title={props.canClaim ? "Click (or Space) to claim" : undefined}
        >
          <Countdown msLeft={props.game.claimMsLeft} receivedAt={props.game.receivedAt} />
          <Tile kind={kindOf(phase.tile)} glow={props.canClaim} />
          {props.canClaim && <span className="offer-hint">Claim</span>}
        </div>
      )}
      {phase.kind === "claimed" && (
        <div className="offer">
          <Tile kind={kindOf(phase.tile)} />
          <span className="offer-hint">{props.nameOf(phase.seat)} claimed it</span>
        </div>
      )}
    </div>
  );
}

const CLAIM_WINDOW_MS = 5000;

/** A ring that drains over the rest of the claim window. */
function Countdown({ msLeft, receivedAt }: { msLeft: number | null; receivedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  if (msLeft === null) return null;
  const left = Math.max(0, msLeft - (now - receivedAt));
  const fraction = Math.min(1, left / CLAIM_WINDOW_MS);
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg className="countdown" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} className="countdown-track" />
      <circle cx="50" cy="50" r={r} className="countdown-ring" strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
    </svg>
  );
}

function ActionBar({ commands, status, onSort }: { commands: Command[]; status: string; onSort(): void }) {
  return (
    <div className="action-bar">
      <span className="status">{status}</span>
      {commands.map((c) => (
        <button key={c.label} onClick={c.run} className="action" style={c.color ? { background: c.color } : undefined}>
          {c.label}
          {c.key && <kbd>{c.key}</kbd>}
        </button>
      ))}
      <button className="action subtle" onClick={onSort} title="Sort the loose tiles">
        Sort <kbd>S</kbd>
      </button>
    </div>
  );
}

function statusLine({ view, legalActions }: GameSnapshot, nameOf: (s: Seat) => string): string {
  const { phase } = view;
  const mine = (s: Seat) => s === view.seat;
  switch (phase.kind) {
    case "awaitDiscard":
      return mine(phase.seat) ? "Your turn: select a tile to discard" : `${nameOf(phase.seat)} is thinking…`;
    case "claimWindow":
      if (legalActions.length > 0) return `You can claim the ${kindCode(kindOf(phase.tile))}`;
      return `${nameOf(phase.from)} discarded`;
    case "claimed":
      if (!mine(phase.seat)) return `${nameOf(phase.seat)} claimed the ${kindCode(kindOf(phase.tile))}`;
      return legalActions.length > 1 ? "Choose how to use the tile" : "Confirm how to use the tile";
    case "handOver":
      return "Hand over";
  }
}

function HandOver({ game, nameOf }: { game: GameSnapshot; nameOf: (s: Seat) => string }) {
  const { startHand, showLobby } = useStore();
  const { phase } = game.view;
  if (phase.kind !== "handOver") return null;
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
  return (
    <div className="hand-over">
      <h2>{headline}</h2>
      <ul>
        {result.payments.map((p, seat) => (
          <li key={seat}>
            {nameOf(seat as Seat)}: <strong>{p > 0 ? `+${p}` : p}</strong>
          </li>
        ))}
      </ul>
      <div className="hand-over-buttons">
        <button onClick={startHand}>Deal again</button>
        <button className="subtle" onClick={showLobby}>
          Back to lobby
        </button>
      </div>
    </div>
  );
}
