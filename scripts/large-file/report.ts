import * as v from 'valibot'

const heapSchema = v.object({ usedSize: v.number(), backingStorageSize: v.number() })
const workerSchema = v.object({
  url: v.string(),
  heap: v.union([heapSchema, v.object({ unavailable: v.string() })]),
})
const resultSchema = v.object({
  browser: v.optional(v.string()),
  host: v.optional(
    v.object({ name: v.string(), arch: v.string(), cpus: v.number(), memoryBytes: v.number() }),
  ),
  rendering: v.optional(v.nullable(v.object({ path: v.string() }))),
  sizeMiB: v.number(),
  highlighting: v.optional(v.string(), 'default'),
  status: v.string(),
  metrics: v.optional(
    v.nullable(
      v.object({
        openToTextMs: v.optional(v.number()),
        highlighting: v.optional(
          v.object({ state: v.string(), openToHighlightMs: v.optional(v.number()) }),
        ),
        saveMs: v.optional(v.number()),
        keyLatencyMs: v.optional(v.object({ p95: v.number() })),
        workersAfterOpen: v.optional(v.array(workerSchema)),
      }),
    ),
  ),
})

export function comparisonReport(results: readonly unknown[]) {
  const rows = results.map((value) => {
    const row = v.parse(resultSchema, value)
    const metrics = row.metrics
    return `| ${hostCell(row.host)} | ${rendererCell(row)} | ${row.sizeMiB} | ${row.highlighting} | ${row.status} | ${metrics?.highlighting?.state ?? 'unmeasured'} | ${rounded(metrics?.openToTextMs)} | ${rounded(metrics?.highlighting?.openToHighlightMs)} | ${rounded(metrics?.keyLatencyMs?.p95)} | ${rounded(metrics?.saveMs)} | ${workerMemory(metrics?.workersAfterOpen, 'shiki.worker')} | ${workerMemory(metrics?.workersAfterOpen, 'treeSitter.worker')} |`
  })
  return [
    '# Large-file highlighting comparison',
    '',
    'Each row uses a fresh browser and API, the same deterministic corpus and typing/save sequence.',
    'Shiki uses light-plus; Tree-sitter uses tree-sitter-light. Worker columns are JS heap plus external backing storage after opening and GC, in MiB. Unavailable measurements stay explicit.',
    "Renderer is the page rasterization path from Chromium's GPU feature status (chrome://gpu): software times include CPU rasterization and are not display latency on that host.",
    'These are requested engines: configured large-file tiers can pause highlighting above their limit. Inspect screenshots and worker measurements before treating such rows as highlighting throughput.',
    '',
    '| Host | Renderer | MiB | Theme engine | Result | Syntax | Open ms | Color ms | Key p95 ms | Save ms | Shiki MiB | Tree-sitter MiB |',
    '| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n')
}

function hostCell(host: v.InferOutput<typeof resultSchema>['host']) {
  if (!host) return '—'
  return `${host.name} ${host.arch} ${host.cpus} CPU ${rounded(host.memoryBytes / 1024 ** 3)} GiB`
}

function rendererCell(row: v.InferOutput<typeof resultSchema>) {
  if (!row.rendering) return '—'
  return `${row.rendering.path}, Chromium ${row.browser ?? 'unknown'}`
}

function rounded(value: number | undefined) {
  return value === undefined ? '—' : String(Math.round(value * 10) / 10)
}

function workerMemory(
  workers: readonly v.InferOutput<typeof workerSchema>[] | undefined,
  name: string,
) {
  const matching = workers?.filter((worker) => worker.url.includes(name))
  if (!matching?.length) return '—'
  let bytes = 0
  for (const { heap } of matching) {
    if ('unavailable' in heap) return 'unavailable'
    bytes += heap.usedSize + heap.backingStorageSize
  }
  return rounded(bytes / 1024 / 1024)
}
