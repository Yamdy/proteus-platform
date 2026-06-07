// @proteus-ai/server — WebSocket real-time event push

import type { FastifyInstance } from "fastify";
import type { EventLog, StoreEvent } from "@proteus-ai/core";

type Subscriber = (event: StoreEvent) => void;

export class EventBus {
  private subscribers = new Map<string, Set<Subscriber>>();
  private globalSubscribers = new Set<Subscriber>();

  constructor(private readonly eventLog?: EventLog) {}

  subscribe(sessionId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(sessionId);
    if (!set) { set = new Set(); this.subscribers.set(sessionId, set); }
    set.add(fn);
    return () => { set!.delete(fn); if (set!.size === 0) this.subscribers.delete(sessionId); };
  }

  subscribeAll(fn: Subscriber): () => void {
    this.globalSubscribers.add(fn);
    return () => { this.globalSubscribers.delete(fn); };
  }

  publish(event: StoreEvent): void {
    this.eventLog?.appendEvent(event);
    const set = this.subscribers.get(event.sessionId);
    if (set) for (const fn of set) try { fn(event); } catch { /* protect bus */ }
    for (const fn of this.globalSubscribers) try { fn(event); } catch { /* protect bus */ }
  }
}

interface ClientMessage {
  action?: "subscribe" | "unsubscribe";
  type?: "subscribe" | "unsubscribe";
  sessionId?: string;
}

export interface WsRoutesOptions {
  eventBus: EventBus;
}

export async function registerWsRoutes(app: FastifyInstance, opts: WsRoutesOptions): Promise<void> {
  const { eventBus } = opts;

  app.get("/ws", { websocket: true } as any, (socket: any) => {
    let currentUnsub: (() => void) | null = null;
    const clearSub = () => { if (currentUnsub) { currentUnsub(); currentUnsub = null; } };

    socket.on("message", (raw: Buffer | string) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch {
        socket.send(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      if (msg.action === "subscribe" || msg.type === "subscribe") {
        clearSub();
        const push = (evt: StoreEvent) => {
          try { socket.send(JSON.stringify({ event: evt.event, payload: evt.payload, timestamp: evt.timestamp })); } catch { /* disconnected */ }
        };
        currentUnsub = msg.sessionId ? eventBus.subscribe(msg.sessionId, push) : eventBus.subscribeAll(push);
        socket.send(JSON.stringify({ action: "subscribed", sessionId: msg.sessionId ?? null }));
      } else if (msg.action === "unsubscribe" || msg.type === "unsubscribe") {
        clearSub();
        socket.send(JSON.stringify({ action: "unsubscribed", sessionId: null }));
      }
    });

    socket.on("close", () => { clearSub(); });
  });
}
