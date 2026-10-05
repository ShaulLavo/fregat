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
  const reads: string[] = []
  const activityReads: string[] = []
  const writes: string[] = []
  const reviews: { body: string; event: string }[] = []
  const activityReviews: unknown[] = []
  const activityCommits: unknown[] = []
  const activityDiscussions: unknown[] = []
  const azureThreads: unknown[] = []
  const remoteProbes: (readonly string[])[] = []
  const control = {
    failPost: false,
    failReview: false,
    beforePost: async () => {},
    beforeRead: async () => {},
    beforeCommentsRead: async () => {},
    beforeActivityRead: async () => {},
  }
  const run: NonNullable<ForgeBoundaries['run']> = async ({ argv, input, cwd }) => {
    const ok = (stdout = '') => ({ exitCode: 0, stderr: '', stdout })
    if (
      argv.length === 5 &&
      argv[0] === 'git' &&
      argv[1] === '-C' &&
      argv[2] === cwd &&
      argv[3] === 'remote' &&
      argv[4] === '-v'
    ) {
      remoteProbes.push(argv)
      return runGit(cwd, argv.slice(3), { allowFailure: true })
    }
    if (argv[0] === 'az') {
      if (argv[1] === 'account') return ok('fixture')
      if (argv.includes('show'))
        return ok(JSON.stringify({ repository: { name: 'repo', project: { name: 'project' } } }))
      if (argv.includes('invoke')) return ok(JSON.stringify({ value: azureThreads }))
    }
    if (argv[0] === 'gh' && argv[1] === 'auth') return ok()
    if (argv[0] === 'gh' && argv[1] === 'api') {
      if (argv.some((arg) => arg.endsWith('/pulls/7/reviews')) && argv.includes('POST')) {
        if (control.failReview) return { exitCode: 1, stderr: 'fixture review refusal', stdout: '' }
        reviews.push(JSON.parse(input ?? '{}'))
        return ok('{}')
      }
      if (!argv.includes('POST') && argv.some((arg) => arg.includes('/pulls/7/'))) {
        activityReads.push('activity')
        await control.beforeRead()
        await control.beforeActivityRead()
        const endpoint = argv.find((arg) => arg.includes('/pulls/7/')) ?? ''
        if (endpoint.includes('/reviews?')) return ok(JSON.stringify(activityReviews))
        if (endpoint.includes('/commits?')) return ok(JSON.stringify(activityCommits))
        if (endpoint.includes('/comments?')) return ok(JSON.stringify(activityDiscussions))
      }
      if (!argv.some((arg) => arg.includes('/issues/7/comments')))
        return { exitCode: 1, stderr: 'unexpected endpoint', stdout: '' }
      if (!argv.includes('POST')) {
        reads.push('comments')
        await control.beforeRead()
        await control.beforeCommentsRead()
        return ok(JSON.stringify(comments))
      }
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
  return {
    run,
    comments,
    reads,
    writes,
    reviews,
    activityReads,
    activityReviews,
    activityCommits,
    activityDiscussions,
    azureThreads,
    control,
    remoteProbes,
  }
}
