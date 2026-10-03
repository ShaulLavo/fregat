import { expect, test } from 'vitest'
import { JSON5 } from 'bun'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { withWorkspace } from './release/fixture.mjs'

const script = fileURLToPath(new URL('./workspace-tooling.mjs', import.meta.url))
const catalog = { typescript: '7.0.2', vitest: '5.0.2', 'typescript-api': 'npm:typescript@~6.0.3' }

async function prepare({ root, put }) {
  await put('.', {
    name: 'fixture',
    private: true,
    packageManager: 'bun@1.4.2',
    workspaces: { packages: ['apps/*', 'hotkeys/packages/*'], catalog },
  })
  const format = JSON.stringify({ semi: false, singleQuote: true })
  await writeFile(`${root}/.oxfmtrc.json`, format)
  for (const family of ['editor', 'ghostty-webgpu', 'hotkeys']) {
    await mkdir(`${root}/${family}`, { recursive: true })
    await writeFile(`${root}/${family}/.oxfmtrc.json`, format)
  }
}

function run(root, ...args) {
  return spawnSync('bun', [script, ...args], { cwd: root, encoding: 'utf8' })
}

test('checks workspace tools, standalone catalogs and the Astro compiler API', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await fixture.put('apps/site', {
      name: 'site',
      devDependencies: { typescript: catalog['typescript-api'] },
    })
    await fixture.put('hotkeys', {
      name: 'hotkeys-workspace',
      workspaces: { packages: ['packages/*'], catalog: { vitest: '5.0.2' } },
    })
    await fixture.put('hotkeys/packages/core', {
      name: 'core',
      devDependencies: { typescript: '7.0.2', vitest: 'catalog:' },
    })
    const result = run(fixture.root)
    expect(result.status, result.stderr).toBe(0)
  })
})

test('rejects and synchronizes tool versions, Bun pins and standalone catalog drift', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await fixture.put('editor', {
      name: 'editor-workspace',
      packageManager: 'bun@1.3.14',
      devDependencies: { typescript: '~6.0.3' },
      workspaces: { packages: ['packages/*'], catalog: { vitest: '4.0.0' } },
    })
    const failed = run(fixture.root)
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain('typescript must be 7.0.2')
    expect(failed.stderr).toContain('packageManager must be bun@1.4.2')
    expect(failed.stderr).toContain('catalog vitest must be 5.0.2')
    expect(run(fixture.root, '--write').status).toBe(0)
    expect(run(fixture.root).status).toBe(0)
    const manifest = await fixture.read('editor')
    expect(manifest.devDependencies.typescript).toBe('7.0.2')
    expect(manifest.packageManager).toBe('bun@1.4.2')
    expect(manifest.workspaces.catalog.vitest).toBe('5.0.2')
  })
})

test('rejects formatter drift while allowing family-specific generated-file exclusions', async () => {
  await withWorkspace(async (fixture) => {
    await prepare(fixture)
    await writeFile(
      `${fixture.root}/ghostty-webgpu/.oxfmtrc.json`,
      JSON.stringify({ semi: true, singleQuote: true, ignorePatterns: ['native/**'] }),
    )
    const result = run(fixture.root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('semi must match the root formatter')
  })
})

test('root and standalone terminal install Node types ahead of ancestor packages', async () => {
  const checkout = fileURLToPath(new URL('../', import.meta.url))
  const require = createRequire(join(checkout, 'package.json'))
  const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')

  for (const workspace of ['.', 'ghostty-webgpu']) {
    const manifestPath = join(checkout, workspace, 'package.json')
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
      await writeFile(
        join(project, 'index.ts'),
        "const bytes: Uint8Array = Buffer.from('checkout')",
      )
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
  }
})

test('terminal workspace version agrees with the root lockfile', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../ghostty-webgpu/package.json', import.meta.url), 'utf8'),
  )
  const lockfile = JSON5.parse(await readFile(new URL('../bun.lock', import.meta.url), 'utf8'))
  expect(lockfile.workspaces['ghostty-webgpu'].version).toBe(manifest.version)
})

test('terminal native input closure agrees with its package dependencies', () => {
  const terminal = fileURLToPath(new URL('../ghostty-webgpu/', import.meta.url))
  const verifier = fileURLToPath(
    new URL('../ghostty-webgpu/scripts/verify-config-resolver-artifacts.ts', import.meta.url),
  )
  const result = spawnSync('bun', [verifier, '--state', 'either'], {
    cwd: terminal,
    encoding: 'utf8',
  })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(['bootstrap', 'assembled']).toContain(result.stdout.trim())
})
