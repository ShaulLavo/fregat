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
export async function createFakeForge(pullRequest: FakePullRequest) {
  const directory = await mkdtemp('/work/tmp/fregat-fake-gh-')
  await copyFile(new URL('./fixtures/fake-gh.mjs', import.meta.url), join(directory, 'gh'))
  await chmod(join(directory, 'gh'), 0o755)
  await writeFile(join(directory, 'forge.json'), JSON.stringify({ branches: { '*': pullRequest } }))
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
