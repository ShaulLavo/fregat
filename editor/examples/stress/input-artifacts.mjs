import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'

export async function readInputArtifact(path) {
  const bytes = await readFile(path)
  const text = path.endsWith('.gz') ? gunzipSync(bytes) : bytes
  return JSON.parse(text.toString('utf8'))
}

export async function writeInputArtifact(path, value) {
  const text = JSON.stringify(value) + '\n'
  await writeFile(path, path.endsWith('.gz') ? gzipSync(text) : text)
}

export async function preserveInputCapture(path, results, capture) {
  let schedule = []
  let failure = null
  try {
    schedule = await capture()
  } catch (error) {
    failure = { error }
  }
  await writeInputArtifact(path, {
    schemaVersion: 1,
    kind: 'paired-input-capture',
    captureComplete: failure === null,
    completeSchedule: failure === null,
    failure: failure ? String(failure.error) : null,
    results,
    schedule,
  })
  if (failure) throw failure.error
  return schedule
}
