import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createScriptError } from '../structured-errors'

/** What `fake-gh.mjs` answers for a branch: GitHub's GraphQL node shape. */
export type FakePullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  closedAt: string | null
}

/** What `gh pr view <n>` answers: the node plus where its head lives. */
export type FakePullRequestDetail = FakePullRequest & {
  headRefName: string
  baseRefName: string
  isCrossRepository: boolean
}

/**
 * A directory holding a fake `gh` that answers every branch with `pullRequest`, or, given
 * `detail`, answers only its head branch and `gh pr view` for its number. A scenario puts it
 * first on the throwaway server's PATH through `prepareServer`.
 */
export async function createFakeForge(
  pullRequest: FakePullRequest | null = null,
  detail: FakePullRequestDetail | null = null,
) {
  const cli = await fakeCli('gh', 'fake-gh.mjs')
  const branches = pullRequest ? { '*': pullRequest } : {}
  await writeFile(
    join(cli.directory, 'forge.json'),
    JSON.stringify({
      branches: detail ? { [detail.headRefName]: detail } : branches,
      pullRequests: detail ? { [detail.number]: detail } : {},
    }),
  )
  return cli
}

/** A directory holding a fake `glab` with no merge request until one is created. */
export function createFakeGitLab() {
  return fakeCli('glab', 'fake-glab.mjs')
}

async function fakeCli(binary: string, fixture: string) {
  const directory = await mkdtemp(`/work/tmp/fregat-fake-${binary}-`)
  await copyFile(new URL(`./fixtures/${fixture}`, import.meta.url), join(directory, binary))
  await chmod(join(directory, binary), 0o755)
  return {
    directory,
    /** Every recorded invocation, one argv per entry. */
    async calls(): Promise<string[][]> {
      const text = await readFile(join(directory, 'calls.jsonl'), 'utf8').catch(() => '')
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    },
    release: () => rm(directory, { recursive: true, force: true }),
  }
}

/**
 * A bare repository reachable as `git@<host>:<repository>.git` through a repo-local
 * `core.sshCommand`. `insteadOf` cannot stand in: `git remote -v` prints the rewritten address,
 * and the server detects the forge from it.
 */
export async function createSshRemote(repository: string) {
  const root = await mkdtemp('/work/tmp/fregat-ssh-remote-')
  const bare = join(root, `${repository}.git`)
  await mkdir(join(bare, '..'), { recursive: true })
  const init = Bun.spawn(['git', 'init', '--quiet', '--bare', '-b', 'main', bare])
  if (await init.exited) throw createScriptError('git init --bare failed')
  const ssh = join(root, 'ssh')
  await writeFile(ssh, `#!/bin/sh\nfor last; do :; done\ncd '${root}' && exec sh -c "$last"\n`)
  await chmod(ssh, 0o755)
  return { bare, ssh, release: () => rm(root, { recursive: true, force: true }) }
}
