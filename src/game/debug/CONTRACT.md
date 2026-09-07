# Game diagnostics

Records frame gaps, subsystem costs and renderer allocations for a running city.

## Input

- `HitchLog(threshold = 40)`: `note(label, milliseconds?)`, `time(label, work, threshold = 4)` and `frame(gapMilliseconds)`.
- `RenderWork(renderer.info).since()`: Three renderer allocation counters.
- `FrameReports(send, snapshot)`: a send callback and a callback returning the snapshot fields in the [report schema](report.schema.json). `frame(now, gapMs, notes)` records a frame and its preceding work.
- `hitchReportPlugin(outputDirectory)`: the Vite development server and the `urbe:performance` event carrying a report.

## Output

- HitchLog exposes `notes`, `count` and `worst`, and prints gaps above its threshold.
- RenderWork returns a summary of newly allocated pipelines and maps, or null.
- FrameReports sends one report per second, with frame median, p95, maximum and up to 20 hitch records. Snapshot collection occurs only when sending. Missing development transport creates no reporter.
- The plugin validates reports and stores the latest 60 in `performance.json` under its configured directory. Writes are serialized. Reports contain the game id, rendering settings, counters, position and timing only.

## Errors

Invalid reports are discarded. Transport or storage failures report a warning and do not interrupt gameplay.

## Dependencies

[Game](../CONTRACT.md), [Vite custom events](https://vite.dev/guide/api-plugin#client-server-communication).
