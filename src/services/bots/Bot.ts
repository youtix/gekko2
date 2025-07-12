import { wait } from '@utils/process/process.utils';
import { HandleCommand } from './bots.types';

export abstract class Bot {
  protected handleCommand?: HandleCommand;
  private isListening: boolean;

  constructor(handleCommand?: HandleCommand) {
    this.handleCommand = handleCommand;
    this.isListening = false;
  }

  protected abstract checkUpdates(): Promise<void>;

  public async listen(interval = 1000) {
    this.isListening = true;
    while (this.isListening) {
      await this.checkUpdates();
      await wait(interval);
    }
  }

  public close() {
    this.isListening = false;
  }
}
