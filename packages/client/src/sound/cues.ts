import type { Action, GameEvent, Seat } from "@mahjong/engine";

/** Every sound the game can play. Recorded ones are files in `public/sounds/`; the rest are synthesised. */
export type SoundId =
  | "deal"
  | "discard"
  | "discardOther"
  | "draw"
  | "yourTurn"
  | "claimPing"
  | "set"
  | "kong"
  | "win"
  | "winBig"
  | "drawHand"
  | "gong"
  | "cheer"
  | "hostPrompt";

/** A sound to play, `delay` ms after the message arrived (so sounds in one message don't pile up). */
export interface Cue {
  sound: SoundId;
  delay: number;
}

/**
 * What to play for one `state` message: its events (already filtered for this seat), who we are, and
 * what we may do now. Other players' draws are silent; alerts only play for you. See docs/sound.md.
 */
export function soundsFor(events: readonly GameEvent[], mySeat: Seat, dealer: Seat, legalActions: readonly Action[]): Cue[] {
  const cues: Cue[] = [];
  let delay = 0;
  const add = (sound: SoundId, gap = 0) => {
    delay += cues.length > 0 ? gap : 0;
    cues.push({ sound, delay });
  };

  for (const e of events) {
    switch (e.type) {
      case "dealt":
        add("deal");
        if (dealer === mySeat) add("yourTurn", 900);
        break;
      case "drew":
        if (e.seat !== mySeat) break;
        add("draw", 150);
        if (!e.replacement) add("yourTurn", 150);
        break;
      case "discarded":
        add(e.seat === mySeat ? "discard" : "discardOther", 150);
        break;
      case "claimWindowOpened":
        if (legalActions.some((a) => a.type === "claim")) add("claimPing", 120);
        break;
      case "melded":
        add(e.meld.type === "kong" ? "kong" : "set", 150);
        break;
      case "kongAdded":
        add("kong", 150);
        break;
      case "handOver":
        if (e.result.kind === "draw") add("drawHand", 300);
        else add(e.result.winner === mySeat ? "winBig" : "win", 300);
        break;
      case "claimed":
        // The set (or the win) that follows has its own sound.
        break;
    }
  }
  return cues;
}
