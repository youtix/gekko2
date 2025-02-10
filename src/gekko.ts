/*

  Gekko is a Bitcoin trading bot for popular Bitcoin exchanges written 
  in node, it features multiple trading methods using technical analysis.

  If you are interested in how Gekko works, read more about Gekko's 
  architecture here:

  TODO: create documentation

  Disclaimer:

  USE AT YOUR OWN RISK!

  The author of this project is NOT responsible for any damage or loss caused 
  by this software. There can be bugs and the bot may not perform as expected 
  or specified. Please consider testing it first with paper trading and/or 
  backtesting on historical data. Also look at the code to see what how 
  it is working.

*/

import { pipeline } from './services/core/pipeline';
import { logger } from './services/logger';
import { logVersion } from './utils/process/process.utils';

export const main = async () => {
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

  try {
    logger.info(logVersion());
    pipeline(); // Launch bot
  } catch (e) {
    logger.error(e instanceof Error ? e.message : e);
  }
};

await main();
