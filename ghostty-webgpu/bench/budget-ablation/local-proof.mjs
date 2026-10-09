import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { arms, assertArmWork } from './proof.mjs'

const [repository, bundle, output] = process.argv.slice(2, 5).map((path) => resolve(path))
const workloads = process.argv.slice(5)
if (workloads.length === 0) workloads.push('line-scroll', 'unicode-emoji')
const { chromium } = createRequire(join(repository, 'ghostty-webgpu/package.json'))('playwright')
const { createFixture } = await import(join(bundle, 'fixture.mjs'))
const fixture = createFixture(join(bundle, 'packet'))
const result = {
  scope: 'Linux headless SwiftShader correctness only, no efficiency verdict',
  rows: [],
  errors: [],
}
await mkdir(output, { recursive: false })
let browser
try {
  const port = await fixture.start()
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  })
  for (const [arm, settings] of Object.entries(arms)) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1400 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => result.errors.push(error.stack))
    await page.goto(`http://127.0.0.1:${port}/?accessibility=off&retention=bounded&arm=${arm}`)
    await page.waitForFunction(() => window.__direct)
    await page.evaluate(
      ({ variant }) => window.__compare.prepare({ variant, count: 2, path: 'bytes' }),
      settings,
    )
    const correctness = await page.evaluate(() => window.__compare.correctness())
    for (const workload of workloads) {
      const measured = await page.evaluate(
        async (fixture) => window.__direct.measured(fixture, 120),
        workload,
      )
      result.pending = { arm, workload, measured }
      const work = assertArmWork(measured, 2, 120)
      const inputs = await page.evaluate(() => window.__direct.inputProof())
      const content = await page.evaluate(() => window.__direct.content())
      const cells = await page.evaluate(() => window.__direct.cellLayout())
      result.rows.push({ arm, workload, correctness, measured, work, inputs, content, cells })
      delete result.pending
      await page.screenshot({ path: join(output, `${arm}-${workload}.png`) })
    }
    await context.close()
  }
  for (const workload of workloads) {
    const rows = result.rows.filter((row) => row.workload === workload)
    const digest = (row) =>
      JSON.stringify({
        inputs: row.inputs,
        text: row.content.map((x) => [x.historyRows, x.retainedRows, x.retainedTextSha256]),
        cells: row.cells.map((x) => [
          x.rows,
          x.columns,
          x.widthsAndOwnerBoundariesSha256,
          x.ownerTextSha256,
        ]),
      })
    assert.equal(new Set(rows.map(digest)).size, 1, `${workload} input/retained/cell proof differs`)
  }
  assert.deepEqual(result.errors, [])
  result.complete = true
} catch (error) {
  result.failure = String(error.stack ?? error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await fixture.close()
  result.requests = fixture.requests
  await writeFile(join(output, 'index.json'), JSON.stringify(result, null, 2) + '\n')
}
console.log(JSON.stringify({ complete: result.complete, failure: result.failure, output }))
