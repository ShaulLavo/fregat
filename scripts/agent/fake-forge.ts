import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What `fake-gh.mjs` answers for a branch: GitHub's GraphQL node shape. */
export type FakePullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  closedAt: string | null
}

/**
 * A directory holding a fake `gh` that answers every branch with `pullRequest`. A scenario puts
 * it first on the throwaway server's PATH through `prepareServer`.
 */
export async function createFakeForge(pullRequest: FakePullRequest | null = null) {
  const cli = await fakeCli('gh', 'fake-gh.mjs')
  await writeFile(
    join(cli.directory, 'forge.json'),
    JSON.stringify({ branches: pullRequest ? { '*': pullRequest } : {} }),
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
