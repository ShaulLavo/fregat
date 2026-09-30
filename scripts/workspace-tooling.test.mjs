import { expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
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
