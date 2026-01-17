import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { resetDateParts } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BacktestStream } from '../stream/backtest/backtest.stream';
import { CandleValidatorStream } from '../stream/candleValidator/candleValidator.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';

const buildRealtimePipeline = async (plugins: Plugin[]) => {
  const { pairs, warmup } = config.getWatch();
  const { timeframe } = pairs[0]; // TODO: support multiple pairs
  const now = resetDateParts(processStartTime(), ['s', 'ms']);
  const offset = getCandleTimeOffset(TIMEFRAME_TO_MINUTES[timeframe], now);
  const startDate = subMinutes(now, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe] + offset).getTime();

  await pipeline(
    mergeSequentialStreams(
      new HistoricalCandleStream({ startDate, endDate: now, tickrate: warmup.tickrate }),
      new RealtimeStream(),
    ),
    new CandleValidatorStream(),
    new PluginsStream(plugins),
  );
};

const buildBacktestPipeline = async (plugins: Plugin[]) => {
  const { daterange } = config.getWatch(); // Daterange is always set thanks to zod

  await pipeline(
    new BacktestStream({ start: daterange!.start, end: daterange!.end }),
    new CandleValidatorStream(),
    new PluginsStream(plugins),
  );
};

const buildImporterPipeline = async (plugins: Plugin[]) => {
  const { daterange, tickrate } = config.getWatch(); // Daterange is always set thanks to zod
  await pipeline(
    new HistoricalCandleStream({ startDate: daterange!.start, endDate: daterange!.end, tickrate }),
    new CandleValidatorStream(),
    new PluginsStream(plugins),
  );
};

export const streamPipelines = {
  realtime: buildRealtimePipeline,
  backtest: buildBacktestPipeline,
  importer: buildImporterPipeline,
};

export const mergeSequentialStreams = (...streams: Readable[]) => {
  async function* concatGenerator() {
    for (const stream of streams) {
      for await (const chunk of stream) {
        yield chunk;
      }
    }
  }

  const merged = Readable.from(concatGenerator());

  // Ensure all underlying streams are destroyed when the merged stream is destroyed
  const originalDestroy = merged.destroy.bind(merged);
  merged.destroy = (error?: Error | null) => {
    for (const stream of streams) {
      if (!stream.destroyed) {
        stream.destroy(error ?? undefined);
      }
    }
    return originalDestroy(error ?? undefined);
  };

  return merged;
};
