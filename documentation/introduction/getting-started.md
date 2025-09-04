# Getting Started

Welcome to Gekko 2! This guide will help you set up your environment and run your first trading strategy.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Bun](https://bun.sh/) (latest version)
- Git (to clone the repository)

## Installation

1. Clone the Gekko 2 repository:

   ```bash
   git clone https://github.com/youtix/gekko2.git
   cd gekko2
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

## Importing Data

To import historical market data for backtesting:

1. Configure gekko 2 with [importer mode](../modes/importer.md)

2. Run the importer:

   ```bash
   bun run gekko
   ```

   This will fetch and store the historical data locally.

## Backtesting Data

To backtest your strategy using the imported data:

1. Configure gekko 2 with [backtest mode](../modes/backtest.md)

2. Run the backtest:

   ```bash
   bun run gekko
   ```

3. Review the results in the console output or generated reports.

## Running Strategies in Live Mode

To run a strategy in live trading mode:

1. Configure gekko 2 with [realtime mode](../modes/realtime.md)

2. Start the live trading process:

   ```bash
   bun run gekko
   ```

   This will connect to the exchange and execute trades based on your strategy.

## Next Steps

- Explore the [Strategies](../strategies/introduction.md) section to learn more about creating custom strategies.
- Check out the [Plugins](../plugins/introduction.md) section to extend Gekko's functionality.
- Dive into the [Modes](../modes/introduction.md) section to understand different ways to run Gekko.
