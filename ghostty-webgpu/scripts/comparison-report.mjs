import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function quantile(values, percentile) {
  assert(values.length > 0 && values.every(Number.isFinite), 'Finite samples required')
  const sorted = [...values].sort((a, b) => a - b)
  if (percentile === 0.5) {
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]
}

export function order(variants, repetition) {
  const offset = Math.floor(repetition / 2) % variants.length
  const rotated = [...variants.slice(offset), ...variants.slice(0, offset)]
  return repetition % 2 ? rotated.reverse() : rotated
}

export function droppedFrames(intervals, period) {
  assert(period > 0 && Number.isFinite(period))
  return intervals.reduce(
    (sum, interval) => sum + Math.max(0, Math.round(interval / period) - 1),
    0,
  )
}

export function summaries(artifact) {
  const groups = new Map()
  const add = (run, metric, value, unit) => {
    if (!Number.isFinite(value)) return
    const key = [run.variant, run.path, run.count, metric].join('/')
    if (!groups.has(key))
      groups.set(key, {
        variant: run.variant,
        path: run.path,
        count: run.count,
        metric,
        unit,
        values: [],
      })
    groups.get(key).values.push(value)
  }
  for (const run of artifact.runs) {
    if (run.error) continue
    for (const [name, sample] of Object.entries(run.parse ?? {}))
      add(run, `parse/${name}`, sample.bytes / sample.milliseconds / 1000, 'MB/s')
    for (const name of ['write', 'input']) {
      if (!run.latency?.[name]?.length) continue
      add(run, `${name}/p50`, quantile(run.latency[name], 0.5), 'ms')
      add(run, `${name}/p95`, quantile(run.latency[name], 0.95), 'ms')
    }
    for (const [name, sample] of Object.entries(run.burst ?? {})) {
      add(run, `burst/${name}/p50`, quantile(sample.intervals, 0.5), 'ms')
      add(run, `burst/${name}/p95`, quantile(sample.intervals, 0.95), 'ms')
      add(
        run,
        `burst/${name}/dropped`,
        droppedFrames(sample.intervals, run.refreshPeriod),
        'frames',
      )
    }
    for (const state of ['idle', 'output']) {
      if (!run[state]) continue
      add(run, `${state}/cpu`, run[state].cpu.percentOfOneCore, '% core')
    }
    const memory = run.memory
    if (!memory) continue
    const retained = (snapshot) => snapshot.heap.usedSize + (snapshot.heap.backingStorageSize ?? 0)
    add(
      run,
      'memory/terminal',
      (retained(memory.initial) - retained(memory.empty)) / run.count / 1048576,
      'MiB',
    )
    add(
      run,
      'memory/10k',
      (retained(memory.history) - retained(memory.initial)) / run.count / 1048576,
      'MiB',
    )
    for (const state of ['initial', 'history']) {
      add(run, `memory/${state}/wasm`, memory[state].wasmBytes / 1048576, 'MiB total')
      if (memory[state].rssBytes != null && memory.empty.rssBytes != null)
        add(
          run,
          `memory/${state}/rss-delta`,
          (memory[state].rssBytes - memory.empty.rssBytes) / 1048576,
          'MiB total',
        )
    }
  }
  return Array.from(groups.values(), (group) => ({
    ...group,
    median: quantile(group.values, 0.5),
    repetitions: group.values.length,
  }))
}

const number = (value) => value.toFixed(2)

export function markdown(artifact) {
  assert(
    !artifact.smoke && artifact.hardware,
    'Correctness smoke cannot generate performance claims',
  )
  const rows = summaries(artifact)
  const lines = [
    '# Terminal comparison benchmarks',
    '',
    'Generated from the checked-in JSON artifact. Lower is better except parse throughput.',
    '',
    '## Run it',
    '',
    'From `ghostty-webgpu`, run `bun run bench:compare -- --bundle /path/to/bundle` to build and measure.',
    'Use `bun run bench:compare -- --smoke --bundle /path/to/bundle` for correctness only.',
    'Use `bun run bench:compare -- --build-only --bundle /path/to/bundle` for a portable Node bundle.',
    'On the target machine, enter that bundle and run `npm install --ignore-scripts`,',
    '`npx playwright install chromium`, then `node comparison-runner.mjs --smoke`.',
    'Run `node comparison-runner.mjs --output results` on AC power for measurements.',
    'Headed Chromium windows open during the run. Set aside up to 30 minutes.',
    'Regenerate this document with `node comparison-report.mjs results/comparison.json docs/benchmarks.md`.',
    '',
    '## Environment',
    '',
    `- Commit measured: \`${artifact.manifest.commit}\`. Source SHA-256: \`${artifact.manifest.sourceSha256}\`.`,
    `- Browser: ${artifact.environment.browser}. OS: ${artifact.environment.os}.`,
    `- GPU: ${artifact.environment.renderer}. Headed hardware adapter: ${artifact.hardware}.`,
    `- Font: JetBrains Mono ${artifact.manifest.versions['@fontsource/jetbrains-mono']}, bundled regular/bold Latin faces. Emoji and CJK use the same OS fallback fonts.`,
    `- Font size: ${artifact.manifest.settings.fontSize}px. DPR: ${artifact.manifest.settings.dpr}. Grid: ${artifact.manifest.settings.columns} × ${artifact.manifest.settings.rows}.`,
    `- Libraries: ghostty-webgpu ${artifact.manifest.versions['ghostty-webgpu']}; xterm ${artifact.manifest.versions['@xterm/xterm']} with WebGL addon ${artifact.manifest.versions['@xterm/addon-webgl']}; ghostty-web ${artifact.manifest.versions['ghostty-web']}.`,
    `- Repetitions: ${artifact.repetitions}. Each table cell is the median of the per-run result, including per-run p50/p95.`,
    `- Artifact: [comparison.json](benchmarks/${artifact.artifactName ?? 'mac-m1'}/comparison.json).`,
    '',
    '## Method',
    '',
    'Each case opens a fresh browser context. All 1, 8, or 17 terminals remain visible in a fixed grid.',
    'Library order alternates forward/reverse between repetitions and rotates on the third repetition.',
    'Byte/string paths alternate too. A warmup precedes each timed operation.',
    'Chromium launches with a device scale of 2 so resize-observer backing pixels agree with DPR.',
    'Its WebGL context limit is 32 for every case, allowing all 17 xterm WebGL terminals to remain live.',
    'Parse throughput uses unopened parsers, complete UTF-8 corpora in 4 KiB chunks, and awaits parser completion.',
    'Each parse-only fixture owns a fresh WASM runtime. Runtime construction is outside timing for both Ghostty libraries.',
    'The string chunks are decoded before timing. String-to-WASM encoding remains inside the timed library call.',
    'MB means 1,000,000 bytes. The real-log fixture is an archived 256-entry public Git history log, repeated to at least 1 MiB.',
    'xterm DOM and WebGL share a parser; their parse results are independent repetitions of that same parser.',
    '',
    'Write latency starts at the browser write call. Input latency starts at the captured keydown event,',
    'crosses a loopback WebSocket byte echo, and ends at a compositor capture containing the colored glyph.',
    'Chromium screencast timestamps identify the first captured frame showing the glyph, not a library render callback.',
    'This is captured-frame latency, not an optical display measurement. Capture overhead and capture cadence remain in the measurement.',
    'Screencasting is stopped for burst, CPU, and memory measurements.',
    '',
    'Burst output writes at least 4 KiB per terminal per animation frame for each corpus.',
    'Frame intervals come from requestAnimationFrame timestamps. Dropped frames are inferred from the measured idle refresh period,',
    'rounded to the nearest number of display intervals. They are missed animation-frame opportunities, not GPU presentation counters.',
    'CPU is Chromium browser/renderer/GPU process CPU time as a percentage of one core.',
    '',
    'Memory per terminal and per 10k rows is the post-GC CDP used JS heap plus backing storage delta, divided by terminal count.',
    'This is retained JS/backing storage, not total terminal memory. WASM linear-memory capacity is reported separately.',
    'Renderer/GPU RSS deltas cover all Chromium processes and include browser allocation noise and shared resources.',
    'GPU allocation is not available per terminal. Negative deltas are retained as measurement noise.',
    'Each Ghostty library shares one WASM runtime per context, matching its supported multi-terminal use.',
    'The 10k fixture contains exactly 10,000 retained 40-column ASCII history rows per terminal.',
    '',
    '## Results',
    '',
  ]
  const cases = artifact.manifest.settings.counts.flatMap((count) =>
    ['bytes', 'string'].map((path) => ({ count, path })),
  )
  for (const { count, path } of cases) {
    lines.push(
      `### ${count} terminal${count === 1 ? '' : 's'}, ${path}`,
      '',
      '| Measure | ghostty-webgpu | xterm WebGL | xterm DOM | ghostty-web |',
      '| --- | ---: | ---: | ---: | ---: |',
    )
    const subset = rows.filter((row) => row.count === count && row.path === path)
    const metrics = [...new Set(subset.map((row) => row.metric))]
    for (const metric of metrics) {
      const cells = artifact.manifest.variants.map(({ id }) => {
        const row = subset.find((entry) => entry.variant === id && entry.metric === metric)
        return row ? `${number(row.median)} ${row.unit}` : 'unmeasured'
      })
      lines.push(`| ${metric} | ${cells.join(' | ')} |`)
    }
    lines.push('')
  }
  lines.push(
    '## Wins and losses',
    '',
    'These comparisons use one terminal and the byte path. They report every measured metric against both other libraries.',
    '',
    '| Measure | Against xterm WebGL | Against xterm DOM | Against ghostty-web |',
    '| --- | --- | --- | --- |',
  )
  const headline = rows.filter(
    (row) => row.variant === 'ghostty-webgpu' && row.count === 1 && row.path === 'bytes',
  )
  for (const row of headline) {
    const cells = ['xterm-webgl', 'xterm-dom', 'ghostty-web'].map((variant) => {
      const other = rows.find(
        (entry) =>
          entry.variant === variant &&
          entry.count === 1 &&
          entry.path === 'bytes' &&
          entry.metric === row.metric,
      )
      if (!other) return 'unmeasured'
      if (
        row.metric.includes('wasm') ||
        row.metric.includes('rss') ||
        row.median < 0 ||
        other.median < 0
      )
        return `${number(row.median)} vs ${number(other.median)} ${row.unit}`
      const better = row.metric.startsWith('parse/')
        ? row.median > other.median
        : row.median < other.median
      if (row.median === other.median) return 'tie'
      return `${better ? 'win' : 'loss'} (${number(row.median)} vs ${number(other.median)} ${row.unit})`
    })
    lines.push(`| ${row.metric} | ${cells.join(' | ')} |`)
  }
  lines.push(
    '',
    '## Correctness and limits',
    '',
    'The runner asserts ASCII, SGR, wide text, cursor overwrite, byte echo, glyph presentation, and exact history length.',
    'The artifact retains Unicode/ZWJ text plus a screenshot for each library/path/count in the first repetition.',
    'Review those screenshots for glyph layout differences; parser acceptance alone cannot prove Unicode shaping parity.',
    'Firefox and Safari were not measured. This run qualifies headed Chromium on the recorded hardware only.',
    'The corpus and font hashes, raw latency samples, raw frame intervals, process CPU snapshots, memory buckets,',
    'actual execution order, and failed cases are retained in JSON.',
    '',
  )
  for (const run of artifact.runs.filter((run) => run.error))
    lines.push(
      `- Failed ${run.variant}/${run.path}/${run.count}, repetition ${run.repetition}: ${run.error}`,
    )
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifact = JSON.parse(await readFile(process.argv[2], 'utf8'))
  await writeFile(process.argv[3], markdown(artifact))
}
