import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { readWorkspaceGraph, requiredLibraries } from './affected.mjs'
import { consume, planBuilds, prepare, produce, verifyImported } from './build-reuse.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const graph = readWorkspaceGraph(root)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const full = {
  code: 'true',
  shared: 'true',
  tooling: 'true',
  tree: 'true',
  web: 'true',
  server: 'true',
  tui: 'true',
  editor: 'true',
  ghostty: 'true',
  site: 'true',
  sites: 'fregat,singapore,demo,ghostty-webgpu',
  packages: 'all',
}

function selected(values = {}) {
  return Object.assign(
    Object.fromEntries(Object.keys(full).map((key) => [key, 'false'])),
    {
      code: 'true',
      packages: '[]',
      sites: '',
    },
    values,
  )
}

function fixture(drift = '') {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-build-reuse-'))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    writeFileSync(
      path.join(directory, file),
      typeof value === 'string' ? value : JSON.stringify(value),
    )
  }
  write('package.json', {
    private: true,
    packageManager: JSON.parse(readFileSync(path.join(root, 'package.json'))).packageManager,
    workspaces: { packages: ['packages/*'] },
    scripts: { 'build:workspaces': 'turbo run build --filter=@fregat/* --filter=@workspace/ui' },
  })
  write('bun.lock', {
    lockfileVersion: 1,
    workspaces: {
      '': { name: 'fixture' },
      'packages/base': {
        name: '@fregat/base',
        dependencies: { '@workspace/utils': 'workspace:*' },
      },
      'packages/utils': { name: '@workspace/utils' },
      'packages/ui': { name: '@workspace/ui', dependencies: { '@fregat/base': 'workspace:*' } },
    },
    packages: {
      '@fregat/base': ['@fregat/base@workspace:packages/base'],
      '@workspace/utils': ['@workspace/utils@workspace:packages/utils'],
      '@workspace/ui': ['@workspace/ui@workspace:packages/ui'],
    },
  })
  write('.gitignore', 'node_modules\n.turbo\ntransport\n**/dist\n')
  write('shared.txt', 'committed input')
  write('turbo.json', {
    globalDependencies: ['builder.mjs', 'shared.txt'],
    globalEnv: ['NODE_ENV'],
    tasks: {
      build: { dependsOn: ['^build'], outputs: ['dist/**'] },
      '@workspace/ui#build': {
        dependsOn: ['^build'],
        outputs: ['src/lib/generated/cn-tables.ts'],
        inputs: ['$TURBO_DEFAULT$', '!src/lib/generated/cn-tables.ts'],
      },
      test: { dependsOn: ['^build'], outputs: [] },
    },
  })
  write('packages/base/package.json', {
    name: '@fregat/base',
    dependencies: { '@workspace/utils': 'workspace:*' },
    scripts: { build: 'bun ../../builder.mjs', test: 'bun ../../test-task.mjs' },
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './worker/*': './dist/worker/*.js',
      './types': './dist/types.js',
    },
  })
  write('packages/ui/package.json', {
    name: '@workspace/ui',
    dependencies: { '@fregat/base': 'workspace:*' },
    scripts: { build: 'bun ../../builder.mjs', test: 'bun ../../test-task.mjs' },
  })
  write('packages/utils/package.json', { name: '@workspace/utils' })
  write('packages/utils/index.ts', 'export const sourceOnly = true')
  write('packages/base/input.txt', 'base source')
  write('packages/ui/input.txt', 'ui source')
  write('packages/ui/src/lib/generated/cn-tables.ts', 'export const classes = []\n')
  write(
    'builder.mjs',
    `import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const ui = process.cwd().endsWith('/ui');
const drift = ${JSON.stringify(drift)};
if (!ui && drift === 'shared') writeFileSync('../../shared.txt', 'changed while building');
if (!ui && drift === 'task-local') writeFileSync('input.txt', 'changed while building');
if (!ui && drift === 'environment') writeFileSync('../../.env.local', 'NODE_ENV=production');
const input = readFileSync(drift === 'task-local' ? 'input.txt' : '../../shared.txt', 'utf8');
const file = ui ? 'src/lib/generated/cn-tables.ts' : 'dist/index.js';
mkdirSync(ui ? 'src/lib/generated' : 'dist/worker', {recursive:true});
if(!ui) mkdirSync('dist/node_modules/dependency', {recursive:true});
const generated = drift === 'generated' ? 'export const classes = [1]\\n' : 'export const classes = []\\n';
writeFileSync(file,ui ? generated : 'export const value = '+JSON.stringify(input)+'\\n');
if(!ui){ writeFileSync('dist/index.d.ts','export declare const value = 1\\n'); writeFileSync('dist/style.css','body{}'); writeFileSync('dist/types.js',''); writeFileSync('dist/node_modules/dependency/index.js','export const bundled = true'); writeFileSync('dist/worker/parser.js','self.onmessage=()=>{}'); }
appendFileSync('../../compiles.log',process.cwd()+'\\n');`,
  )
  write(
    'test-task.mjs',
    "import {appendFileSync} from 'node:fs'; appendFileSync('../../tests.log','test\\n')",
  )
  write(
    'node_modules/turbo/package.json',
    readFileSync(path.join(root, 'node_modules/turbo/package.json'), 'utf8'),
  )
  mkdirSync(path.join(directory, 'node_modules/.bin'), { recursive: true })
  symlinkSync(
    path.join(root, 'node_modules/.bin/turbo'),
    path.join(directory, 'node_modules/.bin/turbo'),
  )
  symlinkSync('packages/ui', path.join(directory, 'instructions-link'))
  const git = (args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  git(['init', '-q'])
  git(['add', '.'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'Fixture',
  ])
  const context = {
    repository: 'fixture/repo',
    run: '42',
    attempt: 1,
    source: git(['rev-parse', 'HEAD']),
    os: 'Linux',
    arch: 'X64',
    image: 'ubuntu24/20261023.334.3',
  }
  const request = (targets = 'all', override = {}) =>
    prepare({
      root: directory,
      temporary: path.join(directory, 'transport'),
      targets,
      context: { ...context, ...override },
    })
  const publication = () => {
    const prepared = request()
    const published = produce(prepared)
    const downloads = path.join(directory, 'transport/downloads')
    mkdirSync(downloads, { recursive: true })
    cpSync(published.directory, path.join(downloads, published.name), { recursive: true })
    return { prepared, published, downloads }
  }
  return { directory, context, git, write, request, publication }
}

function rewriteBundle(bundle, mutate) {
  const old = path.join(bundle.downloads, bundle.published.name)
  const manifest = JSON.parse(readFileSync(path.join(old, 'manifest.json')))
  mutate(manifest, old)
  const content = JSON.stringify(manifest)
  writeFileSync(path.join(old, 'manifest.json'), content)
  const name = bundle.published.name.replace(/[a-f0-9]{64}$/, hash(content))
  const next = path.join(bundle.downloads, name)
  if (next !== old) {
    cpSync(old, next, { recursive: true })
    rmSync(old, { recursive: true })
  }
  return next
}

function compiles(directory) {
  const file = path.join(directory, 'compiles.log')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
}

test('full enabled CI has one owner for each of its 29 setup build tasks', () => {
  const plan = planBuilds(graph, full)
  expect(plan).toEqual(requiredLibraries(graph, Array.from(graph.packages.keys())))
  expect(plan).toHaveLength(29)
  expect(new Set(plan).size).toBe(29)
})

test.each([
  ['web', { web: 'true' }, 23],
  ['tree Browser prerequisites', { tree: 'true' }, 23],
  ['tooling', { tooling: 'true' }, 29],
  ['server', { server: 'true' }, 2],
  ['TUI', { tui: 'true' }, 12],
  ['Editor', { editor: 'true' }, 24],
  ['Ghostty', { ghostty: 'true' }, 4],
  ['empty union', {}, 0],
])('%s selection has its exact existing graph closure', (_, flags, size) => {
  expect(planBuilds(graph, selected(flags))).toHaveLength(size)
})

test('union covers every enabled family and selected site without duplicate tasks', () => {
  const plan = planBuilds(
    graph,
    selected({ web: 'true', editor: 'true', ghostty: 'true', site: 'true', sites: 'demo' }),
  )
  expect(plan).toHaveLength(28)
  expect(plan).not.toContain('@fregat/react-hotkeys')
  expect(() => planBuilds(graph, selected({ shared: 'true', packages: '["unknown"]' }))).toThrow()
  expect(() => planBuilds(graph, selected({ site: 'true', sites: 'unknown' }))).toThrow()
})

test('empty producer and consumer succeed with no fake artifact or compile', () => {
  const f = fixture()
  const request = f.request('[]')
  expect(produce(request)).toBeNull()
  expect(() => verifyImported(request)).not.toThrow()
  expect(consume(request, path.join(f.directory, 'absent'))).toEqual([])
  expect(compiles(f.directory)).toEqual([])
})

test('cold producer builds each task once, imports exact outputs and warm producer hits build cache', () => {
  const f = fixture()
  const bundle = f.publication()
  expect(compiles(f.directory)).toHaveLength(2)
  const manifest = JSON.parse(readFileSync(path.join(bundle.published.directory, 'manifest.json')))
  expect(manifest.tasks.every((task) => task.taskId.endsWith('#build'))).toBe(true)
  expect(manifest.files.map((file) => file.path)).toContain(
    'packages/ui/src/lib/generated/cn-tables.ts',
  )
  expect(manifest.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([
      'packages/base/dist/index.js',
      'packages/base/dist/index.d.ts',
      'packages/base/dist/style.css',
      'packages/base/dist/types.js',
      'packages/base/dist/worker/parser.js',
      'packages/base/dist/node_modules/dependency/index.js',
    ]),
  )
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  const imported = consume(f.request('["@fregat/base"]', { attempt: 2 }), bundle.downloads)
  expect(imported).toHaveLength(1)
  expect(
    readFileSync(path.join(f.directory, 'packages/base/dist/worker/parser.js'), 'utf8'),
  ).toContain('onmessage')
  expect(compiles(f.directory)).toHaveLength(2)
  const warm = produce(f.request('all', { attempt: 2 }))
  expect(warm).not.toBeNull()
  expect(compiles(f.directory)).toHaveLength(2)
  expect(warm.tasks.every((task) => task.cache.status === 'HIT')).toBe(true)
})

test.each([
  ['shared', 'Build inputs changed during execution'],
  ['task-local', 'Build task/output identity changed during execution'],
  ['environment', 'Build inputs changed during execution'],
])('producer rejects %s drift before staging or successful cache publication', (drift, message) => {
  const f = fixture(drift)
  const request = f.request()
  expect(() => produce(request)).toThrow(message)
  expect(existsSync(path.join(request.directory, 'bundle'))).toBe(false)
  expect(compiles(f.directory)).toHaveLength(2)
  if (drift === 'environment') return
  expect(readFileSync(path.join(f.directory, 'packages/base/dist/index.js'), 'utf8')).toContain(
    'changed while building',
  )
  const after = f.request()
  expect(after.identity.inputs === request.identity.inputs).toBe(drift === 'task-local')
})

test('producer accepts declared generated UI output changes without resealing source inputs', () => {
  const f = fixture('generated')
  const request = f.request()
  const publication = produce(request)
  const manifest = JSON.parse(readFileSync(path.join(publication.directory, 'manifest.json')))
  expect(
    readFileSync(path.join(f.directory, 'packages/ui/src/lib/generated/cn-tables.ts'), 'utf8'),
  ).toBe('export const classes = [1]\n')
  expect(manifest.identity).toEqual(request.identity)
  expect(f.request().identity).toEqual(request.identity)
  const downloads = path.join(f.directory, 'transport/generated-download')
  cpSync(publication.directory, path.join(downloads, publication.name), { recursive: true })
  expect(consume(f.request(), downloads)).toHaveLength(2)
})

test('partial warm cache compiles only the missing build task and never saves test entries', () => {
  const f = fixture()
  const bundle = f.publication()
  const task = bundle.published.tasks.find((entry) => entry.package === '@workspace/ui')
  assert(task)
  const cache = path.join(f.directory, '.turbo/ci-builds')
  rmSync(path.join(cache, `${task.hash}.tar.zst`))
  writeFileSync(path.join(cache, '0000000000000000.tar.zst'), 'unrelated test cache')
  produce(f.request('all', { attempt: 2 }))
  expect(compiles(f.directory)).toHaveLength(3)
  expect(readdirSync(cache)).not.toContain('0000000000000000.tar.zst')
})

test('consumer only imports its required subset and build-cache entries', () => {
  const f = fixture()
  const bundle = f.publication()
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  rmSync(path.join(f.directory, '.turbo/cache'), { recursive: true, force: true })
  f.write('packages/ui/src/lib/generated/cn-tables.ts', 'keep untouched subset sentinel')
  consume(f.request('["@fregat/base"]'), bundle.downloads)
  expect(
    readFileSync(path.join(f.directory, 'packages/ui/src/lib/generated/cn-tables.ts'), 'utf8'),
  ).toBe('keep untouched subset sentinel')
  expect(
    readdirSync(path.join(f.directory, '.turbo/cache')).filter((name) => name.endsWith('.tar.zst')),
  ).toHaveLength(1)
})

test.each([false, true])(
  'imported build entries satisfy Turbo prerequisites without caching test success with GitHub formatting %s',
  (github) => {
    const f = fixture()
    const bundle = f.publication()
    consume(f.request('all'), bundle.downloads)
    const build = bundle.published.tasks.find((task) => task.taskId === '@fregat/base#build')
    assert(build)
    const turbo = path.join(f.directory, 'node_modules/.bin/turbo')
    const summaries = path.join(f.directory, '.turbo/runs')
    for (let i = 0; i < 2; i++) {
      const before = readdirSync(summaries)
      const output = execFileSync(
        turbo,
        ['run', 'test', '--cache=local:r', '--filter=@workspace/ui', '--summarize'],
        {
          cwd: f.directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            CI: github ? 'true' : undefined,
            GITHUB_ACTIONS: github ? 'true' : undefined,
          },
        },
      )
      process.stdout.write(output)
      const created = readdirSync(summaries).filter((file) => !before.includes(file))
      expect(created).toHaveLength(1)
      const result = JSON.parse(readFileSync(path.join(summaries, created[0]), 'utf8'))
      expect(result.execution.exitCode).toBe(0)
      expect(result.tasks.map((task) => [task.taskId, task.cache.status])).toEqual([
        ['@fregat/base#build', 'HIT'],
        ['@workspace/ui#test', 'MISS'],
      ])
      expect(result.tasks[0].hash).toBe(build.hash)
      expect(
        readFileSync(path.join(f.directory, 'tests.log'), 'utf8').trim().split('\n'),
      ).toHaveLength(i + 1)
      expect(compiles(f.directory)).toHaveLength(2)
    }
  },
)

test('required consumer fails closed on missing bundle and never compiles', () => {
  const f = fixture()
  expect(() => consume(f.request('all'), path.join(f.directory, 'missing'))).toThrow()
  expect(compiles(f.directory)).toEqual([])
})

test('failed producer publishes nothing', () => {
  const f = fixture()
  f.write('builder.mjs', 'process.exit(23)')
  const request = f.request('all')
  expect(() => produce(request)).toThrow()
  expect(existsSync(path.join(request.directory, 'bundle/manifest.json'))).toBe(false)
})

test.each([
  'checkout',
  'source',
  'run',
  'os',
  'arch',
  'imageOS',
  'platform',
  'toolchain',
  'environment',
  'inputs',
])('consumer rejects wrong %s identity before copying outputs', (key) => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest) => {
    manifest.identity[key] = 'wrong'
  })
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
  expect(existsSync(path.join(f.directory, 'packages/base/dist'))).toBe(false)
})

test('observed hosted image patch difference imports only with equal live build inputs', () => {
  const f = fixture()
  const bundle = f.publication()
  const producer = f.request()
  const consumer = f.request('all', { image: 'ubuntu24/20261012.334.1', attempt: 2 })
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  expect(consume(consumer, bundle.downloads)).toHaveLength(2)
  expect(consumer.cachePrefix).toBe(producer.cachePrefix)
  expect(compiles(f.directory)).toHaveLength(2)
  const receipt = JSON.parse(
    readFileSync(path.join(f.directory, '.turbo/workspace-builds-receipt.json')),
  )
  expect(receipt.provenance).toEqual({
    producer: { image: 'ubuntu24/20261023.334.3' },
    consumer: { image: 'ubuntu24/20261012.334.1' },
  })
  expect(() => verifyImported(consumer)).not.toThrow()
  const warm = produce(f.request('all', { image: 'ubuntu24/20261012.334.1', attempt: 2 }))
  expect(warm.tasks.every((task) => task.cache.status === 'HIT')).toBe(true)
  expect(compiles(f.directory)).toHaveLength(2)
})

test.each([undefined, '', 'undefined/undefined', 'ubuntu24/', '/20261023.334.3'])(
  'missing or malformed image metadata %s fails closed',
  (image) => {
    expect(() => fixture().request('all', { image })).toThrow()
  },
)

test.each([
  ['OS', ['platform', 'os'], process.platform === 'win32' ? 'linux' : 'win32'],
  ['architecture', ['platform', 'arch'], process.arch === 'arm64' ? 'x64' : 'arm64'],
  ['distribution', ['platform', 'system', 'distribution'], 'different-linux'],
  ['OS release', ['platform', 'system', 'version'], '26.04'],
  ['libc', ['platform', 'system', 'libc'], 'different-libc'],
  ['Bun', ['toolchain', 'bun'], '1.4.2'],
  ['Bun revision', ['toolchain', 'bunRevision'], '0'.repeat(40)],
  ['Node', ['toolchain', 'node'], 'v26.7.1'],
  ['Turbo', ['toolchain', 'turbo'], '2.11.4'],
  ['old schema', ['schema'], 'fregat-ci-ws-v1'],
])('image patch tolerance still rejects incompatible %s', (_, keys, value) => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest) => {
    const parent = keys.slice(0, -1).reduce((object, key) => object[key], manifest.identity)
    parent[keys.at(-1)] = value
  })
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  expect(() =>
    consume(f.request('all', { image: 'ubuntu24/20261012.334.1' }), bundle.downloads),
  ).toThrow()
  expect(existsSync(path.join(f.directory, 'packages/base/dist'))).toBe(false)
})

test.each([
  [['provenance']],
  [['provenance', 'image']],
  [['identity', 'platform']],
  [['identity', 'platform', 'system']],
  [['identity', 'platform', 'system', process.platform === 'linux' ? 'libc' : 'release']],
  [['identity', 'toolchain', 'bunRevision']],
  [['identity', 'toolchain', 'node']],
])('missing mandatory bundle metadata %s rejects', (keys) => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest) => {
    const parent = keys.slice(0, -1).reduce((object, key) => object[key], manifest)
    delete parent[keys.at(-1)]
  })
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
})

test('runtime platform and exact build tools are measured independently of image provenance', () => {
  const f = fixture()
  const identity = f.request().identity
  expect(identity.platform.os).toBe(process.platform)
  expect(identity.platform.arch).toBe(process.arch)
  expect(
    Object.values(identity.platform.system).every(
      (value) => typeof value === 'string' && value.length > 0,
    ),
  ).toBe(true)
  expect(identity.toolchain.bun).toBe(Bun.version)
  expect(identity.toolchain.bunRevision).toBe(Bun.revision)
  expect(identity.toolchain.node).toBe(
    execFileSync('node', ['-p', 'process.version'], { encoding: 'utf8' }).trim(),
  )
  expect(identity.imageOS).toBe('ubuntu24')
  expect(identity).not.toHaveProperty('image')
})

test('cross-image consumer still rejects changed source and environment', () => {
  const f = fixture()
  const bundle = f.publication()
  const override = { image: 'ubuntu24/20261012.334.1' }
  f.write('packages/base/input.txt', 'changed source')
  expect(() => consume(f.request('all', override), bundle.downloads)).toThrow(
    'Build task/output identity mismatch',
  )
  f.write('packages/base/input.txt', 'base source')
  f.write('.env.local', 'NODE_ENV=production')
  expect(() => consume(f.request('all', override), bundle.downloads)).toThrow(
    'Build identity mismatch',
  )
})

test('cross-image consumer requires the exact non-dist UI output root', () => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest, directory) => {
    const file = 'packages/ui/src/lib/generated/cn-tables.ts'
    manifest.files = manifest.files.filter((entry) => entry.path !== file)
    rmSync(path.join(directory, 'files', file))
  })
  expect(() =>
    consume(f.request('all', { image: 'ubuntu24/20261012.334.1' }), bundle.downloads),
  ).toThrow('Required build output root is empty')
})

test('digest and file-byte changes reject', () => {
  const f = fixture()
  const bundle = f.publication()
  const folder = path.join(bundle.downloads, bundle.published.name)
  writeFileSync(path.join(folder, 'files/packages/base/dist/index.js'), 'changed bytes')
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
  copyFileSync(
    path.join(bundle.published.directory, 'files/packages/base/dist/index.js'),
    path.join(folder, 'files/packages/base/dist/index.js'),
  )
  writeFileSync(
    path.join(folder, 'manifest.json'),
    readFileSync(path.join(folder, 'manifest.json'), 'utf8') + '\n',
  )
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
})

test.each([
  '../escape',
  '/absolute',
  'C:\\escape',
  'packages/base/dist/../../input.txt',
  'packages/base/node_modules/x',
  'packages/base/dist/.env',
])('unsafe output path %s rejects before extraction', (file) => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest) => {
    manifest.files[0].path = file
  })
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
})

test.each([
  'missing declaration',
  'missing CSS',
  'missing worker',
  'dist-only UI',
  'duplicate path',
  'source injection',
  'symlink',
])('%s bundle fails closed', (variant) => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest, directory) => {
    if (variant === 'duplicate path') {
      manifest.files.push(manifest.files[0])
      return
    }
    if (variant === 'source injection') {
      manifest.files[0].path = 'packages/base/input.txt'
      return
    }
    const suffix = {
      'missing declaration': 'dist/index.d.ts',
      'missing CSS': 'dist/style.css',
      'missing worker': 'dist/worker/parser.js',
      'dist-only UI': 'src/lib/generated/cn-tables.ts',
      symlink: 'dist/index.js',
    }[variant]
    const file = manifest.files.find((entry) => entry.path.endsWith(suffix))
    assert(file)
    const target = path.join(directory, 'files', file.path)
    rmSync(target)
    if (variant === 'symlink')
      symlinkSync(path.join(f.directory, 'packages/base/input.txt'), target)
  })
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
})

test('producer validates runtime/type/wildcard export realizations', () => {
  const f = fixture()
  const manifest = JSON.parse(readFileSync(path.join(f.directory, 'packages/base/package.json')))
  manifest.exports['./missing'] = './dist/missing.d.ts'
  f.write('packages/base/package.json', manifest)
  expect(() => produce(f.request())).toThrow()
})

test('partial retry selects unique latest eligible attempt; future or duplicate producer fails', () => {
  const f = fixture()
  const bundle = f.publication()
  const second = produce(f.request('all', { attempt: 2 }))
  cpSync(second.directory, path.join(bundle.downloads, second.name), { recursive: true })
  expect(consume(f.request('all', { attempt: 3 }), bundle.downloads)).toHaveLength(2)
  expect(() => consume(f.request('all', { attempt: 1 }), bundle.downloads)).toThrow()
  const directory = path.join(bundle.downloads, second.name)
  cpSync(directory, directory.replace(/[a-f0-9]{64}$/, '0'.repeat(64)), { recursive: true })
  expect(() => consume(f.request('all', { attempt: 3 }), bundle.downloads)).toThrow()
})

test('cache identity separates toolchain/environment/shared inputs and primary tree/filter sets', () => {
  const f = fixture()
  const initial = f.request()
  expect(f.request('["@fregat/base"]').cachePrefix).toBe(initial.cachePrefix)
  expect(f.request('["@fregat/base"]').cacheKey).not.toBe(initial.cacheKey)
  f.write('packages/base/input.txt', 'changed local source')
  expect(f.request().cachePrefix).toBe(initial.cachePrefix)
  const lock = readFileSync(path.join(f.directory, 'bun.lock'), 'utf8')
  f.write('bun.lock', 'changed parser lock')
  expect(f.request().cachePrefix).not.toBe(initial.cachePrefix)
  f.write('bun.lock', lock)
  f.write('builder.mjs', 'changed root helper')
  expect(f.request().cachePrefix).not.toBe(initial.cachePrefix)
  expect(f.request('all', { image: 'ubuntu26/20261023.334.3' }).cachePrefix).not.toBe(
    initial.cachePrefix,
  )
  const beforeTool = f.request()
  f.write('node_modules/turbo/package.json', { version: '0.0.0' })
  expect(f.request().cachePrefix).not.toBe(beforeTool.cachePrefix)
  const beforeEnv = f.request()
  f.write('packages/base/.env.local', 'NODE_ENV=production')
  expect(f.request().cachePrefix).not.toBe(beforeEnv.cachePrefix)
})

test('site prerequisite reuse requires a matching verified import and intact files', () => {
  const f = fixture()
  const request = f.request()
  expect(() => verifyImported(request)).toThrow()
  const bundle = f.publication()
  consume(request, bundle.downloads)
  expect(() => verifyImported(f.request())).not.toThrow()
  f.write('packages/base/dist/index.d.ts', 'changed')
  expect(() => verifyImported(f.request())).toThrow()
  expect(compiles(f.directory)).toHaveLength(2)
})

test('artifact ZIP mode normalization preserves manifest output modes on import', () => {
  const f = fixture()
  const bundle = f.publication()
  const directory = rewriteBundle(bundle, (manifest, folder) => {
    const file = manifest.files.find((entry) => entry.path === 'packages/base/dist/index.js')
    assert(file)
    file.mode = 0o755
    chmodSync(path.join(folder, 'files', file.path), 0o644)
  })
  expect(directory).toBeTruthy()
  consume(f.request(), bundle.downloads)
  expect(lstatSync(path.join(f.directory, 'packages/base/dist/index.js')).mode & 0o777).toBe(0o755)
})

test('hardlinks, unexpected source files and escaped checkout parents reject', () => {
  const f = fixture()
  const bundle = f.publication()
  const folder = path.join(bundle.downloads, bundle.published.name)
  const file = path.join(folder, 'files/packages/base/dist/index.js')
  rmSync(file)
  linkSync(path.join(f.directory, 'packages/base/dist/index.js'), file)
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
  rmSync(file)
  copyFileSync(path.join(bundle.published.directory, 'files/packages/base/dist/index.js'), file)
  writeFileSync(path.join(folder, 'source.txt'), 'unexpected source')
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
  rmSync(path.join(folder, 'source.txt'))
  rmSync(path.join(f.directory, 'packages/base/dist'), { recursive: true })
  const escape = path.join(f.directory, 'transport/escape')
  mkdirSync(escape)
  symlinkSync(escape, path.join(f.directory, 'packages/base/dist'))
  expect(() => consume(f.request(), bundle.downloads)).toThrow()
  expect(readdirSync(escape)).toEqual([])
})

test('bundle identities include declared output roots and the full producer union', () => {
  const f = fixture()
  const bundle = f.publication()
  rewriteBundle(bundle, (manifest) => {
    const ui = manifest.tasks.find((task) => task.taskId === '@workspace/ui#build')
    assert(ui)
    ui.roots = ['packages/ui/dist']
  })
  expect(() => consume(f.request('["@fregat/base"]'), bundle.downloads)).toThrow()
})

test('a package source edit invalidates its build and dependency hashes through Turbo', () => {
  const f = fixture()
  const bundle = f.publication()
  f.write('packages/base/input.txt', 'next version')
  const next = produce(f.request('all', { attempt: 2 }))
  expect(compiles(f.directory)).toHaveLength(4)
  expect(next.tasks.every((task) => task.cache.status === 'MISS')).toBe(true)
  expect(next.tasks.map((task) => task.hash)).not.toEqual(
    bundle.published.tasks.map((task) => task.hash),
  )
})

test('tracked directory symlinks are sealed as source links without following them', () => {
  const f = fixture()
  const initial = f.request()
  rmSync(path.join(f.directory, 'instructions-link'))
  symlinkSync('packages/base', path.join(f.directory, 'instructions-link'))
  expect(f.request().identity.inputs).not.toBe(initial.identity.inputs)
})
