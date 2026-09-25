import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  atomicTemporaryPath,
  commitAtomicWrite,
  stageAtomicWrite,
  writeFileAtomic,
  writeFileAtomicSync,
  type AtomicWriteDriver,
  type AtomicWriteDurability,
} from '../atomic-write'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('atomic write', () => {
  it.each([
    ['rename', []],
    ['fsync-file', ['temporary']],
    ['fsync-all', ['temporary', 'directory']],
  ] as const)('%s flushes %j', async (durability, flushed) => {
    const target = path.join(await temporaryDirectory(), 'file.json')
    const { driver, synced } = recordingDriver(target)

    await writeFileAtomic(target, 'next', { driver, durability })

    expect(synced).toEqual(flushed)
    expect(await readFile(target, 'utf8')).toBe('next')
    expect(await readdir(path.dirname(target))).toEqual(['file.json'])
  })

  it.each(['rename', 'fsync-file', 'fsync-all'] as const)(
    'writes synchronously at %s',
    async (durability: AtomicWriteDurability) => {
      const target = path.join(await temporaryDirectory(), 'file.json')
      await writeFile(target, 'previous')

      writeFileAtomicSync(target, 'next', { durability })

      expect(await readFile(target, 'utf8')).toBe('next')
      expect(await readdir(path.dirname(target))).toEqual(['file.json'])
    },
  )

  // A umask of 022 or 002 would drop write bits from 0o666 without the chmod.
  it('applies the requested mode exactly', async () => {
    const directory = await temporaryDirectory()
    const asyncTarget = path.join(directory, 'async')
    const syncTarget = path.join(directory, 'sync')

    await writeFileAtomic(asyncTarget, 'x', { durability: 'rename', mode: 0o666 })
    writeFileAtomicSync(syncTarget, 'x', { durability: 'rename', mode: 0o666 })

    expect((await stat(asyncTarget)).mode & 0o777).toBe(0o666)
    expect((await stat(syncTarget)).mode & 0o777).toBe(0o666)
  })

  it('removes the temporary file and throws the raw error when the rename fails', async () => {
    const directory = await temporaryDirectory()
    const target = path.join(directory, 'occupied')
    await mkdir(target)

    await expect(
      writeFileAtomic(target, 'next', { durability: 'fsync-all' }),
    ).rejects.toMatchObject({ code: 'EISDIR' })
    expect(() => writeFileAtomicSync(target, 'next', { durability: 'fsync-all' })).toThrow(
      expect.objectContaining({ code: 'EISDIR' }),
    )
    expect(await readdir(directory)).toEqual(['occupied'])
  })

  it.each(['stage', 'write'] as const)(
    '%s preserves a staging path it did not create',
    async (kind) => {
      const target = path.join(await temporaryDirectory(), 'file.json')
      const temporary = atomicTemporaryPath(target)
      await writeFile(target, 'previous target')
      await writeFile(temporary, 'another pending write')

      const pending =
        kind === 'stage'
          ? stageAtomicWrite(temporary, 'next', { durability: 'fsync-all' })
          : writeFileAtomic(target, 'next', { durability: 'fsync-all', temporary })
      await expect(pending).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(temporary, 'utf8')).toBe('another pending write')
      expect(await readFile(target, 'utf8')).toBe('previous target')
    },
  )

  it('removes its partial staging file when writing fails', async () => {
    const target = path.join(await temporaryDirectory(), 'file.json')
    const temporary = atomicTemporaryPath(target)
    const failure = Object.assign(new Error('Fixture disk failure'), { code: 'EIO' })
    const { driver } = recordingDriver(target)
    driver.writeFile = async (file, _data, options) => {
      await writeFile(file, 'partial bytes', options)
      throw failure
    }

    await expect(
      stageAtomicWrite(temporary, 'next', { driver, durability: 'fsync-all' }),
    ).rejects.toBe(failure)
    expect(await readdir(path.dirname(target))).toEqual([])
  })

  it('leaves the target untouched between stage and commit', async () => {
    const target = path.join(await temporaryDirectory(), 'file.json')
    await writeFile(target, 'previous')
    const temporary = atomicTemporaryPath(target)

    await stageAtomicWrite(temporary, 'next', { durability: 'fsync-all' })
    expect(await readFile(target, 'utf8')).toBe('previous')

    await commitAtomicWrite(temporary, target, { durability: 'fsync-all' })
    expect(await readFile(target, 'utf8')).toBe('next')
    expect(await readdir(path.dirname(target))).toEqual(['file.json'])
  })
})

function recordingDriver(target: string) {
  const synced: string[] = []
  const driver: AtomicWriteDriver = {
    chmod,
    async open(openedPath, flags) {
      synced.push(openedPath === path.dirname(target) ? 'directory' : 'temporary')
      return open(openedPath, flags)
    },
    rename,
    rm,
    writeFile,
  }
  return { driver, synced }
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-atomic-write-'))
  directories.push(directory)
  return directory
}
