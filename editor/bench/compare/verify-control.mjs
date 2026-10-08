import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { editors, percentile } from './protocol.mjs'

function mutationTimes(result, editor, mib, role) {
  const rows = result.samples.filter(
    (row) => row.editor === editor && row.mib === mib && row.status === 'ok',
  )
  return ['end', 'middle'].flatMap((where) => {
    const values = rows.flatMap((row) =>
      (row.typing?.[where]?.raw ?? []).map((key) => key.mutationMs),
    )
    if (!values.length)
      throw new RangeError(`Missing ${role} observations for ${editor} at ${mib} MiB (${where})`)
    if (!values.every(Number.isFinite))
      throw new RangeError(`Nonfinite ${role} observations for ${editor} at ${mib} MiB (${where})`)
    return values
  })
}

export function verifyControl(baseline, control) {
  const delayMs = control?.config?.delayMs
  if (!Number.isFinite(delayMs) || delayMs < 100)
    throw new RangeError('Use a control delay of at least 100 ms to exceed frame scheduling waits')
  if (!Array.isArray(baseline?.samples) || !Array.isArray(control?.samples))
    throw new RangeError('Baseline and control require recorded samples')
  return editors.flatMap((editor) => {
    const fixtures = [
      ...new Set(control.samples.filter((row) => row.editor === editor).map((row) => row.mib)),
    ]
    if (!fixtures.length) throw new RangeError(`Missing control observations for ${editor}`)
    return fixtures.map((mib) => {
      const baselineTimes = mutationTimes(baseline, editor, mib, 'baseline')
      const controlTimes = mutationTimes(control, editor, mib, 'control')
      const deltaMs = percentile(controlTimes, 0.5) - percentile(baselineTimes, 0.5)
      if (!Number.isFinite(deltaMs) || deltaMs < delayMs * 0.8)
        throw new RangeError(`${editor} detected ${deltaMs} ms for ${delayMs} ms injected delay`)
      return { editor, mib, deltaMs, delayMs }
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseline, control] = await Promise.all(
    process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  )
  for (const row of verifyControl(baseline, control))
    console.log(
      `${row.editor} ${row.mib} MiB: ${row.deltaMs.toFixed(2)} ms median mutation-latency increase for ${row.delayMs} ms injected delay`,
    )
}
