import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../packages/', import.meta.url))

type PackageManifest = {
  name: string
  private?: boolean
  exports: Record<string, string | { types?: string }>
}

export const packages = readdirSync(root)
  .map((directory) => {
    const manifest = JSON.parse(
      readFileSync(`${root}/${directory}/package.json`, 'utf8'),
    ) as PackageManifest
    const entryPoints = Object.entries(manifest.exports)
      .filter(
        ([name, target]) =>
          !name.includes('internal') &&
          !name.includes('*') &&
          typeof target !== 'string' &&
          target.types,
      )
      .map(([, target]) => resolve(root, directory, (target as { types: string }).types))
    return { directory, name: manifest.name, private: manifest.private, entryPoints }
  })
  .filter((entry) => !entry.private && entry.name.startsWith('@singapore-editor/'))
  .sort((left, right) => left.name.localeCompare(right.name))
