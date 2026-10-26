import type { Action, Seat, TileId } from "@mahjong/engine";
import type { ClientMessage, ErrorCode, LobbyMessage, ServerMessage } from "@mahjong/protocol";
import { create } from "zustand";
import { soundsFor } from "../sound/cues";
import { playCues } from "../sound/player";
import { GameSocket, type ConnectionStatus } from "./socket";

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
  code: ErrorCode | "serverRestarting";
  message: string;
  at: number;
  /** How long to show it (default 3 s). */
  ms?: number;
}

interface Store {
  status: ConnectionStatus;
  session: Session | null;
  lobby: LobbyMessage | null;
  /** When the lobby message arrived (for its countdowns). */
  lobbyAt: number;
  game: GameSnapshot | null;
  /** Still looking at the last hand's result after the room moved on to a wind break. */
  viewingResult: boolean;
  /** Left at a wind break: show this player the celebration screen. */
  leftGame: boolean;
  /** The most recently discarded tile, for highlighting in its pond. */
  lastDiscard: TileId | null;
  notice: Notice | null;

  createRoom(name: string): void;
  joinRoom(room: string, name: string): void;
  leaveRoom(): void;
  send(message: ClientMessage): void;
  takeSeat(seat: Seat): void;
  act(action: Action): void;
  /** At a wind break: give up your seat and see the celebration. */
  leaveGame(): void;
  set(partial: Partial<Pick<Store, "viewingResult" | "leftGame">>): void;
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
        set((s) => ({
          lobby: m,
          lobbyAt: performance.now(),
          // A new game (or a fresh lobby) clears the personal end-of-game screen.
          leftGame: s.leftGame && m.phase !== "lobby",
          viewingResult: s.viewingResult && m.phase === "windBreak",
        }));
        return;
      case "state": {
        const { t: _, ...rest } = m;
        const discarded = m.events.findLast((e) => e.type === "discarded");
        const dealt = m.events.some((e) => e.type === "dealt");
        const ended = m.events.some((e) => e.type === "handOver");
        set((s) => ({
          game: { ...rest, receivedAt: performance.now() },
          viewingResult: ended || (s.viewingResult && !dealt),
          lastDiscard: discarded?.type === "discarded" ? discarded.tile : dealt ? null : s.lastDiscard,
        }));
        playCues(soundsFor(m.events, m.view.seat, m.view.dealer, m.legalActions));
        return;
      }
      case "serverRestarting":
        set({ notice: { code: "serverRestarting", message: "The server is restarting…", at: Date.now(), ms: 10_000 } });
        return;
      case "error":
        // A saved room that no longer exists: everyone left it, or the server restarted. Forget it.
        if (m.code === "noSuchRoom" && get().session) {
          saveSession(null);
          set({
            session: null,
            lobby: null,
            game: null,
            notice: {
              code: m.code,
              message: "That room has closed (everyone left, or the server restarted). Start a new room to keep playing.",
              at: Date.now(),
              ms: 12_000,
            },
          });
          return;
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
    lobbyAt: 0,
    game: null,
    viewingResult: false,
    leftGame: false,
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
      socket.send({ t: "leaveRoom" });
      saveSession(null);
      set({ session: null, lobby: null, game: null, viewingResult: false, leftGame: false });
    },
    send: (message) => socket.send(message),
    takeSeat: (seat) => socket.send({ t: "takeSeat", seat }),
    leaveGame() {
      socket.send({ t: "leaveSeat" });
      set({ leftGame: true, viewingResult: false });
    },
    set: (partial) => set(partial),
    act(action) {
      const { game } = get();
      if (game) socket.send({ t: "action", action, stateVersion: game.stateVersion });
    },
    dismissNotice: () => set({ notice: null }),
  };
});

function friendlyError(code: ErrorCode, message: string): string {
  if (code === "staleState") return "Too late: someone else got there first.";
  if (code === "noSuchRoom") return "That room doesn't exist (any more).";
  return message;
}
