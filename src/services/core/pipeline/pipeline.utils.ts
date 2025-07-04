import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { GekkoError } from '@errors/gekko.error';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { getNextMinute, toISOString, toTimestamp } from '@utils/date/date.utils';
import { waitSync } from '@utils/process/process.utils';
import { Interval, subMinutes } from 'date-fns';
import inquirer from 'inquirer';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BacktestStream } from '../stream/backtest/backtest.stream';
import { GapFillerStream } from '../stream/gapFiller/gapFiller.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';

const buildRealtimePipeline = async (plugins: Plugin[]) => {
  info('pipeline', 'Waiting for the end of the minute to synchronize streams');
  waitSync(getNextMinute() - Date.now());

  const { tickrate, timeframe, warmup } = config.getWatch();
  const endDate = Date.now();
  const offset = getCandleTimeOffset(TIMEFRAME_TO_MINUTES[timeframe]);
  const startDate = subMinutes(endDate, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe] + offset).getTime();

  await pipeline(
    mergeSequentialStreams(
      new HistoricalCandleStream({ startDate, endDate, tickrate: warmup.tickrate }),
      new RealtimeStream({ tickrate, threshold: startDate }),
    ),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildBacktestPipeline = async (plugins: Plugin[]) => {
  const watch = config.getWatch();
  await pipeline(
    new BacktestStream(
      watch.scan
        ? await askForDaterange()
        : { start: toTimestamp(watch.daterange.start), end: toTimestamp(watch.daterange.end) },
    ),
    new GapFillerStream(),
    new PluginsStream(plugins),
  );
};

const buildImporterPipeline = async (plugins: Plugin[]) => {
  const { daterange, tickrate } = config.getWatch();
  await pipeline(
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
  if (!dateranges) throw new GekkoError('pipeline', 'No daterange found in database');
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
