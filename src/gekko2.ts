/*

  Gekko is a modular crypto trading bot framework supporting backtesting, real-time trading, and custom strategies.

  Disclaimer:

  USE AT YOUR OWN RISK!

  The author of this project is NOT responsible for any damage or loss caused 
  by this software. There can be bugs and the bot may not perform as expected 
  or specified. Please consider testing it first with paper trading and/or 
  backtesting on historical data. Also look at the code to see what how 
  it is working.

*/

import { ApplicationStopError } from '@errors/applicationStop.error';
import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { gekkoPipeline } from '@services/core/pipeline/pipeline';
import { inject } from '@services/injecter/injecter';
import { debug, error, info } from '@services/logger';
import { logVersion } from '@utils/process/process.utils';
import { isNil, isString } from 'lodash-es';
import { inspect } from 'node:util';

export const main = async () => {
  if (config.showLogo()) {
    // eslint-disable-next-line no-console
    console.log(`
  ______   ________  __    __  __    __   ______          ______  
 /      \\ /        |/  |  /  |/  |  /  | /      \\        /      \\ 
/$$$$$$  |$$$$$$$$/ $$ | /$$/ $$ | /$$/ /$$$$$$  |      /$$$$$$  |
$$ | _$$/ $$ |__    $$ |/$$/  $$ |/$$/  $$ |  $$ |      $$____$$ |
$$ |/    |$$    |   $$  $$<   $$  $$<   $$ |  $$ |       /    $$/ 
$$ |$$$$ |$$$$$/    $$$$$  \\  $$$$$  \\  $$ |  $$ |      /$$$$$$/  
$$ \\__$$ |$$ |_____ $$ |$$  \\ $$ |$$  \\ $$ \\__$$ |      $$ |_____ 
$$    $$/ $$       |$$ | $$  |$$ | $$  |$$    $$/       $$       |
 $$$$$$/  $$$$$$$$/ $$/   $$/ $$/   $$/  $$$$$$/        $$$$$$$$/ 
`);
  }

  let exitCode: number | undefined; // undefined: the run ended normally
  try {
    info('gekko', logVersion());
    await gekkoPipeline(); // Launch bot
  } catch (e) {
    if (e instanceof ApplicationStopError) {
      // An orderly stop (circuit breaker) is not a crash: exit 0 so that a restart-on-failure supervisor leaves it stopped
      error('gekko', `Application stopped: ${e.message}`);
      // 0 even if onUnhandledRejection set process.exitCode to 1: a failed order creation also rejects the Trader's un-awaited
      // launch(), so the flag is usually set when the breaker trips, and exit 1 would get the bot restarted, its counter reset
      exitCode = 0;
    } else {
      logFailure(e);
      exitCode = 1;
    }
  } finally {
    inject.closeStorage();
  }
  // A stopped or failed run exits explicitly, after the cleanup: in realtime mode, timers (order polling, hearts) would keep it alive
  if (exitCode !== undefined) process.exit(exitCode);
};

// "<name>: <message>", then the frames. A stack usually starts with that line, but not always: in Bun, a DOMException's stack
// (the DataCloneError of structuredClone, for one) is frames only.
const describeError = (e: Error) => {
  const header = String(e);
  return e.stack?.startsWith(header) ? e.stack : [header, e.stack].filter(Boolean).join('\n');
};

// Not String(), which gives '[object Object]' for an object, and throws for one without a prototype
const describeValue = (value: unknown) => (value instanceof Error ? describeError(value) : isString(value) ? value : inspect(value));

// Down to the root cause (inspect() cuts a chain after two causes), stopping at a cause already listed: a chain can loop
const describeCauses = (failure: unknown) => {
  const chain = [failure];
  let link = failure;
  while (link instanceof Error && !isNil(link.cause) && !chain.includes(link.cause)) {
    link = link.cause;
    chain.push(link);
  }
  return chain.slice(1).map(cause => `Caused by: ${describeValue(cause)}`);
};

/**
 * How main() and the process handlers report a failure. A GekkoError is expected and its one-line message explains it: the
 * message at error level, the stack at debug level. Anything else is unexpected: name, message and stack at error level. Causes,
 * whatever the failure, follow in full on the error-level line.
 */
const logFailure = (failure: unknown, prefix = '') => {
  const isExpected = failure instanceof GekkoError;
  error('gekko', [`${prefix}${isExpected ? failure.message : describeValue(failure)}`, ...describeCauses(failure)].join('\n'));
  if (isExpected) debug('gekko', `${prefix}${describeError(failure)}`);
};

const onUncaughtException = (e: unknown) => {
  logFailure(e, 'Uncaught exception: ');
  try {
    inject.closeStorage();
  } catch {
    // Nothing may keep the process from exiting
  }
  process.exit(1);
};

// Not fatal: timer-driven tasks (realtime candle fetch, Trader sync, order polling, Telegram sends) float promises that
// reject on transient network failures, and a network blip must not kill a live bot. The exit code still reports it.
const onUnhandledRejection = (reason: unknown) => {
  logFailure(reason, 'Unhandled rejection: ');
  process.exitCode = 1;
};

// Without them, while `await main()` is pending, Bun only prints these errors on stderr and the process keeps running
process.on('uncaughtException', onUncaughtException);
process.on('unhandledRejection', onUnhandledRejection);

await main();
