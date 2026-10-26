import { expect, test } from 'vitest'
import { copyFile, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { withWorkspace } from './release/fixture.mjs'

const script = fileURLToPath(new URL('./workspace-tooling.mjs', import.meta.url))
const catalog = { typescript: '7.0.2', vitest: '5.0.2', 'typescript-api': 'npm:typescript@~6.0.3' }
const checkout = fileURLToPath(new URL('../', import.meta.url))

async function scriptTestFiles(root) {
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  const command = manifest.scripts['test:scripts'].replace('vitest run', 'vitest list')
  const result = spawnSync(
    'bun',
    ['exec', `${command} --filesOnly --json --root ${JSON.stringify(root)}`],
    {
      cwd: checkout,
      encoding: 'utf8',
    },
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return JSON.parse(result.stdout)
    .map(({ file }) => relative(root, file).replaceAll('\\', '/'))
    .sort()
}

test('test:scripts discovers every script suite through the root route', async () => {
  const files = await readdir(join(checkout, 'scripts'), { recursive: true })
  const expected = files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !file.split('/').includes('node_modules') && /\.test\.(ts|mjs)$/.test(file))
    .map((file) => `scripts/${file}`)
    .sort()
  const discovered = await scriptTestFiles(checkout)
  expect(discovered.filter((file) => file.startsWith('scripts/'))).toEqual(expected)
})

test('test:scripts picks up future nested ts and mjs suites without collecting other owners', async () => {
  await withWorkspace(async ({ root }) => {
    const files = [
      'scripts/direct.test.ts',
      'scripts/nested/deep.test.mjs',
      'scripts/nested/deep.test.ts',
      'scripts/nested/ignored.spec.ts',
      'scripts/nested/ignored.browser.tsx',
      'scripts/node_modules/dependency/ignored.test.ts',
      'apps/server/unregistered.test.ts',
      'apps/web/scripts/shard-durations.test.ts',
    ]
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    await copyFile(
      join(checkout, 'vitest.scripts.config.mjs'),
      join(root, 'vitest.scripts.config.mjs'),
    )
    await symlink(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction')
    expect(await scriptTestFiles(root)).toEqual([
      'apps/web/scripts/shard-durations.test.ts',
      'scripts/direct.test.ts',
      'scripts/nested/deep.test.mjs',
      'scripts/nested/deep.test.ts',
    ])
  })
})

async function prepare({ put }) {
  await put('.', {
    name: 'fixture',
    private: true,
    packageManager: 'bun@1.4.4',
    workspaces: {
      packages: ['apps/*', 'packages/*'],
      catalog,
    },
  })
}

function run(root, ...args) {
  return spawnSync('bun', [script].concat(args), { cwd: root, encoding: 'utf8' })
}

test('checks Fregat workspace tools and the Astro compiler API', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await fixture.put('apps/site', {
      name: 'site',
      devDependencies: { typescript: catalog['typescript-api'] },
    })
    await fixture.put('packages/contracts', {
      name: '@workspace/contracts',
      devDependencies: { typescript: '7.0.2', vitest: 'catalog:' },
    })
    const result = run(fixture.root)
    expect(result.status, result.stderr).toBe(0)
  })
})

test('rejects and synchronizes tool versions, Bun pins and workspace catalog drift', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await fixture.put('packages/contracts', {
      name: 'contracts',
      packageManager: 'bun@1.3.14',
      devDependencies: { typescript: '~6.0.3' },
      workspaces: { packages: ['packages/*'], catalog: { vitest: '4.0.0' } },
    })
    const failed = run(fixture.root)
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain('typescript must be 7.0.2')
    expect(failed.stderr).toContain('packageManager must be bun@1.4.4')
    expect(failed.stderr).toContain('catalog vitest must be 5.0.2')
    expect(run(fixture.root, '--write').status).toBe(0)
    expect(run(fixture.root).status).toBe(0)
    const manifest = await fixture.read('packages/contracts')
    expect(manifest.devDependencies.typescript).toBe('7.0.2')
    expect(manifest.packageManager).toBe('bun@1.4.4')
    expect(manifest.workspaces.catalog.vitest).toBe('5.0.2')
  })
})

test('root installs Node types ahead of ancestor packages', async () => {
  const checkout = fileURLToPath(new URL('../', import.meta.url))
  const require = createRequire(join(checkout, 'package.json'))
  const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')

  const manifestPath = join(checkout, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  expect(manifest.devDependencies['@types/node']).toBe('26.6.3')
  const localRequire = createRequire(manifestPath)
  const nodeTypes = dirname(localRequire.resolve('@types/node/package.json'))

  await withWorkspace(async ({ root }) => {
    const ancestor = join(root, 'node_modules/@types/node')
    const project = join(root, 'repo')
    await mkdir(ancestor, { recursive: true })
    await mkdir(project)
    await writeFile(join(ancestor, 'index.d.ts'), 'declare const ancestorTypes: unique symbol')
    await writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'bundler',
          types: ['node'],
          skipLibCheck: true,
          noEmit: true,
        },
        files: ['index.ts'],
      }),
    )
    await writeFile(join(project, 'index.ts'), "const bytes: Uint8Array = Buffer.from('checkout')")
    const args = [compiler, '-p', join(project, 'tsconfig.json'), '--traceResolution']
    const before = spawnSync('node', args, { cwd: project, encoding: 'utf8' })
    expect(before.status).not.toBe(0)
    expect(before.stdout).toContain(join(ancestor, 'index.d.ts'))
    expect(before.stdout).toContain("Cannot find name 'Buffer'")

    const typesRoot = join(project, 'node_modules/@types')
    await mkdir(typesRoot, { recursive: true })
    await symlink(nodeTypes, join(typesRoot, 'node'), 'junction')
    const after = spawnSync('node', args, { cwd: project, encoding: 'utf8' })
    expect(after.status, after.stdout + after.stderr).toBe(0)
    expect(after.stdout).toContain(join(nodeTypes, 'index.d.ts'))
    expect(after.stdout).not.toContain(join(ancestor, 'index.d.ts'))
  })
})

test('ignores undeclared standalone checkouts', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await fixture.put('packages/singapore', {
      name: 'standalone-editor',
      devDependencies: { typescript: '1.0.0' },
    })
    const manifest = await fixture.read('.')
    manifest.workspaces.packages = ['apps/*']
    await fixture.put('.', manifest)
    const result = run(fixture.root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 package manifests')
  })
})
