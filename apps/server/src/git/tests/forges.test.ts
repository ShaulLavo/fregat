import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { detectForge, remoteRepositoryPath } from '../forges/detect'
import type { RunProcess } from '../forges/types'
import type { GitPublishRequest } from '@workspace/contracts'
import {
  createForgeRepository,
  createPullRequest,
  readBranchPullRequests,
  readPullRequest,
  resolvePullRequest,
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
    await expect(
      readBranchPullRequests({ cwd: await checkout(), branches: ['absent'] }, forge),
    ).rejects.toThrow('lookup limit')
    expect(pages).toBeLessThanOrEqual(5)
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
