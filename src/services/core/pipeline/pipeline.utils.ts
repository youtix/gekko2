import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { resetDateParts } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { MultiAssetBacktestStream } from '../stream/backtest/multiAssetBacktest.stream';
import { MultiAssetHistoricalStream } from '../stream/multiAssetHistorical.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';
import { FillCandleGapStream } from '../stream/validation/fillCandleGap.stream';
import { RejectDuplicateCandleStream } from '../stream/validation/rejectDuplicateCandle.stream';
import { RejectFutureCandleStream } from '../stream/validation/rejectFuturCandle.stream';

const buildRealtimePipeline = async (plugins: Plugin[]) => {
  const { pairs, timeframe, warmup } = config.getWatch();
  // End time of the last candle to download (now)
  const end = resetDateParts(processStartTime(), ['s', 'ms']);
  // Offset to align candles to the start of the timeframe
  const offset = getCandleTimeOffset(TIMEFRAME_TO_MINUTES[timeframe], end);
  // Start time of the first candle to download
  const start = subMinutes(end, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe] + offset).getTime();

  await pipeline(
    mergeSequentialStreams(
      new MultiAssetHistoricalStream({ daterange: { start, end }, tickrate: warmup.tickrate, pairs }),
      synchronizeStreams(pairs.map(p => new RealtimeStream(p.symbol))),
    ),
    new RejectFutureCandleStream(),
    new RejectDuplicateCandleStream(),
    new FillCandleGapStream(),
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

  const stream = new MultiAssetHistoricalStream({ daterange, tickrate, pairs });
  return pipeline(stream, new FillCandleGapStream(), new PluginsStream(plugins));
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
