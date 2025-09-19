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

import { StopGekkoError } from '@errors/stopGekko.error';
import { config } from '@services/configuration/configuration';
import { gekkoPipeline } from '@services/core/pipeline/pipeline';
import { error, info } from '@services/logger';
import { logVersion } from '@utils/process/process.utils';

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

  try {
    info('gekko', logVersion());
    await gekkoPipeline(); // Launch bot
  } catch (e) {
    if (e instanceof StopGekkoError) {
      info('gekko', 'Stopping Gekko Application');
      return;
    }
    error('gekko', e instanceof Error ? e.message : e);
  }
};

await main();
