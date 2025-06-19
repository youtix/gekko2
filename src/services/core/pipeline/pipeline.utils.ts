import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { NoDaterangeFoundError } from '@errors/backtest/NoDaterangeFound.error';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { toISOString, toTimestamp } from '@utils/date/date.utils';
import { Interval, subMinutes } from 'date-fns';
import inquirer from 'inquirer';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BacktestStream } from '../stream/backtest.stream';
import { GapFillerStream } from '../stream/gapFiller/gapFiller.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle.error.ts/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';

const buildRealtimePipeline = (plugins: Plugin[]) => {
  const { tickrate, timeframe, warmup } = config.getWatch();
  const endDate = Date.now();
  const startDate = subMinutes(endDate, warmup.candleCount * TIMEFRAME_TO_MINUTES[timeframe]).getTime();
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
