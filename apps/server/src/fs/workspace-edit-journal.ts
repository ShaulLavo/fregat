import { syncPath } from './sync-path'
import { randomUUID } from 'node:crypto'
import type { Dirent, Stats } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'
import type {
  WorkspaceEditEventPublication,
  WorkspaceEditRecoveryTarget,
  WorkspaceEditResult,
  WorkspaceEditState,
} from '@workspace/contracts'
import { FsError } from './errors'
import { nodeErrorCode } from '@workspace/contracts'

export const MAX_WORKSPACE_EDIT_OPERATION_BYTES = 128 * 1024 * 1024
export const MAX_WORKSPACE_EDIT_JOURNAL_BYTES = 512 * 1024 * 1024
export const WORKSPACE_EDIT_STABLE_TTL_MS = 24 * 60 * 60 * 1000
export const WORKSPACE_EDIT_STABLE_STATES = new Set<WorkspaceEditState>([
  'finalized',
  'undone',
  'redone',
])

export type WorkspaceEditJournalGuard =
  | {
      readonly exists: false
      readonly path: string
    }
  | {
      readonly dev: number
      readonly exists: true
      readonly ino: number
      readonly mode: number
      readonly mtimeMs: number
      readonly path: string
      readonly size: number
      readonly version: string
    }

export type WorkspaceEditPreparedLeg =
  | {
      readonly afterStage: string
      readonly beforeMode: number
      readonly beforeMtimeMs: number
      readonly beforeStage: string
      readonly index: number
      readonly kind: 'write'
      readonly path: string
    }
  | {
      readonly destinationExists: boolean
      readonly index: number
      readonly kind: 'create'
      readonly noOp: boolean
      readonly overwrite: boolean
      readonly path: string
      readonly reservedPath?: string
    }
  | {
      readonly destinationExists: boolean
      readonly index: number
      readonly kind: 'rename'
      readonly newPath: string
      readonly noOp: boolean
      readonly oldPath: string
      readonly overwrite: boolean
      readonly reservedPath?: string
    }
  | {
      readonly index: number
      readonly kind: 'delete'
      readonly noOp: boolean
      readonly path: string
      readonly reservedPath?: string
    }

export type WorkspaceEditProgramStep =
  | {
      readonly afterStage: string
      readonly beforeMode: number
      readonly beforeMtimeMs: number
      readonly beforeStage: string
      readonly kind: 'write'
      readonly path: string
    }
  | {
      readonly kind: 'move'
      readonly from: string
      readonly to: string
    }
  | {
      readonly kind: 'remove'
      readonly path: string
    }
  | {
      readonly kind: 'create'
      readonly path: string
    }

export type WorkspaceEditIntentPathGuard = {
  readonly dev?: number
  readonly exists: boolean
  readonly ino?: number
  readonly mode?: number
  readonly mtimeMs?: number
  readonly reference: string
  readonly size?: number
  readonly version?: string
}

export type WorkspaceEditJournalRecord =
  | {
      readonly after: readonly WorkspaceEditIntentPathGuard[]
      readonly before: readonly WorkspaceEditIntentPathGuard[]
      readonly direction: 'forward' | 'reverse'
      readonly step: WorkspaceEditProgramStep
      readonly stepIndex: number
      readonly transitionId: string
      readonly type: 'intent'
    }
  | {
      readonly stepIndex: number
      readonly transitionId: string
      readonly type: 'complete'
    }
  | {
      readonly stepIndex: number
      readonly transitionId: string
      readonly type: 'compensated'
    }

type WorkspaceEditTransitionCacheEntry = {
  readonly fingerprint: string
  readonly result: WorkspaceEditResult
}

export type WorkspaceEditRecoveryStep = {
  readonly direction: 'forward' | 'reverse'
  readonly step: WorkspaceEditProgramStep
}

export type WorkspaceEditJournalManifest = {
  readonly activeTransition?: {
    readonly direction: 'forward' | 'reverse'
    readonly previousState: WorkspaceEditState
    readonly transitionId: string
  }
  readonly affectedPaths: readonly string[]
  readonly bodyDigest: string
  readonly createdAt: number
  readonly eventPublication: WorkspaceEditEventPublication
  readonly forwardGuards?: readonly WorkspaceEditJournalGuard[]
  readonly generation: number
  readonly guards: readonly WorkspaceEditJournalGuard[]
  readonly legs: readonly WorkspaceEditPreparedLeg[]
  readonly operationId: string
  readonly provisionalFrom?: 'finalized' | 'redone' | 'undone'
  readonly recoveryProgram?: readonly WorkspaceEditRecoveryStep[]
  readonly recoveryGuards?: readonly WorkspaceEditJournalGuard[]
  readonly recoveryTarget?: WorkspaceEditRecoveryTarget
  readonly rolledBackPaths: readonly string[]
  readonly reverseGuards?: readonly WorkspaceEditJournalGuard[]
  readonly state: WorkspaceEditState
  readonly touchedAt: number
  readonly transitionResults: Readonly<Record<string, WorkspaceEditTransitionCacheEntry>>
  readonly unrecoveredPaths: readonly string[]
  readonly version: 1
  readonly workspace: string
}

export type WorkspaceEditFileHandle = Pick<FileHandle, 'close' | 'sync' | 'writeFile'>

export type WorkspaceEditFileSystemDriver = {
  chmod(path: string, mode: number): Promise<void>
  lstat(path: string): Promise<Stats>
  mkdir(path: string, options: { mode: number; recursive: boolean }): Promise<unknown>
  open(path: string, flags: string, mode?: number): Promise<WorkspaceEditFileHandle>
  readFile(path: string): Promise<Buffer>
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
  realpath(path: string): Promise<string>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>
  stat(path: string): Promise<Stats>
  utimes(path: string, atime: number | Date, mtime: number | Date): Promise<void>
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { flag?: string; mode?: number },
  ): Promise<void>
}

export const nodeWorkspaceEditFileSystemDriver: WorkspaceEditFileSystemDriver = {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
}

const MANIFEST_FILE = 'manifest.json'
const PROGRAM_FILE = 'program.jsonl'
const STAGE_DIRECTORY = 'stage'

export class WorkspaceEditJournal {
  readonly root
  private readonly driver

  constructor(
    root: string,
    driver: WorkspaceEditFileSystemDriver = nodeWorkspaceEditFileSystemDriver,
  ) {
    this.root = path.resolve(root)
    this.driver = driver
  }

  async initialize() {
    const existed = Boolean(await this.lstatOptional(this.root))
    await this.driver.mkdir(this.root, { mode: 0o700, recursive: true })
    await this.assertDirectory(this.root)
    await this.driver.chmod(this.root, 0o700)
    await syncPath(this.driver, this.root)
    if (!existed) await syncPath(this.driver, path.dirname(this.root))
  }

  async createOperation(operationId: string) {
    const operationPath = this.operationPath(operationId)
    await this.driver.mkdir(operationPath, { mode: 0o700, recursive: false })
    await this.assertDirectory(operationPath)
    await this.driver.chmod(operationPath, 0o700)
    await syncPath(this.driver, this.root)
    const stagePath = path.join(operationPath, STAGE_DIRECTORY)
    await this.driver.mkdir(stagePath, { mode: 0o700, recursive: false })
    await this.assertDirectory(stagePath)
    await this.driver.chmod(stagePath, 0o700)
    await syncPath(this.driver, operationPath)
  }

  async writeStage(operationId: string, name: string, bytes: Uint8Array) {
    const relativePath = `${STAGE_DIRECTORY}/${name}`
    const target = this.operationChild(operationId, relativePath)
    await this.assertMissing(target)
    await this.driver.writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
    await this.driver.chmod(target, 0o600)
    await syncPath(this.driver, target)
    await syncPath(this.driver, path.dirname(target))
    return relativePath
  }

  async readStage(operationId: string, relativePath: string) {
    const target = this.operationChild(operationId, relativePath)
    await this.assertRegularFile(target)
    return this.driver.readFile(target)
  }

  reservedPath(operationId: string, name: string) {
    return this.operationChild(operationId, `${STAGE_DIRECTORY}/${name}`)
  }

  storedPath(operationId: string, relativePath: string) {
    return this.operationChild(operationId, relativePath)
  }

  async assertReservedPathMissing(operationId: string, relativePath: string) {
    await this.assertMissing(this.operationChild(operationId, relativePath))
  }

  async persist(manifest: WorkspaceEditJournalManifest) {
    const operationPath = this.operationPath(manifest.operationId)
    await this.assertDirectory(operationPath)
    const destination = path.join(operationPath, MANIFEST_FILE)
    const temporary = path.join(operationPath, `.${MANIFEST_FILE}.${randomUUID()}.tmp`)
    const serialized = `${JSON.stringify(manifest)}\n`

    await this.assertMissing(temporary)
    await this.driver.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
    await this.driver.chmod(temporary, 0o600)
    await syncPath(this.driver, temporary)
    await this.assertReplaceableManifest(destination)
    await this.driver.rename(temporary, destination)
    await syncPath(this.driver, operationPath)
  }

  async append(operationId: string, record: WorkspaceEditJournalRecord) {
    const operationPath = this.operationPath(operationId)
    await this.assertDirectory(operationPath)
    const target = path.join(operationPath, PROGRAM_FILE)
    const existed = Boolean(await this.lstatOptional(target))
    await this.assertAppendTarget(target)
    const handle = await this.driver.open(target, 'a', 0o600)

    try {
      await this.driver.chmod(target, 0o600)
      await handle.writeFile(`${JSON.stringify(record)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (!existed) await syncPath(this.driver, operationPath)
  }

  async load(operationId: string) {
    const target = this.operationChild(operationId, MANIFEST_FILE)
    await this.assertRegularFile(target)
    const bytes = await this.driver.readFile(target)
    const manifest = parseManifest(bytes)
    if (manifest.operationId !== operationId) throw new FsError('WORKSPACE_EDIT_INVALID')
    return manifest
  }

  async records(operationId: string) {
    const target = this.operationChild(operationId, PROGRAM_FILE)
    const stats = await this.lstatOptional(target)
    if (!stats) return []
    if (!stats.isFile() || stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')

    const text = (await this.driver.readFile(target)).toString('utf8')
    const lines = text.split('\n')
    const records: WorkspaceEditJournalRecord[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (!line) continue
      try {
        records.push(parseRecord(line))
      } catch (error) {
        if (index === lines.length - 1) break
        throw error
      }
    }

    return records
  }

  async list() {
    await this.initialize()
    const entries = await this.driver.readdir(this.root, { withFileTypes: true })
    const manifests: WorkspaceEditJournalManifest[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new FsError('WORKSPACE_EDIT_INVALID')
      }

      try {
        manifests.push(await this.load(entry.name))
      } catch (error) {
        if (nodeErrorCode(error) !== 'ENOENT') throw error
        await this.remove(entry.name)
      }
    }

    return manifests
  }

  async remove(operationId: string) {
    const operationPath = this.operationPath(operationId)
    const stats = await this.lstatOptional(operationPath)
    if (!stats) return
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')

    await this.driver.rm(operationPath, { force: false, recursive: true })
    await syncPath(this.driver, this.root)
  }

  async clearStaging(operationId: string) {
    const operationPath = this.operationPath(operationId)
    await this.assertDirectory(operationPath)
    const stagePath = path.join(operationPath, STAGE_DIRECTORY)
    const programPath = path.join(operationPath, PROGRAM_FILE)
    await this.removeJournalChild(stagePath)
    await this.removeJournalChild(programPath)
    await syncPath(this.driver, operationPath)
  }

  async sizeBytes() {
    await this.initialize()
    return this.directorySize(this.root)
  }

  operationPath(operationId: string) {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new FsError('WORKSPACE_EDIT_INVALID')
    return path.join(this.root, operationId)
  }

  private operationChild(operationId: string, relativePath: string) {
    const operationPath = this.operationPath(operationId)
    const target = path.resolve(operationPath, relativePath)
    const relative = path.relative(operationPath, target)
    if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }

    return target
  }

  private async assertDirectory(target: string) {
    const stats = await this.driver.lstat(target)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async assertRegularFile(target: string) {
    const stats = await this.driver.lstat(target)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async assertMissing(target: string) {
    if (!(await this.lstatOptional(target))) return

    throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async assertReplaceableManifest(target: string) {
    const stats = await this.lstatOptional(target)
    if (!stats) return
    if (stats.isSymbolicLink() || !stats.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async assertAppendTarget(target: string) {
    const stats = await this.lstatOptional(target)
    if (!stats) return
    if (stats.isSymbolicLink() || !stats.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async removeJournalChild(target: string) {
    const stats = await this.lstatOptional(target)
    if (!stats) return
    if (stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')

    await this.driver.rm(target, { force: false, recursive: stats.isDirectory() })
  }

  private async lstatOptional(target: string) {
    try {
      return await this.driver.lstat(target)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return null
      throw error
    }
  }

  private async directorySize(root: string): Promise<number> {
    const entries = await this.driver.readdir(root, { withFileTypes: true })
    let size = 0

    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')
      const target = path.join(root, entry.name)
      if (entry.isDirectory()) {
        size += await this.directorySize(target)
        continue
      }
      if (!entry.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')

      size += (await this.driver.stat(target)).size
    }

    return size
  }
}

function parseManifest(bytes: Uint8Array): WorkspaceEditJournalManifest {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceEditJournalManifest
    if (value.version !== 1) throw new FsError('WORKSPACE_EDIT_INVALID')
    if (!value.operationId || !Array.isArray(value.guards) || !Array.isArray(value.legs)) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }

    return value
  } catch (error) {
    if (error instanceof FsError) throw error
    throw new FsError('WORKSPACE_EDIT_INVALID', undefined, error)
  }
}

function parseRecord(line: string): WorkspaceEditJournalRecord {
  try {
    return JSON.parse(line) as WorkspaceEditJournalRecord
  } catch (error) {
    throw new FsError('WORKSPACE_EDIT_INVALID', undefined, error)
  }
}
