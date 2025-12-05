import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { resetDateParts, toTimestamp } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BacktestStream } from '../stream/backtest/backtest.stream';
import { GapFillerStream } from '../stream/gapFiller/gapFiller.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';

const buildRealtimePipeline = async (plugins: Plugin[]) => {
  const { timeframe, warmup } = config.getWatch();
  const now = resetDateParts(processStartTime(), ['s', 'ms']);
  const offset = getCandleTimeOffset(TIMEFRAME_TO_MINUTES[timeframe], now);
  const startDate = subMinutes(now, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe] + offset).getTime();

  await pipeline(
    mergeSequentialStreams(
      new HistoricalCandleStream({ startDate, endDate: now, tickrate: warmup.tickrate }),
      new RealtimeStream(),
    ),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildBacktestPipeline = async (plugins: Plugin[]) => {
  const { daterange } = config.getWatch(); // Daterange is always set thanks to zod

  await pipeline(
    new BacktestStream({ start: toTimestamp(daterange?.start), end: toTimestamp(daterange?.end) }),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildImporterPipeline = async (plugins: Plugin[]) => {
  const { daterange, tickrate } = config.getWatch();
  // Here we have already checked the watch.daterange in configuration
  await pipeline(
    new HistoricalCandleStream({
      startDate: toTimestamp(daterange!.start),
      endDate: toTimestamp(daterange!.end),
      tickrate,
    }),
    new GapFillerStream(),
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
  return Readable.from(concatGenerator());
};
