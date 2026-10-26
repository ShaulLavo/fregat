import { expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { requiredLibraries, selectAffected } from './affected.mjs'

import { consumerGraph } from './fixtures/consumer-workspace.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const graph = consumerGraph(root)
const select = (files, full = false) => selectAffected(graph, files, full)

test('a root lockfile change retains every package test and its build prerequisites', () => {
  const plan = select(['bun.lock'])
  const all = select([], true)
  expect(plan.packages).toEqual(all.packages)
  expect(requiredLibraries(graph, plan.packages)).toEqual(requiredLibraries(graph, all.packages))
  expect(plan).toMatchObject({
    exhaustive: false,
    tooling: true,
    web: true,
    server: true,
    tui: true,
    site: true,
  })
})

test('the four documentation files in PR 1207 do not consume application or library runners', () => {
  const plan = select([
    '.agents/skills/react-development/SKILL.md',
    'PLAN.md',
    'plans/342-app-reactivity-and-async-ownership.md',
    'plans/README.md',
  ])
  expect(plan).toMatchObject({
    packages: [],
    code: false,
    docs: true,
    exhaustive: false,
    web: false,
    server: false,
    tui: false,
    site: false,
  })
  expect(plan.docs_files).toContain('.agents/skills/react-development/SKILL.md')
})

test('a changeset by itself does not select application or library tests', () => {
  expect(select(['.changeset/patch.md'])).toMatchObject({
    packages: [],
    shared: false,
    docs: true,
    web: false,
  })
})

test.each([
  ['apps/web/src/features/chat/components/message.tsx', 'web'],
  ['apps/server/src/provider/service.ts', 'server'],
  ['apps/tui/src/main.tsx', 'tui'],
  ['packages/contracts/src/index.ts', '@workspace/contracts'],
])('%s selects only its owning package', (file, name) => {
  expect(select([file]).packages).toEqual([name])
  expect(select([file]).tooling).toBe(false)
})

test('dependencies are built without selecting their tests', () => {
  const plan = select(['apps/web/src/main.tsx'])
  expect(plan.packages).toEqual(['web'])
  expect(requiredLibraries(graph, plan.packages)).toEqual(['@workspace/ui'])
  expect(plan).not.toHaveProperty('ghostty')
})

test.each(['.agents/skills/helper.ts', 'apps/deleted-package/src/index.ts'])(
  '%s selects root tooling without every application suite',
  (file) => {
    expect(select([file])).toMatchObject({
      packages: [],
      tooling: true,
      web: false,
      server: false,
      tui: false,
    })
  },
)

test.each([
  'package.json',
  'turbo.json',
  'bunfig.toml',
  '.npmrc',
  '.env.production',
  'tsconfig.base.json',
  'vitest.scripts.config.mjs',
  'vitest.config.ts',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'patches/example.patch',
  '.github/workflows/ci.yml',
  '.github/actions/setup/action.yml',
  'scripts/dev-sources.ts',
])('%s selects all package owners of shared dependency and configuration inputs', (file) => {
  const plan = select([file])
  expect(plan.packages).toEqual(select([], true).packages)
  expect(plan).toMatchObject({ tooling: true, web: true, server: true, exhaustive: false })
})

test('global selection remains additive for mixed documentation and package changes', () => {
  const plan = select(['bun.lock', 'apps/server/src/index.ts', 'docs/development.md'])
  expect(plan.packages).toEqual(select([], true).packages)
  expect(plan).toMatchObject({ tooling: true, docs: true, exhaustive: false })
  expect(plan.docs_files).toEqual(['docs/development.md'])
})

test('a changed library retains its tests and the transitive build prerequisites', () => {
  const plan = select(['packages/contracts/src/index.ts'])
  expect(plan.packages).toEqual(['@workspace/contracts'])
  expect(plan.web).toBe(false)
  expect(requiredLibraries(graph, plan.packages)).toEqual([])
})

test('an empty changed selection leaves package and tooling runners idle', () => {
  expect(select([])).toMatchObject({ packages: [], code: false, tooling: false, exhaustive: false })
})

test.each([
  'plans/190-faster-ci.md',
  'docs/development.md',
  'AGENTS.md',
  'docs/images/example.webp',
])('%s only selects documentation formatting', (file) => {
  expect(select([file])).toMatchObject({ packages: [], code: false, docs: true, site: false })
})

test.each(['docs/settings-reference.md', 'docs/native-syntax-coverage.md'])(
  'generated documentation %s selects its root tooling owner',
  (file) => {
    expect(select([file])).toMatchObject({ packages: [], tooling: true })
  },
)

test('scheduled and manual validation retain every package', () => {
  expect(select([], true).packages).toHaveLength(graph.packages.size)
  expect(select([], true)).toMatchObject({
    tooling: true,
    web: true,
    server: true,
    tui: true,
    site: true,
  })
})

test('release consumers need only Fregat workspace builds', () => {
  expect(requiredLibraries(graph, ['server'])).toEqual([])
  expect(requiredLibraries(graph, ['site'])).toEqual([])
  expect(requiredLibraries(graph, ['tui'])).toEqual([])
  expect(requiredLibraries(graph, ['web'])).toEqual(['@workspace/ui'])
  expect(requiredLibraries(graph, [])).toEqual([])
  expect(Array.from(graph.packages.keys())).toContain('@workspace/pty')
  expect(
    Array.from(graph.packages.keys()).some((name) => /singapore|ghostty|hotkeys/.test(name)),
  ).toBe(false)
})

test('unknown build targets fail instead of silently omitting checks', () => {
  expect(() => requiredLibraries(graph, ['unknown'])).toThrow('existing workspaces')
})

const gitAvailable = Bun.which('git') !== null
if (!gitAvailable) console.info('Skipping affected CI git proof. Git is required.')

test.skipIf(!gitAvailable).each([
  [[], '', 'changed', []],
  [['apps/site/index.html'], 'fregat', 'changed', ['site']],
  [['bun.lock'], 'fregat', 'changed', ['site']],
  [['package.json'], 'fregat', 'changed', ['site']],
  [['turbo.json'], 'fregat', 'changed', ['site']],
  [['tsconfig.json'], 'fregat', 'changed', ['site']],
  [[], 'fregat', 'full', ['site']],
])('CLI exports raw sites for %s in %s mode and JSON arrays', (files, sites, mode, packages) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-affected-output-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  try {
    for (const folder of ['apps/site', 'docs'])
      mkdirSync(path.join(directory, folder), { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=site' },
      }),
    )
    writeFileSync(path.join(directory, 'turbo.json'), '{"globalDependencies":[],"tasks":{}}')
    writeFileSync(path.join(directory, 'apps/site/package.json'), '{"name":"site"}')
    git('init', '-q')
    git('config', 'user.name', 'CI fixture')
    git('config', 'user.email', 'ci@example.test')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(path.join(directory, 'docs/Review note.md'), '# Changed\n')
    for (const file of files) {
      const target = path.join(directory, file)
      const content = existsSync(target) ? readFileSync(target, 'utf8') : '<main>Changed</main>'
      writeFileSync(target, `${content}\n`)
    }
    git('add', '.')
    git('commit', '-qm', 'changed')
    const output = path.join(directory, 'outputs')
    const result = Bun.spawnSync(
      ['bun', path.join(root, 'scripts/ci/affected.mjs'), mode, base, git('rev-parse', 'HEAD')],
      { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output } },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const selection = JSON.parse(result.stdout.toString())
    const exported = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
    expect(selection.packages).toEqual(packages)
    expect(exported.sites).toBe(sites)
    expect(JSON.parse(exported.packages)).toEqual(selection.packages)
    expect(JSON.parse(exported.docs_files)).toEqual(['docs/Review note.md'])
    expect(exported.site).toBe(String(packages.length > 0))
    expect(exported.docs).toBe('true')
    expect(exported.exhaustive).toBe(String(mode === 'full'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test.skipIf(!gitAvailable)('CLI includes both paths of a rename and the entire PR diff', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-affected-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  try {
    for (const folder of ['apps/web', 'apps/server', 'scripts/ci'])
      mkdirSync(path.join(directory, folder), { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=web' },
      }),
    )
    writeFileSync(
      path.join(directory, 'turbo.json'),
      JSON.stringify({ globalDependencies: [], tasks: {} }),
    )
    writeFileSync(path.join(directory, 'apps/web/package.json'), '{"name":"web"}')
    writeFileSync(path.join(directory, 'apps/server/package.json'), '{"name":"server"}')
    writeFileSync(path.join(directory, 'apps/web/old.ts'), 'export const value = 1\n')
    git('init', '-q')
    git('config', 'user.name', 'CI fixture')
    git('config', 'user.email', 'ci@example.test')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    git('mv', 'apps/web/old.ts', 'apps/server/renamed.ts')
    git('commit', '-qam', 'move')
    writeFileSync(path.join(directory, 'apps/server/renamed.ts'), 'export const value = 2\n')
    git('commit', '-qam', 'second PR commit')
    const output = path.join(directory, 'outputs')
    const result = Bun.spawnSync(
      ['bun'].concat([
        path.join(root, 'scripts/ci/affected.mjs'),
        'changed',
        base,
        git('rev-parse', 'HEAD'),
      ]),
      { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output } },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      packages: ['server', 'web'],
      server: true,
      web: true,
    })
    expect(readFileSync(output, 'utf8')).toContain('packages=["server","web"]\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
