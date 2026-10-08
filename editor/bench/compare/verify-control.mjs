import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { editors, percentile } from './protocol.mjs'

export function verifyControl(baseline, control) {
  if (!baseline || !control || control.config.delayMs < 100)
    throw new RangeError('Use a control delay of at least 100 ms to exceed frame scheduling waits')
  return editors.map((editor) => {
    const mutationTimes = (result) =>
      result.samples
        .filter((row) => row.editor === editor && row.status === 'ok')
        .flatMap((row) =>
          ['end', 'middle'].flatMap((where) => row.typing[where].raw.map((key) => key.mutationMs)),
        )
    const deltaMs =
      percentile(mutationTimes(control), 0.5) - percentile(mutationTimes(baseline), 0.5)
    if (!Number.isFinite(deltaMs) || deltaMs < control.config.delayMs * 0.8)
      throw new RangeError(
        `${editor} detected ${deltaMs} ms for ${control.config.delayMs} ms injected delay`,
      )
    return { editor, deltaMs, delayMs: control.config.delayMs }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseline, control] = await Promise.all(
    process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  )
  for (const row of verifyControl(baseline, control))
    console.log(
      `${row.editor}: ${row.deltaMs.toFixed(2)} ms median mutation-latency increase for ${row.delayMs} ms injected delay`,
    )
}
