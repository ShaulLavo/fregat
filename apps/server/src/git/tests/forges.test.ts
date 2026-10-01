import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { detectForge, remoteRepositoryPath } from '../forges/detect'
import type { RunProcess } from '../forges/types'
import type { GitPublishRequest } from '@workspace/contracts'
import {
  createForgeRepository,
  readPullRequestComments,
  postPullRequestComment,
  submitPullRequestReview,
  createPullRequest,
  readBranchPullRequests,
  readPullRequest,
  resolvePullRequest,
  readPullRequestsByNumber,
} from '../pull-request'
import type { GitProcessResult } from '../utils/process'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/** Each case gets its own directory, so the per-checkout caches never carry over. */
async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-forge-'))
  roots.push(root)
  return root
}

const ok = (stdout = ''): GitProcessResult => ({ exitCode: 0, stderr: '', stdout })
const json = (value: unknown) => ok(JSON.stringify(value))

type Call = { argv: readonly string[]; env?: Readonly<Record<string, string>>; input?: string }

/**
 * The outside world for one checkout: `git remote -v` names `remote`, and `answer` plays every
 * forge CLI. Unanswered commands exit 1, so a call nobody expected fails loudly.
 */
function boundary(
  remote: string,
  answer: (argv: readonly string[]) => GitProcessResult | 'missing' | undefined,
) {
  const calls: Call[] = []
  const run: RunProcess = async (input) => {
    calls.push({ argv: input.argv, env: input.env, input: input.input })
    if (input.argv[0] === 'git' && input.argv.includes('remote'))
      return ok(`origin\t${remote} (fetch)\norigin\t${remote} (push)\n`)
    const result = answer(input.argv)
    if (result === 'missing') throw Object.assign(new Error('spawn'), { code: 'ENOENT' })
    return result ?? { exitCode: 1, stderr: `unexpected ${input.argv.join(' ')}`, stdout: '' }
  }
  return { calls, run, commands: (name: string) => calls.filter((call) => call.argv[0] === name) }
}

describe('forge detection', () => {
  it.each([
    ['git@github.com:acme/repo.git', 'github', 'GitHub'],
    ['https://github.example.com/acme/repo', 'github', 'GitHub Self-Hosted'],
    ['https://gitlab.com/group/sub/project.git', 'gitlab', 'GitLab'],
    ['ssh://git@gitlab.internal:2222/group/project.git', 'gitlab', 'GitLab Self-Hosted'],
    ['https://codeberg.org/owner/repo.git', 'forgejo', 'Forgejo'],
    ['https://git.gitea.example/owner/repo', 'forgejo', 'Forgejo'],
    ['https://dev.azure.com/org/project/_git/repo', 'azure-devops', 'Azure DevOps'],
    ['https://org.visualstudio.com/project/_git/repo', 'azure-devops', 'Azure DevOps'],
    ['git@bitbucket.org:workspace/repo.git', 'bitbucket', 'Bitbucket'],
  ])('%s is %s', (remote, kind, name) => {
    expect(detectForge(remote)).toMatchObject({ kind, name })
  })

  it('prefers Forgejo labels over GitHub ones and knows nothing of other hosts', () => {
    expect(detectForge('https://github.forgejo.example/o/r')?.kind).toBe('forgejo')
    expect(detectForge('/srv/git/repo.git')).toBeNull()
    expect(detectForge('https://example.com/o/r')).toBeNull()
    expect(remoteRepositoryPath('git@gitlab.com:group/sub/project.git')).toBe('group/sub/project')
  })
})

describe('GitHub', () => {
  const remote = 'git@github.com:acme/repo.git'
  const pullRequest = {
    isDraft: false,
    number: 42,
    state: 'OPEN',
    title: 'Fix',
    url: 'https://github.com/acme/repo/pull/42',
    closedAt: null,
  }

  function github(lookup: GitProcessResult, created = '[]') {
    let didCreate = false
    return boundary(remote, (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[2] === 'list') return didCreate ? ok(created) : lookup
      if (argv[2] === 'create') {
        didCreate = true
        return ok('https://github.com/acme/repo/pull/42')
      }
      return undefined
    })
  }

  it('returns a confirmed empty list as absence', async () => {
    const cwd = await checkout()
    const forge = github(ok('[]'))
    await expect(readPullRequest({ branch: 'feature/login', cwd }, forge)).resolves.toEqual({
      pullRequest: null,
      support: 'ready',
      forge: { kind: 'github', name: 'GitHub', host: 'github.com' },
    })
    expect(forge.commands('gh').at(-1)?.argv).toEqual([
      'gh',
      'pr',
      'list',
      '--repo',
      remote,
      '--head',
      'feature/login',
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'isDraft,number,state,title,url,closedAt',
    ])
  })

  it('returns the existing pull request without creating another', async () => {
    const cwd = await checkout()
    const forge = github(json([pullRequest]))
    await expect(
      createPullRequest({ branch: 'feature/login', cwd, title: 'Fix' }, forge),
    ).resolves.toMatchObject({ kind: 'exists', pullRequest: { number: 42 } })
    expect(forge.calls.some((call) => call.argv[2] === 'create')).toBe(false)
  })

  it('creates only after confirmed absence, then reads the new request', async () => {
    const cwd = await checkout()
    const forge = github(ok('[]'), JSON.stringify([pullRequest]))
    await expect(
      createPullRequest({ branch: 'feature/login', cwd, title: 'Fix', draft: true }, forge),
    ).resolves.toMatchObject({ kind: 'created', pullRequest: { number: 42 } })
    const create = forge.calls.find((call) => call.argv[2] === 'create')
    expect(create?.argv).toContain('--draft')
    expect(create?.argv).toEqual(expect.arrayContaining(['--repo', remote]))
  })

  it.each([
    [
      'expired auth',
      { exitCode: 1, stderr: 'HTTP 401: Bad credentials', stdout: '' },
      'could not list',
    ],
    [
      'rate limit',
      { exitCode: 1, stderr: 'HTTP 429: rate limit exceeded', stdout: '' },
      'could not list',
    ],
    ['network', { exitCode: 1, stderr: 'network unreachable', stdout: '' }, 'could not list'],
    [
      'timeout',
      { exitCode: 143, stderr: '', stdout: '', limit: { kind: 'timeout', timeoutMs: 20_000 } },
      'timed out',
    ],
    ['malformed JSON', { exitCode: 0, stderr: '', stdout: '{' }, 'invalid pull request response'],
    ['malformed record', ok('[{"number":42}]'), 'invalid pull request response'],
    ['wrong shape', ok('null'), 'invalid pull request response'],
  ] satisfies [string, GitProcessResult, string][])(
    'rejects %s and performs no create',
    async (_label, result, message) => {
      const cwd = await checkout()
      const forge = github(result)
      await expect(readPullRequest({ branch: 'feature/login', cwd }, forge)).rejects.toThrow(
        message,
      )
      await expect(
        createPullRequest({ branch: 'feature/login', cwd, title: 'Fix' }, forge),
      ).rejects.toThrow(message)
      expect(forge.calls.some((call) => call.argv[2] === 'create')).toBe(false)
    },
  )

  it('tells a missing CLI from a signed-out one', async () => {
    const missing = boundary(remote, () => 'missing')
    await expect(
      readPullRequest({ branch: 'b', cwd: await checkout() }, missing),
    ).resolves.toMatchObject({
      support: 'cli-missing',
      pullRequest: null,
    })
    const signedOut = boundary(remote, () => ({ exitCode: 1, stderr: 'not logged in', stdout: '' }))
    await expect(
      readPullRequest({ branch: 'b', cwd: await checkout() }, signedOut),
    ).resolves.toMatchObject({
      support: 'unauthenticated',
    })
  })

  it('asks once for every branch in GraphQL, names as variables, and tells none from found', async () => {
    const node = (number: number, state: string) => ({
      closedAt: state === 'MERGED' ? '2026-09-25T10:00:00Z' : null,
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/repo/pull/${number}`,
      state,
      isDraft: number === 8,
    })
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[1] === 'api')
        return json({
          data: {
            repository: {
              b0: { nodes: [node(7, 'MERGED')] },
              b1: { nodes: [] },
              b2: { nodes: [node(8, 'OPEN')] },
            },
          },
        })
      return undefined
    })
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['feature/a', 'feature/b"}', 'feature/c'] },
      forge,
    )
    if (result.kind !== 'ready') throw new TypeError('expected an answer')
    expect(result.pullRequests.get('feature/a')).toMatchObject({
      number: 7,
      state: 'merged',
      closedAt: '2026-09-25T10:00:00Z',
    })
    expect(result.pullRequests.get('feature/b"}')).toBeNull()
    expect(result.pullRequests.get('feature/c')).toMatchObject({ number: 8, draft: true })
    const graphql = forge.calls.filter((call) => call.argv[1] === 'api')
    expect(graphql).toHaveLength(1)
    expect(graphql[0]?.argv).toContain('h1=feature/b"}')
    expect(graphql[0]?.argv).toContain('owner=acme')
    expect(graphql[0]?.argv.find((arg) => arg.startsWith('query='))).not.toContain('feature/b')
  })

  it('names a self-hosted host on every call', async () => {
    const forge = boundary('https://github.example.com/acme/repo', (argv) =>
      argv[1] === 'auth' || argv[2] === 'list' ? ok('[]') : undefined,
    )
    await readPullRequest({ branch: 'b', cwd: await checkout() }, forge)
    const [auth, list] = forge.commands('gh')
    expect(auth?.argv).toEqual(['gh', 'auth', 'status', '--hostname', 'github.example.com'])
    expect(list?.env).toEqual({ GH_HOST: 'github.example.com' })
  })
})

describe('GitLab', () => {
  const remote = 'git@gitlab.com:group/project.git'
  const mergeRequest = {
    iid: 5,
    title: 'Draft: change',
    web_url: 'https://gitlab.com/group/project/-/merge_requests/5',
    state: 'merged',
    draft: true,
    merged_at: '2026-09-25T09:00:00Z',
  }

  it('lists by source branch and maps state, draft and merge time', async () => {
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[1] === 'mr') return json([mergeRequest])
      return undefined
    })
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['feature'] },
      forge,
    )
    if (result.kind !== 'ready') throw new TypeError('expected an answer')
    expect(result.pullRequests.get('feature')).toEqual({
      closedAt: '2026-09-25T09:00:00Z',
      draft: true,
      number: 5,
      state: 'merged',
      title: 'Draft: change',
      url: mergeRequest.web_url,
    })
    expect(forge.commands('glab').at(-1)?.argv).toEqual([
      'glab',
      'mr',
      'list',
      '--repo',
      remote,
      '--source-branch',
      'feature',
      '--all',
      '--per-page',
      '1',
      '--output',
      'json',
    ])
  })

  it('creates a merge request with its target and draft flag', async () => {
    let created = false
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[2] === 'list') return json(created ? [{ ...mergeRequest, state: 'opened' }] : [])
      if (argv[2] === 'create') {
        created = true
        return ok()
      }
      return undefined
    })
    await expect(
      createPullRequest(
        { branch: 'feature', base: 'main', cwd: await checkout(), title: 'Change', draft: true },
        forge,
      ),
    ).resolves.toMatchObject({ kind: 'created', pullRequest: { number: 5, state: 'open' } })
    expect(forge.calls.find((call) => call.argv[2] === 'create')?.argv).toEqual(
      expect.arrayContaining([
        '--repo',
        remote,
        '--source-branch',
        'feature',
        '--target-branch',
        'main',
        '--draft',
      ]),
    )
  })

  it('recognises a self-hosted instance on a plain host through a signed-in glab', async () => {
    const forge = boundary('https://code.example.com/group/project.git', (argv) => {
      if (argv[0] === 'glab' && argv[1] === 'auth') return ok()
      if (argv[1] === 'mr') return json([])
      return undefined
    })
    await expect(
      readPullRequest({ branch: 'feature', cwd: await checkout() }, forge),
    ).resolves.toMatchObject({
      support: 'ready',
      forge: { kind: 'gitlab', name: 'GitLab Self-Hosted', host: 'code.example.com' },
    })
  })
})

describe('Forgejo', () => {
  const remote = 'https://codeberg.org/owner/repo.git'
  const logins = [{ name: 'codeberg', url: 'https://codeberg.org' }]

  it('reads recent pulls through the host login and filters by head branch', async () => {
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'login') return json(logins)
      if (argv[1] === 'api')
        return json([
          {
            number: 9,
            title: 'Other',
            html_url: 'https://codeberg.org/owner/repo/pulls/9',
            state: 'open',
            head: { ref: 'other' },
          },
          {
            number: 3,
            title: 'WIP: mine',
            html_url: 'https://codeberg.org/owner/repo/pulls/3',
            state: 'closed',
            merged: true,
            merged_at: '2026-09-24T00:00:00Z',
            head: { ref: 'mine' },
          },
        ])
      return undefined
    })
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['mine', 'absent'] },
      forge,
    )
    if (result.kind !== 'ready') throw new TypeError('expected an answer')
    expect(result.pullRequests.get('mine')).toMatchObject({
      number: 3,
      state: 'merged',
      draft: true,
    })
    expect(result.pullRequests.get('absent')).toBeNull()
    expect(forge.calls.find((call) => call.argv[1] === 'api')?.argv).toEqual([
      'tea',
      'api',
      '--login',
      'codeberg',
      'https://codeberg.org/api/v1/repos/owner/repo/pulls?state=all&sort=recentupdate&limit=50&page=1',
    ])
  })

  it('finds a branch beyond the first full page', async () => {
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'login') return json(logins)
      const page = new URL(argv.at(-1) ?? '').searchParams.get('page')
      const pull = (number: number, branch: string) => ({
        number,
        title: branch,
        html_url: `https://codeberg.org/owner/repo/pulls/${number}`,
        state: 'open',
        head: { ref: branch },
      })
      return json(
        page === '2'
          ? [pull(51, 'old-open')]
          : Array.from({ length: 50 }, (_, i) => pull(i + 1, `other-${i}`)),
      )
    })
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['old-open'] },
      forge,
    )
    expect(result.kind === 'ready' && result.pullRequests.get('old-open')).toMatchObject({
      number: 51,
    })
  })

  it('is signed out when no login matches the host', async () => {
    const forge = boundary(remote, (argv) =>
      argv[1] === 'login' ? json([{ name: 'other', url: 'https://example.org' }]) : undefined,
    )
    await expect(
      readPullRequest({ branch: 'b', cwd: await checkout() }, forge),
    ).resolves.toMatchObject({
      support: 'unauthenticated',
    })
  })

  it('creates against the default branch with the body on stdin', async () => {
    let created = false
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'login') return json(logins)
      if (argv.includes('POST')) {
        created = true
        return ok('{}')
      }
      if (argv.at(-1)?.endsWith('/repos/owner/repo')) return json({ default_branch: 'trunk' })
      if (argv[1] === 'api')
        return json(
          created
            ? [
                {
                  number: 4,
                  title: 'T',
                  html_url: 'https://codeberg.org/owner/repo/pulls/4',
                  state: 'open',
                  head: { ref: 'feature' },
                },
              ]
            : [],
        )
      return undefined
    })
    await expect(
      createPullRequest({ branch: 'feature', cwd: await checkout(), title: 'T', body: 'B' }, forge),
    ).resolves.toMatchObject({ kind: 'created', pullRequest: { number: 4 } })
    const post = forge.calls.find((call) => call.argv.includes('POST'))
    expect(JSON.parse(post?.input ?? '{}')).toEqual({
      base: 'trunk',
      head: 'feature',
      title: 'T',
      body: 'B',
    })
  })
})

describe('Azure DevOps', () => {
  const remote = 'https://dev.azure.com/org/project/_git/repo'

  it('lists by source branch and builds the web URL', async () => {
    const forge = boundary(remote, (argv) => {
      if (argv[1] === 'account') return ok('someone@example.com\n')
      if (argv[3] === 'list')
        return json([
          {
            pullRequestId: 17,
            title: 'Change',
            status: 'abandoned',
            isDraft: false,
            closedDate: '2026-09-24T00:00:00Z',
            repository: { webUrl: 'https://dev.azure.com/org/project/_git/repo' },
          },
        ])
      return undefined
    })
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['feature'] },
      forge,
    )
    if (result.kind !== 'ready') throw new TypeError('expected an answer')
    expect(result.pullRequests.get('feature')).toMatchObject({
      number: 17,
      state: 'closed',
      url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/17',
    })
    expect(forge.calls.find((call) => call.argv[3] === 'list')?.argv).toEqual(
      expect.arrayContaining(['--detect', 'true', '--source-branch', 'feature', '--status', 'all']),
    )
  })

  it('reports a signed-out az as unauthenticated', async () => {
    const forge = boundary(remote, () => ({
      exitCode: 1,
      stderr: "Please run 'az login'",
      stdout: '',
    }))
    await expect(
      readPullRequest({ branch: 'b', cwd: await checkout() }, forge),
    ).resolves.toMatchObject({
      support: 'unauthenticated',
    })
  })
})

describe('Bitbucket Cloud', () => {
  const remote = 'git@bitbucket.org:workspace/repo.git'
  const credential = ok('protocol=https\nhost=bitbucket.org\nusername=me\npassword=app-password\n')

  function api(respond: (url: URL, init: RequestInit) => Response) {
    const requests: { url: URL; init: RequestInit }[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      requests.push({ url, init: init ?? {} })
      return respond(url, init ?? {})
    }) as typeof fetch
    return { requests, fetcher }
  }

  it('authenticates with the credential git stores and queries by source branch', async () => {
    const http = api(() =>
      Response.json({
        values: [
          {
            id: 6,
            title: 'Change',
            state: 'MERGED',
            updated_on: '2026-09-23T00:00:00Z',
            links: { html: { href: 'https://bitbucket.org/workspace/repo/pull-requests/6' } },
          },
        ],
      }),
    )
    const forge = boundary(remote, (argv) => (argv.includes('credential') ? credential : undefined))
    const result = await readBranchPullRequests(
      { cwd: await checkout(), branches: ['feature'] },
      { run: forge.run, fetch: http.fetcher },
    )
    if (result.kind !== 'ready') throw new TypeError('expected an answer')
    expect(result.pullRequests.get('feature')).toMatchObject({ number: 6, state: 'merged' })
    const [request] = http.requests
    expect(request?.url.pathname).toBe('/2.0/repositories/workspace/repo/pullrequests')
    expect(request?.url.searchParams.get('q')).toBe('source.branch.name = "feature"')
    expect(request?.url.searchParams.getAll('state')).toEqual([
      'OPEN',
      'MERGED',
      'DECLINED',
      'SUPERSEDED',
    ])
    expect(new Headers(request?.init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('me:app-password').toString('base64')}`,
    )
    const fill = forge.calls.find((call) => call.argv.includes('credential'))
    expect(fill?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
  })

  it('is signed out without a stored credential and fails a refused request', async () => {
    const none = boundary(remote, () => ({ exitCode: 128, stderr: 'no credential', stdout: '' }))
    await expect(
      readPullRequest({ branch: 'b', cwd: await checkout() }, none),
    ).resolves.toMatchObject({
      support: 'unauthenticated',
    })
    const refused = api(() => new Response('{}', { status: 429 }))
    const forge = boundary(remote, (argv) => (argv.includes('credential') ? credential : undefined))
    await expect(
      readBranchPullRequests(
        { cwd: await checkout(), branches: ['b'] },
        { run: forge.run, fetch: refused.fetcher },
      ),
    ).rejects.toThrow('could not list')
  })
})

it('reports no forge for a remote on an unknown host', async () => {
  const forge = boundary('/srv/git/repo.git', () => undefined)
  await expect(readPullRequest({ branch: 'b', cwd: await checkout() }, forge)).resolves.toEqual({
    pullRequest: null,
    support: 'no-forge',
    forge: null,
  })
})

describe('repository creation', () => {
  const create = (forge: GitPublishRequest['forge'], repository: string) => ({
    forge,
    repository,
    visibility: 'public' as const,
  })

  it('GitLab resolves the namespace and posts the project', async () => {
    const forge = boundary('', (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[2] === 'namespaces/group%2Fsub') return json({ id: 42 })
      if (argv.includes('projects'))
        return json({
          web_url: 'https://gitlab.com/group/sub/app',
          http_url_to_repo: 'https://gitlab.com/group/sub/app.git',
          ssh_url_to_repo: 'git@gitlab.com:group/sub/app.git',
        })
      return undefined
    })
    await expect(
      createForgeRepository(create('gitlab', 'group/sub/app'), await checkout(), forge),
    ).resolves.toEqual({
      url: 'https://gitlab.com/group/sub/app',
      httpsUrl: 'https://gitlab.com/group/sub/app.git',
      sshUrl: 'git@gitlab.com:group/sub/app.git',
    })
    expect(forge.calls.find((call) => call.argv.includes('projects'))?.argv).toEqual(
      expect.arrayContaining(['path=app', 'visibility=public', 'namespace_id=42']),
    )
  })

  it('binds remote-free GitLab publishing to the selected authenticated host', async () => {
    const host = 'gitlab.internal'
    const forge = boundary('', (argv) => {
      const selected = argv[argv.indexOf('--hostname') + 1]
      const authenticated = new Set(['gitlab.com', host])
      const targetHost = authenticated.has(selected ?? '') ? selected : 'gitlab.com'
      if (argv[1] === 'auth') return ok()
      if (argv.includes('namespaces/team')) return json({ id: 12 })
      return json({
        web_url: `https://${targetHost}/team/app`,
        http_url_to_repo: `https://${targetHost}/team/app.git`,
        ssh_url_to_repo: `git@${targetHost}:team/app.git`,
      })
    })
    const result = await createForgeRepository(
      { ...create('gitlab', 'team/app'), host },
      await checkout(),
      forge,
    )
    expect(result.url).toBe(`https://${host}/team/app`)
    for (const call of forge.commands('glab').filter((call) => call.argv[1] === 'api')) {
      expect(call.argv).toEqual(expect.arrayContaining(['--hostname', host]))
    }
  })

  it('Forgejo creates under the user or an organization', async () => {
    const forge = boundary('', (argv) => {
      if (argv[1] === 'login') return json([{ name: 'codeberg', url: 'https://codeberg.org' }])
      if (argv.at(-1)?.endsWith('/user')) return json({ login: 'me' })
      if (argv.includes('POST'))
        return json({
          html_url: 'https://codeberg.org/team/app',
          clone_url: 'https://codeberg.org/team/app.git',
          ssh_url: 'git@codeberg.org:team/app.git',
        })
      return undefined
    })
    await createForgeRepository(create('forgejo', 'team/app'), await checkout(), forge)
    const post = forge.calls.find((call) => call.argv.includes('POST'))
    expect(post?.argv.at(-1)).toBe('https://codeberg.org/api/v1/orgs/team/repos')
    expect(JSON.parse(post?.input ?? '{}')).toEqual({
      name: 'app',
      private: false,
      auto_init: false,
    })
  })

  it('Azure DevOps needs organization/project/name', async () => {
    const forge = boundary('', (argv) => {
      if (argv[1] === 'account') return ok('me\n')
      if (argv[2] === 'create')
        return json({
          webUrl: 'https://dev.azure.com/org/proj/_git/app',
          remoteUrl: 'https://org@dev.azure.com/org/proj/_git/app',
          sshUrl: 'git@ssh.dev.azure.com:v3/org/proj/app',
        })
      return undefined
    })
    await expect(
      createForgeRepository(create('azure-devops', 'org/app'), await checkout(), forge),
    ).rejects.toThrow('Azure DevOps needs the repository as organization/project/name')
    await expect(
      createForgeRepository(create('azure-devops', 'org/proj/app'), await checkout(), forge),
    ).resolves.toMatchObject({ sshUrl: 'git@ssh.dev.azure.com:v3/org/proj/app' })
    expect(forge.calls.find((call) => call.argv[2] === 'create')?.argv).toEqual(
      expect.arrayContaining([
        '--org',
        'https://dev.azure.com/org',
        '--project',
        'proj',
        '--name',
        'app',
      ]),
    )
  })

  it('Bitbucket posts the repository with its privacy', async () => {
    const requests: { url: string; body: string }[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: String(init?.body ?? '') })
      return Response.json({
        links: {
          html: { href: 'https://bitbucket.org/ws/app' },
          clone: [
            { name: 'https', href: 'https://bitbucket.org/ws/app.git' },
            { name: 'ssh', href: 'git@bitbucket.org:ws/app.git' },
          ],
        },
      })
    }) as typeof fetch
    const forge = boundary('', (argv) =>
      argv.includes('credential') ? ok('username=me\npassword=secret\n') : undefined,
    )
    await expect(
      createForgeRepository(create('bitbucket', 'ws/app'), await checkout(), {
        run: forge.run,
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ sshUrl: 'git@bitbucket.org:ws/app.git' })
    expect(requests[0]).toEqual({
      url: 'https://api.bitbucket.org/2.0/repositories/ws/app',
      body: JSON.stringify({ scm: 'git', is_private: false }),
    })
  })
})

describe('owner review regressions', () => {
  it.each([
    ['bitbucket', 'github.com'],
    ['bitbucket', 'bitbucket.internal'],
    ['bitbucket', 'bitbucket.org\nhost=github.com'],
    ['github', 'gitlab.com'],
    ['github', 'github.com/path'],
    ['gitlab', 'user@gitlab.com'],
  ] satisfies [GitPublishRequest['forge'], string][])(
    'rejects publishing %s on %s before asking for credentials',
    async (kind, host) => {
      const forge = boundary('', () => ok('username=me\npassword=secret\n'))
      await expect(
        createForgeRepository(
          {
            forge: kind,
            host,
            repository: 'owner/repo',
            visibility: 'private',
          },
          await checkout(),
          forge,
        ),
      ).rejects.toThrow('host')
      expect(forge.calls).toEqual([])
    },
  )

  it('probes the overridden forge even when the checkout forge is cached as ready', async () => {
    const cwd = await checkout()
    const forge = boundary('https://github.com/acme/repo.git', (argv) => {
      if (argv[0] === 'glab') return 'missing'
      if (argv[1] === 'auth') return ok()
      if (argv[2] === 'list') return json([])
      return undefined
    })
    await readPullRequest({ cwd, branch: 'feature' }, forge)
    await expect(
      resolvePullRequest({ cwd, number: 1, remoteUrl: 'https://gitlab.com/team/repo.git' }, forge),
    ).rejects.toThrow('command-line tool is not installed')
  })

  it('names why a pinned pull request read cannot reach its forge', async () => {
    const forge = boundary('https://gitlab.com/team/repo.git', (argv) =>
      argv[0] === 'glab' ? 'missing' : undefined,
    )
    await expect(
      readPullRequestsByNumber(
        { cwd: await checkout(), remoteUrl: 'https://gitlab.com/team/repo.git', numbers: [1] },
        forge,
      ),
    ).rejects.toThrow('GitLab is not ready: its command-line tool is not installed')
  })

  it('bounds Forgejo history scans and preserves unknown absence', async () => {
    let pages = 0
    const forge = boundary('https://codeberg.org/owner/repo.git', (argv) => {
      if (argv[1] === 'login') return json([{ name: 'codeberg', url: 'https://codeberg.org' }])
      pages += 1
      if (pages > 6) return json([])
      return json(
        Array.from({ length: 50 }, (_, index) => ({
          number: pages * 50 + index,
          title: 'Other',
          state: 'closed',
          html_url: `https://codeberg.org/owner/repo/pulls/${pages * 50 + index}`,
          head: { ref: 'other' },
        })),
      )
    })
    const cwd = await checkout()
    const result = await readBranchPullRequests({ cwd, branches: ['absent', 'other'] }, forge)
    expect(pages).toBeLessThanOrEqual(5)
    // One unmatched branch is unknown; it does not fail the branches the scan did answer.
    expect(result.kind === 'ready' && result.pullRequests.has('absent')).toBe(false)
    expect(result.kind === 'ready' && result.pullRequests.get('other')).toMatchObject({
      number: 50,
    })
    pages = 0
    await expect(readPullRequest({ cwd, branch: 'absent' }, forge)).rejects.toThrow('lookup limit')
  })

  it('checks out an Azure fork from its source repository at the reported commit', async () => {
    const source = 'https://dev.azure.com/org/project/_git/fork'
    const commit = 'a'.repeat(40)
    const forge = boundary('https://dev.azure.com/org/project/_git/repo', (argv) => {
      if (argv[1] === 'account') return ok()
      if (argv[3] !== 'show') return undefined
      return json({
        pullRequestId: 17,
        title: 'Fork',
        status: 'active',
        repository: { webUrl: 'https://dev.azure.com/org/project/_git/repo' },
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        forkSource: {
          name: 'refs/heads/feature',
          objectId: commit,
          repository: { remoteUrl: source },
        },
      })
    })
    const { detail } = await resolvePullRequest({ cwd: await checkout(), number: 17 }, forge)
    expect(detail).toMatchObject({
      crossRepository: true,
      headFetchRef: 'refs/heads/feature',
      headSource: { url: source, commit },
    })
  })
})

it('reads distinct pinned GitHub requests in one repository query', async () => {
  const forge = boundary('https://github.com/acme/repo.git', (argv) => {
    if (argv[1] === 'auth') return ok()
    if (argv[1] !== 'api') return undefined
    return json({
      data: {
        repository: {
          p0: {
            number: 12,
            title: 'A',
            url: 'https://github.com/acme/repo/pull/12',
            state: 'OPEN',
            isDraft: false,
            closedAt: null,
          },
          p1: {
            number: 13,
            title: 'B',
            url: 'https://github.com/acme/repo/pull/13',
            state: 'MERGED',
            isDraft: false,
            closedAt: null,
          },
        },
      },
    })
  })
  const found = await readPullRequestsByNumber(
    { cwd: await checkout(), remoteUrl: 'https://github.com/acme/repo.git', numbers: [12, 13, 12] },
    forge,
  )
  expect([...found.keys()]).toEqual([12, 13])
  expect(forge.calls.filter((call) => call.argv[1] === 'api')).toHaveLength(1)
  expect(forge.calls.at(-1)?.argv).toEqual(expect.arrayContaining(['-F', 'n0=12', '-F', 'n1=13']))
})

describe('forge discussion capabilities', () => {
  it('GitHub reads and posts on the selected self-hosted host, preserving comment text', async () => {
    const body = '--flag\n$HOME `command`'
    const forge = boundary('https://github.example.com/acme/repo.git', (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv.includes('POST')) return ok('{}')
      if (argv[1] === 'api')
        return json([
          {
            id: 11,
            body,
            created_at: '2026-10-01T10:00:00Z',
            html_url: 'https://github.example.com/acme/repo/pull/7#issuecomment-11',
            user: null,
          },
        ])
      return undefined
    })
    const cwd = await checkout()
    expect(await readPullRequestComments({ cwd, number: 7 }, forge)).toMatchObject({
      kind: 'ready',
      comments: [{ id: '11', body, author: 'Deleted account' }],
      truncated: false,
    })
    expect(await postPullRequestComment({ cwd, number: 7, body }, forge)).toEqual({
      kind: 'posted',
    })
    expect(forge.calls.at(-1)?.argv).toEqual(
      expect.arrayContaining([
        '--hostname',
        'github.example.com',
        'repos/acme/repo/issues/7/comments',
        '--input',
        '-',
      ]),
    )
    expect(forge.calls.at(-1)?.input).toBe(JSON.stringify({ body }))
    expect(forge.calls.at(-1)?.argv.join(' ')).not.toContain(body)
  })

  it('GitLab encodes a nested project and excludes system, diff, and threaded notes', async () => {
    const forge = boundary('https://gitlab.example.com/group/sub/repo.git', (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv.includes('POST')) return ok('{}')
      if (argv[1] === 'api')
        return json([
          {
            id: 1,
            body: 'pushed',
            created_at: 'today',
            system: true,
            type: null,
            author: { username: 'author' },
          },
          {
            id: 2,
            body: 'review',
            created_at: 'today',
            system: false,
            type: null,
            author: { username: 'reviewer' },
          },
          {
            id: 3,
            body: 'replace this expression',
            created_at: 'today',
            system: false,
            type: 'DiffNote',
            position: { position_type: 'text', new_path: 'src/file.ts', new_line: 12 },
            author: { username: 'reviewer' },
          },
          {
            id: 4,
            body: 'threaded reply',
            created_at: 'today',
            system: false,
            type: 'DiscussionNote',
            author: { username: 'reviewer' },
          },
          {
            id: 5,
            body: 'positioned note',
            created_at: 'today',
            system: false,
            type: null,
            position: { position_type: 'text', new_path: 'src/file.ts', new_line: 13 },
            author: { username: 'reviewer' },
          },
        ])
      return undefined
    })
    const cwd = await checkout()
    expect(await readPullRequestComments({ cwd, number: 7 }, forge)).toMatchObject({
      kind: 'ready',
      comments: [{ id: '2', body: 'review' }],
    })
    await postPullRequestComment({ cwd, number: 7, body: 'true' }, forge)
    expect(forge.calls.at(-1)?.argv).toEqual(
      expect.arrayContaining([
        'projects/group%2Fsub%2Frepo/merge_requests/7/notes',
        '--hostname',
        'gitlab.example.com',
        '--input',
        '-',
        '--header',
        'Content-Type: application/json',
      ]),
    )
    expect(forge.calls.at(-1)?.input).toBe(JSON.stringify({ body: 'true' }))
  })

  it('Forgejo sends the body on stdin using the login for the remote host', async () => {
    const forge = boundary('https://codeberg.org/acme/repo.git', (argv) => {
      if (argv[1] === 'login')
        return json([
          { name: 'wrong', url: 'https://forgejo.example.com' },
          { name: 'correct', url: 'https://codeberg.org' },
        ])
      if (argv.includes('POST')) return ok('{}')
      if (argv[1] === 'api')
        return json([
          {
            id: 4,
            body: 'review',
            created_at: 'today',
            html_url: 'https://codeberg.org/acme/repo/pulls/7',
            user: { login: 'reviewer' },
          },
        ])
      return undefined
    })
    const cwd = await checkout()
    expect(await readPullRequestComments({ cwd, number: 7 }, forge)).toMatchObject({
      kind: 'ready',
      comments: [{ id: '4' }],
    })
    await postPullRequestComment({ cwd, number: 7, body: 'text\nwith quotes "' }, forge)
    expect(forge.calls.at(-1)).toMatchObject({
      input: JSON.stringify({ body: 'text\nwith quotes "' }),
    })
    expect(forge.calls.at(-1)?.argv).toEqual(
      expect.arrayContaining([
        '--login',
        'correct',
        'https://codeberg.org/api/v1/repos/acme/repo/issues/7/comments',
      ]),
    )
  })

  it.each([99, 100, 101])(
    'Forgejo bounds %i unpaginated comments and reports only omitted rows',
    async (count) => {
      const forge = boundary('https://codeberg.org/acme/repo.git', (argv) => {
        if (argv[1] === 'login') return json([{ name: 'fixture', url: 'https://codeberg.org' }])
        if (argv[1] === 'api')
          return json(
            Array.from({ length: count }, (_, index) => ({
              id: index + 1,
              body: `Comment ${index + 1}`,
              created_at: '2026-10-01T10:00:00Z',
              html_url: `https://codeberg.org/acme/repo/pulls/7#issuecomment-${index + 1}`,
              user: { login: 'reviewer' },
            })),
          )
        return undefined
      })
      const result = await readPullRequestComments({ cwd: await checkout(), number: 7 }, forge)
      expect(result.kind).toBe('ready')
      if (result.kind !== 'ready') return
      expect(result.comments).toHaveLength(Math.min(count, 100))
      expect(result.comments.at(-1)?.id).toBe(String(Math.min(count, 100)))
      expect(result.truncated).toBe(count > 100)
      expect(forge.calls.at(-1)?.argv.at(-1)).toBe(
        'https://codeberg.org/api/v1/repos/acme/repo/issues/7/comments',
      )
    },
  )

  it.each([99, 100])('GitHub keeps the page-bound preview for %i comments', async (count) => {
    const forge = boundary('https://github.com/acme/repo.git', (argv) => {
      if (argv[1] === 'auth') return ok()
      if (argv[1] === 'api')
        return json(
          Array.from({ length: count }, (_, index) => ({
            id: index + 1,
            body: `Comment ${index + 1}`,
            created_at: '2026-10-01T10:00:00Z',
            html_url: `https://github.com/acme/repo/pull/7#issuecomment-${index + 1}`,
            user: { login: 'reviewer' },
          })),
        )
      return undefined
    })
    const result = await readPullRequestComments({ cwd: await checkout(), number: 7 }, forge)
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.comments).toHaveLength(count)
    expect(result.truncated).toBe(count === 100)
    expect(forge.calls.at(-1)?.argv).toContain('repos/acme/repo/issues/7/comments?per_page=100')
  })

  it('Bitbucket filters inline/reply/deleted comments and explicitly reports a bounded page', async () => {
    const forge = boundary('https://bitbucket.org/acme/repo.git', (argv) =>
      argv.includes('credential') ? ok('username=fixture\npassword=fixture\n') : undefined,
    )
    const requests: { url: string; body: string | null }[] = []
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : null })
      if (init?.method === 'POST') return Response.json({ id: 3 })
      const comment = {
        id: 1,
        content: { raw: 'general' },
        created_on: 'today',
        user: { display_name: 'reviewer' },
        links: { html: { href: 'https://bitbucket.org/acme/repo/pull-requests/7' } },
      }
      return Response.json({
        next: 'https://api.bitbucket.org/next',
        values: [
          comment,
          { ...comment, id: 2, inline: { path: 'file' } },
          { ...comment, id: 3, parent: { id: 1 } },
          { ...comment, id: 4, deleted: true },
        ],
      })
    }) as typeof fetch
    const boundaries = { ...forge, fetch: fetcher }
    const cwd = await checkout()
    expect(await readPullRequestComments({ cwd, number: 7 }, boundaries)).toMatchObject({
      kind: 'ready',
      comments: [{ id: '1', body: 'general' }],
      truncated: true,
    })
    await postPullRequestComment({ cwd, number: 7, body: 'Thanks' }, boundaries)
    expect(requests.at(-1)).toEqual({
      url: 'https://api.bitbucket.org/2.0/repositories/acme/repo/pullrequests/7/comments',
      body: JSON.stringify({ content: { raw: 'Thanks' } }),
    })
  })

  it.each([
    ['https://dev.azure.com/org/project/_git/repo', 'https://dev.azure.com/org'],
    ['git@ssh.dev.azure.com:v3/org/project/repo', 'https://dev.azure.com/org'],
    ['git@org.visualstudio.com:v3/org/project/repo', 'https://org.visualstudio.com'],
  ])(
    'Azure reads returned repository threads for %s with native context and unsupported writes',
    async (remote, organization) => {
      const forge = boundary(remote, (argv) => {
        if (argv[1] === 'account') return ok('fixture')
        if (argv.includes('show'))
          return json({
            repository: { name: 'returned-repo', project: { name: 'returned-project' } },
          })
        if (argv.includes('invoke'))
          return json({
            value: [
              {
                id: 3,
                threadContext: { filePath: '/src/main.ts' },
                comments: [
                  {
                    id: 1,
                    content: 'Inline comment',
                    publishedDate: 'today',
                    author: { displayName: 'Reader' },
                  },
                  { id: 2, content: 'Reply', publishedDate: 'today' },
                  { id: 3, content: 'System event', publishedDate: 'today', commentType: 'system' },
                  { id: 4, content: 'Deleted', publishedDate: 'today', isDeleted: true },
                ],
              },
              {
                id: 4,
                isDeleted: true,
                comments: [{ id: 1, content: 'Deleted thread', publishedDate: 'today' }],
              },
            ],
          })
        return undefined
      })
      const cwd = await checkout()
      expect(await readPullRequestComments({ cwd, number: 7 }, forge)).toMatchObject({
        kind: 'ready',
        forge: { kind: 'azure-devops' },
        truncated: false,
        comment: { kind: 'unsupported' },
        review: { kind: 'unsupported' },
        comments: [
          { id: '3:1', body: 'Inline comment', context: { threadId: '3', path: '/src/main.ts' } },
          { id: '3:2', body: 'Reply', context: { threadId: '3', path: '/src/main.ts' } },
        ],
      })
      expect(forge.commands('az').at(-1)?.argv).toEqual(
        expect.arrayContaining([
          '--org',
          organization,
          'project=returned-project',
          'repositoryId=returned-repo',
          'pullRequestId=7',
        ]),
      )
      expect(await postPullRequestComment({ cwd, number: 7, body: 'Thanks' }, forge)).toMatchObject(
        {
          kind: 'unsupported',
        },
      )
      expect(
        await submitPullRequestReview({ cwd, number: 7, body: '', verdict: 'approve' }, forge),
      ).toMatchObject({ kind: 'unsupported' })
      expect(forge.commands('az')).toHaveLength(3)
      for (const call of forge.commands('az').slice(1)) {
        expect(call.argv[call.argv.indexOf('--org') + 1]).toBe(organization)
      }
    },
  )

  it.each([99, 100, 101])('Azure caps its unpaginated preview of %i comments', async (count) => {
    const forge = boundary('https://dev.azure.com/org/project/_git/repo', (argv) => {
      if (argv[1] === 'account') return ok('fixture')
      if (argv.includes('show'))
        return json({ repository: { name: 'repo', project: { name: 'project' } } })
      if (argv.includes('invoke'))
        return json({
          value: [
            {
              id: 1,
              comments: Array.from({ length: count }, (_, index) => ({
                id: index + 1,
                content: 'Comment',
                publishedDate: 'today',
              })),
            },
          ],
        })
      return undefined
    })
    const result = await readPullRequestComments({ cwd: await checkout(), number: 7 }, forge)
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.comments).toHaveLength(Math.min(count, 100))
    expect(result.truncated).toBe(count > 100)
  })

  it('a refused comment exposes no forge stderr or comment body', async () => {
    const forge = boundary('https://github.com/acme/repo.git', (argv) =>
      argv[1] === 'auth' ? ok() : { exitCode: 1, stdout: '', stderr: 'secret body' },
    )
    await expect(
      postPullRequestComment({ cwd: await checkout(), number: 7, body: 'private comment' }, forge),
    ).rejects.toMatchObject({
      code: 'git.PULL_REQUEST_COMMENT_FAILED',
      message: 'The Git host could not post the comment',
    })
  })
})

describe('forge review submission', () => {
  it.each([
    ['comment', 'COMMENT'],
    ['approve', 'APPROVE'],
    ['request-changes', 'REQUEST_CHANGES'],
  ] as const)(
    'GitHub submits %s atomically with JSON stdin on the selected host',
    async (verdict, event) => {
      const forge = boundary('https://github.internal/acme/repo.git', (argv) =>
        argv[1] === 'auth' || argv.includes('POST') ? ok('{}') : undefined,
      )
      const body = 'A "quoted" summary\nwith unicode α'
      expect(
        await submitPullRequestReview({ cwd: await checkout(), number: 7, verdict, body }, forge),
      ).toEqual({ kind: 'submitted', verdict })
      const writes = forge.commands('gh').filter((call) => call.argv.includes('POST'))
      expect(writes).toHaveLength(1)
      expect(writes[0]?.argv).toEqual(
        expect.arrayContaining([
          '--hostname',
          'github.internal',
          'repos/acme/repo/pulls/7/reviews',
          '--input',
          '-',
        ]),
      )
      expect(JSON.parse(writes[0]?.input ?? '{}')).toEqual({ body, event })
      expect(writes[0]?.argv).not.toContain(body)
    },
  )

  it.each([false, true])(
    'GitLab approval waits for its summary (summary refusal: %s)',
    async (refused) => {
      const forge = boundary('https://gitlab.internal/group/sub/repo.git', (argv) => {
        if (argv[1] === 'auth') return ok()
        if (argv.some((arg) => arg.endsWith('/notes')))
          return refused ? { exitCode: 1, stdout: '', stderr: 'private summary' } : ok('{}')
        if (argv.some((arg) => arg.endsWith('/approve'))) return ok('{}')
        return undefined
      })
      const body = 'Summary before approval'
      const submitted = submitPullRequestReview(
        { cwd: await checkout(), number: 7, verdict: 'approve', body },
        forge,
      )
      if (refused)
        await expect(submitted).rejects.toMatchObject({
          code: 'git.PULL_REQUEST_REVIEW_FAILED',
          internal: { at: 'summary' },
        })
      if (!refused)
        await expect(submitted).resolves.toEqual({ kind: 'submitted', verdict: 'approve' })
      const posts = forge.commands('glab').filter((call) => call.argv.includes('POST'))
      expect(posts).toHaveLength(refused ? 1 : 2)
      expect(posts[0]?.argv).toEqual(
        expect.arrayContaining([
          'projects/group%2Fsub%2Frepo/merge_requests/7/notes',
          '--header',
          'Content-Type: application/json',
        ]),
      )
      expect(JSON.parse(posts[0]?.input ?? '{}')).toEqual({ body })
      expect(posts[0]?.argv).toEqual(expect.arrayContaining(['--hostname', 'gitlab.internal']))
      if (!refused)
        expect(posts[1]?.argv).toContain('projects/group%2Fsub%2Frepo/merge_requests/7/approve')
    },
  )

  it('GitLab request changes returns unsupported before writing a summary', async () => {
    const forge = boundary('https://gitlab.com/acme/repo.git', (argv) =>
      argv[1] === 'auth' ? ok() : undefined,
    )
    expect(
      await submitPullRequestReview(
        { cwd: await checkout(), number: 7, verdict: 'request-changes', body: 'Changes' },
        forge,
      ),
    ).toMatchObject({ kind: 'unsupported' })
    expect(forge.commands('glab')).toHaveLength(1)
  })

  it.each([
    ['comment', 'COMMENT'],
    ['approve', 'APPROVED'],
    ['request-changes', 'REQUEST_CHANGES'],
  ] as const)('Forgejo binds %s to the fetched head', async (verdict, event) => {
    const head = 'a'.repeat(40)
    const forge = boundary('https://codeberg.org/acme/repo.git', (argv) => {
      if (argv.includes('login')) return json([{ name: 'fixture', url: 'https://codeberg.org' }])
      if (argv.includes('POST')) return ok('{}')
      if (argv.at(-1)?.endsWith('/pulls/7')) return json({ head: { sha: head } })
      return undefined
    })
    expect(
      await submitPullRequestReview(
        { cwd: await checkout(), number: 7, verdict, body: 'Review' },
        forge,
      ),
    ).toEqual({ kind: 'submitted', verdict })
    const post = forge.commands('tea').find((call) => call.argv.includes('POST'))
    expect(post?.argv).toContain('https://codeberg.org/api/v1/repos/acme/repo/pulls/7/reviews')
    expect(JSON.parse(post?.input ?? '{}')).toEqual({ body: 'Review', event, commit_id: head })
    expect(post?.argv).toEqual(expect.arrayContaining(['--data', '@-']))
  })

  it('Forgejo does not post a review after an unreadable head', async () => {
    const forge = boundary('https://codeberg.org/acme/repo.git', (argv) => {
      if (argv.includes('login')) return json([{ name: 'fixture', url: 'https://codeberg.org' }])
      return json({ head: { sha: 'invalid' } })
    })
    await expect(
      submitPullRequestReview(
        { cwd: await checkout(), number: 7, verdict: 'approve', body: '' },
        forge,
      ),
    ).rejects.toMatchObject({ code: 'git.PULL_REQUEST_RESPONSE_INVALID' })
    expect(forge.commands('tea').some((call) => call.argv.includes('POST'))).toBe(false)
  })

  it.each([false, true])(
    'Bitbucket verdict follows the summary (summary refusal: %s)',
    async (refused) => {
      const forge = boundary('https://bitbucket.org/acme/repo.git', (argv) =>
        argv.includes('credential') ? ok('username=fixture\npassword=fixture\n') : undefined,
      )
      const posts: { url: string; body: unknown }[] = []
      const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        posts.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
        return Response.json({}, { status: refused ? 403 : 200 })
      }) as typeof fetch
      const result = submitPullRequestReview(
        { cwd: await checkout(), number: 7, verdict: 'request-changes', body: 'Changes required' },
        { ...forge, fetch: fetcher },
      )
      if (refused)
        await expect(result).rejects.toMatchObject({
          code: 'git.PULL_REQUEST_REVIEW_FAILED',
          internal: { at: 'summary', status: 403 },
        })
      if (!refused)
        await expect(result).resolves.toMatchObject({
          kind: 'submitted',
          verdict: 'request-changes',
        })
      expect(posts).toHaveLength(refused ? 1 : 2)
      expect(posts[0]?.body).toEqual({ content: { raw: 'Changes required' } })
      expect(posts[0]?.url).toMatch(/\/comments$/)
      if (!refused) expect(posts[1]?.url).toMatch(/\/request-changes$/)
    },
  )
})
