import { Indicator } from '../../indicator';

export class ADL extends Indicator {
  public onNewCandle(/** candle: Candle*/): void {
    throw new Error('Method not implemented.');
  }
  public getResult(): number | null {
    throw new Error('Method not implemented.');
  }
}
