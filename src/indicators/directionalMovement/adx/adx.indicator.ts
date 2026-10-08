import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { WilderSmoothing } from '@indicators/movingAverages/wilderSmoothing/wilderSmoothing.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { DX } from '../dx/dx.indicator';

export class ADX extends Indicator<'ADX'> {
  private dx: DX;
  private smoothing: WilderSmoothing;

  /** @param period - Period of the DX and of its smoothing: a whole number, at least 1. Required */
  constructor({ period }: IndicatorRegistry['ADX']['input']) {
    super();
    checkInteger('ADX', 'period', period);
    this.dx = new DX({ period });
    this.smoothing = new WilderSmoothing({ period });
  }

  public onNewCandle(candle: Candle): void {
    this.dx.onNewCandle(candle);
    const dx = this.dx.getResult();
    if (isNil(dx)) return;

    // ADX is Wilder's smoothing of DX: it used to repeat the recurrence inline instead of sharing the class ATR and RSI use
    this.smoothing.onNewCandle({ close: dx } as Candle);
    this.result = this.smoothing.getResult();
  }
}
