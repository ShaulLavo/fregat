import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrumentAllocations } from './ghostty-extension-allocations.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../ghostty-webgpu')
const output = resolve(process.argv[2]!)
await mkdir(output)
const source = await readFile(join(packageRoot, 'src/extensions/manager.ts'), 'utf8')
const instrumented = instrumentAllocations(source)
await writeFile(join(output, 'allocation-sites.json'), JSON.stringify(instrumented.sites, null, 2))
const build = await Bun.build({
  entrypoints: [join(packageRoot, 'bench/extension-allocation-entry.ts')],
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'external',
  outdir: output,
  naming: 'entry.mjs',
  plugins: [
    {
      name: 'owned-allocation-sites',
      setup(builder) {
        builder.onLoad({ filter: /\/extensions\/manager\.ts$/ }, () => ({
          contents: instrumented.source,
          loader: 'ts',
        }))
      },
    },
  ],
})
assert(build.success, build.logs.map(String).join('\n'))
for (const name of ['ghostty-vt.wasm', 'bridge.wasm'])
  await copyFile(join(packageRoot, name), join(output, name))
const child = spawnSync('node', [join(output, 'entry.mjs'), output], { stdio: 'inherit' })
assert.equal(child.status, 0)
const result = JSON.parse(await readFile(join(output, 'counters.json'), 'utf8')) as {
  rows: {
    inert: number
    operations: number
    lifecycle: Record<string, number>
    positiveAllocation: Record<string, number>
  }[]
}
for (const row of result.rows) {
  for (const kind of ['ArrayExpression', 'EntriesFactory'])
    assert(
      Object.entries(row.positiveAllocation).some(
        ([site, count]) => site.startsWith(`${kind}@`) && count > 0,
      ),
      `Interested setup must make the ${kind} counter observable`,
    )
  const totals: Record<string, number> = {}
  for (const [site, count] of Object.entries(row.lifecycle)) {
    const kind = site.split('@')[0]!
    totals[kind] = (totals[kind] ?? 0) + count
  }
  assert.equal(
    totals.ArrayExpression ?? 0,
    0,
    `Inert lifecycle allocated absent-contribution arrays beside ${row.inert} attachments`,
  )
  assert.equal(totals.EntriesFactory ?? 0, 0)
  assert.equal(totals.NewExpression, row.operations, 'Every attachment gets a fresh exposed handle')
  assert.equal(
    totals.ArrowFunctionExpression,
    row.operations,
    'Every handle keeps its independent dispose closure',
  )
  assert.equal(
    totals.ObjectExpression ?? 0,
    0,
    'Repeated same-value attachment reuses only the weak identity slot',
  )
}
