import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  missingReleaseFiles,
  REMOTE_SUPPORT,
  RUNTIME_PACKAGES,
  runtimeManifest,
  writeRuntimeManifest,
} from '../release-files'

const serverPackage = path.resolve(import.meta.dirname, '../../..')
const repositoryRoot = path.resolve(serverPackage, '../..')

async function buildScript() {
  const manifest = JSON.parse(await readFile(path.join(serverPackage, 'package.json'), 'utf8'))
  return manifest.scripts.build as string
}

function fixtureLock(packages: Record<string, string>) {
  const entries = Object.entries(packages).map(
    ([key, spec]) => `    ${JSON.stringify(key)}: [${JSON.stringify(spec)}, "", {}, "sha512-x"],`,
  )
  return `{\n  "lockfileVersion": 1,\n  "packages": {\n${entries.join('\n')}\n  },\n}\n`
}

test('the runtime packages cover every --external of the server build', async () => {
  const externals = [...(await buildScript()).matchAll(/--external (\S+)/g)].map(
    (match) => match[1],
  )
  expect(externals.length).toBeGreaterThan(0)
  for (const external of externals) expect(RUNTIME_PACKAGES).toContain(external)
})

test('the runtime packages cover every package the server resolves beside its bundle', async () => {
  const glob = new Bun.Glob('src/**/*.ts')
  const resolved = new Set<string>()
  for await (const file of glob.scan({ cwd: serverPackage })) {
    if (file.includes('/tests/')) continue
    const source = await readFile(path.join(serverPackage, file), 'utf8')
    for (const match of source.matchAll(/import\.meta\.resolve\('((?:@[^/']+\/)?[^/']+)/g))
      resolved.add(match[1]!)
  }
  expect(resolved.size).toBeGreaterThan(0)
  for (const name of resolved) expect(RUNTIME_PACKAGES).toContain(name)
})

test('the server build writes the remote support bundle from its entry', async () => {
  expect(await buildScript()).toContain(
    `bun build src/installation/remote-support.ts --target bun --outfile dist/${REMOTE_SUPPORT}`,
  )
})

test('manifest versions come from bun.lock, with the server workspace resolution first', () => {
  const lock = fixtureLock({
    sharp: 'sharp@0.1.0',
    'server/sharp': 'sharp@0.2.0',
    '@anthropic-ai/claude-agent-sdk': '@anthropic-ai/claude-agent-sdk@1.2.3',
    typescript: 'typescript@7.0.0',
    'site/typescript': 'typescript@5.0.0',
    'typescript-language-server': 'typescript-language-server@6.0.0',
  })
  expect(JSON.parse(runtimeManifest(lock))).toEqual({
    name: 'platform-server-runtime',
    private: true,
    dependencies: {
      sharp: '0.2.0',
      '@anthropic-ai/claude-agent-sdk': '1.2.3',
      typescript: '7.0.0',
      'typescript-language-server': '6.0.0',
    },
  })
})

test('the real bun.lock pins every runtime package to an exact version', async () => {
  const manifest = JSON.parse(
    runtimeManifest(await readFile(path.join(repositoryRoot, 'bun.lock'), 'utf8')),
  )
  expect(Object.keys(manifest.dependencies)).toEqual([...RUNTIME_PACKAGES])
  for (const version of Object.values(manifest.dependencies))
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
})

test('a runtime package missing from bun.lock fails the manifest', () => {
  const lock = fixtureLock({ sharp: 'sharp@0.2.0', typescript: 'typescript@7.0.0' })
  expect(() => runtimeManifest(lock)).toThrow(
    expect.objectContaining({
      code: 'installation.RUNTIME_PACKAGE_MISSING',
      message:
        'bun.lock resolves no version for the server runtime packages @anthropic-ai/claude-agent-sdk, typescript-language-server.',
    }),
  )
})

test('a built server directory reports the release files it lacks', async () => {
  const server = await mkdtemp(path.join(tmpdir(), 'platform-release-files-'))
  try {
    expect(await missingReleaseFiles(server)).toEqual(['runtime/package.json', REMOTE_SUPPORT])
    const lockfile = path.join(server, 'bun.lock')
    await writeFile(
      lockfile,
      fixtureLock(Object.fromEntries(RUNTIME_PACKAGES.map((name) => [name, `${name}@1.0.0`]))),
    )
    await writeRuntimeManifest(server, lockfile)
    await writeFile(path.join(server, REMOTE_SUPPORT), '')
    expect(await missingReleaseFiles(server)).toEqual([])
  } finally {
    await rm(server, { force: true, recursive: true })
  }
})
