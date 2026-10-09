import { debug } from '@services/logger';
import { copyPayload } from './event.utils';

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
  public readonly emitterName: string;

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

  /** Queues a copy of the payload, made now: what the emitter changes in its own object afterwards never reaches the listeners */
  public addDeferredEmit<T = unknown>(name: string, payload: T): void {
    debug('event', `[${this.emitterName}] Adding deferred event: ${name}`);
    const lastGroup = this.deferredGroups.at(-1);
    if (lastGroup?.name === name) lastGroup.payloads.push(structuredClone(payload));
    else this.deferredGroups.push({ name, payloads: [structuredClone(payload)] });
  }

  /**
   * Delivers the oldest group of deferred events to each listener in turn, each with its own copy of the array and its payloads.
   * Resolves to false when none is queued, to true otherwise.
   */
  public async broadcastDeferredEmit(): Promise<boolean> {
    // Out of the queue before its delivery: a payload a listener queues meanwhile joins a later group, not the array being delivered
    const group = this.deferredGroups.shift();
    if (!group) return false;
    const { name, payloads } = group;
    debug('event', `[${this.emitterName}] Broadcasting deferred event: ${name} (${payloads.length} payloads)`);
    // The listeners all got the copy made when the payloads were queued: one that wrote to it changed what the next ones received, and
    // what the others kept (the analyzers keep the latest portfolio). The last listener gets that copy, which nothing else holds any
    // more, and only the others a new one: none for a single listener, as the timeframe candle has in a backtest (its analyzer). The
    // listeners are those of the event when the delivery starts: one added meanwhile would have shared the copy of the last.
    const listeners = [...(this.listeners.get(name) ?? [])];
    for (const [index, listener] of listeners.entries()) {
      // One after the other, to avoid race conditions
      await listener(index < listeners.length - 1 ? copyPayload(payloads) : payloads);
    }
    return true;
  }

  /**
   * How many deferred payloads are still queued, per event name, in the order the names were first queued: what never arrives if no
   * broadcast follows. Only the events listened to are counted, nothing is lost with the others. It leaves the queue as it is.
   */
  public countUndeliveredPayloads(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const { name, payloads } of this.deferredGroups) {
      if (this.listeners.get(name)?.length) counts.set(name, (counts.get(name) ?? 0) + payloads.length);
    }
    return counts;
  }
}
