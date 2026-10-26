import type { ClientMessage, ServerMessage } from "@mahjong/protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

/**
 * One WebSocket to the server at `/ws` on the same origin, reconnecting with backoff whenever it drops.
 * Messages sent while it's down are dropped: on reconnect the store rejoins and gets a fresh snapshot.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private retryMs = 500;

  constructor(private readonly handlers: SocketHandlers) {}

  connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.handlers.onStatus("connecting");
    ws.addEventListener("open", () => {
      this.retryMs = 500;
      this.handlers.onStatus("open");
      this.handlers.onOpen();
    });
    ws.addEventListener("message", (e) => this.handlers.onMessage(JSON.parse(String(e.data)) as ServerMessage));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.handlers.onStatus("closed");
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    });
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
