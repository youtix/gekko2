import { debug } from '@services/logger';
import { Fifo } from '@utils/collection/fifo';
import { DeffferedEvent } from '../../models/event.types';

type Listener<T = unknown> = (payload: T) => Promise<void> | void;

export class SequentialEventEmitter {
  private listeners: Map<string, Listener[]>;
  private readonly defferedEvents: Fifo<DeffferedEvent>;
  private readonly emitterName: string;

  constructor(emitterName: string) {
    this.listeners = new Map();
    this.defferedEvents = new Fifo();
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
    this.defferedEvents.push({ name, payload });
  }

  public async broadcastDeferredEmit(): Promise<boolean> {
    const event = this.defferedEvents.shift();
    if (!event) return false;
    debug('event', `[${this.emitterName}] Broadcasting deferred event: ${event.name}`);
    await this.emit(event.name, event.payload);
    return true;
  }
}
