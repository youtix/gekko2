import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import { getCandleStart } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { startOfMinute, subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { MultiAssetBacktestStream } from '../stream/backtest/multiAssetBacktest.stream';
import { MultiAssetHistoricalStream } from '../stream/multiAssetHistorical.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';
import { FillCandleGapStream } from '../stream/validation/fillCandleGap.stream';
import { RejectDuplicateCandleStream } from '../stream/validation/rejectDuplicateCandle.stream';
import { RejectFutureCandleStream } from '../stream/validation/rejectFutureCandle.stream';

const buildRealtimePipeline = async (plugins: Plugin[]) => {
  const { pairs, timeframe, warmup } = config.getWatch();
  // Built before the clock is read below: a live stream starts with the minute in progress when it is built, so a minute
  // that closes in between is fetched by both streams (the second copy is dropped as a duplicate) rather than by neither.
  const liveStream = synchronizeStreams(pairs.map(p => new RealtimeStream(p.symbol)));
  // The warmup history holds `candleCount` whole candles, then the closed minutes of the candle in progress
  const currentMinute = startOfMinute(Date.now()).getTime();
  const start = getCandleStart(TIMEFRAME_TO_MINUTES[timeframe!], currentMinute, warmup.candleCount); // Timeframe will always defined in thanks to zod super refine
  const end = subMinutes(currentMinute, 1).getTime();
  const history = new MultiAssetHistoricalStream({ daterange: { start, end }, tickrate: warmup.tickrate, pairs });

  await pipeline(
    mergeSequentialStreams(history, liveStream),
    new RejectFutureCandleStream(),
    new RejectDuplicateCandleStream(),
    new FillCandleGapStream(pairs.map(p => p.symbol)),
    new PluginsStream(plugins),
  );
};

const buildBacktestPipeline = async (plugins: Plugin[]) => {
  const { daterange, pairs } = config.getWatch();
  if (!daterange) throw new Error('daterange is not set');

  await pipeline(new MultiAssetBacktestStream({ daterange, pairs }), new PluginsStream(plugins));
};

const buildImporterPipeline = async (plugins: Plugin[]) => {
  const { daterange, tickrate, pairs } = config.getWatch();
  if (!daterange) throw new Error('daterange is not set');

  // Closed minutes only: the exchange serves the minute in progress as an unfinished candle, and storage never replaces a
  // stored minute
  const lastClosedMinute = subMinutes(startOfMinute(Date.now()), 1).getTime();
  const isEndClosed = startOfMinute(daterange.end).getTime() <= lastClosedMinute;
  if (!isEndClosed)
    warning(
      'pipeline',
      `daterange.end ${toISOString(daterange.end)} is not a closed minute yet: importing up to the last closed minute, ${toISOString(lastClosedMinute)}.`,
    );
  const end = isEndClosed ? daterange.end : lastClosedMinute;

  const stream = new MultiAssetHistoricalStream({ daterange: { start: daterange.start, end }, tickrate, pairs });
  return pipeline(stream, new RejectFutureCandleStream(), new FillCandleGapStream(pairs.map(p => p.symbol)), new PluginsStream(plugins));
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

  // Ensure all underlying streams are destroyed when the merged stream is destroyed. They are destroyed without the error:
  // the merged stream reports it, and a stream not consumed yet has no 'error' listener, so it would raise an unhandled error.
  const originalDestroy = merged.destroy.bind(merged);
  merged.destroy = (error?: Error | null) => {
    for (const stream of streams) {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }
    return originalDestroy(error ?? undefined);
  };

  return merged;
};
