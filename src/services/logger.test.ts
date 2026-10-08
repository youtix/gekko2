import { LogLevel } from '@models/logLevel.types';
import { range } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transports } from 'winston';

type PrintedLine = { level: string; message: string };
type ConsoleTransport = { log: (line: PrintedLine, next: () => void) => void };
type LogFunction = 'debug' | 'info' | 'warning' | 'error';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const notice = (value: string) =>
  `Invalid GEKKO_LOG_LEVEL '${value}', falling back to 'error'. Valid levels: error, warn, info, http, verbose, debug, silly.`;

describe('logger', () => {
  let printed: PrintedLine[];

  beforeEach(() => {
    printed = [];
    // Records what winston's level filter lets through to the console transport, instead of printing it
    vi.spyOn(transports.Console.prototype as ConsoleTransport, 'log').mockImplementation((line, next) => {
      printed.push({ level: line.level, message: line.message });
      next();
    });
  });

  afterEach(() => {
    vi.mocked(transports.Console.prototype.log).mockRestore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // GEKKO_LOG_LEVEL is read when the module loads: every test imports a fresh copy
  const loadLogger = (logLevel: string | undefined) => {
    vi.stubEnv('GEKKO_LOG_LEVEL', logLevel);
    vi.resetModules();
    return import('./logger');
  };

  const logProbes = async (logLevel: string | undefined) => {
    const logger = await loadLogger(logLevel);
    logger.debug('gekko', 'probe');
    logger.info('gekko', 'probe');
    logger.warning('gekko', 'probe');
    logger.error('gekko', 'probe');
    // winston hands its first lines to the transport on a later tick
    await new Promise(resolve => setImmediate(resolve));
    return logger;
  };

  /** Logs each message through the logging function named, from a fresh copy of the module */
  const logWith = async (logLevel: string | undefined, logFunction: LogFunction, messages: unknown[]) => {
    const logger = await loadLogger(logLevel);
    messages.forEach(message => logger[logFunction]('gekko', message));
    // Lets winston hand the lines to the spy rather than to the console once the spy is restored
    await new Promise(resolve => setImmediate(resolve));
    return logger;
  };

  const isProbe = ({ message }: PrintedLine) => message === 'probe';

  it.each`
    logLevel     | levels
    ${undefined} | ${['error']}
    ${''}        | ${['error']}
    ${'error'}   | ${['error']}
    ${'warn'}    | ${['warn', 'error']}
    ${'WARN'}    | ${['warn', 'error']}
    ${'warning'} | ${['warn', 'error']}
    ${'WARNING'} | ${['warn', 'error']}
    ${'INFO'}    | ${['info', 'warn', 'error']}
    ${' info '}  | ${['info', 'warn', 'error']}
    ${'verbose'} | ${['info', 'warn', 'error']}
    ${'Debug'}   | ${['debug', 'info', 'warn', 'error']}
    ${'trace'}   | ${['error']}
  `('prints the $levels probes when GEKKO_LOG_LEVEL is $logLevel', async ({ logLevel, levels }) => {
    await logProbes(logLevel);
    expect(printed.filter(isProbe).map(({ level }) => level)).toEqual(levels);
  });

  it.each`
    logLevel
    ${undefined}
    ${''}
    ${'WARN'}
    ${'warning'}
    ${' info '}
  `('prints no fallback notice when GEKKO_LOG_LEVEL is $logLevel', async ({ logLevel }) => {
    await logProbes(logLevel);
    expect(printed.filter(line => !isProbe(line))).toEqual([]);
  });

  it.each`
    logLevel
    ${'trace'}
    ${' Loud '}
  `('prints the fallback notice once, at error level, when GEKKO_LOG_LEVEL is $logLevel', async ({ logLevel }) => {
    await logProbes(logLevel);
    expect(printed.filter(line => !isProbe(line))).toEqual([{ level: 'error', message: notice(logLevel) }]);
  });

  // The levels winston prints, as the probes above show: a caller can skip a message below them, which winston formats only to drop it
  it.each`
    logLevel     | levels
    ${undefined} | ${['error']}
    ${'error'}   | ${['error']}
    ${'warning'} | ${['warn', 'error']}
    ${'WARN'}    | ${['warn', 'error']}
    ${' info '}  | ${['info', 'warn', 'error']}
    ${'http'}    | ${['info', 'warn', 'error']}
    ${'verbose'} | ${['info', 'warn', 'error']}
    ${'Debug'}   | ${['debug', 'info', 'warn', 'error']}
    ${'silly'}   | ${['debug', 'info', 'warn', 'error']}
    ${'trace'}   | ${['error']}
  `('enables the $levels levels when GEKKO_LOG_LEVEL is $logLevel', async ({ logLevel, levels }) => {
    const { isLevelEnabled } = await loadLogger(logLevel);
    expect(LOG_LEVELS.filter(level => isLevelEnabled(level))).toEqual(levels);
  });

  it('keeps the fallback notice out of the ring buffer', async () => {
    const { getBufferedLogs } = await logProbes('trace');
    expect(getBufferedLogs().map(({ level, message }) => ({ level, message }))).toEqual([
      { level: 'warn', message: 'probe' },
      { level: 'error', message: 'probe' },
    ]);
  });

  describe('ring buffer', () => {
    // Only the levels the log monitoring forwards, whatever winston prints
    it.each`
      logLevel     | logFunction  | levels
      ${'debug'}   | ${'debug'}   | ${[]}
      ${'debug'}   | ${'info'}    | ${[]}
      ${'debug'}   | ${'warning'} | ${['warn']}
      ${'debug'}   | ${'error'}   | ${['error']}
      ${undefined} | ${'warning'} | ${['warn']}
    `('holds $levels once $logFunction has logged with GEKKO_LOG_LEVEL $logLevel', async ({ logLevel, logFunction, levels }) => {
      const { getBufferedLogs } = await logWith(logLevel, logFunction, ['probe']);
      expect(getBufferedLogs().map(({ level }) => level)).toEqual(levels);
    });

    it('holds the time, level, tag and message of a log', async () => {
      vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
      const { getBufferedLogs } = await logWith(undefined, 'error', ['probe']);
      expect(getBufferedLogs()).toEqual([{ timestamp: 1000, level: 'error', tag: 'gekko', message: 'probe' }]);
    });

    it.each`
      message     | buffered
      ${'text'}   | ${'text'}
      ${{ a: 1 }} | ${'{"a":1}'}
    `('holds the message $message as $buffered', async ({ message, buffered }) => {
      const { getBufferedLogs } = await logWith(undefined, 'warning', [message]);
      expect(getBufferedLogs().map(log => log.message)).toEqual([buffered]);
    });

    it('keeps the newest 1000 logs, oldest first', async () => {
      const messages = range(1001).map(index => `w${index}`);
      const { getBufferedLogs } = await logWith(undefined, 'warning', messages);
      expect(getBufferedLogs().map(log => log.message)).toEqual(messages.slice(1));
    });

    it('returns the same entry objects to a later call', async () => {
      const { warning, getBufferedLogs } = await logWith(undefined, 'warning', ['w0']);
      const [entry] = getBufferedLogs();
      warning('gekko', 'w1');
      expect(getBufferedLogs()[0]).toBe(entry);
    });
  });
});
