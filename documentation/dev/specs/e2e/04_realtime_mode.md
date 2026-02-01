# E2E Step 4: Realtime Mode

## Goal
Verify that Gekko2 operates correctly in live environments (Screener, Paper, Live) by processing new data as it arrives (simulated).

## Scenarios

### A. Screener (Multi-Asset)
1. **Setup**: Config watching `BTC/USDT` and `ETH/USDT`.
2. **Action**:
   - Start in `realtime` mode, type `screener`.
   - MSW acts as the exchange.
   - Initial Fetch: MSW returns historical data.
   - Tick: We manually call `advanceTime(60s)`. MSW returns *new* candles for the next minute.
3. **Verification**:
   - Spy on `STRATEGY_SIGNAL` event.
   - Assert signals received for *both* assets (BTC and ETH).

### B. Paper Trader
1. **Setup**: Paper Trading enabled. Initial Balance: 1000 USDT.
2. **Action**:
   - Feed a "Buy" signal sequence via generated market data.
   - `advanceTime` until order fills.
3. **Verification**:
   - Check `PortfolioManager` state.
   - Assert USDT balance decreased, Asset balance increased.
   - Assert `RoundTrip` created in DB.

### C. Live Trader (The Critical Path)
1. **Setup**: Live Trading enabled.
2. **Action**:
   - Trigger a Buy Signal.
3. **Verification**:
   - **Network**: Spy on MSW. Assert `POST /orders` was called with correct payload (Limit/Market, Volume).
   - **Persistence**: Assert Order stored in DB.

## Advanced: Time Travel Implementation
- The test loop will look like this:
```typescript
await app.start();
generateNextCandle(); // Enqueue data for MSW
await advanceTime(60 * 1000); // Trigger generic tick
expect(mswSpy).toHaveBeenCalledWith('fetchTicker');
```
