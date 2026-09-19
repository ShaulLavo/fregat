import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function archivePartFiles(
  directories: readonly string[],
  kind: 'palettes' | 'wallpapers',
) {
  const groups = await Promise.all(
    directories.map(async (directory) => {
      const folder = path.join(directory, kind)
      const names = await readdir(folder)
      return names.filter((name) => name.endsWith('.json')).map((name) => path.join(folder, name))
    }),
  )
  return groups.flat()
}
export async function readArchivePart(
  directories: readonly string[],
  kind: 'palettes' | 'wallpapers',
  id: string,
): Promise<unknown | null> {
  for (const directory of directories) {
    const file = path.join(directory, kind, `${id}.json`)
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}
