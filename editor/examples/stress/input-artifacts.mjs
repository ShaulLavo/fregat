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
