import type { Seat } from "@mahjong/engine";
import type { LobbyMessage, MemberInfo } from "@mahjong/protocol";
import { useStore } from "./store";

/** Handy facts about the room, from the latest lobby message, from your point of view. */
export interface RoomView {
  lobby: LobbyMessage;
  me: MemberInfo | undefined;
  mySeat: Seat | null;
  isHost: boolean;
  memberAt(seat: Seat): MemberInfo | undefined;
  /** "Ann", "Bot 2", or "Seat 3" when empty. */
  nameOf(seat: Seat): string;
}

export function roomView(lobby: LobbyMessage, memberId: string): RoomView {
  const me = lobby.members.find((m) => m.id === memberId);
  const memberAt = (seat: Seat) => lobby.members.find((m) => m.id === lobby.seats[seat]);
  return {
    lobby,
    me,
    mySeat: me?.seat ?? null,
    isHost: lobby.hostId === memberId,
    memberAt,
    nameOf: (seat) => memberAt(seat)?.name ?? `Seat ${seat + 1}`,
  };
}

/** The room view, or null before we've joined. */
export function useRoom(): RoomView | null {
  const lobby = useStore((s) => s.lobby);
  const session = useStore((s) => s.session);
  return lobby && session ? roomView(lobby, session.memberId) : null;
}
