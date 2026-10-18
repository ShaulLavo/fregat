import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
      if (endpoint.startsWith('pulls?')) return state.pulls
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

test('workflow permissions and dispatch keep privileged work on trusted refs', () => {
  const treeWorkflow = readFileSync(
    path.resolve(import.meta.dirname, '../../.github/workflows/editor-tree-sitter-x.yml'),
    'utf8',
  )
  const mergeWorkflow = readFileSync(
    path.resolve(import.meta.dirname, '../../.github/workflows/editor-parser-pin-merge.yml'),
    'utf8',
  )
  expect(treeWorkflow).toContain('persist-credentials: false')
  expect(treeWorkflow).toContain('contents: read')
  expect(treeWorkflow).toContain('contents: write')
  expect(treeWorkflow).toContain('gh workflow run ci.yml --ref "$branch"')
  expect(mergeWorkflow).toContain('ref: refs/heads/main')
  expect(mergeWorkflow).toContain('persist-credentials: false')
  expect(mergeWorkflow).toContain('pull-requests: write')
  expect(mergeWorkflow).toContain('workflow_run:')
})
