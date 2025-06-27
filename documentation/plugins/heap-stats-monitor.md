# HeapStatsMonitor Plugin

The **HeapStatsMonitor** plugin prints memory usage information from Bun's `jsc` engine.
It can be useful to monitor your strategy's memory consumption during both realtime
and backtest runs.

``` 
💡 Note:
This plugin is read-only and only logs information to the console.
```

## Configuration

Add the plugin to the `plugins` section of your configuration file:

```yaml
plugins:
  - name: HeapStatsMonitor         # Must be set to "HeapStatsMonitor"
    interval: 10                   # Optional: log every N advices (default = 1)
    metrics:                       # Optional: list of metrics to display
      - heapSize
      - heapCapacity
      - extraMemorySize
      - objectCount
      - protectedObjectCount
```

If `metrics` is omitted, the plugin displays the five values above by default.

## Events Handled

The plugin listens to the `strategyAdvice` event. Every `interval` advices it will
call `heapStats()` from `bun:jsc` and display the selected metrics using `console.table`.

## Events Emitted

HeapStatsMonitor does not emit any events.
