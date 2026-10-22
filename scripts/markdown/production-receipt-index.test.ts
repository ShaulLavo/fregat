import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'
import {
  syntheticProductionTemplate,
  writeSyntheticProductionArm,
} from './promotion-evidence-full-assembly-fixture'
import { productionBrowserWorkloads, productionUpdates } from './production-workloads'
import { productionTrial, validateProductionReceipt } from './production-reconciliation'

type Row = Parameters<typeof validateProductionReceipt>[0]
type Findings = Parameters<typeof validateProductionReceipt>[2]['findings']
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'production-receipt-index-'))
  try {
    const workloads = productionBrowserWorkloads()
    const workload = workloads.find((entry) => entry.id === 'streaming-replay-mixed-8192-fixed-64')
    if (!workload)
      throw createScriptError('Representative receipt workload is missing.', {
        internal: { available: workloads.length },
      })
    const captured = await writeSyntheticProductionArm(
      root,
      syntheticProductionTemplate(workload, 0, 'remark'),
    )
    const row = v.parse(productionTrial, captured)
    return {
      row,
      inputs: productionUpdates(workload)
        .concat([workload.source])
        .map((source) => ({
          inputSha256: createHash('sha256').update(source).digest('hex'),
          inputUtf16Units: source.length,
        })),
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
function findings(row: Row, inputs: Parameters<typeof validateProductionReceipt>[1]) {
  const state: { findings: Findings } = { findings: [] }
  validateProductionReceipt(row, inputs, state)
  return state.findings
}

test('visits processed revisions linearly while validating every painted completion', async () => {
  const { row, inputs } = await fixture()
  let reads = 0
  row.receipt.processed = new Proxy(row.receipt.processed, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/u.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  expect(findings(row, inputs)).toEqual([])
  expect(reads).toBeLessThan(row.receipt.processed.length * 30)
})

test('keeps the first duplicate completion and reports missing painted revisions', async () => {
  const { row, inputs } = await fixture()
  row.receipt.processed[1].revision = row.receipt.processed[0].revision
  const paths = findings(row, inputs).map((entry) => entry.path)
  const key = `${row.workload}/${row.pair}/${row.engine}`
  expect(paths).toContain(`${key}.revisions`)
  expect(paths).toContain(`${key}.paint.2.completion`)
  expect(paths).not.toContain(`${key}.paint.1.completion`)
  expect(paths).toContain(`${key}.paint.2.projection`)
})

test('checks painted completions even when their array order is wrong', async () => {
  const { row, inputs } = await fixture()
  row.receipt.frames.reverse()
  const paths = findings(row, inputs).map((entry) => entry.path)
  expect(paths).toContain(`${row.workload}/${row.pair}/${row.engine}.paintRevisions`)
  expect(paths.some((entry) => entry.endsWith('.completion'))).toBe(false)
})
