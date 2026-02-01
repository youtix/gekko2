# E2E Step 2: Importer Mode

## Goal
Verify that the `Importer` plugin correctly fetches data from the (mocked) exchange and saves it to the database.

## Test Scenario
1. **Setup**:
   - Configure MSW to return a static set of 100 historical candles for `BTC/USDT`.
   - Use an empty temporary SQLite database.
2. **Action**:
   - Start Gekko2 in `importer` mode via the internal API (or CLI wrapper).
   - Configuration: `mode: importer`, `candleWriter: enabled`.
3. **Verification**:
   - **Network**: Assert MSW received the request for `klines`.
   - **Database**: Query the SQLite DB.
     - Assert `candles` table count is 100.
     - Assert the timestamp of the first and last candle match the generated data.
   - **Integrity**: Check that no "Gap" errors occurred during import.

## Implementation Details
- **Mock Data**: Use `generateCandles` from Step 1 to create the fixture.
- **Assertion**: Use direct SQLite queries to inspect the resulting `history.db`.
