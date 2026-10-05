import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runGit } from '../../src/testing/git'

export async function gitBlobRepository(root: string) {
  const directory = path.join(root, 'blob-repo')
  await mkdir(directory)
  await runGit(directory, ['init', '-b', 'main'])
  await writeFile(path.join(directory, 'empty.txt'), '')
  await writeFile(path.join(directory, 'control.txt'), 'kept\n')
  await runGit(directory, ['add', 'empty.txt', 'control.txt'])
  await runGit(directory, ['commit', '-m', 'initial blobs'])
  const [empty, control] = await Promise.all([
    runGit(directory, ['rev-parse', 'HEAD:empty.txt']),
    runGit(directory, ['rev-parse', 'HEAD:control.txt']),
  ])
  return {
    directory,
    emptyObjectId: empty.stdout.trim(),
    controlObjectId: control.stdout.trim(),
  }
}
