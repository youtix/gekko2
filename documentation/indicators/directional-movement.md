# Directional Movement Indicators

Directional movement indicators help identify whether a market is trending and measure the strength of that trend. They are the foundation of many trend-following strategies and are often used together to assess both the direction and strength of price movements.

Originally developed by J. Welles Wilder, these indicators are widely used in technical analysis. In Gekko 2, they can be used individually or in combination to support sophisticated trading logic.

## **ADX (Average Directional Index)**

The ADX quantifies the strength of a trend, regardless of its direction. A rising ADX indicates a strengthening trend, while a falling ADX indicates a weakening trend. Values above 25 typically signal a strong trend.

## **DX (Directional Index)**

The DX measures the difference between the positive and negative directional indicators (`+DI` and `-DI`). It is an intermediate step in calculating the ADX and reflects directional strength.

## **+DI (Positive Directional Indicator / plusDI)**

+DI measures upward movement in price. When +DI is greater than -DI, it signals that bullish strength is dominating the market.

## **-DI (Negative Directional Indicator / minusDI)**

-DI measures downward movement in price. When -DI is greater than +DI, it suggests bearish strength is currently in control.

## **+DM (Positive Directional Movement / plusDM)**

+DM is calculated based on the difference between the current and previous highs. It is used in computing the +DI value and represents the magnitude of upward movement.

## **-DM (Negative Directional Movement / minusDM)**

-DM is based on the difference between the current and previous lows. It contributes to the -DI value and represents the magnitude of downward movement.

## **ADX Ribbon**

The ADX Ribbon stacks many ADX values with increasing periods to create fast and slow groups. When each group is aligned in one direction, it highlights a strong and persistent trend.
