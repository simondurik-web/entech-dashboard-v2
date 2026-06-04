# Research — 2026-04-19

## Topic: Chart.js decimation and large-dataset strategies for production trends
Project: Entech Dashboard V2

### What is actually new and useful
For V2, Chart.js can handle large production-trend lines **only if the chart pipeline is pre-shaped for canvas efficiency**. The key move is not just turning on decimation, it is feeding Chart.js already-sorted numeric/time data with `parsing: false`, `normalized: true`, and a decimation mode chosen by chart purpose.

### Specific findings

1. **Use decimation only on line charts with the right data shape.**
   The plugin requires `indexAxis: 'x'`, a line chart, `linear` or `time` x-axis, `parsing: false`, and a mutable dataset. If those conditions are not met, the decimation setting will not help.

2. **Pick the algorithm by operational intent.**
   - `lttb`: best for long trend views where the goal is overall shape.
   - `min-max`: best for noisy production data where spikes and dips matter.
   For manufacturing trend pages, `min-max` is the safer default when downtime/scrap spikes are important.

3. **Do not rely on late automatic decimation alone.**
   Chart.js can decimate during draw under limited line settings, but the docs are explicit that pre-decimating before render gives the best memory/performance results. For V2, API routes or server-side chart prep should own the heavy reduction when datasets get large.

4. **Canvas-width-based thresholds are the practical tuning rule.**
   Built-in decimation defaults to roughly one sample per pixel for `lttb`, and triggers at about four times canvas width. That means a 900px chart does not benefit from sending 20k points to the client.

5. **The surrounding performance settings matter as much as decimation.**
   Chart.js performance guidance strongly favors:
   - `parsing: false`
   - `normalized: true`
   - explicit `min` / `max` on scales when possible
   - fixed tick rotation
   - smaller `ticks.sampleSize`
   - disabled animations for heavy charts
   For operational dashboards, disabling animation on large historical charts is the right trade.

6. **OffscreenCanvas is now a real option, but not the first move for V2.**
   Chart.js docs now treat worker rendering as practical in modern browsers. It can free the main thread, but it complicates config transfer, disables DOM-dependent plugins/interactions, and requires manual resize handling. For V2, this is a later optimization, not phase 1.

### Concrete recommendation
For Entech Dashboard V2, the best first implementation is:

- keep Chart.js only for moderate interactive trend views
- server-shape large datasets before they reach the client
- for large production-history line charts, use:
  - `parsing: false`
  - `normalized: true`
  - `animation: false`
  - `decimation.enabled = true`
  - `decimation.algorithm = 'min-max'` for spike-sensitive charts
  - `decimation.algorithm = 'lttb'` for high-level trend summaries

### Best near-term target
The strongest first use is any long-range production/scrap/throughput history chart where users need fast zoomed-out trend reading without freezing the page.

### Sources
- https://www.chartjs.org/docs/latest/configuration/decimation.html
- https://www.chartjs.org/docs/latest/general/performance.html
- https://github.com/chartjs/Chart.js/releases
