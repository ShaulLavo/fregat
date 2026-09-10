import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function writeSshConfig(root: string, contents: string) {
  const directory = path.join(root, '.ssh')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'config')
  await writeFile(file, contents)
  return file
}
