import { lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { lstatOptional, statOptional, statOptionalVia } from '../mutation-target'

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

  it('reads a path under a file (ENOTDIR) as missing', async () => {
    const file = path.join(await temporaryDirectory(), 'file')
    await writeFile(file, '')
    const underFile = path.join(file, 'child')

    expect(await statOptional(underFile)).toBeNull()
    expect(await lstatOptional(underFile)).toBeNull()
    expect(await statOptionalVia(lstat, underFile)).toBeNull()
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
