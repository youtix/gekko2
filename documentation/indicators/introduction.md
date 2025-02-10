# Indicators

Indicators are mathematical calculations based on candle data such as price, volume, etc., which traders use to analyze market behavior and identify potential buy or sell signals. In Gekko, indicators are key components used by strategies to assess the market and generate advice.

All indicators in Gekko follow a unified structure and lifecycle. They:

- Process incoming market candles one by one.
- Internally compute and update their values.
- Return a value via `getResult()` that can be used by strategies.

## Indicator Categories

Indicators are organized by type based on their analytical purpose:

- [**Directional Movement**](./directional-movement.md): Detects upward or downward trends in price.
- [**Momentum**](./momentum.md): Measures the speed or strength of a price movement.
- [**Moving Averages**](./moving-averages.md): Smooths out price data to identify trends over time.
- [**Oscillators**](./oscillators.md): Identifies overbought or oversold market conditions.
- [**Volatility**](./volatility.md): Measures price variation over time.
- [**Volume**](./volume.md): Analyzes the volume traded to confirm trends or reversals.

Each category will be expanded with new indicators as Gekko evolves.

## Notes

- Indicators must be added before the strategy starts running (typically in the `init()` method).
- You can use multiple indicators in a single strategy.

## Example Usage

You typically register an indicator in your strategy like this:

```ts
// In init() method
this.addIndicator('SMA', { period: 14 });
```

This adds the Simple Moving Average indicator with a 14-period window. You can later access its value with:

```ts
// In onEachCandle() method
const [sma, ...otherIndicators] = this.indicators;
const value = sma.getResult();
```