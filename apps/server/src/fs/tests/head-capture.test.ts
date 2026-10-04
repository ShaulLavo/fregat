import {
  mkdtemp,
  open,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../path'
import { readTextHead, readTextFile, type TextHeadFileSystem } from '../read'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('captured text head', () => {
  it('preserves the existing short-file content control', async () => {
    const { paths } = await fixture('export {}\n')
    expect(await readTextHead(paths, 'source.txt', 64)).toMatchObject({
      path: 'source.txt',
      content: 'export {}\n',
      size: 10,
      truncated: false,
    })
  })

  it('captures full bytes with the same content version as a full read', async () => {
    const { paths, file } = await fixture('é\r\n😀\n')
    const full = await readTextFile(paths, 'source.txt', 64)
    const facts = await stat(file, { bigint: true })
    const head = await readTextHead(paths, 'source.txt', 64)
    expect(head).toMatchObject({
      content: full.content,
      truncated: false,
      capture: {
        device: String(facts.dev),
        inode: String(facts.ino),
        mtimeNs: String(facts.mtimeNs),
        ctimeNs: String(facts.ctimeNs),
      },
      coverage: {
        kind: 'complete',
        version: full.version,
        bytesRead: 9,
        decodedBytes: 9,
        utf16Length: 6,
        encoding: 'utf8',
        lossy: false,
        lineTrimmed: false,
      },
    })
  })

  it.each([
    {
      text: 'abcd',
      budget: 4,
      content: 'abcd',
      size: 4,
      bytesRead: 4,
      decodedBytes: 4,
      kind: 'complete',
      lossy: false,
      lineTrimmed: false,
      truncated: false,
    },
    {
      text: '',
      budget: 4,
      content: '',
      size: 0,
      bytesRead: 0,
      decodedBytes: 0,
      kind: 'complete',
      lossy: false,
      lineTrimmed: false,
      truncated: false,
    },
    {
      text: 'ééé\nsecond line\nthird\n',
      budget: 12,
      content: 'ééé\n',
      size: 25,
      bytesRead: 12,
      decodedBytes: 7,
      kind: 'partial',
      lossy: false,
      lineTrimmed: true,
      truncated: true,
    },
    {
      text: 'a\r\nsecond\r\n',
      budget: 7,
      content: 'a\r\n',
      size: 11,
      bytesRead: 7,
      decodedBytes: 3,
      kind: 'partial',
      lossy: false,
      lineTrimmed: true,
      truncated: true,
    },
    {
      text: 'abc\nrest',
      budget: 4,
      content: 'abc\n',
      size: 8,
      bytesRead: 4,
      decodedBytes: 4,
      kind: 'partial',
      lossy: false,
      lineTrimmed: false,
      truncated: true,
    },
    {
      text: '😀x',
      budget: 2,
      content: '�',
      size: 5,
      bytesRead: 2,
      decodedBytes: 2,
      kind: 'partial',
      lossy: true,
      lineTrimmed: false,
      truncated: true,
    },
    {
      text: 'abc\n😀x',
      budget: 6,
      content: 'abc\n',
      size: 9,
      bytesRead: 6,
      decodedBytes: 4,
      kind: 'partial',
      lossy: false,
      lineTrimmed: true,
      truncated: true,
    },
  ])('reports byte and decoded coverage for $text with budget $budget', async (sample) => {
    const { paths } = await fixture(sample.text)
    const head = await readTextHead(paths, 'source.txt', sample.budget)
    expect(head).toMatchObject({
      content: sample.content,
      size: sample.size,
      truncated: sample.truncated,
      coverage: {
        kind: sample.kind,
        bytesRead: sample.bytesRead,
        decodedBytes: sample.decodedBytes,
        utf16Length: sample.content.length,
        encoding: 'utf8',
        lossy: sample.lossy,
        lineTrimmed: sample.lineTrimmed,
      },
    })
    if (sample.kind !== 'complete') expect(head.coverage).not.toHaveProperty('version')
  })

  it('keeps invalid UTF-8 readable while refusing complete text coverage', async () => {
    const { paths } = await fixture(new Uint8Array([0x61, 0xff, 0x62]))
    expect(await readTextHead(paths, 'source.txt', 64)).toMatchObject({
      content: 'a�b',
      size: 3,
      truncated: false,
      coverage: {
        kind: 'lossy',
        bytesRead: 3,
        decodedBytes: 3,
        utf16Length: 3,
        encoding: 'utf8',
        lossy: true,
      },
    })
  })

  it('keeps transcoding explicit', async () => {
    const { paths } = await fixture(new Uint8Array([0xff, 0xfe, 0x61, 0, 0x0a, 0]))
    expect(await readTextHead(paths, 'source.txt', 64)).toMatchObject({
      content: '\uFEFFa\n',
      size: 6,
      truncated: false,
      coverage: {
        kind: 'lossy',
        bytesRead: 6,
        decodedBytes: 6,
        utf16Length: 3,
        encoding: 'utf16le',
        lossy: true,
      },
    })
  })

  it('preserves binary refusal', async () => {
    const { paths } = await fixture(new Uint8Array([0, 1, 2, 0, 255, 0, 0, 7]))
    await expect(readTextHead(paths, 'source.txt', 64)).rejects.toMatchObject({
      code: 'FILE_IS_BINARY',
    })
  })

  it('bounds allocation and reads for a sparse file', async () => {
    const { paths, file } = await fixture('first\n')
    await truncate(file, 2 ** 31)
    const reads: number[] = []
    const fs = fileSystem({ observeRead: (buffer) => reads.push(buffer.byteLength) })
    const head = await readTextHead(paths, 'source.txt', 6, fs)
    expect(head).toMatchObject({
      content: 'first\n',
      size: 2 ** 31,
      truncated: true,
      coverage: { kind: 'partial', bytesRead: 6, decodedBytes: 6 },
    })
    expect(reads).toEqual([6])
    expect(head.coverage).not.toHaveProperty('version')
  })

  it('fills short reads before claiming complete coverage', async () => {
    const { paths } = await fixture('abcdef')
    const reads: number[] = []
    const fs = fileSystem({
      readLimit: 2,
      observeRead: (_buffer, position) => reads.push(position),
    })
    expect(await readTextHead(paths, 'source.txt', 64, fs)).toMatchObject({
      content: 'abcdef',
      truncated: false,
      coverage: { kind: 'complete', bytesRead: 6, decodedBytes: 6 },
    })
    expect(reads).toEqual([0, 2, 4])
  })

  it('keeps captured source facts independent of the preview budget', async () => {
    const { paths } = await fixture('first\nsecond\n')
    const partial = await readTextHead(paths, 'source.txt', 6)
    const complete = await readTextHead(paths, 'source.txt', 64)
    expect(partial.capture).toEqual(complete.capture)
    expect(partial.coverage.kind).toBe('partial')
    expect(partial.coverage).not.toHaveProperty('version')
    expect(complete.coverage.kind).toBe('complete')
  })

  it('refuses a replacement between opening and the first read', async () => {
    const { paths, file, root } = await fixture('before\n')
    const replacement = path.join(root, 'replacement.txt')
    await writeFile(replacement, 'after!\n')
    const reads: number[] = []
    const fs = fileSystem({
      afterOpen: () => rename(replacement, file),
      observeRead: (buffer) => reads.push(buffer.length),
    })
    await expect(readTextHead(paths, 'source.txt', 64, fs)).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    })
    expect(reads).toEqual([])
  })

  it('refuses unexpected EOF even when metadata remains unchanged', async () => {
    const { paths } = await fixture('abcdef')
    await expect(
      readTextHead(paths, 'source.txt', 64, fileSystem({ readLimit: 0 })),
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' })
  })

  it.each(['rewrite', 'truncate', 'replace', 'remove'] as const)(
    'refuses a concurrent %s',
    async (change) => {
      const { paths, file, root } = await fixture('before\n')
      const replacement = path.join(root, 'replacement.txt')
      await writeFile(replacement, 'after!\n')
      let closed = false
      const fs = fileSystem({
        afterRead: async () => {
          if (change === 'rewrite') await writeFile(file, 'after!\n')
          if (change === 'truncate') await truncate(file, 1)
          if (change === 'replace') await rename(replacement, file)
          if (change === 'remove') await unlink(file)
        },
        afterClose: () => {
          closed = true
        },
      })
      await expect(readTextHead(paths, 'source.txt', 64, fs)).rejects.toMatchObject({
        code: 'FILE_CHANGED',
      })
      expect(closed).toBe(true)
    },
  )

  it('refuses a symlink retarget during capture', async () => {
    const { paths, file, root } = await fixture('before\n')
    const link = path.join(root, 'link.txt')
    const other = path.join(root, 'other.txt')
    await writeFile(other, 'after!\n')
    await symlink(file, link)
    const fs = fileSystem({
      afterRead: async () => {
        await unlink(link)
        await symlink(other, link)
      },
    })
    await expect(readTextHead(paths, 'link.txt', 64, fs)).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    })
  })

  it('checks the named symlink after canonical resolution', async () => {
    const { paths, file, root } = await fixture('before\n')
    const link = path.join(root, 'link.txt')
    const other = path.join(root, 'other.txt')
    await writeFile(other, 'after!\n')
    await symlink(file, link)
    expect(await readTextHead(paths, 'link.txt', 64)).toMatchObject({
      content: 'before\n',
      coverage: { kind: 'complete' },
    })
    let namedChecks = 0
    const fs: TextHeadFileSystem = {
      ...fileSystem({}),
      stat: async (absolutePath) => {
        namedChecks += 1
        if (namedChecks === 2) {
          await unlink(link)
          await symlink(other, link)
        }
        return stat(absolutePath, { bigint: true })
      },
    }
    await expect(readTextHead(paths, 'link.txt', 64, fs)).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    })
  })
})

async function fixture(content: string | Uint8Array) {
  const root = await mkdtemp(path.join(tmpdir(), 'fs-head-capture-'))
  roots.push(root)
  const file = path.join(root, 'source.txt')
  await writeFile(file, content)
  return { root, file, paths: createWorkspacePaths(root) }
}

function fileSystem(options: {
  readLimit?: number
  observeRead?: (buffer: Uint8Array, position: number) => void
  afterRead?: () => Promise<void>
  afterOpen?: () => Promise<void>
  afterClose?: () => void
}): TextHeadFileSystem {
  return {
    stat: (file) => stat(file, { bigint: true }),
    open: async (file) => {
      const handle = await open(file, 'r')
      await options.afterOpen?.()
      return {
        stat: () => handle.stat({ bigint: true }),
        read: async (buffer, offset, length, position) => {
          options.observeRead?.(buffer, position)
          const read = await handle.read(
            buffer,
            offset,
            Math.min(options.readLimit ?? length, length),
            position,
          )
          await options.afterRead?.()
          return read
        },
        close: async () => {
          await handle.close()
          options.afterClose?.()
        },
      }
    },
  }
}
