import { ok, strictEqual } from 'node:assert/strict'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, release, platform, hostname, totalmem } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { startIsolatedServer } from '../agent/isolated-server'
import { checkoutRoot } from '../agent/paths'
import { workbenchMeasurements } from '../agent/scenarios/workbench-measurements'
import { runCase } from '../large-file/run'
import { captureRevision } from '../large-file/provenance'
import { renderingPath } from '../large-file/host'
import { buildBenchmarkWeb } from '../large-file/build'

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'web-root': { type: 'string' },
    build: { type: 'boolean', default: false },
    phase: { type: 'string', default: 'all' },
  },
})
ok(values.out && values['web-root'], 'Pass --out DIR and --web-root BUILT_WEB')
ok(['all', 'workbench', 'files'].includes(values.phase), '--phase accepts all, workbench or files')
const output = path.resolve(values.out)
const webRoot = path.resolve(values['web-root'])
await mkdir(output, { recursive: true })
const revision = await captureRevision(checkoutRoot, path.join(output, 'source.patch'))
strictEqual(revision.cleanliness, 'clean', 'Measurements require a committed clean checkout')
if (values.build) {
  await mkdir(webRoot, { recursive: true })
  await buildBenchmarkWeb(webRoot, path.join(output, 'build.log'))
  const after = await captureRevision(checkoutRoot, path.join(output, 'source-after-build.patch'))
  strictEqual(
    after.fingerprint,
    revision.fingerprint,
    'Source must stay unchanged throughout the build',
  )
  await writeFile(
    path.join(webRoot, 'measurement-source.json'),
    JSON.stringify({
      commit: revision.commit,
      fingerprint: revision.fingerprint,
      builtAt: new Date().toISOString(),
    }),
  )
}
const buildSource = JSON.parse(
  await readFile(path.join(webRoot, 'measurement-source.json'), 'utf8'),
)
strictEqual(buildSource.commit, revision.commit, 'The web build must come from the measured commit')
const metadata = {
  experiment: true,
  date: new Date().toISOString(),
  revision,
  buildSource,
  machine: {
    name: hostname(),
    os: platform(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
  },
  runtime: Bun.version,
  phase: values.phase,
}
await writeFile(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2))
if (values.phase !== 'files') {
  const server = await startIsolatedServer(new URL('http://localhost:5297'), {
    scratchRoot: output,
    webRoot,
  })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(server.origin)
    await workbenchMeasurements.run(page, {
      server,
      file: '',
      evidence: {
        dir: output,
        startedAt: new Date(),
        file: (name) => path.join(output, name),
        write: async (name, content) => {
          const target = path.join(output, name)
          await writeFile(target, content)
          return target
        },
        json: async (name, value) => {
          const target = path.join(output, name)
          await writeFile(target, JSON.stringify(value, null, 2))
          return target
        },
      },
      step: async (name) => {
        await page.screenshot({ path: path.join(output, `${name}.png`) })
      },
    })
    strictEqual(errors.length, 0, 'Workbench measurements must have no page execution errors')
    await writeFile(
      path.join(output, 'browser.json'),
      JSON.stringify(
        { browser: browser.version(), rendering: await renderingPath(browser), errors },
        null,
        2,
      ),
    )
  } finally {
    await browser.close()
    await copyFile(
      path.join(server.directory, 'server.stderr'),
      path.join(output, 'workbench-server.stderr'),
    )
    await server.stop({ logs: path.join(output, 'workbench-logs') })
  }
}
if (values.phase !== 'workbench') {
  const cases = [
    { sizeMiB: 1, extension: 'txt' as const, twoByte: true, analysis: 'default' as const },
    { sizeMiB: 200, extension: 'txt' as const, twoByte: true, analysis: 'default' as const },
    ...[0.0625, 1, 10].flatMap((sizeMiB) =>
      ['off', 'on'].map((analysis) => ({
        sizeMiB,
        extension: 'ts' as const,
        twoByte: false,
        analysis: analysis as 'off' | 'on',
      })),
    ),
  ]
  const results = []
  for (const item of cases) {
    const result = await runCase({
      ...item,
      highlighting: item.analysis === 'on' ? 'tree-sitter' : 'default',
      keys: 30,
      settleMs: 10_000,
      output: path.join(output, `${item.extension}-${item.sizeMiB}-${item.analysis}`),
      webRoot,
      profile: false,
    })
    results.push(result)
    await writeFile(path.join(output, 'files.json'), JSON.stringify(results, null, 2))
    console.log(
      JSON.stringify({
        sizeMiB: item.sizeMiB,
        analysis: item.analysis,
        status: result.status,
        metrics: result.metrics,
      }),
    )
    strictEqual(
      result.status,
      'passed',
      'Every measured size must open, type and save byte-exactly',
    )
  }
}
console.log(`Experiment evidence: ${output}`)
