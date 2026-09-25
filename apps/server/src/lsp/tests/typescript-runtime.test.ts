import { mkdir, realpath, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  runtimePackageFiles,
  typescriptRuntimeFixture,
} from '../../../test/factories/typescript-runtime'
import { resolveTypeScriptRuntime } from '../typescript/runtime'

const fixtures: Awaited<ReturnType<typeof typescriptRuntimeFixture>>[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
})

describe('workspace TypeScript runtime selection', () => {
  it.each(['2.9.2', '3.9.10', '4.9.5', '5.9.3', '6.0.3'])(
    'uses the workspace tsserver for TypeScript %s',
    async (version) => {
      const fixture = await typescriptRuntimeFixture(
        runtimePackageFiles({ kind: 'legacy', version }),
      )
      fixtures.push(fixture)

      await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toEqual({
        kind: 'legacy',
        version,
        entrypoint: path.join(fixture.root, 'node_modules/typescript/lib/tsserver.js'),
      })
    },
  )

  it('uses the native launcher for workspace TypeScript 7', async () => {
    const fixture = await typescriptRuntimeFixture(
      runtimePackageFiles({ kind: 'native', version: '7.0.2' }),
    )
    fixtures.push(fixture)

    await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toEqual({
      kind: 'native',
      version: '7.0.2',
      entrypoint: path.join(fixture.root, 'node_modules/typescript/bin/tsc'),
    })
  })

  it('finds a TypeScript version hoisted above a nested package', async () => {
    const fixture = await typescriptRuntimeFixture({
      ...runtimePackageFiles({ kind: 'legacy', version: '5.9.3' }),
      'packages/app/package.json': '{}',
    })
    fixtures.push(fixture)

    await expect(
      resolveTypeScriptRuntime(path.join(fixture.root, 'packages/app')),
    ).resolves.toMatchObject({
      kind: 'legacy',
      version: '5.9.3',
      entrypoint: path.join(fixture.root, 'node_modules/typescript/lib/tsserver.js'),
    })
  })

  it('skips a node_modules candidate that is a file', async () => {
    const fixture = await typescriptRuntimeFixture({
      ...runtimePackageFiles({ kind: 'legacy', version: '5.9.3' }),
      'packages/app/package.json': '{}',
      'packages/app/node_modules': '',
    })
    fixtures.push(fixture)

    await expect(
      resolveTypeScriptRuntime(path.join(fixture.root, 'packages/app')),
    ).resolves.toMatchObject({ kind: 'legacy', version: '5.9.3' })
  })

  it('prefers a nested package version over the hoisted version', async () => {
    const fixture = await typescriptRuntimeFixture({
      ...runtimePackageFiles({ kind: 'native', version: '7.0.2' }),
      ...runtimePackageFiles({
        kind: 'legacy',
        version: '4.9.5',
        directory: 'packages/app/node_modules/typescript',
      }),
    })
    fixtures.push(fixture)

    await expect(
      resolveTypeScriptRuntime(path.join(fixture.root, 'packages/app')),
    ).resolves.toMatchObject({
      kind: 'legacy',
      version: '4.9.5',
      entrypoint: path.join(fixture.root, 'packages/app/node_modules/typescript/lib/tsserver.js'),
    })
  })

  it('follows a package-manager symlink to the installed version', async () => {
    const fixture = await typescriptRuntimeFixture(
      runtimePackageFiles({ kind: 'native', version: '7.0.2', directory: 'store/typescript' }),
    )
    fixtures.push(fixture)
    await mkdir(path.join(fixture.root, 'node_modules'))
    await symlink('../store/typescript', path.join(fixture.root, 'node_modules/typescript'), 'dir')

    await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toMatchObject({
      kind: 'native',
      version: '7.0.2',
      entrypoint: await realpath(path.join(fixture.root, 'store/typescript/bin/tsc')),
    })
  })

  it('uses an installed native preview when no typescript package exists', async () => {
    const fixture = await typescriptRuntimeFixture(
      runtimePackageFiles({
        kind: 'preview',
        version: '7.0.0-dev.20260707.2',
        directory: 'node_modules/@typescript/native-preview',
      }),
    )
    fixtures.push(fixture)

    await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toEqual({
      kind: 'native',
      version: '7.0.0-dev.20260707.2',
      entrypoint: path.join(fixture.root, 'node_modules/@typescript/native-preview/bin/tsgo'),
    })
  })

  it('honors an installed legacy TypeScript even when native preview is also installed', async () => {
    const fixture = await typescriptRuntimeFixture({
      ...runtimePackageFiles({ kind: 'legacy', version: '6.0.3' }),
      ...runtimePackageFiles({
        kind: 'preview',
        version: '7.0.0-dev.20260707.2',
        directory: 'node_modules/@typescript/native-preview',
      }),
    })
    fixtures.push(fixture)

    await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toMatchObject({
      kind: 'legacy',
      version: '6.0.3',
    })
  })

  it('uses the server-owned TypeScript for a workspace without an installation', async () => {
    const fixture = await typescriptRuntimeFixture()
    fixtures.push(fixture)
    const fallback = fileURLToPath(import.meta.resolve('typescript/package.json'))

    await expect(resolveTypeScriptRuntime(fixture.root)).resolves.toMatchObject({
      kind: 'native',
      entrypoint: path.join(path.dirname(fallback), 'bin/tsc'),
    })
  })

  it.each([
    ['malformed JSON', '{'],
    ['an invalid version', '{"version":7}'],
    ['a missing legacy entrypoint', '{"version":"5.9.3"}'],
    ['a missing native entrypoint', '{"version":"7.0.2","bin":{"tsc":"bin/tsc"}}'],
  ])('reports %s instead of substituting another TypeScript version', async (_label, metadata) => {
    const fixture = await typescriptRuntimeFixture({
      'node_modules/typescript/package.json': metadata,
    })
    fixtures.push(fixture)

    await expect(resolveTypeScriptRuntime(fixture.root)).rejects.toMatchObject({
      code: 'LSP_TYPESCRIPT_RUNTIME_INVALID',
    })
  })

  it('reports an installed package with a missing manifest', async () => {
    const fixture = await typescriptRuntimeFixture({
      'node_modules/typescript/lib/tsserver.js': '',
    })
    fixtures.push(fixture)

    await expect(resolveTypeScriptRuntime(fixture.root)).rejects.toMatchObject({
      code: 'LSP_TYPESCRIPT_RUNTIME_INVALID',
    })
  })

  it('reports a broken nearer package even when an ancestor has a working TypeScript', async () => {
    const fixture = await typescriptRuntimeFixture({
      ...runtimePackageFiles({ kind: 'native', version: '7.0.2' }),
      'packages/app/node_modules/typescript/lib/tsserver.js': '',
    })
    fixtures.push(fixture)

    await expect(
      resolveTypeScriptRuntime(path.join(fixture.root, 'packages/app')),
    ).rejects.toMatchObject({
      code: 'LSP_TYPESCRIPT_RUNTIME_INVALID',
    })
  })

  it('reports a dangling package-manager symlink', async () => {
    const fixture = await typescriptRuntimeFixture()
    fixtures.push(fixture)
    await mkdir(path.join(fixture.root, 'node_modules'))
    await symlink(
      '../missing-typescript',
      path.join(fixture.root, 'node_modules/typescript'),
      'dir',
    )

    await expect(resolveTypeScriptRuntime(fixture.root)).rejects.toMatchObject({
      code: 'LSP_TYPESCRIPT_RUNTIME_INVALID',
    })
  })
})
