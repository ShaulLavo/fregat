import { expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readWorkspaceGraph, requiredLibraries, selectAffected } from './affected.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const graph = readWorkspaceGraph(root)
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
    editor: true,
    ghostty: true,
    hotkeys: true,
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
    editor: false,
    ghostty: false,
    hotkeys: false,
  })
  expect(plan.docs_files).toContain('.agents/skills/react-development/SKILL.md')
})

const terminalPrFiles = [
  '.changeset/desktop-linux-webgl-auto.md',
  'packages/ghostty-webgpu/docs/api.md',
  'packages/ghostty-webgpu/src/render/shared/backend-order.test.ts',
  'packages/ghostty-webgpu/src/render/shared/backend-order.ts',
  'packages/ghostty-webgpu/src/render/shared/selector.ts',
  'packages/ghostty-webgpu/src/render/tests/platforms.ts',
  'packages/ghostty-webgpu/src/render/tests/selector.browser.test.ts',
  'packages/ghostty-webgpu/src/worker/runtime.ts',
  'packages/ghostty-webgpu/src/worker/terminal.browser.test.ts',
  'packages/ghostty-webgpu/src/worker/tests/platform-backend.worker.ts',
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

test('shader-only edits select the dedicated Ghostty library/browser gate', () => {
  const plan = select(['packages/ghostty-webgpu/packages/shaders/src/addon.ts'])
  expect(plan).toMatchObject({
    packages: ['ghostty-webgpu-shaders'],
    ghostty: true,
    shared: false,
    tooling: false,
    web: false,
    server: false,
    editor: false,
  })
  expect(requiredLibraries(graph, plan.packages)).toEqual([
    '@fregat/hotkeys',
    'ghostty-webgpu',
    'ghostty-webgpu-shaders',
  ])
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
  ['packages/singapore/packages/highlighting/src/index.ts', '@singapore-editor/highlighting'],
  ['packages/hotkeys/packages/hotkeys/src/index.ts', '@fregat/hotkeys'],
  ['packages/contracts/src/index.ts', '@workspace/contracts'],
  ['packages/ghostty-webgpu/site/src/main.ts', 'ghostty-webgpu-site'],
  ['packages/ghostty-webgpu/site-classic/src/main.ts', 'ghostty-webgpu-classic-site'],
  ['packages/ghostty-webgpu/docs/correctness-results.json', 'ghostty-webgpu'],
])('%s selects only its owning package', (file, name) => {
  expect(select([file]).packages).toEqual([name])
  expect(select([file]).tooling).toBe(false)
})

test('classic Ghostty changes select the site build', () => {
  expect(select(['packages/ghostty-webgpu/site-classic/src/main.ts'])).toMatchObject({
    site: true,
    sites: 'ghostty-webgpu',
  })
})

test('PR 1232 selects Editor health when changing its baseline and workflow', () => {
  expect(
    select([
      '.github/workflows/workspace-libraries.yml',
      'packages/singapore/docs/architecture/phase-0/health-baseline.json',
      'scripts/workspace-verification.test.ts',
    ]),
  ).toMatchObject({ editor: true, ghostty: true, web: true, server: true })
})

test.each([
  'packages/singapore/docs/architecture/phase-0/health-baseline.json',
  'packages/singapore/docs/architecture/phase-0/core-public-api.json',
  'packages/singapore/docs/architecture/phase-0/timer-usage.json',
  'packages/singapore/docs/architecture/e056-platform-agnostic-core-sources.json',
  'packages/singapore/scripts/architecture-health.mjs',
  'packages/singapore/scripts/check-full-text-boundary.mjs',
  'packages/singapore/scripts/full-text-boundary-allow.json',
  'packages/singapore/scripts/command-reference.ts',
  'packages/singapore/docs/commands.md',
  'packages/singapore/package.json',
  'packages/singapore/site/package.json',
])('%s selects Editor health without unrelated library or application tests', (file) => {
  expect(select([file])).toMatchObject({
    editor: true,
    ghostty: false,
    hotkeys: false,
    web: false,
    server: false,
    tui: false,
  })
})

test.each([
  'packages/singapore/docs/architecture/phase-0/README.md',
  'packages/singapore/docs/architecture/phase-0/performance-baseline.md',
  'packages/singapore/docs/architecture/extension-hooks.md',
  'packages/singapore/docs/development.md',
])('%s does not select Editor health', (file) => {
  expect(select([file]).editor).toBe(false)
})

test('dependencies are built without selecting their tests', () => {
  const plan = select(['apps/web/src/main.tsx'])
  expect(plan.packages).toEqual(['web'])
  expect(requiredLibraries(graph, plan.packages)).toContain('ghostty-webgpu')
  expect(plan.ghostty).toBe(false)
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
      ghostty: false,
      editor: false,
    })
  },
)

test.each([
  'package.json',
  '.github/workflows/workspace-libraries.yml',
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
  'packages/singapore/tsconfig.json',
  'packages/singapore/scripts/workspace-root.ts',
  'packages/singapore/scripts/build-package.ts',
  'packages/singapore/examples/app/tsconfig.json',
  'packages/hotkeys/tsconfig.json',
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
  expect(requiredLibraries(graph, plan.packages)).toContain('@fregat/hotkeys')
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
  [[], '', 'changed', []],
  [['apps/site/index.html'], 'fregat', 'changed', ['site']],
  [
    ['apps/site/index.html', 'packages/singapore/site/index.html'],
    'fregat,singapore',
    'changed',
    ['singapore-editor-site', 'site'],
  ],
  [['bun.lock'], 'fregat,singapore', 'changed', ['singapore-editor-site', 'site']],
  [['package.json'], 'fregat,singapore', 'changed', ['singapore-editor-site', 'site']],
  [['turbo.json'], 'fregat,singapore', 'changed', ['singapore-editor-site', 'site']],
  [['tsconfig.json'], 'fregat,singapore', 'changed', ['singapore-editor-site', 'site']],
  [[], 'fregat,singapore', 'full', ['singapore-editor-site', 'site']],
])('CLI exports raw sites for %s in %s mode and JSON arrays', (files, sites, mode, packages) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-affected-output-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  try {
    for (const folder of ['apps/site', 'packages/singapore/site', 'docs'])
      mkdirSync(path.join(directory, folder), { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*', 'packages/singapore/site'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=site' },
      }),
    )
    writeFileSync(path.join(directory, 'turbo.json'), '{"globalDependencies":[],"tasks":{}}')
    writeFileSync(path.join(directory, 'apps/site/package.json'), '{"name":"site"}')
    writeFileSync(
      path.join(directory, 'packages/singapore/site/package.json'),
      '{"name":"singapore-editor-site"}',
    )
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
