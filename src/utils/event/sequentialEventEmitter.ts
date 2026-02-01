import { debug } from '@services/logger';

type Listener<T = unknown> = (payload: T) => Promise<void> | void;

export class SequentialEventEmitter {
  private listeners: Map<string, Listener[]>;
  private readonly deferredEvents: Map<string, unknown[]>;
  private readonly emitterName: string;

  constructor(emitterName: string) {
    this.listeners = new Map();
    this.deferredEvents = new Map();
    this.emitterName = emitterName;
  }

  public on<T = unknown>(event: string, listener: Listener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(listener as Listener);
  }

  public off<T = unknown>(event: string, listener: Listener<T>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      this.listeners.set(
        event,
        eventListeners.filter(l => l !== listener),
      );
    }
  }

  public async emit<T = unknown>(event: string, payload?: T): Promise<void> {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        await listener(payload);
      }
    }
  }

  public addDeferredEmit<T = unknown>(name: string, payload: T): void {
    debug('event', `[${this.emitterName}] Adding deferred event: ${name}`);
    const existing = this.deferredEvents.get(name);
    if (existing) {
      existing.push(structuredClone(payload));
    } else {
      this.deferredEvents.set(name, [structuredClone(payload)]);
    }
  }

  public async broadcastDeferredEmit(): Promise<boolean> {
    const entry = this.deferredEvents.entries().next().value;
    if (!entry) return false;
    const [name, payloads] = entry;
    this.deferredEvents.delete(name);
    debug('event', `[${this.emitterName}] Broadcasting deferred event: ${name} (${payloads.length} payloads)`);
    await this.emit(name, payloads); // Broadcast all deferred events sequentially to avoid race conditions
    return true;
  }
}
