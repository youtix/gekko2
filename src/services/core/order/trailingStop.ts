// Note: as of now only supports trailing the price going up (after
// a buy), on trigger (when the price moves down) you should sell.

import EventEmitter from 'node:events';
import { OnTriggerFn, TrailingStopArg } from './trailingStop.types';

// @param initialPrice: initial price, preferably buy price
// @param trail: fixed offset from the price
// @param onTrigger: fn to call when the stop triggers
export class TrailingStop extends EventEmitter {
  trail: number;
  onTrigger: OnTriggerFn;
  isLive: boolean;
  previousPrice: number;
  trailingPoint: number;

  constructor({ initialPrice, onTrigger, trail }: TrailingStopArg) {
    super();

    this.trail = trail;
    this.isLive = true;
    this.onTrigger = onTrigger;

    this.previousPrice = initialPrice;
    this.trailingPoint = initialPrice - this.trail;
  }

  updatePrice(price: number) {
    if (!this.isLive) return;

    if (price > this.trailingPoint + this.trail) {
      this.trailingPoint = price - this.trail;
    }

    this.previousPrice = price;

    if (price <= this.trailingPoint) {
      this.trigger();
    }
  }

  updateTrail(trail: number) {
    if (!this.isLive) return;

    this.trail = trail;
    this.trailingPoint = this.previousPrice - this.trail;
    // recheck whether moving the trail triggered.
    this.updatePrice(this.previousPrice);
  }

  trigger() {
    if (!this.isLive) return;

    this.isLive = false;
    if (this.onTrigger) {
      this.onTrigger(this.previousPrice);
    }
    this.emit('trigger', this.previousPrice);
  }
}
