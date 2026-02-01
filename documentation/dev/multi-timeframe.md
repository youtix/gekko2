# multi-timeframe

## From single timeframe to multiple timeframes
### now
Actualy, we have only single timeframe for all assets.
### future
The goal is to one timeframe by asset.
### Problem
In realtime mode we need to calculate how many candles we need to warmup the application. So if we want to use 1m timeframe for BTC/USDT and 5m timeframe for ETH/USDT we need to calculate how many candles we need to warmup for both assets. 
- it asks to have one asset to begin to download further candles than other assets.
- it asks to move the warmup with candleCount config inside the asset config.
