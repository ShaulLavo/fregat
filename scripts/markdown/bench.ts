import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createScriptError } from '../structured-errors'
import { runMarkdownBenchmarks } from './bench-run'
import { BENCHMARK_FAMILIES, type BenchmarkFamily, type BenchmarkMode } from './workloads'
import type { BenchmarkSample } from './bench-types'

export { runMarkdownBenchmarks } from './bench-run'

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'quick' },
      family: { type: 'string', multiple: true },
      fixture: { type: 'string', multiple: true },
      out: { type: 'string' },
      'browser-log': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/bench.ts --out DIRECTORY [--mode quick|promotion] [--family FAMILY] [--fixture ID] [--browser-log FILE]\nPromotion collects at least 20 native trials. Qualification remains NOT VERIFIED until paired production candidate measurements exist.\n',
    )
  } else {
    if (!values.out)
      throw createScriptError('A benchmark report needs --out DIRECTORY', {
        internal: { argument: 'out' },
      })
    const mode = parseMode(values.mode)
    const families = values.family?.map(parseFamily)
    const browserLog = values['browser-log']
      ? await readFile(values['browser-log'], 'utf8')
      : undefined
    const report = await runMarkdownBenchmarks({
      mode,
      families,
      fixtureIds: values.fixture,
      browserLog,
    })
    const output = path.resolve(values.out)
    await mkdir(output, { recursive: true })
    await writeRawSamples(path.join(output, 'raw-samples.jsonl'), report.rawSamples)
    const { rawSamples, ...summary } = report
    await writeFile(
      path.join(output, 'benchmark.json'),
      `${JSON.stringify({ ...summary, rawSamplesFile: 'raw-samples.jsonl', rawSampleCount: rawSamples.length }, null, 2)}\n`,
    )
    process.stdout.write(
      `${JSON.stringify({ verdict: report.verdict, evidence: output, samples: report.rawSamples.length, families: report.families.map((family) => ({ family: family.family, status: family.status })) })}\n`,
    )
    process.exitCode = report.families.some((family) => family.status === 'FAILED') ? 1 : 0
  }
}

async function writeRawSamples(file: string, samples: readonly BenchmarkSample[]): Promise<void> {
  const output = await open(file, 'w')
  try {
    for (let offset = 0; offset < samples.length; offset += 1024) {
      await output.write(
        samples
          .slice(offset, offset + 1024)
          .map((sample) => JSON.stringify(sample))
          .join('\n') + '\n',
      )
    }
  } finally {
    await output.close()
  }
}

function parseMode(value: string): BenchmarkMode {
  if (value === 'quick' || value === 'promotion') return value
  throw createScriptError('--mode accepts quick or promotion', { internal: { argument: 'mode' } })
}

function parseFamily(value: string): BenchmarkFamily {
  const family = BENCHMARK_FAMILIES.find((entry) => entry === value)
  if (family) return family
  throw createScriptError('--family requires a benchmark family', {
    internal: { argument: 'family' },
  })
}
