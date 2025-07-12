import { HandleCommand } from './bots.types';

export abstract class Bot {
  protected handleCommand?: HandleCommand;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(handleCommand?: HandleCommand) {
    this.handleCommand = handleCommand;
  }

  protected abstract checkUpdates(): Promise<void>;

  public listen(interval = 1000) {
    this.intervalId = setInterval(this.checkUpdates, interval);
  }

  public close() {
    clearInterval(this.intervalId);
  }
}
