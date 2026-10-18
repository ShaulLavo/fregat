import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { mergePins, publishPins } from './parser-pins.mjs'

function githubFixture() {
  const data = JSON.parse(
    readFileSync(new URL('./fixtures/parser-pins.json', import.meta.url), 'utf8'),
  )
  const state = {
    ...data,
    pulls: [data.pull],
    runs: [data.ci],
    jobs: [data.job],
    artifacts: [data.artifact],
    writes: [],
    reads: [],
    current: data.pull,
  }
  const api = {
    get: async (endpoint) => {
      state.reads.push(endpoint)
      if (endpoint === 'actions/runs/10') return state.updater
      if (endpoint === 'actions/runs/20') return state.ci
      if (endpoint === 'pulls/42') return state.current
      if (endpoint.startsWith('pulls/'))
        return state.pulls.find((pull) => endpoint === `pulls/${pull.number}`)
      assert.fail(endpoint)
    },
    pages: async (endpoint) => {
      state.reads.push(endpoint)
      if (endpoint.startsWith('pulls?state=open&'))
        return state.pulls.filter((pull) => pull.state === 'open')
      if (endpoint.startsWith('pulls?state=all&')) return state.pulls
      if (endpoint.startsWith('actions/artifacts?')) return state.artifacts
      if (endpoint.startsWith('actions/workflows/ci.yml/runs?')) return state.runs
      if (endpoint.startsWith('actions/runs/20/jobs?')) return state.jobs
      if (endpoint.endsWith('/files?per_page=100')) return state.files
      assert.fail(endpoint)
    },
    write: async (endpoint, method, body) => {
      state.writes.push({ endpoint, method, body })
      if (endpoint === 'pulls') {
        const number = Math.max(41, ...state.pulls.map((pull) => pull.number)) + 1
        const pull = { ...state.pull, number, head: { ...state.pull.head, ref: body.head } }
        state.pulls.push(pull)
        if (number === 42) {
          state.pull = pull
          state.current = pull
        }
        return { number }
      }
      if (endpoint.endsWith('/merge')) state.current.state = 'closed'
      if (method === 'PATCH')
        state.pulls.find((pull) => endpoint === `pulls/${pull.number}`).state = body.state
      return { merged: true }
    },
  }
  const merge = (id = 20) =>
    mergePins({ api, repository: state.repository, event: { workflow_run: { id } } })
  return { state, api, merge }
}

test('squash-merges an authenticated head only after its full CI aggregate succeeds, once', async () => {
  const fixture = githubFixture()
  await fixture.merge()
  await fixture.merge()
  expect(fixture.state.writes).toEqual([
    {
      endpoint: 'pulls/42/merge',
      method: 'PUT',
      body: { merge_method: 'squash', sha: fixture.state.ci.head_sha },
    },
  ])
})

test.each(['failure', 'cancelled', 'neutral', 'skipped', null])(
  'CI %s never merges',
  async (conclusion) => {
    const fixture = githubFixture()
    fixture.state.ci.conclusion = conclusion
    await fixture.merge()
    expect(fixture.state.writes).toEqual([])
  },
)

test.each(['queued', 'in_progress'])('CI %s never merges', async (status) => {
  const fixture = githubFixture()
  fixture.state.ci.status = status
  await fixture.merge()
  expect(fixture.state.writes).toEqual([])
})

test.each([
  (state) => {
    state.runs = []
  },
  (state) => {
    state.jobs = []
  },
  (state) => {
    state.jobs.push({ ...state.job })
  },
  (state) => {
    state.job.conclusion = 'failure'
  },
  (state) => {
    state.job.status = 'in_progress'
  },
  (state) => {
    state.job.head_sha = 'd'.repeat(40)
  },
  (state) => {
    state.job.run_attempt = 1
  },
  (state) => {
    state.job.run_id = 21
  },
  (state) => {
    state.ci.event = 'pull_request'
  },
  (state) => {
    state.ci.path = '.github/workflows/other.yml'
  },
  (state) => {
    state.ci.repository.full_name = 'fixture/fork'
  },
  (state) => {
    state.ci.head_sha = 'd'.repeat(40)
  },
  (state) => {
    state.ci.head_branch = 'human'
  },
])('missing, partial, foreign, or stale CI evidence blocks merge %#', async (mutate) => {
  const fixture = githubFixture()
  mutate(fixture.state)
  await fixture.merge()
  expect(fixture.state.writes).toEqual([])
})

test('a newer failed or pending full run blocks an older successful one', async () => {
  const fixture = githubFixture()
  fixture.state.runs.unshift({
    ...fixture.state.ci,
    id: 21,
    status: 'in_progress',
    conclusion: null,
  })
  await fixture.merge()
  expect(fixture.state.writes).toEqual([])
})

test.each([
  (state) => {
    state.artifacts = []
  },
  (state) => {
    state.artifact.expired = true
  },
  (state) => {
    state.artifact.name = 'tree-sitter-pin-wrong'
  },
  (state) => {
    state.updater.path = '.github/workflows/other.yml'
  },
  (state) => {
    state.updater.head_branch = 'tree-sitter-x/auto/forged'
  },
  (state) => {
    state.updater.event = 'pull_request'
  },
  (state) => {
    state.updater.conclusion = 'failure'
  },
  (state) => {
    state.updater.status = 'in_progress'
  },
  (state) => {
    state.updater.repository.full_name = 'fixture/fork'
  },
  (state) => {
    state.pull.user.id = 1
  },
  (state) => {
    state.pull.user.login = 'other[bot]'
  },
  (state) => {
    state.pull.user.type = 'User'
  },
  (state) => {
    state.pull.head.repo.full_name = 'fixture/fork'
  },
  (state) => {
    state.pull.base.ref = 'other'
  },
  (state) => {
    state.pull.base.repo.full_name = 'fixture/fork'
  },
  (state) => {
    state.pull.draft = true
  },
  (state) => {
    state.pull.head.ref = 'changeset-release/main'
  },
  (state) => {
    state.pull.head.ref = state.pull.head.ref.replace('/auto/', '/')
  },
  (state) => {
    state.files = []
  },
  (state) => {
    state.files[0].filename = '.github/workflows/ci.yml'
  },
  (state) => {
    state.files[0].filename = 'scripts/ci/parser-pins.mjs'
  },
  (state) => {
    state.files[0].status = 'added'
  },
  (state) => {
    state.files[0].previous_filename = 'other'
  },
])('untrusted or irrelevant PRs never merge despite copied metadata %#', async (mutate) => {
  const fixture = githubFixture()
  mutate(fixture.state)
  await fixture.merge()
  expect(fixture.state.writes).toEqual([])
})

test('a changed head during the final read blocks merge', async () => {
  const fixture = githubFixture()
  fixture.state.current = structuredClone(fixture.state.pull)
  fixture.state.current.head.sha = 'd'.repeat(40)
  await fixture.merge()
  expect(fixture.state.writes).toEqual([])
})

test('the expected head is sent to GitHub so a concurrent push cannot bypass the check', async () => {
  const fixture = githubFixture()
  fixture.api.write = async (_endpoint, _method, body) => {
    expect(body.sha).toBe(fixture.state.pull.head.sha)
    assert.fail('GitHub: 409 head changed')
  }
  await expect(fixture.merge()).rejects.toThrow('409 head changed')
})

test('updater completion reconciles already-successful CI after a dispatch recovery', async () => {
  const fixture = githubFixture()
  await fixture.merge(10)
  expect(fixture.state.writes).toHaveLength(1)
})

function publicationFixture() {
  let root
  onTestFinished(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })
  root = mkdtempSync(path.join(tmpdir(), 'parser-pin-publish-'))
  const directory = path.join(root, 'checkout')
  mkdirSync(directory)
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null'].concat(args), {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  git('init', '--bare', '-q', path.join(root, 'origin.git'))
  git('init', '-b', 'main', '-q')
  git('config', 'user.name', 'fixture')
  git('config', 'user.email', 'fixture@example.com')
  git('remote', 'add', 'origin', path.join(root, 'origin.git'))
  const manifest = 'editor/packages/tree-sitter/package.json'
  mkdirSync(path.dirname(path.join(directory, manifest)), { recursive: true })
  const before = JSON.stringify({
    dependencies: {
      'web-tree-sitter': `github:ShaulLavo/tree-sitter-x#${'0'.repeat(40)}`,
      'tree-sitter-md': `github:ShaulLavo/tree-sitter-md#${'0'.repeat(40)}`,
    },
  })
  writeFileSync(path.join(directory, manifest), before)
  const secondary = path.join(directory, 'editor/packages/other/package.json')
  mkdirSync(path.dirname(secondary), { recursive: true })
  writeFileSync(secondary, before)
  git('add', '.')
  git('commit', '-qm', 'initial')
  const base = git('rev-parse', 'HEAD')
  const metadata = { base, runtime: 'a'.repeat(40), markdown: 'b'.repeat(40) }
  const updated = before
    .replace(/tree-sitter-x#0{40}/g, `tree-sitter-x#${metadata.runtime}`)
    .replace(/tree-sitter-md#0{40}/g, `tree-sitter-md#${metadata.markdown}`)
  writeFileSync(path.join(directory, manifest), updated)
  const patch = git('diff') + '\n'
  writeFileSync(path.join(directory, manifest), before)
  const fixture = githubFixture()
  fixture.state.pulls = []
  fixture.state.artifacts = []
  const publish = () =>
    publishPins({
      api: fixture.api,
      repository: fixture.state.repository,
      directory,
      patch,
      metadata,
    })
  return { ...fixture, root, directory, git, metadata, patch, publish, manifest, before }
}

function cliPublicationFixture(historySize) {
  const fixture = publicationFixture()
  const bin = path.join(fixture.root, 'bin')
  const statePath = path.join(fixture.directory, 'github.json')
  const pins = path.join(fixture.directory, 'pin-update')
  for (const directory of [bin, pins]) mkdirSync(directory)
  const history = Array.from({ length: historySize }, (_, index) => ({
    ...fixture.state.pull,
    number: 100 + index,
    state: index < 101 ? 'open' : 'closed',
    user: { id: 1, login: 'contributor', type: 'User' },
    head: { ...fixture.state.pull.head, ref: `feature/${index}` },
    body: 'Build and test verification for this pull request.\n'.repeat(400),
  }))
  const obsolete = structuredClone(fixture.state.pull)
  obsolete.head.ref = obsolete.head.ref.replace('a'.repeat(40), 'd'.repeat(40))
  fixture.state.pulls = history.concat([obsolete])
  writeFileSync(statePath, JSON.stringify(fixture.state))
  writeFileSync(path.join(pins, 'update.patch'), fixture.patch)
  writeFileSync(path.join(pins, 'metadata.json'), JSON.stringify(fixture.metadata))
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const state = JSON.parse(readFileSync('github.json', 'utf8'))
const [command, endpoint, ...flags] = process.argv.slice(2)
assert.equal(command, 'api')
const url = new URL('https://fixture.invalid/' + endpoint)
const route = url.pathname.replace('/repos/' + state.repository + '/', '')
const method = flags.includes('--method') ? flags[flags.indexOf('--method') + 1] : 'GET'
state.reads.push(endpoint)
let result
if (route === 'pulls' && method === 'GET') {
  const query = url.searchParams
  result = state.pulls.filter(pull =>
    (query.get('state') === 'all' || pull.state === query.get('state')) &&
    pull.base.ref === query.get('base') &&
    (!query.has('head') || query.get('head') === state.repository.split('/')[0] + ':' + pull.head.ref))
} else if (route === 'pulls' && method === 'POST') {
  const body = JSON.parse(readFileSync(0, 'utf8'))
  result = { ...state.pull, number: 2000, head: { ...state.pull.head, ref: body.head } }
  state.pulls.push(result)
} else if (route.endsWith('/files')) {
  result = state.files
} else if (route === 'actions/artifacts') {
  result = { artifacts: state.artifacts }
} else {
  result = state.pulls.find(pull => route === 'pulls/' + pull.number)
  assert.ok(result, endpoint)
  if (method === 'PATCH') Object.assign(result, JSON.parse(readFileSync(0, 'utf8')))
}
if (method !== 'GET') state.writes.push({ endpoint, method })
writeFileSync('github.json', JSON.stringify(state))
if (flags.includes('--paginate')) {
  assert.ok(flags.includes('--slurp'))
  result = Array.isArray(result)
    ? Array.from({ length: Math.max(1, Math.ceil(result.length / 100)) }, (_, page) => result.slice(page * 100, (page + 1) * 100))
    : [result]
}
process.stdout.write(JSON.stringify(result))
`,
    { mode: 0o755 },
  )
  const read = () => JSON.parse(readFileSync(statePath, 'utf8'))
  const run = () => {
    const result = spawnSync(
      'node',
      [path.resolve(import.meta.dirname, 'parser-pins.mjs'), 'publish'],
      {
        cwd: fixture.directory,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          GITHUB_REPOSITORY: fixture.state.repository,
          GITHUB_OUTPUT: path.join(fixture.root, 'output'),
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    )
    expect(result.status, result.stderr).toBe(0)
    return result
  }
  return { ...fixture, run, read, statePath, pins, history }
}

test.skipIf(process.platform === 'win32').each([0, 1300])(
  'production CLI publishes once and reuses the exact branch with %i historical PRs',
  (historySize) => {
    const fixture = cliPublicationFixture(historySize)
    if (historySize)
      expect(Buffer.byteLength(JSON.stringify(fixture.history))).toBeGreaterThan(16 * 1024 * 1024)
    fixture.run()
    const receipt = JSON.parse(
      readFileSync(path.join(fixture.directory, 'pin-receipt.json'), 'utf8'),
    )
    const state = fixture.read()
    state.pulls.find((pull) => pull.number === receipt.number).head.sha = receipt.head
    writeFileSync(fixture.statePath, JSON.stringify(state))
    fixture.run()
    expect(
      JSON.parse(readFileSync(path.join(fixture.directory, 'pin-receipt.json'), 'utf8')),
    ).toEqual(receipt)
    const final = fixture.read()
    expect(final.writes.filter((write) => write.method === 'POST')).toHaveLength(1)
    expect(final.writes.filter((write) => write.method === 'PATCH')).toHaveLength(1)
    expect(final.pulls.find((pull) => pull.number === 42).state).toBe('closed')
    expect(final.pulls.filter((pull) => pull.user.id === 1 && pull.state === 'open')).toHaveLength(
      Math.min(historySize, 101),
    )
    if (!historySize) return
    expect(final.reads).toContain(
      `repos/fixture/parser/pulls?state=all&base=main&head=${encodeURIComponent(`fixture:${receipt.branch}`)}&per_page=100`,
    )
    expect(final.reads).not.toContain('repos/fixture/parser/pulls?state=all&base=main&per_page=100')
  },
)

test.skipIf(process.platform === 'win32').each(['closed', 'merged'])(
  'production CLI preserves a %s same-pin PR buried in large history',
  (status) => {
    const fixture = cliPublicationFixture(1300)
    const state = fixture.read()
    state.pulls.push({
      ...state.pull,
      number: 2001,
      state: 'closed',
      merged_at: status === 'merged' ? '2026-10-18T00:00:00Z' : null,
    })
    writeFileSync(fixture.statePath, JSON.stringify(state))
    fixture.run()
    expect(fixture.read().writes).toEqual([])
    expect(fixture.git('ls-remote', 'origin')).toBe('')
    expect(existsSync(path.join(fixture.directory, 'pin-receipt.json'))).toBe(false)
  },
)

test('creates one immutable branch and PR, and reuses it on the same pin pair rerun', async () => {
  const fixture = publicationFixture()
  const result = await fixture.publish()
  expect(result.branch).toBe(
    `tree-sitter-x/auto/${fixture.metadata.runtime}-${fixture.metadata.markdown}`,
  )
  expect(fixture.state.writes.find((write) => write.method === 'POST').body.head).toBe(
    result.branch,
  )
  const original = fixture.git('ls-remote', 'origin', `refs/heads/${result.branch}`)
  fixture.state.pull.head.sha = result.head
  fixture.state.artifact.name = `tree-sitter-pin-${result.head}`
  fixture.state.artifacts.push(fixture.state.artifact)
  const repeated = await fixture.publish()
  expect(repeated).toEqual(result)
  expect(fixture.state.writes.filter((write) => write.method === 'POST')).toHaveLength(1)
  expect(fixture.git('ls-remote', 'origin', `refs/heads/${result.branch}`)).toBe(original)
})

test('recovers denied PR creation without another commit or a force push', async () => {
  const fixture = publicationFixture()
  const write = fixture.api.write
  fixture.api.write = async () => {
    assert.fail('creation denied')
  }
  await expect(fixture.publish()).rejects.toThrow('creation denied')
  const before = fixture.git('ls-remote', 'origin')
  fixture.api.write = write
  const result = await fixture.publish()
  expect(fixture.git('ls-remote', 'origin')).toBe(before)
  expect(result.number).toBe(42)
})

test.each(['closed', 'merged'])('same pins preserve a %s PR', async (state) => {
  const fixture = publicationFixture()
  fixture.state.pull.state = state === 'merged' ? 'closed' : state
  fixture.state.pulls = [fixture.state.pull]
  expect(await fixture.publish()).toBeNull()
  expect(fixture.git('ls-remote', 'origin')).toBe('')
  expect(fixture.state.writes).toEqual([])
})

test('new pins close only obsolete authenticated bot PRs and leave unrelated PRs alone', async () => {
  const fixture = publicationFixture()
  const old = fixture.state.pull
  old.head.ref = old.head.ref.replace('a'.repeat(40), 'd'.repeat(40))
  fixture.state.pulls = [old, { ...old, number: 99, user: { id: 1 } }]
  fixture.state.artifacts.push(fixture.state.artifact)
  await fixture.publish()
  expect(fixture.state.writes.filter((write) => write.method === 'PATCH')).toEqual([
    { endpoint: 'pulls/42', method: 'PATCH', body: { state: 'closed' } },
  ])
})

test('new upstream pins leave one current PR even when multiple old receipts expired', async () => {
  const fixture = publicationFixture()
  fixture.state.pulls = ['d', 'e', 'f'].map((pin, index) => {
    const pull = structuredClone(fixture.state.pull)
    pull.number += index
    pull.head.ref = pull.head.ref.replace('a'.repeat(40), pin.repeat(40))
    return pull
  })
  fixture.state.current = fixture.state.pulls[0]
  const result = await fixture.publish()
  expect(
    fixture.state.pulls.filter((pull) => pull.state === 'open').map((pull) => pull.number),
  ).toEqual([result.number])
  const current = fixture.state.pulls.find((pull) => pull.number === result.number)
  current.head.sha = result.head
  fixture.state.artifacts.push({
    ...fixture.state.artifact,
    name: `tree-sitter-pin-${result.head}`,
  })
  const repeated = await fixture.publish()
  expect(repeated).toEqual(result)
  expect(fixture.state.writes.filter((write) => write.method === 'POST')).toHaveLength(1)
  expect(fixture.state.writes.filter((write) => write.method === 'PATCH')).toHaveLength(3)
})

test('already-current main closes obsolete authenticated pin PRs without publishing', async () => {
  const fixture = publicationFixture()
  fixture.state.pulls = [fixture.state.pull]
  fixture.state.artifacts.push(fixture.state.artifact)
  expect(
    await publishPins({
      api: fixture.api,
      repository: fixture.state.repository,
      directory: fixture.directory,
      patch: '',
      metadata: fixture.metadata,
    }),
  ).toBeNull()
  expect(fixture.state.writes).toHaveLength(1)
  expect(fixture.git('ls-remote', 'origin')).toBe('')
})

test.each(['expired', 'missing'])(
  '%s receipts still allow obsolete bot PR cleanup',
  async (receipt) => {
    const fixture = publicationFixture()
    fixture.state.pulls = [fixture.state.pull]
    fixture.state.artifacts =
      receipt === 'missing' ? [] : [{ ...fixture.state.artifact, expired: true }]
    const result = await publishPins({
      api: fixture.api,
      repository: fixture.state.repository,
      directory: fixture.directory,
      patch: '',
      metadata: fixture.metadata,
    })
    expect(result).toBeNull()
    expect(fixture.state.writes).toContainEqual({
      endpoint: 'pulls/42',
      method: 'PATCH',
      body: { state: 'closed' },
    })
  },
)

test.each([
  (state) => {
    state.pull.user.id = 1
  },
  (state) => {
    state.pull.head.repo.full_name = 'fixture/fork'
  },
  (state) => {
    state.pull.base.ref = 'release'
  },
  (state) => {
    state.pull.head.ref = 'changeset-release/main'
  },
  (state) => {
    state.pull.draft = true
  },
  (state) => {
    state.files[0].filename = '.github/workflows/ci.yml'
  },
  (state) => {
    state.files[0].status = 'added'
  },
  (state) => {
    state.files[0].previous_filename = 'other'
  },
])('receipt-free cleanup preserves irrelevant or untrusted PRs %#', async (mutate) => {
  const fixture = publicationFixture()
  fixture.state.pulls = [fixture.state.pull]
  mutate(fixture.state)
  await publishPins({
    api: fixture.api,
    repository: fixture.state.repository,
    directory: fixture.directory,
    patch: '',
    metadata: fixture.metadata,
  })
  expect(fixture.state.writes).toEqual([])
})

test('a preexisting contaminated branch is rejected and never overwritten', async () => {
  const fixture = publicationFixture()
  const branch = fixture.state.pull.head.ref
  fixture.git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
  const before = fixture.git('ls-remote', 'origin')
  await expect(fixture.publish()).rejects.toThrow('Existing branch must match the generated tree')
  expect(fixture.git('ls-remote', 'origin')).toBe(before)
  expect(fixture.state.writes).toEqual([])
})

test('a generated patch cannot add arbitrary workflow code or change manifest scripts', async () => {
  const fixture = publicationFixture()
  const manifest = path.join(fixture.directory, fixture.manifest)
  const changed = JSON.parse(fixture.before)
  changed.scripts = { test: 'untrusted-command' }
  writeFileSync(manifest, JSON.stringify(changed))
  const patch = fixture.git('diff') + '\n'
  writeFileSync(manifest, fixture.before)
  await expect(
    publishPins({
      api: fixture.api,
      repository: fixture.state.repository,
      directory: fixture.directory,
      patch,
      metadata: fixture.metadata,
    }),
  ).rejects.toThrow('Manifest edits must contain only parser pin replacements')
  expect(fixture.state.writes).toEqual([])
})

test.each(['tree-sitter-x', 'tree-sitter-md'])(
  'a changed secondary manifest cannot carry a different %s pin',
  async (parser) => {
    const fixture = publicationFixture()
    const secondary = path.join(fixture.directory, 'editor/packages/other/package.json')
    const changed = fixture.before
      .replace(/tree-sitter-x#0{40}/g, `tree-sitter-x#${fixture.metadata.runtime}`)
      .replace(/tree-sitter-md#0{40}/g, `tree-sitter-md#${fixture.metadata.markdown}`)
    writeFileSync(
      secondary,
      changed.replace(
        `${parser}#${parser === 'tree-sitter-x' ? fixture.metadata.runtime : fixture.metadata.markdown}`,
        `${parser}#${'c'.repeat(40)}`,
      ),
    )
    const patch = fixture.git('diff') + '\n'
    await expect(
      publishPins({
        api: fixture.api,
        repository: fixture.state.repository,
        directory: fixture.directory,
        patch,
        metadata: fixture.metadata,
      }),
    ).rejects.toThrow('exact metadata SHAs')
  },
)

test('all changed manifests accept the same exact metadata pin replacements', async () => {
  const fixture = publicationFixture()
  const changed = fixture.before
    .replace(/tree-sitter-x#0{40}/g, `tree-sitter-x#${fixture.metadata.runtime}`)
    .replace(/tree-sitter-md#0{40}/g, `tree-sitter-md#${fixture.metadata.markdown}`)
  for (const manifest of [fixture.manifest, 'editor/packages/other/package.json'])
    writeFileSync(path.join(fixture.directory, manifest), changed)
  const result = await publishPins({
    api: fixture.api,
    repository: fixture.state.repository,
    directory: fixture.directory,
    patch: fixture.git('diff') + '\n',
    metadata: fixture.metadata,
  })
  expect(result.number).toBe(42)
})

test.skipIf(process.platform === 'win32')(
  'the actual updater formats its catalog and outputs (POSIX CLI fixtures)',
  () => {
    let root
    onTestFinished(() => {
      if (root) rmSync(root, { recursive: true, force: true })
    })
    root = mkdtempSync(path.join(tmpdir(), 'parser-pin-updater-'))
    const source = path.resolve(import.meta.dirname, '../..')
    const editor = path.join(root, 'editor')
    const languages = path.join(editor, 'packages/tree-sitter-languages')
    const bin = path.join(root, 'bin')
    for (const directory of [
      bin,
      path.join(editor, 'scripts'),
      path.join(languages, 'scripts'),
      path.join(languages, 'src'),
      path.join(languages, 'notices'),
      path.join(editor, 'packages/tree-sitter'),
    ]) {
      mkdirSync(directory, { recursive: true })
    }
    for (const file of [
      'scripts/update-tree-sitter-x.ts',
      'scripts/workspace-root.ts',
      'packages/tree-sitter-languages/scripts/generate.mjs',
      'packages/tree-sitter-languages/src/query-captures.ts',
    ]) {
      writeFileSync(path.join(editor, file), readFileSync(path.join(source, 'editor', file)))
    }
    const dependencies = path.join(source, 'editor/packages/tree-sitter-languages/node_modules')
    // This fixture uses the installed formatter and runtime, and performs no package downloads.
    symlinkSync(dependencies, path.join(languages, 'node_modules'), 'junction')
    symlinkSync(path.join(source, 'node_modules'), path.join(editor, 'node_modules'), 'junction')
    const manifest = {
      dependencies: {
        'web-tree-sitter': `github:ShaulLavo/tree-sitter-x#${'0'.repeat(40)}`,
        'tree-sitter-md': `github:ShaulLavo/tree-sitter-md#${'0'.repeat(40)}`,
      },
    }
    writeFileSync(path.join(editor, 'package.json'), JSON.stringify(manifest))
    writeFileSync(path.join(editor, 'packages/tree-sitter/package.json'), JSON.stringify(manifest))
    writeFileSync(
      path.join(languages, 'package.json'),
      JSON.stringify({
        type: 'module',
        scripts: { 'languages:generate': 'node scripts/generate.mjs' },
      }),
    )
    writeFileSync(
      path.join(languages, 'languages.json'),
      JSON.stringify({
        sources: {
          'tree-sitter-md': {
            repository: 'fixture/markdown',
            revision: '0'.repeat(40),
            version: '0.0.0',
          },
        },
        languages: [],
        captureMappings: {},
      }),
    )
    writeFileSync(path.join(languages, 'notices/tree-sitter-md.txt'), 'Fixture license\n')
    writeFileSync(
      path.join(root, 'fetch.ts'),
      `globalThis.fetch = async () => new Response(JSON.stringify({
    version: '1.0.0', peerDependencies: { 'web-tree-sitter': '^1.0.0' }
  }))`,
    )
    const realBun = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim()
    writeFileSync(
      path.join(bin, 'bun'),
      `#!/bin/sh\nif [ "$1" = install ]; then exit 0; fi\nexec "${realBun}" "$@"\n`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(bin, 'git'),
      `#!/bin/sh\ncase "$*" in\n  *tree-sitter-x*) printf '%s\\trefs/heads/web-tree-sitter\\n' '${'a'.repeat(40)}' ;;\n  *tree-sitter-md*) printf '%s\\tHEAD\\n' '${'b'.repeat(40)}' ;;\n  *) exit 64 ;;\nesac\n`,
      { mode: 0o755 },
    )
    execFileSync(
      realBun,
      [
        '--preload',
        path.join(root, 'fetch.ts'),
        path.join(editor, 'scripts/update-tree-sitter-x.ts'),
      ],
      {
        cwd: editor,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: 'pipe',
      },
    )
    const files = [
      'languages.json',
      'languages.lock.json',
      'src/catalog.generated.ts',
      'src/metadata.ts',
    ]
    execFileSync(path.join(source, 'node_modules/.bin/oxfmt'), ['--check'].concat(files), {
      cwd: languages,
      stdio: 'pipe',
    })
    expect(
      JSON.parse(readFileSync(path.join(languages, 'languages.json'), 'utf8')).sources[
        'tree-sitter-md'
      ],
    ).toMatchObject({ revision: 'b'.repeat(40), version: '1.0.0' })
  },
)

function dispatchFixture({
  status = 'completed',
  conclusion = 'success',
  runs,
  before,
  after,
} = {}) {
  let root
  onTestFinished(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })
  root = mkdtempSync(path.join(tmpdir(), 'parser-pin-dispatch-'))
  const { state } = githubFixture()
  const branch = state.pull.head.ref
  const commit = state.pull.head.sha
  const bin = path.join(root, 'bin')
  mkdirSync(bin)
  const dispatches = path.join(root, 'dispatches')
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh
set -eu
case "$1 $2" in
  "api repos/fixture/parser/git/ref/heads/$BRANCH")
    if [ -f "$DISPATCHES" ]; then printf '%s\n' "$AFTER"; else printf '%s\n' "$BEFORE"; fi ;;
  "run list") printf '%s\n' "$RUNS" ;;
  "workflow run")
    [ "$3" = ci.yml ] && [ "$4" = --ref ] && [ "$5" = "$BRANCH" ]
    printf 'dispatch\n' >> "$DISPATCHES" ;;
  *) printf 'unexpected gh call: %s\n' "$*" >&2; exit 64 ;;
esac
`,
    { mode: 0o755 },
  )
  const workflow = Bun.YAML.parse(
    readFileSync(
      path.resolve(import.meta.dirname, '../../.github/workflows/editor-tree-sitter-x.yml'),
      'utf8',
    ),
  )
  const step = workflow.jobs.publish.steps.find((entry) => entry.name === 'Dispatch full CI')
  const selected = runs ?? [
    { headSha: commit, headBranch: branch, event: 'workflow_dispatch', status, conclusion },
  ]
  const run = () =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: state.repository,
        branch,
        commit,
        BRANCH: branch,
        BEFORE: before ?? commit,
        AFTER: after ?? commit,
        RUNS: JSON.stringify(selected),
        DISPATCHES: dispatches,
      },
      encoding: 'utf8',
    })
  const count = () =>
    existsSync(dispatches) ? readFileSync(dispatches, 'utf8').trim().split('\n').length : 0
  return { run, count, selected, commit, branch }
}

const shellAvailable = ['bash', 'jq', 'git'].every((command) => Bun.which(command))
if (!shellAvailable)
  console.info('Skipping dispatch shell fixtures: Bash, jq and Git are required.')

test.skipIf(!shellAvailable).each([
  ['missing', undefined, undefined, true],
  ['failed', 'completed', 'failure', true],
  ['cancelled', 'completed', 'cancelled', true],
  ['timed out', 'completed', 'timed_out', true],
  ['queued', 'queued', null, false],
  ['pending', 'in_progress', null, false],
  ['success', 'completed', 'success', false],
])('dispatch recovery handles %s exact-head CI', (name, status, conclusion, dispatch) => {
  const fixture = dispatchFixture({ status, conclusion, runs: name === 'missing' ? [] : undefined })
  const result = fixture.run()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(fixture.count()).toBe(dispatch ? 1 : 0)
  // GitHub has accepted a run. A later updater must leave that pending run alone.
  fixture.selected.unshift({
    headSha: fixture.commit,
    headBranch: fixture.branch,
    event: 'workflow_dispatch',
    status: 'queued',
    conclusion: null,
  })
  const repeated = fixture.run()
  expect(repeated.status, repeated.stdout + repeated.stderr).toBe(0)
  expect(fixture.count()).toBe(dispatch ? 1 : 0)
})

test.skipIf(!shellAvailable).each(['before', 'after'])(
  'a branch moving %s dispatch fails closed',
  (phase) => {
    const fixture = dispatchFixture({ runs: [], [phase]: 'd'.repeat(40) })
    const result = fixture.run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Pin branch moved')
    expect(fixture.count()).toBe(phase === 'after' ? 1 : 0)
  },
)

test.skipIf(!shellAvailable)('foreign or stale successful CI does not suppress a dispatch', () => {
  const fixture = dispatchFixture({
    runs: [
      {
        status: 'completed',
        conclusion: 'success',
        headSha: 'd'.repeat(40),
        headBranch: 'human',
        event: 'pull_request',
      },
    ],
  })
  const result = fixture.run()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(fixture.count()).toBe(1)
})

test('workflow permissions and token boundaries keep branch code unprivileged', () => {
  const read = (file) => readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8')
  const treeWorkflow = read('.github/workflows/editor-tree-sitter-x.yml')
  const mergeWorkflow = read('.github/workflows/editor-parser-pin-merge.yml')
  const ci = Bun.YAML.parse(read('.github/workflows/ci.yml'))
  const libraries = Bun.YAML.parse(read('.github/workflows/workspace-libraries.yml'))
  expect(ci.permissions).toEqual({ contents: 'read' })
  expect(libraries.permissions).toEqual({ contents: 'read' })
  const jobs = Object.entries(ci.jobs).concat(Object.entries(libraries.jobs))
  for (const [name, job] of jobs) {
    const permissions = job.permissions ?? ci.permissions
    expect(Object.values(permissions)).not.toContain('write')
    if (['baseline', 'verdict'].includes(name)) continue
    expect(JSON.stringify(job)).not.toMatch(/github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN/)
    expect(permissions).toEqual({ contents: 'read' })
  }
  const checkouts = jobs
    .flatMap(([, job]) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('actions/checkout@'))
  expect(checkouts).toHaveLength(15)
  for (const step of checkouts) expect(step.with?.['persist-credentials']).toBe(false)

  const baseline = ci.jobs.baseline
  expect(baseline.permissions).toEqual({ actions: 'read' })
  expect(baseline.steps).toHaveLength(1)
  expect(baseline.steps[0].uses).toBeUndefined()
  expect(baseline.steps[0].run).not.toMatch(/bun |node |\.\//)
  expect(ci.jobs.changes.needs).toBe('baseline')
  expect(ci.jobs.changes.steps.find((step) => step.id === 'plan').env.BASELINE_SHA).toBe(
    '${{ needs.baseline.outputs.sha }}',
  )

  const verdict = ci.jobs.verdict
  expect(verdict.permissions).toEqual({ actions: 'read', contents: 'read' })
  expect(verdict.needs).toContain('baseline')
  expect(verdict.steps.map((step) => step.name)).toEqual([
    'Checkout trusted verifier',
    'Checkout candidate graph',
    'Fetch CI metadata',
    'Setup Bun',
    'Verdict',
    'Report queue and execution times',
  ])
  expect(verdict.steps[0].with).toMatchObject({ ref: 'refs/heads/main', path: 'trusted' })
  expect(verdict.steps[1].with).toMatchObject({ path: 'candidate' })
  expect(verdict.steps[2].env.GH_TOKEN).toBe('${{ github.token }}')
  expect(verdict.steps[2].run).not.toMatch(/bun |node |candidate|trusted/)
  expect(verdict.steps[3].with).toEqual({ 'bun-version-file': 'trusted/package.json' })
  expect(verdict.steps[4].run).toBe(
    'bun trusted/scripts/ci-verdict.ts candidate/.github/workflows/ci.yml "$RUNNER_TEMP/ci-jobs.json" "$RUNNER_TEMP/ci-run.json"',
  )
  expect(verdict.steps[4].env).not.toHaveProperty('GH_TOKEN')
  expect(verdict.steps[5].env).not.toHaveProperty('GH_TOKEN')
  const setup = read('.github/actions/setup/action.yml')
  expect(setup).not.toMatch(/github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN|gh release download/)
  expect(setup).toContain('curl --fail --location --silent --show-error')
  expect(treeWorkflow).toContain('persist-credentials: false')
  expect(treeWorkflow).toContain('contents: write')
  expect(treeWorkflow).toContain('gh workflow run ci.yml --ref "$branch"')
  expect(mergeWorkflow).toContain('ref: refs/heads/main')
  expect(mergeWorkflow).toContain('persist-credentials: false')
  expect(mergeWorkflow).toContain('pull-requests: write')
  expect(mergeWorkflow).toContain('workflow_run:')
})
