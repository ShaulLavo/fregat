import type { GitRepositoryRunner } from './service'

export async function searchHistoryTips(
  runner: GitRepositoryRunner,
  tips: readonly string[],
  search: string,
): Promise<string[]> {
  const options = { input: `${tips.join('\n')}\n` }
  const args = [
    'log',
    '--format=%H',
    '--no-show-signature',
    '--fixed-strings',
    '--regexp-ignore-case',
  ]
  const [messages, authors, revision] = await Promise.all([
    runner.run([...args, `--grep=${search}`, '--stdin'], options),
    runner.run([...args, `--author=${search}`, '--stdin'], options),
    resolveSearchRevision(runner, tips, search),
  ])
  return [...new Set([...messages.stdout.split('\n'), ...authors.stdout.split('\n'), ...revision])]
    .filter(Boolean)
    .sort()
}

async function resolveSearchRevision(
  runner: GitRepositoryRunner,
  tips: readonly string[],
  search: string,
): Promise<string[]> {
  if (!/^[0-9a-f]{4,64}$/i.test(search)) return []
  const resolved = await runner.run(
    ['rev-parse', '--verify', '--quiet', `${search.toLowerCase()}^{commit}`],
    { allowFailure: true },
  )
  if (resolved.exitCode !== 0) return []
  const commit = resolved.stdout.trim()
  for (const tip of tips) {
    const result = await runner.run(['merge-base', '--is-ancestor', commit, tip], {
      allowFailure: true,
    })
    if (result.exitCode === 0) return [commit]
  }
  return []
}
