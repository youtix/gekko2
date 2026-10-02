import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transports } from 'winston';

type PrintedLine = { level: string; message: string };
type ConsoleTransport = { log: (line: PrintedLine, next: () => void) => void };

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

  it('keeps the fallback notice out of the ring buffer, which still gets every probe', async () => {
    const { getBufferedLogs } = await logProbes('trace');
    expect(getBufferedLogs().map(({ level, message }) => ({ level, message }))).toEqual([
      { level: 'debug', message: 'probe' },
      { level: 'info', message: 'probe' },
      { level: 'warn', message: 'probe' },
      { level: 'error', message: 'probe' },
    ]);
  });

  it.each`
    message     | buffered
    ${'text'}   | ${'text'}
    ${{ a: 1 }} | ${'{"a":1}'}
  `('buffers the message $message as $buffered', async ({ message, buffered }) => {
    const { info, getBufferedLogs } = await loadLogger(undefined);
    info('gekko', message);
    expect(getBufferedLogs().map(log => log.message)).toEqual([buffered]);
  });
});
