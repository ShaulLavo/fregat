import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { RUNTIME_PACKAGES } from '../../apps/server/src/installation/release-files'
import { runtimePackageFiles } from './runtime'

test('resolves Web Push in its owning workspace and follows its runtime dependencies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-notices-'))
  try {
    const server = path.join(root, 'apps/server')
    const push = path.join(root, 'packages/push')
    await mkdir(server, { recursive: true })
    await mkdir(push, { recursive: true })
    const dependencies = Object.fromEntries(
      RUNTIME_PACKAGES.filter((name) => name !== 'web-push').map((name) => [name, '1.0.0']),
    )
    await writeFile(path.join(server, 'package.json'), JSON.stringify({ dependencies }))
    await writeFile(
      path.join(push, 'package.json'),
      JSON.stringify({ dependencies: { 'web-push': '3.6.7' } }),
    )
    const expected = []
    for (const name of RUNTIME_PACKAGES) {
      const owner = name === 'web-push' ? push : server
      const directory = path.join(owner, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      const manifest = path.join(directory, 'package.json')
      await writeFile(
        manifest,
        JSON.stringify({ name, dependencies: name === 'web-push' ? { http_ece: '1.2.0' } : {} }),
      )
      expected.push(manifest)
    }
    const child = path.join(push, 'node_modules/http_ece')
    await mkdir(child, { recursive: true })
    await writeFile(path.join(child, 'package.json'), JSON.stringify({ name: 'http_ece' }))
    expected.push(path.join(child, 'package.json'))
    expect(runtimePackageFiles(root).sort()).toEqual(expected.sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
