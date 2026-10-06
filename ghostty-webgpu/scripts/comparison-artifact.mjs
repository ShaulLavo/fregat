import { stringifyChunked } from '@discoveryjs/json-ext'
import { createWriteStream } from 'node:fs'
import { appendFile, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function writeComparisonArtifact(path, artifact) {
  const temporary = await mkdtemp(join(dirname(path), '.comparison-json-'))
  try {
    const output = join(temporary, 'artifact.json')
    await pipeline(
      Readable.from(stringifyChunked(artifact, null, 2), { objectMode: false }),
      createWriteStream(output),
    )
    await appendFile(output, '\n')
    await rename(output, path)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
