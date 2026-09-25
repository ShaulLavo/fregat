import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@workspace/utils/objects'

import { createInternalError } from '../../src/observability/structured-errors'

export async function installedTypeScriptRuntimeFixture(
  packageName: string,
  files: Readonly<Record<string, string>>,
) {
  const packagePath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`))
  const metadata: unknown = JSON.parse(await readFile(packagePath, 'utf8'))
  if (!isRecord(metadata) || typeof metadata.version !== 'string') {
    throw createInternalError('TypeScript fixture package has no version')
  }

  const fixture = await typescriptRuntimeFixture(files)
  try {
    await mkdir(path.join(fixture.root, 'node_modules'), { recursive: true })
    await symlink(
      path.dirname(packagePath),
      path.join(fixture.root, 'node_modules/typescript'),
      'dir',
    )
    return { ...fixture, version: metadata.version }
  } catch (cause) {
    await fixture.dispose()
    throw cause
  }
}

export async function typescriptRuntimeFixture(files: Readonly<Record<string, string>> = {}) {
  const root = await watchableTempDirectory('platform-typescript-runtime-')
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, contents)
  }
  return { root, dispose: () => rm(path.dirname(root), { recursive: true, force: true }) }
}

/**
 * TypeScript refuses to watch a directory within two levels of the filesystem root, so a project
 * at `/tmp/x` never sees a file appear. One level deeper, as real checkouts are.
 */
export async function watchableTempDirectory(prefix: string) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  const directory = path.join(parent, 'project')
  await mkdir(directory)
  return directory
}

export function runtimePackageFiles({
  kind,
  version,
  directory = 'node_modules/typescript',
}: {
  readonly kind: 'legacy' | 'native' | 'preview'
  readonly version: string
  readonly directory?: string
}): Readonly<Record<string, string>> {
  const command = kind === 'preview' ? 'tsgo' : 'tsc'
  const entrypoint = kind === 'legacy' ? 'lib/tsserver.js' : `bin/${command}`
  const name = kind === 'preview' ? '@typescript/native-preview' : 'typescript'
  return {
    [`${directory}/package.json`]: JSON.stringify({
      name,
      version,
      bin: { [command]: `./bin/${command}` },
    }),
    [`${directory}/${entrypoint}`]: '',
  }
}
