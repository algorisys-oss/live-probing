import { wsUrl } from "./api";
import type { WsMessage } from "./types";

interface WsClientHandlers {
  onMessage: (msg: WsMessage) => void;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Resilient WebSocket wrapper with exponential backoff auto-reconnect.
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private handlers: WsClientHandlers;
  private backoff = 500;
  private readonly maxBackoff = 15000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(handlers: WsClientHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = 500;
      this.handlers.onOpen();
    };

    socket.onmessage = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as WsMessage;
        this.handlers.onMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      this.handlers.onClose();
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose will follow; force close to be safe
      try {
        socket.close();
      } catch {
        /* noop */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* noop */
      }
      this.socket = null;
    }
  }
}
