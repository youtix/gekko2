import EventEmitter from 'node:events';
import { OnTriggerFn, TrailingStopArg } from './trailingStop.types';

/**
 * Note: as of now only supports trailing the price going up (after a buy),
 * on trigger (when the price moves down) you should sell.
 */
export class TrailingStop extends EventEmitter {
  private trail: number;
  private onTrigger: OnTriggerFn;
  private isLive: boolean;
  private previousPrice: number;
  private trailingPoint: number;

  /**
   * @param initialPrice: initial price, preferably buy price
   * @param trail: fixed offset from the price
   * @param onTrigger: function to call when the stop triggers
   */
  constructor({ initialPrice, onTrigger, trail }: TrailingStopArg) {
    super();

    this.trail = trail;
    this.isLive = true;
    this.onTrigger = onTrigger;

    this.previousPrice = initialPrice;
    this.trailingPoint = initialPrice - this.trail;
  }

  public updatePrice(price: number) {
    if (!this.isLive) return;

    if (price > this.trailingPoint + this.trail) {
      this.trailingPoint = price - this.trail;
    }

    this.previousPrice = price;

    if (price <= this.trailingPoint) {
      this.trigger();
    }
  }

  public updateTrail(trail: number) {
    if (!this.isLive) return;

    this.trail = trail;
    this.trailingPoint = this.previousPrice - this.trail;
    // recheck whether moving the trail triggered.
    this.updatePrice(this.previousPrice);
  }

  private trigger() {
    if (!this.isLive) return;

    this.isLive = false;
    if (this.onTrigger) {
      this.onTrigger(this.previousPrice);
    }
    this.emit('trigger', this.previousPrice);
  }
}
