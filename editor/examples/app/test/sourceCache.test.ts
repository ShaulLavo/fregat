import { beforeEach, describe, expect, it } from 'vitest'

import type { SourceSnapshot } from '../src/githubSource.ts'
import {
  clearSourceCache,
  loadCachedSourceSnapshot,
  saveSourceSnapshotToCache,
} from '../src/sourceCache.ts'

describe('source cache', () => {
  let opfs: MemoryDirectoryHandle

  beforeEach(() => {
    opfs = new MemoryDirectoryHandle('root')
  })

  it('stores, reads, and clears a source snapshot', async () => {
    await saveSourceSnapshotToCache(snapshot(), opfs)

    await expect(loadCachedSourceSnapshot(opfs)).resolves.toMatchObject({
      repo: 'singapore',
      commitSha: 'commit-sha',
      treeSha: 'tree-sha',
      files: [{ path: 'README.md', text: '# Editor' }],
    })

    await clearSourceCache(opfs)
    await expect(loadCachedSourceSnapshot(opfs)).resolves.toBeNull()
  })

  it('returns null when a cached object is missing', async () => {
    await saveSourceSnapshotToCache(snapshot(), opfs)
    const cacheDir = await opfs.getDirectoryHandle('editor-github-source-cache')
    const objectsDir = await cacheDir.getDirectoryHandle('objects')

    await objectsDir.removeEntry('readme-sha')

    await expect(loadCachedSourceSnapshot(opfs)).resolves.toBeNull()
  })

  it('writes the manifest after source objects', async () => {
    await saveSourceSnapshotToCache(snapshot(), opfs)

    expect(opfs.writeLog.at(-1)).toBe('manifest.json')
  })
})

function snapshot(): SourceSnapshot {
  return {
    owner: 'ShaulLavo',
    repo: 'singapore',
    branch: 'main',
    commitSha: 'commit-sha',
    treeSha: 'tree-sha',
    fetchedAt: 1,
    files: [{ path: 'README.md', sha: 'readme-sha', size: 8, text: '# Editor' }],
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory'
  readonly directories = new Map<string, MemoryDirectoryHandle>()
  readonly files = new Map<string, MemoryFileHandle>()
  readonly writeLog: string[]

  constructor(
    readonly name: string,
    writeLog: string[] = [],
  ) {
    this.writeLog = writeLog
  }

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<MemoryDirectoryHandle> {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('Not found', 'NotFoundError')

    const directory = new MemoryDirectoryHandle(name, this.writeLog)
    this.directories.set(name, directory)
    return directory
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<MemoryFileHandle> {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('Not found', 'NotFoundError')

    const file = new MemoryFileHandle(name, this.writeLog)
    this.files.set(name, file)
    return file
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    if (this.files.delete(name)) return
    if (this.directories.delete(name)) return
    if (options?.recursive) return
    throw new DOMException('Not found', 'NotFoundError')
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === this
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    if (possibleDescendant === this) return []

    for (const [name, directory] of this.directories) {
      const childPath = await directory.resolve(possibleDescendant)
      if (childPath) return [name, ...childPath]
    }

    for (const [name, file] of this.files) {
      if (await file.isSameEntry(possibleDescendant)) return [name]
    }

    return null
  }
}

class MemoryFileHandle {
  readonly kind = 'file'
  text = ''

  constructor(
    readonly name: string,
    private readonly writeLog: string[],
  ) {}

  async getFile(): Promise<File> {
    return new File([this.text], this.name)
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === this
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let nextText = ''

    return {
      write: async (data: BufferSource | Blob | string) => {
        nextText = String(data)
      },
      close: async () => {
        this.text = nextText
        this.writeLog.push(this.name)
      },
    } as FileSystemWritableFileStream
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    throw new DOMException('Not supported', 'NotSupportedError')
  }
}
