import type { AppOptions } from 'server/testing'
import { runGit } from './git'

type ForgeBoundaries = NonNullable<NonNullable<AppOptions['orchestration']>['forgeBoundaries']>

/** Only external forge I/O is replaced; repository reads still use real git. */
export function createForgeDiscussionBoundary() {
  const comments: {
    id: number
    body: string
    created_at: string
    html_url: string
    user: { login: string }
  }[] = []
  const writes: string[] = []
  const control = {
    failPost: false,
    beforePost: async () => {},
  }
  const run: NonNullable<ForgeBoundaries['run']> = async ({ argv, input, cwd }) => {
    const ok = (stdout = '') => ({ exitCode: 0, stderr: '', stdout })
    if (argv[0] === 'git' && argv[1] === 'remote')
      return runGit(cwd, argv.slice(1), { allowFailure: true })
    if (argv[0] === 'az' && argv[1] === 'account') return ok('fixture')
    if (argv[0] === 'gh' && argv[1] === 'auth') return ok()
    if (argv[0] === 'gh' && argv[1] === 'api') {
      if (!argv.some((arg) => arg.includes('/issues/7/comments')))
        return { exitCode: 1, stderr: 'unexpected endpoint', stdout: '' }
      if (!argv.includes('POST')) return ok(JSON.stringify(comments))
      const { body } = JSON.parse(input ?? '{}') as { body: string }
      writes.push(body)
      await control.beforePost()
      if (control.failPost) return { exitCode: 1, stderr: 'fixture refusal', stdout: '' }
      const id = comments.length + 1
      comments.push({
        id,
        body,
        user: { login: 'reviewer' },
        created_at: '2026-10-01T10:00:00Z',
        html_url: `https://github.com/fixture/repo/pull/7#issuecomment-${id}`,
      })
      return ok('{}')
    }
    return { exitCode: 1, stderr: 'unexpected forge command', stdout: '' }
  }
  return { run, comments, writes, control }
}
