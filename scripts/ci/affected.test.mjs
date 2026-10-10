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

const terminalPrFiles = [
  '.changeset/desktop-linux-webgl-auto.md',
  'ghostty-webgpu/docs/api.md',
  'ghostty-webgpu/src/render/backend-order.test.ts',
  'ghostty-webgpu/src/render/backend-order.ts',
  'ghostty-webgpu/src/render/selector.ts',
  'ghostty-webgpu/src/render/tests/platforms.ts',
  'ghostty-webgpu/src/render/tests/selector.browser.test.ts',
  'ghostty-webgpu/src/worker/runtime.ts',
  'ghostty-webgpu/src/worker/terminal.browser.test.ts',
  'ghostty-webgpu/src/worker/tests/platform-backend.worker.ts',
]

test('PR 1208 selects terminal verification and patch-note formatting only', () => {
  expect(select(terminalPrFiles)).toMatchObject({
    packages: ['ghostty-webgpu'],
    ghostty: true,
    shared: false,
    docs: true,
    web: false,
    server: false,
    tui: false,
    editor: false,
    hotkeys: false,
    site: false,
    desktop: false,
  })
})

test('a changeset by itself does not select application or library tests', () => {
  expect(select(['.changeset/patch.md'])).toMatchObject({
    packages: [],
    shared: false,
    docs: true,
    ghostty: false,
    web: false,
  })
})

test('mixed terminal and app changes retain affected app checks', () => {
  expect(select(terminalPrFiles.concat(['apps/web/src/main.tsx']))).toMatchObject({
    shared: true,
    ghostty: true,
    web: true,
  })
})

test('full validation still covers terminal consumers and repository checks', () => {
  expect(select(terminalPrFiles, true)).toMatchObject({
    shared: true,
    ghostty: true,
    web: true,
    server: true,
    site: true,
    exhaustive: true,
  })
})

test.each([
  ['apps/web/src/features/chat/components/message.tsx', 'web'],
  ['apps/server/src/provider/service.ts', 'server'],
  ['apps/tui/src/main.tsx', 'tui'],
  ['editor/packages/highlighting/src/index.ts', '@singapore-editor/highlighting'],
  ['hotkeys/packages/hotkeys/src/index.ts', '@fregat/hotkeys'],
  ['packages/contracts/src/index.ts', '@workspace/contracts'],
  ['ghostty-webgpu/site/src/main.ts', 'ghostty-webgpu-site'],
  ['ghostty-webgpu/docs/correctness-results.json', 'ghostty-webgpu'],
])('%s selects only its owning package', (file, name) => {
  expect(select([file]).packages).toEqual([name])
  expect(select([file]).tooling).toBe(false)
})

test('dependencies are built without selecting their tests', () => {
  const plan = select(['apps/web/src/main.tsx'])
  expect(plan.packages).toEqual(['web'])
  expect(requiredLibraries(graph, plan.packages)).toContain('ghostty-webgpu')
  expect(plan.ghostty).toBe(false)
})

test.each([
  'package.json',
  'bun.lock',
  'turbo.json',
  '.github/workflows/ci.yml',
  '.agents/skills/helper.ts',
  'apps/deleted-package/src/index.ts',
])('%s selects root tooling without every application suite', (file) => {
  expect(select([file])).toMatchObject({
    packages: [],
    tooling: true,
    web: false,
    server: false,
    tui: false,
    ghostty: false,
    editor: false,
  })
})

test('script changes select the script package and its tooling suite', () => {
  expect(select(['scripts/dev-sources.ts'])).toMatchObject({
    packages: ['scripts'],
    tooling: true,
    web: false,
    server: false,
    tui: false,
    ghostty: false,
  })
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
    editor: true,
    ghostty: true,
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

test.skipIf(!gitAvailable).each([
  [[], ''],
  [['apps/site/index.html'], 'fregat'],
  [['apps/site/index.html', 'editor/site/index.html'], 'fregat,singapore'],
])('CLI exports raw sites %s and JSON arrays', (files, sites) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-affected-output-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  try {
    for (const folder of ['apps/site', 'editor/site', 'docs'])
      mkdirSync(path.join(directory, folder), { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*', 'editor/site'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=site' },
      }),
    )
    writeFileSync(path.join(directory, 'turbo.json'), '{"globalDependencies":[],"tasks":{}}')
    writeFileSync(path.join(directory, 'apps/site/package.json'), '{"name":"site"}')
    writeFileSync(
      path.join(directory, 'editor/site/package.json'),
      '{"name":"singapore-editor-site"}',
    )
    git('init', '-q')
    git('config', 'user.name', 'CI fixture')
    git('config', 'user.email', 'ci@example.test')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(path.join(directory, 'docs/Review note.md'), '# Changed\n')
    for (const file of files) writeFileSync(path.join(directory, file), '<main>Changed</main>\n')
    git('add', '.')
    git('commit', '-qm', 'changed')
    const output = path.join(directory, 'outputs')
    const result = Bun.spawnSync(
      [
        'bun',
        path.join(root, 'scripts/ci/affected.mjs'),
        'changed',
        base,
        git('rev-parse', 'HEAD'),
      ],
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
    expect(exported.sites).toBe(sites)
    expect(JSON.parse(exported.packages)).toEqual(selection.packages)
    expect(JSON.parse(exported.docs_files)).toEqual(['docs/Review note.md'])
    expect(exported.site).toBe(String(files.length > 0))
    expect(exported.docs).toBe('true')
    expect(exported.exhaustive).toBe('false')
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
