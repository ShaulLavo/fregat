import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { editors, summarize, percentile, verifyGeometry } from './protocol.mjs'

export function summary(result) {
  if (result.config.profileOpen)
    throw new RangeError('Use summarize-open.mjs for diagnostic profiles')
  const rows = []
  for (const mib of result.config.selected) {
    for (const editor of editors) {
      const samples = result.samples.filter((row) => row.editor === editor && row.mib === mib)
      const successful = samples.filter((row) => row.status === 'ok')
      const typing = (where) =>
        summarize(
          successful.flatMap((row) => row.typing[where].raw.map((key) => key.inputToFrameMs)),
        )
      rows.push({
        editor,
        mib,
        successful: successful.length,
        attempted: samples.length,
        openMs: percentile(
          successful.map((row) => row.open.highlightedFrameMs),
          0.5,
        ),
        firstFrameMs: percentile(
          successful.map((row) => row.open.firstFrameMs),
          0.5,
        ),
        endMs: typing('end'),
        middleMs: typing('middle'),
        scrollRenderingMs: summarize(successful.flatMap((row) => row.scroll.rendering.samplesMs)),
        scrollIntervalMs: summarize(successful.flatMap((row) => row.scroll.rawIntervalsMs)),
        heapMiB: percentile(
          successful.map((row) => row.heapAfterBytes / 1024 / 1024),
          0.5,
        ),
        backingMiB: percentile(
          successful.map((row) => row.heapAfter.backingStorageSize / 1024 / 1024),
          0.5,
        ),
        failures: samples
          .filter((row) => row.status !== 'ok')
          .map((row) => ({ repetition: row.repetition, status: row.status, errors: row.errors })),
      })
    }
  }
  return { rows, bundles: result.bundles.map(({ id, totals }) => ({ id, ...totals })) }
}

export function verify(result) {
  if (result.config.profileOpen)
    throw new RangeError('Use summarize-open.mjs for diagnostic profiles')
  const expected = result.config.selected.length * result.config.repetitions * 3
  if (result.samples.length !== expected)
    throw new RangeError(`Expected ${expected} samples, got ${result.samples.length}`)
  const identities = new Set(
    result.samples.map((row) => `${row.editor}/${row.mib}/${row.repetition}`),
  )
  if (identities.size !== expected) throw new RangeError('Duplicate sample identities')
  for (const mib of result.config.selected) {
    for (const editor of editors) {
      for (let repetition = 0; repetition < result.config.repetitions; repetition++) {
        if (!identities.has(`${editor}/${mib}/${repetition}`))
          throw new RangeError('Missing sample identity')
      }
    }
  }
  for (const mib of [1].filter((mib) => result.config.selected.includes(mib))) {
    for (const editor of editors) {
      const samples = result.samples.filter((row) => row.editor === editor && row.mib === mib)
      if (
        samples.length !== result.config.repetitions ||
        samples.some((row) => row.status !== 'ok')
      )
        throw new RangeError(`Incomplete usable ${editor} ${mib} MiB comparison`)
    }
  }
  for (const sample of result.samples) {
    if (!['ok', 'failed', 'timeout', 'page-error'].includes(sample.status))
      throw new RangeError('Unknown sample outcome')
    if (sample.status !== 'ok' && !sample.errors?.length)
      throw new RangeError('Failed sample has no retained error')
    if (sample.open) verifyGeometry(sample.open)
  }
  for (const sample of result.samples.filter((row) => row.status === 'ok')) {
    verifyGeometry(sample.open)
    for (const where of ['end', 'middle']) {
      if (sample.typing[where].raw.length !== result.config.keys)
        throw new RangeError('Missing keystroke samples')
      if (
        sample.typing[where].raw.some(
          (key) => !key.trusted || !key.rendered || !Number.isFinite(key.inputToFrameMs),
        )
      )
        throw new RangeError('Invalid input evidence')
    }
    if (sample.scroll.rendering.ms.n < result.config.frames - 5)
      throw new RangeError('Missing scroll frames')
  }
  return `${result.samples.length} samples retained; ${result.samples.filter((row) => row.status === 'ok').length} usable`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new RangeError('Pass an experiment.json or .json.gz path')
  const input = await readFile(resolve(process.argv[2]))
  const result = JSON.parse(
    process.argv[2].endsWith('.gz') ? gunzipSync(input).toString() : input.toString(),
  )
  console.error(verify(result))
  console.log(JSON.stringify(summary(result), null, 2))
}
