import { debug } from '@services/logger';

type Listener<T = unknown> = (payload: T) => Promise<void> | void;

/** Payloads queued in a row under one event name, which its listeners receive together, as one array */
type DeferredGroup = { name: string; payloads: unknown[] };

export class SequentialEventEmitter {
  private listeners: Map<string, Listener[]>;
  /**
   * The deferred events in the order they were queued. Only payloads queued in a row under one name are grouped: listeners depend on
   * the order across events too (a cancelation must follow the creation of its order, a fill between two errors makes them not
   * consecutive).
   */
  private readonly deferredGroups: DeferredGroup[];
  private readonly emitterName: string;

  constructor(emitterName: string) {
    this.listeners = new Map();
    this.deferredGroups = [];
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
    const lastGroup = this.deferredGroups.at(-1);
    if (lastGroup?.name === name) lastGroup.payloads.push(structuredClone(payload));
    else this.deferredGroups.push({ name, payloads: [structuredClone(payload)] });
  }

  /** Delivers the oldest group of deferred events. Resolves to false when none is queued, to true otherwise. */
  public async broadcastDeferredEmit(): Promise<boolean> {
    // Out of the queue before its delivery: a payload a listener queues meanwhile joins a later group, not the array being delivered
    const group = this.deferredGroups.shift();
    if (!group) return false;
    const { name, payloads } = group;
    debug('event', `[${this.emitterName}] Broadcasting deferred event: ${name} (${payloads.length} payloads)`);
    await this.emit(name, payloads); // Broadcast all deferred events sequentially to avoid race conditions
    return true;
  }
}
