import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readWorkspaceGraph, requiredLibraries, selectAffected } from './affected.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const graph = readWorkspaceGraph(root)
const select = (files, full = false) => selectAffected(graph, files, full)

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
    editor: false,
    ghostty: false,
    hotkeys: false,
  })
  expect(plan.docs_files).toContain('.agents/skills/react-development/SKILL.md')
})

test('metadata code still receives full validation', () => {
  expect(select(['.agents/skills/helper.ts']).packages).toHaveLength(graph.packages.size)
})

test('a web source reader runs contracts checks without treating contracts as changed code', () => {
  const plan = select(['apps/web/src/features/chat/components/message.tsx'])
  expect(plan.packages).toEqual(['@workspace/contracts', 'web'])
  expect(plan).toMatchObject({
    web: true,
    server: false,
    tui: false,
    desktop: false,
    site: false,
    editor: false,
    ghostty: false,
    hotkeys: false,
  })
})

test('server changes select every real in-process test consumer', () => {
  const plan = select(['apps/server/src/provider/service.ts'])
  expect(plan.packages).toEqual([
    '@workspace/client-core',
    '@workspace/contracts',
    'server',
    'tui',
    'web',
  ])
  expect(plan).toMatchObject({
    web: true,
    server: true,
    tui: true,
    site: false,
    editor: false,
    ghostty: false,
  })
})

test('an Editor highlighting change skips unrelated server, TUI and Ghostty suites', () => {
  expect(select(['editor/packages/highlighting/src/index.ts'])).toMatchObject({
    web: true,
    site: true,
    editor: true,
    server: false,
    tui: false,
    ghostty: false,
    hotkeys: false,
  })
})

test('catalog-backed Hotkeys consumers are selected with their dependents', () => {
  const plan = select(['hotkeys/packages/hotkeys/src/index.ts'])
  expect(plan.packages).toEqual(
    expect.arrayContaining([
      '@fregat/react-hotkeys',
      '@workspace/contracts',
      '@workspace/client-core',
      '@singapore-editor/core',
      'ghostty-webgpu',
      'web',
      'tui',
    ]),
  )
  expect(plan).toMatchObject({
    web: true,
    server: true,
    tui: true,
    editor: true,
    ghostty: true,
    hotkeys: true,
  })
})

test('nested website ownership does not run its parent library tests', () => {
  const plan = select(['ghostty-webgpu/site/src/main.ts'])
  expect(plan.packages).toEqual(['ghostty-webgpu-site'])
  expect(plan).toMatchObject({ site: true, ghostty: false, editor: false, web: false })
})

test('the separate line editor selects its verification contract', () => {
  expect(select(['ghostty-webgpu-line-editor/src/index.ts'])).toMatchObject({ ghostty: true })
})

test('the native Mac app keeps shared checks and uses its own workflow', () => {
  expect(select(['apps/mac/MacApp/WorkspaceView.swift'])).toMatchObject({
    code: true,
    packages: [],
    web: false,
    server: false,
    tui: false,
    site: false,
  })
})

test.each([
  'package.json',
  'bun.lock',
  'turbo.json',
  '.github/workflows/ci.yml',
  'scripts/dev-sources.ts',
  'apps/deleted-package/src/index.ts',
  'packages/deleted-package/package.json',
])('%s retains full validation', (file) => {
  expect(select([file]).packages).toEqual(Array.from(graph.packages.keys()).sort())
})

test('every Turbo global dependency retains full validation', () => {
  for (const input of graph.globalInputs) {
    const file = input
      .replaceAll('**', 'fixture')
      .replaceAll('*', 'fixture')
      .replace('{ts,mjs}', 'ts')
    expect(select([file]).packages, file).toEqual(Array.from(graph.packages.keys()).sort())
  }
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
  'generated documentation %s still selects code checks',
  (file) => {
    expect(select([file]).packages).toHaveLength(graph.packages.size)
  },
)

test('root-document task inputs still select the check that reads them', () => {
  const pkg = graph.packages.get('@workspace/contracts')
  const custom = { ...graph, packages: new Map(graph.packages) }
  custom.packages.set(pkg.name, {
    ...pkg,
    tasks: pkg.tasks.concat([{ name: 'test', inputs: ['docs/example.md'], dependencies: [] }]),
  })
  expect(selectAffected(custom, ['docs/example.md'])).toMatchObject({
    packages: ['@workspace/contracts'],
    web: false,
    server: false,
  })
})

test('external check inputs add checks without invalidating production consumers', () => {
  const plan = select(['editor/bench/compare/protocol.mjs'])
  expect(plan.packages).toContain('@singapore-editor/core')
  expect(plan.server).toBe(false)
})

test('main and manual runs retain the full graph even with no changed files', () => {
  expect(select([], true).packages).toHaveLength(graph.packages.size)
  expect(select([], true)).toMatchObject({
    web: true,
    server: true,
    tui: true,
    editor: true,
    ghostty: true,
    hotkeys: true,
    site: true,
  })
})

test('scoped server setup omits unrelated terminal, line-editor and React Hotkeys builds', () => {
  const libraries = requiredLibraries(graph, ['server'])
  expect(libraries).toContain('@fregat/hotkeys')
  expect(libraries).not.toContain('ghostty-webgpu')
  expect(libraries).not.toContain('ghostty-webgpu-line-editor')
  expect(libraries).not.toContain('@fregat/react-hotkeys')
  expect(requiredLibraries(graph, ['ghostty-webgpu-site'])).toEqual([
    '@fregat/hotkeys',
    'ghostty-webgpu',
  ])
  expect(requiredLibraries(graph, [])).toEqual([])
})

test('producer preparation includes explicit typecheck fixture builds', () => {
  expect(requiredLibraries(graph, ['@singapore-editor/core'])).toEqual(
    expect.arrayContaining([
      '@singapore-editor/tree-sitter-languages',
      '@singapore-editor/gutters',
      '@singapore-editor/scope-lines',
    ]),
  )
})

test('unknown build targets fail instead of silently omitting checks', () => {
  expect(() => requiredLibraries(graph, ['unknown'])).toThrow('existing workspaces')
})

const gitAvailable = Bun.which('git') !== null
if (!gitAvailable) console.info('Skipping affected CI git proof. Git is required.')

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
