import { config } from '@services/configuration/configuration';
import { SQLiteStorage } from './sqlite.storage';
import { Storage } from './storage';

class StateManager {
  private startTime: EpochTimeStamp;
  private storageInstance?: Storage;

  constructor() {
    this.startTime = Date.now();
  }

  public getStartTime() {
    return this.startTime;
  }

  public getStorageInstance(): Storage {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (storageConfig?.type === 'sqlite') return new SQLiteStorage();
    throw new Error();
  }
}

export const stateManager = new StateManager();
