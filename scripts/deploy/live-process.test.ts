import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { runLiveProcess } from './live-process.mjs'

test.each(['SIGTERM', 'SIGINT'])('forwards %s and waits for child cleanup', async (signal) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-child-signal-'))
  const worker = path.join(directory, 'worker.mjs')
  const ready = path.join(directory, 'ready')
  const cleaned = path.join(directory, 'cleaned')
  await writeFile(
    worker,
    `import { writeFile } from 'node:fs/promises';
    const timer = setInterval(() => {}, 1000);
    process.on(${JSON.stringify(signal)}, async () => { await new Promise(resolve => setTimeout(resolve, 100)); await writeFile(${JSON.stringify(cleaned)}, 'done'); clearInterval(timer) });
    await writeFile(${JSON.stringify(ready)}, String(process.pid));`,
  )
  const controller = new AbortController()
  const running = runLiveProcess('node', [worker], { signal: controller.signal })
  const settled = running.catch((error) => error)
  try {
    await expect.poll(() => readFile(ready, 'utf8').catch(() => '')).not.toBe('')
    controller.abort(signal)
    expect(await settled).toBe(signal)
    expect(await readFile(cleaned, 'utf8')).toBe('done')
  } finally {
    controller.abort(signal)
    await settled
    await rm(directory, { recursive: true, force: true })
  }
})

test('a subprocess timeout also waits for cleanup and fails', async () => {
  const result = runLiveProcess(
    'node',
    [
      '-e',
      'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 100)); setInterval(() => {}, 1000)',
    ],
    { timeout: 500 },
  )
  await expect(result).rejects.toThrow()
})
