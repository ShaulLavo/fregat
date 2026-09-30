import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  defaultSeed,
  fixtureFacts,
  fixtureIds,
  generateFixture,
  generatorVersion,
} from './src/fixtures.ts'

export function createManifest(seed = defaultSeed) {
  return {
    schemaVersion: 1,
    generatorVersion,
    seed,
    fixtures: fixtureIds.map((id) => {
      const text = generateFixture(id, seed)
      return { id, ...fixtureFacts(text), sha256: createHash('sha256').update(text).digest('hex') }
    }),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2]
  const manifest = createManifest()
  if (directory) {
    await mkdir(directory, { recursive: true })
    for (const id of fixtureIds)
      await writeFile(resolve(directory, `${id}.txt`), generateFixture(id))
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  console.log(JSON.stringify(manifest, null, 2))
}
