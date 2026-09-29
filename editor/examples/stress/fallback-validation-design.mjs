import { writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import {
  primaryMetrics,
  secondaryMetrics,
  validateFinalBlockCount,
} from './fallback-validation.mjs'
import { fail } from './errors.mjs'

const orders = [
  ['baseline', 'control', 'candidate'],
  ['control', 'candidate', 'baseline'],
  ['candidate', 'baseline', 'control'],
  ['candidate', 'control', 'baseline'],
  ['control', 'baseline', 'candidate'],
  ['baseline', 'candidate', 'control'],
]

async function main() {
  if (process.argv.length < 3 || process.argv.length > 5)
    fail('Usage: fallback-validation-design.mjs design.json [capture-directory] [block-count]')
  const output = resolve(process.argv[2])
  const directory = resolve(process.argv[3] ?? resolve(dirname(output), 'captures'))
  const blockCount = Number(process.argv[4] ?? 12)
  validateFinalBlockCount(blockCount)
  const design = {
    schemaVersion: 1,
    purpose: 'final',
    predeclaredAt: new Date().toISOString(),
    seed: 60061,
    bootstrapDraws: 32768,
    familywiseAlpha: 0.05,
    clockQuantumMs: 0.1,
    numericalEpsilonMs: 1e-7,
    regressionMarginMs: 0,
    primaryMetrics,
    secondaryMetrics,
    blocks: Array.from({ length: blockCount }, (_, index) => block(index, output, directory)),
  }
  await writeFile(output, JSON.stringify(design, null, 2) + '\n', { flag: 'wx' })
  console.log(output)
}

function block(index, output, directory) {
  const id = `block-${String(index + 1).padStart(2, '0')}`
  const artifacts = ['baseline', 'control', 'candidate'].map((arm) => [
    arm,
    relative(dirname(output), resolve(directory, `${id}-${arm}.json`))
      .split(sep)
      .join('/'),
  ])
  return { id, order: orders[index % orders.length], ...Object.fromEntries(artifacts) }
}

try {
  await main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
