# Moving Averages

Moving averages are one of the most widely used tools in technical analysis. They smooth out price data over a defined period to help identify the direction of a trend and filter out market noise. Gekko 2 includes several types of moving averages, each with its own behavior and use case.

## **SMA (Simple Moving Average)**

SMA calculates the arithmetic mean of prices over a given period. It gives equal weight to each data point. It's useful for identifying trends and support/resistance levels but can be slow to react to sudden price changes.

## **EMA (Exponential Moving Average)**

EMA gives more weight to recent prices, making it more responsive to new data than the SMA. It reacts faster to recent price changes and is popular for short-term trend tracking.

## **DEMA (Double Exponential Moving Average)**

DEMA is designed to reduce the lag of traditional EMAs. It combines an EMA and another EMA applied to the first EMA, providing a smoother and more responsive trend-following line.

## **TEMA (Triple Exponential Moving Average)**

TEMA further reduces lag compared to EMA and DEMA by combining a single EMA, a double EMA, and a triple EMA into one formula. This results in a moving average that is even more responsive to price changes while maintaining smoothness, making it useful for traders who want to minimize lag in their signals.

## **WMA (Weighted Moving Average)**

WMA assigns more weight to recent prices by multiplying each price by a weight based on its age. This makes it more sensitive than SMA or EMA to recent price movements.

## **SMMA (Smoothed Moving Average)**

SMMA is similar to EMA but applies a longer smoothing factor, resulting in a slower and smoother curve. It’s useful for filtering out extreme short-term volatility.

## **WilderSmoothing**

This smoothing method is based on the technique introduced by J. Welles Wilder and is often used in indicators like ATR and RSI. It is a form of exponential smoothing that reduces lag while maintaining stability.

## EMA Ribbon

EMA Ribbon stacks a series of EMAs with progressively longer periods. By default it uses 22 EMAs starting at period 3 and increasing by 3 each time. The indicator tracks the spread between the highest and lowest EMA values to gauge trend strength.
