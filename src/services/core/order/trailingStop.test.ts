import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { TrailingStop } from './trailingStop';

describe('TrailingStop', () => {
  let trailingStop: TrailingStop;
  const onTriggerMock = vi.fn();
  let emitSpy: MockInstance;

  beforeEach(() => {
    trailingStop = new TrailingStop({ trail: 10, initialPrice: 100, onTrigger: onTriggerMock });
    emitSpy = vi.spyOn(trailingStop, 'emit');
  });

  it('should call onTrigger when the stop hits', () => {
    trailingStop.updatePrice(50);

    expect(onTriggerMock).toHaveBeenCalledTimes(1);
    expect(onTriggerMock).toHaveBeenCalledWith(50);
  });

  it('should emit a trigger event when the stop hits', () => {
    trailingStop.updatePrice(50);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('trigger', 50);
  });

  it('should not trigger when the the price does not go down', () => {
    trailingStop.updatePrice(100);
    trailingStop.updatePrice(101);
    trailingStop.updatePrice(102);
    trailingStop.updatePrice(103);
    trailingStop.updatePrice(104);

    expect(onTriggerMock).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should not trigger when the the price goes down but above the offset', () => {
    trailingStop.updatePrice(99);
    trailingStop.updatePrice(98);
    trailingStop.updatePrice(97);
    trailingStop.updatePrice(96);
    trailingStop.updatePrice(95);
    trailingStop.updatePrice(94);
    trailingStop.updatePrice(93);
    trailingStop.updatePrice(92);
    trailingStop.updatePrice(91);

    expect(onTriggerMock).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should trigger when the the price equals the offset', () => {
    trailingStop.updatePrice(99);
    trailingStop.updatePrice(98);
    trailingStop.updatePrice(92);
    trailingStop.updatePrice(90);

    expect(onTriggerMock).toHaveBeenCalledTimes(1);
    expect(onTriggerMock).toHaveBeenCalledWith(90);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('trigger', 90);
  });

  it('should trigger when the the price goes up and down', () => {
    trailingStop.updatePrice(101);
    trailingStop.updatePrice(102);
    trailingStop.updatePrice(103);
    trailingStop.updatePrice(104);
    trailingStop.updatePrice(105);
    trailingStop.updatePrice(95);

    expect(onTriggerMock).toHaveBeenCalledTimes(1);
    expect(onTriggerMock).toHaveBeenCalledWith(95);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('trigger', 95);
  });

  it('should only trigger once', () => {
    trailingStop.updatePrice(90);
    trailingStop.updatePrice(80);

    expect(onTriggerMock).toHaveBeenCalledTimes(1);
    expect(onTriggerMock).toHaveBeenCalledWith(90);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('trigger', 90);
  });
});
