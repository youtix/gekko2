// All plugins supported by Gekko.
//
//  Required parameters per plugin.
//
// name: Name of the plugin
// slug: name of the plugin mapped to the config key. Expected
//    filename to exist in `gekko/plugins/` (only if path is not
//    specified)
// async: upon creating a new plugin instance, does something async
//    happen where Gekko needs to wait for? If set to true, the
//    constructor will be passed a callback which it should execute
//    as soon as Gekko can continue.
// modes: a list indicating in what Gekko modes this plugin is
//    allowed to run. Realtime is during a live market watch and
//    backtest is during a backtest.
//
//
//  Optional parameters per plugin.
//
// description: text describing the plugin.
// dependencies: a list of external npm modules this plugin requires to
//    be installed.
// emits: events emitted by this plugin that other plugins can subscribe to.
// path: fn that returns path of file of the plugin (overwrites `gekko/plugins/{slug}`)
//    when given the configuration object (relative from `gekko/plugins/`).
// greedy: if this plugin wants to subscribe to a lot of events, but can function
//    properly when some events wont be emitted.
export const plugins = [
  {
    name: 'Candle writer',
    description: 'Store candles in a database',
    slug: 'candleWriter',
    modes: ['realtime', 'importer'],
    version: 0.1,
  },
  {
    name: 'Trading Advisor',
    description: 'Calculate trading advice',
    slug: 'tradingAdvisor',
    modes: ['realtime', 'backtest'],
  },
  {
    name: 'IRC bot',
    description: 'IRC module lets you communicate with Gekko on IRC.',
    slug: 'ircbot',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'irc',
        version: '0.5.2',
      },
    ],
  },
  {
    name: 'Telegram bot',
    description: 'Telegram module lets you communicate with Gekko on Telegram.',
    slug: 'telegrambot',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'node-telegram-bot-api',
        version: '0.24.0',
      },
    ],
  },
  {
    name: 'XMPP bot',
    description: 'XMPP module lets you communicate with Gekko on Jabber.',
    slug: 'xmppbot',
    silent: false,
    modes: ['realtime'],
    dependencies: [
      {
        module: 'node-xmpp-client',
        version: '3.0.2',
      },
    ],
  },
  {
    name: 'Pushover',
    description: 'Sends pushover.',
    slug: 'pushover',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'pushover-notifications',
        version: '0.2.3',
      },
    ],
  },
  {
    name: 'Campfire bot',
    description: 'Lets you communicate with Gekko on Campfire.',
    slug: 'campfire',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'ranger',
        version: '0.2.4',
      },
    ],
  },
  {
    name: 'Mailer',
    description: 'Sends you an email everytime Gekko has new advice.',
    slug: 'mailer',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'emailjs',
        version: '1.0.5',
      },
      {
        module: 'prompt-lite',
        version: '0.1.1',
      },
    ],
  },
  {
    name: 'Advice logger',
    description: '',
    slug: 'adviceLogger',
    silent: true,
    modes: ['realtime'],
  },
  {
    name: 'Trader',
    description: 'Follows the advice and create real orders.',
    slug: 'trader',
    modes: ['realtime'],
  },
  {
    name: 'Paper Trader',
    description: 'Paper trader that simulates fake trades.',
    slug: 'paperTrader',
    modes: ['realtime', 'backtest'],
  },
  {
    name: 'Performance Analyzer',
    description: 'Analyzes performances of trades',
    slug: 'performanceAnalyzer',
    modes: ['realtime', 'backtest'],
  },
  {
    name: 'Redis beacon',
    slug: 'redisBeacon',
    description: 'Publish events over Redis Pub/Sub',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'redis',
        version: '0.10.0',
      },
    ],
  },
  {
    name: 'Pushbullet',
    description: 'Sends advice to pushbullet.',
    slug: 'pushbullet',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'pushbullet',
        version: '1.4.3',
      },
    ],
  },
  {
    name: 'Kodi',
    description: 'Sends advice to Kodi.',
    slug: 'kodi',
    modes: ['realtime'],
  },
  {
    name: 'Candle Uploader',
    description: 'Upload candles to an extneral server',
    slug: 'candleUploader',
    modes: ['realtime'],
  },
  {
    name: 'Twitter',
    description: 'Sends trades to twitter.',
    slug: 'twitter',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'twitter',
        version: '1.7.1',
      },
    ],
  },
  {
    name: 'Slack',
    description: 'Sends trades to slack channel.',
    slug: 'slack',
    modes: ['realtime'],
    dependencies: [
      {
        module: '@slack/client',
        version: '3.13.0',
      },
    ],
  },
  {
    name: 'IFTTT',
    description: 'Sends trades to IFTTT webhook.',
    slug: 'ifttt',
    modes: ['realtime'],
  },
  {
    name: 'Event logger',
    description: 'Logs all gekko events.',
    slug: 'eventLogger',
    modes: ['realtime', 'backtest'],
    greedy: true,
  },
  {
    name: 'Backtest result export',
    description: 'Exports the results of a gekko backtest',
    slug: 'backtestResultExporter',
    modes: ['backtest'],
  },
  {
    name: 'Child to parent',
    description: 'Relays events from the child to the parent process',
    slug: 'childToParent',
    modes: ['realtime'],
    greedy: true,
  },
  {
    name: 'Candle Uploader',
    description: 'Upload realtime market candles to an external server',
    slug: 'candleUploader',
    modes: ['realtime'],
    dependencies: [
      {
        module: 'axios',
        version: '0.18.0',
      },
    ],
  },
  {
    name: 'Blotter',
    description: 'Writes all buy/sell trades to a blotter CSV file',
    slug: 'blotter',
    modes: ['realtime'],
  },
];
