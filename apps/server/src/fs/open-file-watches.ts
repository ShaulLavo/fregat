import { watch, type FSWatcher } from 'node:fs'
import { lstat, readlink } from 'node:fs/promises'
import path from 'node:path'

import { FsError } from './errors'
import { isIgnoredPath, isOutsideRoot, resolveExistingPath, type WorkspacePaths } from './path'

type Release = () => void
type PathChanged = (error?: unknown) => void
type DirectoryWatch = {
  readonly watcher: FSWatcher
  readonly files: Map<string, Set<PathChanged>>
}
type OpenFileWatch = {
  readonly alias: string
  releases: Release[]
  pending: boolean
  notify: boolean
  refreshing: Promise<void> | null
}

export class OpenFileWatches {
  private readonly directories = new Map<string, DirectoryWatch>()
  private readonly files = new Set<OpenFileWatch>()
  private readonly paths: WorkspacePaths
  private readonly changed: (alias: string) => void
  private readonly failed: (error: unknown, alias: string) => void
  private closed = false

  constructor(
    paths: WorkspacePaths,
    changed: (alias: string) => void,
    failed: (error: unknown, alias: string) => void,
  ) {
    this.paths = paths
    this.changed = changed
    this.failed = failed
  }

  async retain(alias: string, roots: readonly string[]): Promise<Release> {
    if (this.closed || this.paths.isInternalPath(alias)) return () => {}
    const target = await this.resolveFile(alias)
    if (this.closed || (target && this.coveredByProject(alias, target, roots))) return () => {}

    const file: OpenFileWatch = {
      alias,
      releases: [],
      pending: false,
      notify: false,
      refreshing: null,
    }
    this.files.add(file)
    await this.refresh(file, false)
    return () => this.releaseFile(file)
  }

  close() {
    this.closed = true
    for (const file of this.files) this.releaseFile(file)
  }

  get size() {
    return this.directories.size
  }

  private async resolveFile(alias: string) {
    try {
      return (await resolveExistingPath(this.paths, alias)).absolutePath
    } catch (error) {
      if (!isMissingPath(error)) throw error
      return null
    }
  }

  private coveredByProject(alias: string, target: string, roots: readonly string[]) {
    if (isIgnoredPath(alias)) return false
    if (path.resolve(this.paths.workspaceRootReal, alias) !== target) return false
    const requested = this.paths.resolve(alias).absolutePath
    for (const root of roots) {
      const relative = path.relative(this.paths.resolve(root).absolutePath, requested)
      if (isOutsideRoot(relative)) continue
      return true
    }
    return false
  }

  private refresh(file: OpenFileWatch, notify = true): Promise<void> {
    file.pending = true
    file.notify ||= notify
    if (file.refreshing) return file.refreshing
    file.refreshing = this.refreshUntilSettled(file).finally(() => {
      file.refreshing = null
    })
    return file.refreshing
  }

  private async refreshUntilSettled(file: OpenFileWatch) {
    while (this.files.has(file) && file.pending) {
      file.pending = false
      await this.rebuild(file)
    }
  }

  private async rebuild(file: OpenFileWatch) {
    const releases: Release[] = []
    try {
      await this.followPath(file, releases)
    } catch (error) {
      if (!isMissingPath(error)) this.failed(error, file.alias)
    }
    const previous = file.releases
    file.releases = releases
    for (const release of previous) release()
    if (!this.files.has(file)) return this.releaseFile(file)
    if (!file.notify || file.pending) return
    file.notify = false
    this.changed(file.alias)
  }

  private async followPath(file: OpenFileWatch, releases: Release[]) {
    const root = this.paths.workspaceRootReal
    const changed: PathChanged = (error) => {
      if (error) this.failed(error, file.alias)
      void this.refresh(file)
    }
    let directory = root
    let remaining = path
      .relative(this.paths.workspaceRoot, this.paths.resolve(file.alias).absolutePath)
      .split(path.sep)
    let links = 0
    while (remaining.length > 0 && this.files.has(file)) {
      const name = remaining.shift()
      if (!name) continue
      const candidate = path.join(directory, name)
      // Attach before reading each component so replacement during resolution triggers another pass.
      releases.push(this.retainDirectory(directory, name, changed))
      const entry = await lstat(candidate)
      if (!entry.isSymbolicLink()) {
        directory = candidate
        continue
      }
      if (++links > 40) throw new FsError('INVALID_PATH')
      const target = path.resolve(directory, await readlink(candidate))
      this.paths.assertRealInside(target)
      remaining = [...path.relative(root, target).split(path.sep), ...remaining]
      directory = root
    }
  }

  private retainDirectory(directory: string, name: string, changed: PathChanged): Release {
    let entry = this.directories.get(directory)
    if (!entry) {
      const files = new Map<string, Set<PathChanged>>()
      const watcher = watch(directory, (event, filename) =>
        this.directoryChanged(directory, files, event, filename),
      )
      watcher.on('error', (error) => this.directoryFailed(directory, files, error))
      entry = { watcher, files }
      this.directories.set(directory, entry)
    }
    const callbacks = entry.files.get(name) ?? new Set<PathChanged>()
    callbacks.add(changed)
    entry.files.set(name, callbacks)
    const retained = entry
    return () => {
      callbacks.delete(changed)
      if (callbacks.size === 0) retained.files.delete(name)
      if (retained.files.size > 0) return
      retained.watcher.close()
      if (this.directories.get(directory) === retained) this.directories.delete(directory)
    }
  }

  private directoryChanged(
    directory: string,
    files: DirectoryWatch['files'],
    event: string,
    filename: string | Buffer | null,
  ) {
    const name = filename?.toString()
    if (event === 'rename')
      this.invalidateDirectories(name ? path.join(directory, name) : directory)
    // Rebuilding can add listeners synchronously; dispatch only the original snapshot.
    const callbacks = name
      ? [...(files.get(name) ?? [])]
      : [...files.values()].flatMap((callbacks) => [...callbacks])
    for (const callback of callbacks) callback()
  }

  private directoryFailed(directory: string, files: DirectoryWatch['files'], error: unknown) {
    this.invalidateDirectories(directory)
    const callbacks = [...files.values()].flatMap((callbacks) => [...callbacks])
    for (const callback of callbacks) callback(error)
  }

  private invalidateDirectories(changed: string) {
    for (const [directory, entry] of this.directories) {
      if (directory !== changed && !directory.startsWith(`${changed}${path.sep}`)) continue
      entry.watcher.close()
      this.directories.delete(directory)
    }
  }

  private releaseFile(file: OpenFileWatch) {
    this.files.delete(file)
    for (const release of file.releases) release()
    file.releases = []
  }
}

function isMissingPath(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}
