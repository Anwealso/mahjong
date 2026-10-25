import { randomInt } from "node:crypto";
import { ROOM_CODE_ALPHABET } from "@mahjong/protocol";
import { DEFAULT_ROOM_OPTIONS, Room, type RoomOptions } from "./room";

/** All live rooms, by code. Rooms nobody has been connected to for a while are removed by `sweep`. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly options: RoomOptions = DEFAULT_ROOM_OPTIONS,
    private readonly idleMs = 30 * 60 * 1000,
    private readonly maxRooms = 100,
  ) {}

  /** A new room with a fresh code, or null when the server already has `maxRooms`. */
  create(): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, this.options);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Remove rooms with nobody connected and no activity for `idleMs`, and long-gone watchers from the rest. */
  sweep(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (room.connectedCount === 0 && now - room.lastActivity > this.idleMs) {
        room.dispose();
        this.rooms.delete(code);
      } else {
        room.sweepMembers(now);
      }
    }
  }

  dispose() {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
