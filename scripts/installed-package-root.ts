import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function installedPackageRoot(entry: string, name: string): Promise<string> {
  let directory = path.dirname(entry)
  while (true) {
    const manifest = path.join(directory, 'package.json')
    if ((await readPackageName(manifest)) === name) return directory
    const parent = path.dirname(directory)
    if (parent === directory) throw new TypeError(`No package manifest found for ${name}`)
    directory = parent
  }
}

async function readPackageName(file: string): Promise<string | null> {
  if (!existsSync(file)) return null
  const manifest: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (typeof manifest !== 'object' || manifest === null || !('name' in manifest)) return null
  return typeof manifest.name === 'string' ? manifest.name : null
}
