import type { Action, Seat, TileId } from "@mahjong/engine";
import type { ErrorCode, ServerMessage } from "@mahjong/protocol";
import { create } from "zustand";
import { GameSocket, type ConnectionStatus } from "./socket";

type LobbyMessage = Extract<ServerMessage, { t: "lobby" }>;
type StateMessage = Extract<ServerMessage, { t: "state" }>;

/** Who we are in which room. Saved in localStorage so a refresh rejoins the same seat. */
export interface Session {
  room: string;
  name: string;
  memberId: string;
  token: string;
}

/** The latest `state` message, plus when it arrived (for the claim countdown). */
export type GameSnapshot = Omit<StateMessage, "t"> & { receivedAt: number };

export interface Notice {
  code: ErrorCode;
  message: string;
  at: number;
}

interface Store {
  status: ConnectionStatus;
  session: Session | null;
  lobby: LobbyMessage | null;
  game: GameSnapshot | null;
  /** Show the table (true) or the lobby (false). A new deal switches to the table. */
  atTable: boolean;
  /** The most recently discarded tile, for highlighting in its pond. */
  lastDiscard: TileId | null;
  notice: Notice | null;

  createRoom(name: string): void;
  joinRoom(room: string, name: string): void;
  leaveRoom(): void;
  takeSeat(seat: Seat): void;
  leaveSeat(): void;
  addBots(): void;
  startHand(): void;
  act(action: Action): void;
  showLobby(): void;
  dismissNotice(): void;
}

const SESSION_KEY = "mahjong.session";

function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  history.replaceState(null, "", session ? `#${session.room}` : location.pathname);
}

/** The name we asked to join with, until `welcome` confirms it. */
let pendingName: string | null = null;

export const useStore = create<Store>()((set, get) => {
  const socket = new GameSocket({
    onStatus: (status) => set({ status }),
    onOpen: () => {
      // Rejoin after a refresh or a dropped connection; the server sends a fresh snapshot.
      const { session } = get();
      if (session) {
        pendingName = session.name;
        socket.send({ t: "join", room: session.room, name: session.name, sessionToken: session.token });
      }
    },
    onMessage: (m) => handle(m),
  });

  function handle(m: ServerMessage) {
    switch (m.t) {
      case "welcome": {
        const session = { room: m.room, name: pendingName ?? "", memberId: m.memberId, token: m.sessionToken };
        saveSession(session);
        set({ session });
        return;
      }
      case "lobby":
        set({ lobby: m });
        return;
      case "state": {
        const { t: _, ...rest } = m;
        const discarded = m.events.findLast((e) => e.type === "discarded");
        const dealt = m.events.some((e) => e.type === "dealt");
        set((s) => ({
          game: { ...rest, receivedAt: performance.now() },
          atTable: s.atTable || dealt || m.view.phase.kind !== "handOver",
          lastDiscard: discarded?.type === "discarded" ? discarded.tile : dealt ? null : s.lastDiscard,
        }));
        return;
      }
      case "error":
        // A saved room that no longer exists (e.g. the server restarted): forget it.
        if (m.code === "noSuchRoom" && get().session) {
          saveSession(null);
          set({ session: null, lobby: null, game: null });
        }
        set({ notice: { code: m.code, message: friendlyError(m.code, m.message), at: Date.now() } });
        return;
    }
  }

  queueMicrotask(() => socket.connect());

  return {
    status: "connecting",
    session: loadSession(),
    lobby: null,
    game: null,
    atTable: false,
    lastDiscard: null,
    notice: null,

    createRoom(name) {
      pendingName = name;
      socket.send({ t: "createRoom", name });
    },
    joinRoom(room, name) {
      pendingName = name;
      socket.send({ t: "join", room, name });
    },
    leaveRoom() {
      saveSession(null);
      set({ session: null, lobby: null, game: null, atTable: false });
      // The server only notices we've gone when the socket closes, so start a fresh one.
      socket.restart();
    },
    takeSeat: (seat) => socket.send({ t: "takeSeat", seat }),
    leaveSeat: () => socket.send({ t: "leaveSeat" }),
    addBots: () => socket.send({ t: "addBots" }),
    startHand: () => socket.send({ t: "startHand" }),
    act(action) {
      const { game } = get();
      if (game) socket.send({ t: "action", action, stateVersion: game.stateVersion });
    },
    showLobby: () => set({ atTable: false }),
    dismissNotice: () => set({ notice: null }),
  };
});

function friendlyError(code: ErrorCode, message: string): string {
  if (code === "staleState") return "Too late: someone else got there first.";
  if (code === "noSuchRoom") return "That room doesn't exist (any more).";
  return message;
}
