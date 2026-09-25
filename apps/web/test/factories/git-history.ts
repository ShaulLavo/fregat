import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GitHistoryCommit } from '@workspace/contracts'
import { runGit } from './git'

export async function historyRepository(root: string) {
  const directory = path.join(root, 'history-repo')
  await mkdir(directory, { recursive: true })
  const git = (...args: string[]) => runGit(directory, args, { cwdMode: 'option' }).stdout.trimEnd()
  git('init', '-b', 'main')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  const write = async (name: string, content: string) => {
    const file = path.join(directory, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const commit = (message: string) => {
    git('add', '-A')
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { directory, git, write, commit }
}

export function historyCommit(id: string, parents: readonly string[] = []): GitHistoryCommit {
  return {
    id,
    parents,
    subject: id,
    author: 'Author',
    authorEmail: 'author@example.com',
    timestamp: 0,
  }
}
