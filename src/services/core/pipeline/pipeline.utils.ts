import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { NoDaterangeFoundError } from '@errors/backtest/NoDaterangeFound.error';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { getNextMinute, toISOString, toTimestamp } from '@utils/date/date.utils';
import { waitSync } from '@utils/process/process.utils';
import { Interval, subMinutes } from 'date-fns';
import inquirer from 'inquirer';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BacktestStream } from '../stream/backtest.stream';
import { GapFillerStream } from '../stream/gapFiller/gapFiller.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';

export const getOffset = () => {
  const { timeframe } = config.getWatch();
  const size = TIMEFRAME_TO_MINUTES[timeframe];
  const now = new Date();

  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const month = now.getUTCMonth();
  const weekday = now.getUTCDay();

  if (size <= 1) return 0;

  if (size < 60) return minute % size;

  const minutesSinceMidnight = hour * 60 + minute;

  if (size < 1440) return minutesSinceMidnight % size;

  if (size < 10080) return minutesSinceMidnight;

  if (size === 10080) {
    const minutesSinceWeekStart = ((weekday + 6) % 7) * 1440 + minutesSinceMidnight;
    return minutesSinceWeekStart;
  }

  const startOfMonth = Date.UTC(now.getUTCFullYear(), month, 1);
  if (size === 43200) return Math.floor((now.getTime() - startOfMonth) / 60000);

  if (size === 129600) {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const quarterStart = Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1);
    return Math.floor((now.getTime() - quarterStart) / 60000);
  }

  if (size === 259200) {
    const halfStartMonth = Math.floor(month / 6) * 6;
    const halfStart = Date.UTC(now.getUTCFullYear(), halfStartMonth, 1);
    return Math.floor((now.getTime() - halfStart) / 60000);
  }

  if (size === 518400) {
    const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
    return Math.floor((now.getTime() - startOfYear) / 60000);
  }

  return 0;
};
/**
 * Case 1: timeframe: '1m', warmup.candleCount: 0
 * Launch at: 2025-01-01T16:35:55.000Z
 * Problem: We are going to send into the stream minute 2025-01-01T16:35:00:000 with posibly some trades missing inside it.
 * Solution: Wait until the beginning of the next minute to start the stream
 *
 * Case 2: timeframe: '1m', warmup.candleCount: 0
 * Launch at: 2025-01-01T16:35:00.000Z
 * Problem: We are going to download some trades from binance with start timestamp of the previous candle 2025-01-01T16:34:00.000Z
 * So trading advisor will recieve candles with posibly missing trades inside it and those candles will be from before the launch.
 * Solution: add a protection inside TradeBacther to filter those undesired candles becoming before the launch.
 *
 * Case 3: windowMode: calendar, timeframe: 1d, warmup.candleCount: 15
 * Launch at: 2025-01-15T12:00:00.000Z
 * Problem: Because we are in calendar and '1d' we need to calculate an offset to avoid to have the first
 * candle 2025-01-01T12:00:00.000Z with some minutes candle missing inside it.
 * Solution: Calculate an offset according timeframe to fill the first candle we are going to download.
 */
const buildRealtimePipeline = (plugins: Plugin[]) => {
  // We need to remove the offset of the current minute
  info('init', 'Wait until next minute to be sure the last candle fetched will be correct');
  waitSync(getNextMinute() - Date.now());

  const { tickrate, timeframe, warmup } = config.getWatch();
  const endDate = Date.now();
  const offset = getOffset();
  const startDate = subMinutes(endDate, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe] + offset).getTime();

  return pipeline(
    mergeSequentialStreams(
      new HistoricalCandleStream({ startDate, endDate, tickrate: warmup.tickrate }),
      new RealtimeStream({ tickrate }),
    ),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildBacktestPipeline = async (plugins: Plugin[]) => {
  const watch = config.getWatch();
  return pipeline(
    new BacktestStream(
      watch.scan
        ? await askForDaterange()
        : { start: toTimestamp(watch.daterange.start), end: toTimestamp(watch.daterange.end) },
    ),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildImporterPipeline = (plugins: Plugin[]) => {
  const { daterange, tickrate } = config.getWatch();
  return pipeline(
    new HistoricalCandleStream({
      startDate: toTimestamp(daterange.start),
      endDate: toTimestamp(daterange.end),
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

export const askForDaterange = async () => {
  const dateranges = inject.storage().getCandleDateranges();
  if (!dateranges) throw new NoDaterangeFoundError();
  const result = await inquirer.prompt<{ daterange: Interval<EpochTimeStamp, EpochTimeStamp> }>([
    {
      name: 'daterange',
      type: 'list',
      message: 'Please pick the daterange you are interested in testing:',
      choices: dateranges.map(b => ({
        name: `start: ${toISOString(b.daterange_start)} -> end: ${toISOString(b.daterange_end)}`,
        value: { start: b.daterange_start, end: b.daterange_end },
      })),
    },
  ]);
  return result.daterange;
};
