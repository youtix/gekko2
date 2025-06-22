import inquirer from 'inquirer';
import { Readable } from 'stream';
import { describe, expect, it, Mock, vi } from 'vitest';
import { NoDaterangeFoundError } from '../../../errors/backtest/NoDaterangeFound.error';
import { inject } from '../../injecter/injecter';
import { askForDaterange } from './pipeline.utils';

vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}));
vi.mock('@services/injecter/injecter', () => ({
  inject: { storage: vi.fn() },
}));
vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({
      timeframe: '1m',
      tickrate: 1,
      warmup: { candleCount: 0, tickrate: 1 },
      daterange: { start: '2020-01-01', end: '2020-01-02' },
    })),
  },
}));

describe('pipeline utils', () => {
  describe('mergeSequentialStreams', () => {
    it('concats multiple streams sequentially', async () => {
      const { mergeSequentialStreams } = await import('./pipeline.utils');
      const s1 = Readable.from([1, 2]);
      const s2 = Readable.from([3]);
      const merged = mergeSequentialStreams(s1, s2);
      const result: number[] = [];
      for await (const c of merged) result.push(c as number);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('askForDaterange', () => {
    const prompt = inquirer.prompt as unknown as Mock;

    it('throws when no dateranges found', async () => {
      (inject.storage as Mock).mockReturnValue({ getCandleDateranges: () => undefined });
      await expect(askForDaterange()).rejects.toThrow(NoDaterangeFoundError);
    });

    it('returns selected daterange', async () => {
      const dates = [{ daterange_start: 1, daterange_end: 2 }];
      (inject.storage as Mock).mockReturnValue({ getCandleDateranges: () => dates });
      prompt.mockResolvedValue({ daterange: { start: 1, end: 2 } });
      await expect(askForDaterange()).resolves.toEqual({ start: 1, end: 2 });
    });
  });
});
