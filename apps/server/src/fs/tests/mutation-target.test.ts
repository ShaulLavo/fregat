import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../path'
import { writeTextFile } from '../write'
import { textFileVersion } from '../version'
import {
  lstatOptional,
  resolveMutationTarget,
  statOptional,
  statOptionalVia,
} from '../mutation-target'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('optional stat', () => {
  it('reads a missing path as null', async () => {
    const missing = path.join(await temporaryDirectory(), 'missing')

    expect(await statOptional(missing)).toBeNull()
    expect(await lstatOptional(missing)).toBeNull()
    expect(await statOptionalVia(lstat, missing)).toBeNull()
  })

  it('preserves ENOTDIR for mutations while journal probes treat it as missing', async () => {
    const file = path.join(await temporaryDirectory(), 'file')
    await writeFile(file, '')
    const underFile = path.join(file, 'child')

    await expect(statOptional(underFile)).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(lstatOptional(underFile)).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect(await statOptionalVia(lstat, underFile)).toBeNull()
  })

  it('reports a replaced parent as NOT_A_DIRECTORY when saving with a base version', async () => {
    const root = await temporaryDirectory()
    const parent = path.join(root, 'parent')
    await mkdir(parent)
    await writeFile(path.join(parent, 'child'), 'original')
    const target = await resolveMutationTarget(createWorkspacePaths(root), {
      path: 'parent/child',
      kind: 'content',
    })
    await rm(parent, { recursive: true })
    await writeFile(parent, 'replacement')

    await expect(
      writeTextFile(
        target,
        {
          content: 'changed',
          baseVersion: textFileVersion('original'),
        },
        1024,
      ),
    ).rejects.toMatchObject({ code: 'NOT_A_DIRECTORY' })
  })

  it('still throws when the path exists but cannot be resolved', async () => {
    const loop = path.join(await temporaryDirectory(), 'loop')
    await symlink(loop, loop)

    await expect(statOptional(loop)).rejects.toMatchObject({ code: 'ELOOP' })
    expect((await lstatOptional(loop))?.isSymbolicLink()).toBe(true)
  })
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-mutation-target-'))
  directories.push(directory)
  return directory
}
