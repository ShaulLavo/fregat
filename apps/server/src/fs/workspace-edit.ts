import { atomicTemporaryPath, writeFileAtomic } from './atomic-write'
import { fsyncVia } from './fsync'
import { statOptionalVia } from './mutation-target'
import { sameItems as sameStrings } from '@workspace/utils/collections'
import { isSameOrDescendant, toPosix } from './path'
import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import path from 'node:path'
import type {
  WorkspaceEditCategory,
  WorkspaceEditHistoryEntry,
  WorkspaceEditHistoryLeg,
  WorkspaceEditHistoryResult,
  WorkspaceEditPrepareRequest,
  WorkspaceEditRecoverRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditRecoveryTarget,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditResultEntry,
  WorkspaceEditState,
  WorkspaceEditStatusResult,
  WorkspaceEditTransitionRequest,
  WorkspacePersistenceOperation,
  WorkspaceResourcePrecondition,
  WorkspaceResourceType,
} from '@workspace/contracts'
import { isByteExactText } from './text-encoding'
import { fileVersion } from './version'
import { FsError } from './errors'
import { fileOperationWriteId, isProvisionalWorkspaceEditState } from '@workspace/contracts'
import { slashPathsOverlap } from '@workspace/utils/slash-paths'
import type { WorkspacePaths } from './path'
import type { FileChangeHub } from './watch'
import type { WatchServerMessage } from './contracts'
import { recordRequestContext, runDetached } from '../observability'
import {
  MAX_WORKSPACE_EDIT_JOURNAL_BYTES,
  MAX_WORKSPACE_EDIT_OPERATION_BYTES,
  WORKSPACE_EDIT_STABLE_STATES,
  WORKSPACE_EDIT_STABLE_TTL_MS,
  type WorkspaceEditJournal,
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
  type WorkspaceEditJournalGuard,
  type WorkspaceEditJournalManifest,
  type WorkspaceEditIntentPathGuard,
  type WorkspaceEditPreparedLeg,
  type WorkspaceEditProgramStep,
  type WorkspaceEditRecoveryStep,
} from './workspace-edit-journal'
import {
  WorkspaceEditJournals,
  type WorkspaceEditJournalPlacement,
} from './workspace-edit-journals'

export const WORKSPACE_EDIT_LEASE_MS = 60_000
const JOURNAL_ALLOCATION_MUTEX_KEY = 'journal-allocation'

type WorkspaceEditClock = () => number

export type WorkspaceEditControllerOptions = {
  readonly changes: FileChangeHub
  readonly clock?: WorkspaceEditClock
  /** A journal at the top of each drive, falling back to `journalRoot`. */
  readonly driveJournals?: boolean
  readonly driver?: WorkspaceEditFileSystemDriver
  /** The home journal: the fallback for drives whose top is not writable. */
  readonly journalRoot: string
  readonly mountTop?: (absolutePath: string, device: number) => Promise<string>
  readonly paths: WorkspacePaths
}

type OperationSlot = {
  cancelled: boolean
  digest?: string
  manifest?: WorkspaceEditJournalManifest
  prepare?: Promise<WorkspaceEditResult>
  requestFingerprint?: string
  tombstone?: WorkspaceEditResult
}

type WorkspaceLease = {
  expiresAt: number
  operationId: string
  root: string
  running: boolean
  timer?: ReturnType<typeof setTimeout>
}

type ActualResource =
  | {
      exists: false
      path: string
    }
  | {
      bytes: Buffer
      dev: number
      exists: true
      ino: number
      mode: number
      mtimeMs: number
      path: string
      size: number
      type: 'file'
      version: string
    }
  | EntryResource

/** A resource read for identity only: no bytes, so a directory or a large file costs one lstat. */
type EntryResource = {
  bytes?: undefined
  dev: number
  entry: true
  exists: true
  ino: number
  mode: number
  mtimeMs: number
  path: string
  size: number
  type: WorkspaceResourceType
  version?: undefined
}

type ReadMode = 'content' | 'entry'

type VirtualResource = ActualResource & {
  generation?: number
}

type StagedBlob = {
  bytes: Buffer
  name: string
}

type PreparedPlan = {
  affectedPaths: readonly string[]
  blobs: readonly StagedBlob[]
  guards: readonly WorkspaceEditJournalGuard[]
  legs: readonly WorkspaceEditPreparedLeg[]
  placement: WorkspaceEditJournalPlacement
  stagedBytes: number
  workspaceAbsolute: string
}

type PrepareContext = {
  readonly guards: Map<string, WorkspaceEditJournalGuard>
  readonly legs: WorkspaceEditPreparedLeg[]
  readonly operationId: string
  readonly placement: WorkspaceEditJournalPlacement
  readonly readMode: ReadMode
  /** Bytes staged by moving a workspace resource into the journal. */
  stagedResourceBytes: number
  readonly stagingModes: Set<'copy' | 'rename'>
  readonly virtual: Map<string, VirtualResource>
  readonly workspaceAbsolute: string
}

type ProgramExecution =
  | {
      ok: true
      steps: readonly WorkspaceEditRecoveryStep[]
    }
  | {
      error: unknown
      ok: false
      remaining: readonly WorkspaceEditProgramStep[]
      steps: readonly WorkspaceEditRecoveryStep[]
    }

type CompensationResult =
  | { ok: true }
  | { ok: false; remaining: readonly WorkspaceEditRecoveryStep[] }

type TransitionAction = (
  manifest: WorkspaceEditJournalManifest,
  transitionId: string,
) => Promise<WorkspaceEditJournalManifest>

type TransitionOptions = {
  readonly auditDetails?: (manifest: WorkspaceEditJournalManifest) => Record<string, unknown>
  readonly clearStagingAfter?: boolean
  readonly removeAfter?: boolean
}

type WorkspaceEditTransitionKind =
  | 'abort'
  | 'commit'
  | 'finalize'
  | 'recover'
  | 'redo'
  | 'release'
  | 'rollback'
  | 'undo'

export class WorkspaceEditController {
  readonly serverEpoch = randomUUID()
  private readonly changes
  private readonly clock
  private readonly driver
  private readonly journals
  private readonly journalByOperation = new Map<string, WorkspaceEditJournal>()
  private readonly loadedJournals = new Map<WorkspaceEditJournal, Promise<void>>()
  private readonly leases = new Map<string, WorkspaceLease>()
  private readonly legacyMutations = new Set<string>()
  private readonly paths
  private readonly slots = new Map<string, OperationSlot>()
  private readonly transitionMutex = new AsyncKeyedMutex()
  private historySequence = 0
  private initializePromise?: Promise<void>

  constructor(options: WorkspaceEditControllerOptions) {
    this.paths = options.paths
    this.changes = options.changes
    this.clock = options.clock ?? Date.now
    this.driver = options.driver ?? nodeWorkspaceEditFileSystemDriver
    this.journals = new WorkspaceEditJournals({
      driveJournals: options.driveJournals ?? false,
      driver: this.driver,
      homeRoot: options.journalRoot,
      mountTop: options.mountTop,
      uid: process.getuid?.() ?? 0,
    })
  }

  /** Path segment names the tree, search and watchers must never show. */
  get internalNames() {
    return this.journals.internalNames
  }

  ready() {
    return this.ensureInitialized()
  }

  prepare(body: WorkspaceEditPrepareRequest): Promise<WorkspaceEditResult> {
    recordWorkspaceEditRequest('prepare', body.operationId, {
      operationCount: body.operations.length,
    })
    const fingerprint = prepareFingerprint(body)
    const existing = this.slots.get(body.operationId)
    if (existing) return this.reusePrepare(existing, body, fingerprint)

    const slot: OperationSlot = {
      cancelled: false,
      digest: body.bodyDigest,
      requestFingerprint: fingerprint,
    }
    this.slots.set(body.operationId, slot)
    const prepare = this.prepareRegistered(slot, body)
    slot.prepare = prepare
    return prepare
  }

  async commit(body: WorkspaceEditTransitionRequest) {
    return this.runTransition('commit', body, ['prepared'], (manifest, transitionId) =>
      this.commitPrepared(manifest, transitionId),
    )
  }

  async finalize(body: WorkspaceEditTransitionRequest) {
    const result = await this.runTransition(
      'finalize',
      body,
      ['committed', 'undo-committed', 'redo-committed'],
      (manifest) => this.finalizeProvisional(manifest),
    )
    if (result.state === 'finalized') await this.afterForwardLanded(body.operationId)

    return result
  }

  abort(body: WorkspaceEditTransitionRequest): Promise<WorkspaceEditResult> {
    recordWorkspaceEditRequest('abort', body.operationId, {
      expectedGeneration: body.expectedGeneration,
      transitionId: body.transitionId,
    })
    const existing = this.slots.get(body.operationId)
    if (!existing) return this.installAbortTombstone(body)

    existing.cancelled = true
    if (existing.prepare) return this.abortPreparing(existing, body)
    if (existing.tombstone) return Promise.resolve(existing.tombstone)

    return this.runTransition(
      'abort',
      body,
      ['prepared'],
      (manifest) => this.abortPrepared(manifest),
      { clearStagingAfter: true },
    )
  }

  async rollback(body: WorkspaceEditTransitionRequest) {
    return this.runTransition(
      'rollback',
      body,
      ['committed', 'undo-committed', 'redo-committed'],
      (manifest, transitionId) => this.rollbackProvisional(manifest, transitionId),
    )
  }

  async undo(body: WorkspaceEditTransitionRequest) {
    return this.runTransition('undo', body, ['finalized', 'redone'], (manifest, transitionId) =>
      this.undoStable(manifest, transitionId),
    )
  }

  async redo(body: WorkspaceEditTransitionRequest) {
    return this.runTransition('redo', body, ['undone'], (manifest, transitionId) =>
      this.redoUndone(manifest, transitionId),
    )
  }

  async recover(body: WorkspaceEditRecoverRequest) {
    return this.runTransition('recover', body, ['partial'], (manifest, transitionId) =>
      this.recoverPartial(manifest, transitionId, body.recoveryTarget),
    )
  }

  async release(body: WorkspaceEditReleaseRequest) {
    return this.runTransition(
      'release',
      body,
      ['finalized', 'undone', 'redone', 'rolled-back', 'aborted', 'partial'],
      (manifest) => this.releaseOperation(manifest, body),
      { auditDetails: (manifest) => releaseAuditDetails(manifest, body), removeAfter: true },
    )
  }

  async status(operationId: string): Promise<WorkspaceEditStatusResult> {
    recordWorkspaceEditRequest('status', operationId)
    await this.ensureInitialized()
    const slot = this.slots.get(operationId)
    if (!slot) return { found: false, operationId, serverEpoch: this.serverEpoch }
    if (slot.tombstone) return { found: true, result: slot.tombstone }
    if (slot.manifest) return { found: true, result: await this.result(slot.manifest) }

    return { found: true, result: preparingResult(operationId, this.serverEpoch) }
  }

  async recovery(workspace: string): Promise<WorkspaceEditRecoveryListResult> {
    recordWorkspaceEditRequest('recovery', undefined, { workspace })
    await this.ensureInitialized()
    const canonical = await this.resolveWorkspace(workspace)
    await this.ensureJournalLoaded((await this.journals.forPath(canonical)).journal)
    const operations = this.manifests().filter((manifest) => manifest.state === 'partial')
    const summaries = []
    for (const manifest of operations) {
      if ((await this.driver.realpath(this.workspaceAbsolute(manifest))) !== canonical) continue
      summaries.push({
        generation: manifest.generation,
        operationId: manifest.operationId,
        recoveryTarget: manifest.recoveryTarget!,
        unrecoveredPaths: manifest.unrecoveredPaths,
        workspace: manifest.workspace,
      })
    }
    const sorted = summaries.sort((left, right) =>
      left.operationId.localeCompare(right.operationId),
    )

    return { operations: sorted, serverEpoch: this.serverEpoch }
  }

  /** The ordered undo and redo lists every window of this workspace reads. */
  async history(
    workspace: string,
    category: WorkspaceEditCategory,
  ): Promise<WorkspaceEditHistoryResult> {
    recordWorkspaceEditRequest('history', undefined, { category, workspace })
    await this.ensureInitialized()
    const canonical = await this.resolveWorkspace(workspace)
    await this.ensureJournalLoaded((await this.journals.forPath(canonical)).journal)
    await this.reapExpired()
    const lists = await this.historyLists(canonical, category)
    recordRequestContext({
      workspaceEdit: { redoCount: lists.redo.length, undoCount: lists.undo.length },
    })

    return {
      redo: lists.redo.map(historyEntry),
      serverEpoch: this.serverEpoch,
      undo: lists.undo.map(historyEntry),
    }
  }

  async withLegacyMutation<T>(absolutePaths: readonly string[], mutation: () => Promise<T>) {
    await this.ensureInitialized()
    await this.reapExpired()
    const canonicalPaths = absolutePaths.map((input) => this.canonicalMutationPath(input))
    this.assertLegacyMutationAvailable(canonicalPaths)
    for (const target of canonicalPaths) this.legacyMutations.add(target)

    try {
      return await mutation()
    } finally {
      for (const target of canonicalPaths) this.legacyMutations.delete(target)
    }
  }

  async close() {
    for (const lease of this.leases.values()) clearTimeout(lease.timer)
    this.leases.clear()
    await this.initializePromise
  }

  private reusePrepare(
    slot: OperationSlot,
    body: WorkspaceEditPrepareRequest,
    fingerprint: string,
  ) {
    if (slot.tombstone) return Promise.resolve(slot.tombstone)
    if (slot.digest !== body.bodyDigest || slot.requestFingerprint !== fingerprint) {
      return Promise.reject(new FsError('WORKSPACE_EDIT_INVALID'))
    }
    if (slot.prepare) return slot.prepare
    if (!slot.manifest) return Promise.reject(new FsError('WORKSPACE_EDIT_NOT_FOUND'))

    return this.result(slot.manifest)
  }

  private async prepareRegistered(slot: OperationSlot, body: WorkspaceEditPrepareRequest) {
    try {
      await this.ensureInitialized()
      await this.reapExpired()
      this.assertNotCancelled(slot)
      const plan = await this.preparePlan(body)
      this.assertNotCancelled(slot)
      this.acquireLease(body.operationId, plan.workspaceAbsolute)
      this.assertNotCancelled(slot)
      const manifest = await this.allocatePreparedJournal(slot, body, plan)
      this.assertNotCancelled(slot)
      slot.manifest = manifest
      this.renewLease(manifest.operationId)
      const result = await this.result(manifest)
      this.assertNotCancelled(slot)
      slot.prepare = undefined
      recordWorkspaceEditOutcome('prepare', result)
      return result
    } catch (error) {
      if (slot.cancelled) return this.finishCancelledPrepare(slot, body.operationId)
      await this.cleanupFailedPrepare(body.operationId)
      this.slots.delete(body.operationId)
      throw normalizeWorkspaceEditError(error)
    }
  }

  private async allocatePreparedJournal(
    slot: OperationSlot,
    body: WorkspaceEditPrepareRequest,
    plan: PreparedPlan,
  ) {
    const release = await this.transitionMutex.acquire(JOURNAL_ALLOCATION_MUTEX_KEY)
    try {
      this.assertQuota(plan)
      await plan.placement.journal.createOperation(body.operationId)
      this.assertNotCancelled(slot)
      await this.persistStages(body.operationId, plan.blobs, slot)
      const manifest = preparedManifest(body, plan, this.clock())
      await plan.placement.journal.persist(manifest)
      return manifest
    } finally {
      release()
    }
  }

  private async persistStages(
    operationId: string,
    blobs: readonly StagedBlob[],
    slot: OperationSlot,
  ) {
    for (const blob of blobs) {
      await this.journalOf(operationId).writeStage(operationId, blob.name, blob.bytes)
      this.assertNotCancelled(slot)
    }
  }

  private async finishCancelledPrepare(slot: OperationSlot, operationId: string) {
    await this.journalByOperation.get(operationId)?.remove(operationId)
    this.releaseLease(operationId)
    const result = abortedResult(operationId, this.serverEpoch, 1)
    slot.prepare = undefined
    slot.tombstone = result
    recordWorkspaceEditOutcome('prepare', result)
    return result
  }

  private async cleanupFailedPrepare(operationId: string) {
    await this.journalByOperation
      .get(operationId)
      ?.remove(operationId)
      .catch(() => undefined)
    this.journalByOperation.delete(operationId)
    this.releaseLease(operationId)
  }

  private assertNotCancelled(slot: OperationSlot) {
    if (slot.cancelled) throw new FsError('WORKSPACE_EDIT_STALE')
  }

  private installAbortTombstone(body: WorkspaceEditTransitionRequest) {
    if (body.expectedGeneration !== 0) {
      return Promise.reject(new FsError('WORKSPACE_EDIT_STALE'))
    }

    const result = abortedResult(body.operationId, this.serverEpoch, 0)
    this.slots.set(body.operationId, { cancelled: true, tombstone: result })
    recordWorkspaceEditOutcome('abort', result)
    return Promise.resolve(result)
  }

  private async abortPreparing(slot: OperationSlot, body: WorkspaceEditTransitionRequest) {
    if (body.expectedGeneration !== 0) throw new FsError('WORKSPACE_EDIT_STALE')
    const result = await slot.prepare!
    if (result.state !== 'aborted') throw new FsError('WORKSPACE_EDIT_STALE')

    recordWorkspaceEditOutcome('abort', result)
    return result
  }

  private async runTransition(
    kind: WorkspaceEditTransitionKind,
    body: WorkspaceEditTransitionRequest,
    allowedStates: readonly WorkspaceEditState[],
    action: TransitionAction,
    options: TransitionOptions = {},
  ) {
    recordWorkspaceEditRequest(kind, body.operationId, {
      expectedGeneration: body.expectedGeneration,
      transitionId: body.transitionId,
    })
    await this.ensureInitialized()
    await this.reapExpired()
    const release = await this.transitionMutex.acquire(body.operationId)
    try {
      return await this.runTransitionLocked(kind, body, allowedStates, action, options)
    } finally {
      release()
    }
  }

  private async runTransitionLocked(
    kind: WorkspaceEditTransitionKind,
    body: WorkspaceEditTransitionRequest,
    allowedStates: readonly WorkspaceEditState[],
    action: TransitionAction,
    options: TransitionOptions,
  ) {
    const slot = this.slots.get(body.operationId)
    if (!slot?.manifest) throw new FsError('WORKSPACE_EDIT_NOT_FOUND')
    const cached = cachedTransition(slot.manifest, kind, body)
    if (cached) {
      if (options.clearStagingAfter || shouldClearTerminalStaging(cached.state)) {
        await this.journalOf(body.operationId).clearStaging(body.operationId)
      }
      if (options.removeAfter && cached.state === 'released') {
        await this.journalOf(body.operationId).remove(body.operationId)
      }
      recordWorkspaceEditOutcome(kind, cached)
      return cached
    }
    if (slot.manifest.generation !== body.expectedGeneration) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    if (!allowedStates.includes(slot.manifest.state)) throw new FsError('WORKSPACE_EDIT_STALE')

    this.assertTransitionIdUnused(slot.manifest, kind, body)
    await this.enterTransitionLease(slot.manifest)
    try {
      const previousManifest = slot.manifest
      const next = await action(previousManifest, body.transitionId)
      const result = await this.result(next)
      const cachedManifest = cacheTransition(next, kind, body, result, this.clock())
      await this.journalOf(cachedManifest.operationId).persist(cachedManifest)
      slot.manifest = cachedManifest
      await this.publishTransitionOutcome(cachedManifest)
      this.finishTransitionLease(cachedManifest)
      if (options.clearStagingAfter || shouldClearTerminalStaging(cachedManifest.state)) {
        await this.journalOf(cachedManifest.operationId).clearStaging(cachedManifest.operationId)
      }
      if (options.removeAfter && cachedManifest.state === 'released') {
        await this.journalOf(cachedManifest.operationId).remove(cachedManifest.operationId)
      }

      recordWorkspaceEditOutcome(kind, result, options.auditDetails?.(previousManifest))
      return result
    } catch (error) {
      this.finishTransitionLease(slot.manifest)
      throw error
    }
  }

  private assertTransitionIdUnused(
    manifest: WorkspaceEditJournalManifest,
    kind: WorkspaceEditTransitionKind,
    body: WorkspaceEditTransitionRequest,
  ) {
    const existing = manifest.transitionResults[body.transitionId]
    if (!existing) return
    if (existing.fingerprint === transitionFingerprint(kind, body)) return

    throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async enterTransitionLease(manifest: WorkspaceEditJournalManifest) {
    const workspace = this.workspaceAbsolute(manifest)
    const lease = this.leases.get(manifest.operationId)
    if (!lease) this.acquireLease(manifest.operationId, workspace)
    const active = this.leases.get(manifest.operationId)!
    active.running = true
    clearTimeout(active.timer)
    active.timer = undefined
  }

  private finishTransitionLease(manifest: WorkspaceEditJournalManifest) {
    const lease = this.leases.get(manifest.operationId)
    if (lease) lease.running = false
    if (isLeaseHoldingState(manifest.state)) {
      this.renewLease(manifest.operationId)
      return
    }

    this.releaseLease(manifest.operationId)
  }

  private async commitPrepared(
    manifest: WorkspaceEditJournalManifest,
    transitionId: string,
  ): Promise<WorkspaceEditJournalManifest> {
    await this.revalidateGuards(manifest)
    this.beginBarrier(manifest)
    const active = withActiveTransition(manifest, 'forward', transitionId)
    await this.journalOf(active.operationId).persist(active)
    const execution = await this.executeProgram(
      active,
      await this.forwardProgram(active),
      'forward',
      transitionId,
    )
    if (!execution.ok) return this.compensateFailure(active, execution, 'rolled-back', transitionId)

    try {
      return advanceManifest(active, 'committed', this.clock(), {
        activeTransition: undefined,
        eventPublication: 'pending',
        forwardGuards: await this.snapshotCurrentGuards(active),
      })
    } catch (error) {
      return this.compensateFailure(
        active,
        { error, ok: false, remaining: [], steps: execution.steps },
        'rolled-back',
        transitionId,
      )
    }
  }

  private async finalizeProvisional(manifest: WorkspaceEditJournalManifest) {
    const state = finalizedState(manifest.state)
    this.historySequence += 1
    const next = advanceManifest(manifest, state, this.clock(), {
      eventPublication: 'published',
      historySequence: this.historySequence,
      provisionalFrom: undefined,
    })
    return next
  }

  /**
   * A new operation empties its history's redo list. One that moves, creates or deletes
   * resources also evicts every file operation it touches, and whatever those depended on:
   * their inverses no longer describe the disk.
   */
  private async afterForwardLanded(operationId: string) {
    const manifest = this.slots.get(operationId)?.manifest
    if (!manifest) return
    const older = this.manifests()
      .filter((candidate) => candidate.workspace === manifest.workspace)
      .filter((candidate) => candidate.historySequence < manifest.historySequence)
      .filter((candidate) => WORKSPACE_EDIT_STABLE_STATES.has(candidate.state))
      .sort((left, right) => right.historySequence - left.historySequence)
    const cleared = older
      .filter((candidate) => candidate.category === manifest.category)
      .filter((candidate) => candidate.state === 'undone')
    const evicted =
      manifest.category === 'file-operation' ? [] : dependentFileOperations(manifest, older)
    for (const candidate of [...cleared, ...evicted])
      await this.releaseStable(candidate.operationId)
    if (cleared.length === 0 && evicted.length === 0) return

    recordRequestContext({
      workspaceEdit: {
        clearedRedoOperationIds: cleared.map((candidate) => candidate.operationId),
        evictedOperationIds: evicted.map((candidate) => candidate.operationId),
      },
    })
  }

  private async releaseStable(operationId: string) {
    const release = await this.transitionMutex.acquire(operationId)
    try {
      const slot = this.slots.get(operationId)
      const manifest = slot?.manifest
      if (!slot || !manifest || !WORKSPACE_EDIT_STABLE_STATES.has(manifest.state)) return

      await this.journalOf(operationId).remove(operationId)
      this.changes.forgetTransactionResults(operationId)
      slot.manifest = advanceManifest(manifest, 'released', this.clock(), {
        eventPublication: 'suppressed',
      })
    } finally {
      release()
    }
  }

  private manifests() {
    return Array.from(this.slots.values())
      .map((slot) => slot.manifest)
      .filter((manifest): manifest is WorkspaceEditJournalManifest => Boolean(manifest))
  }

  private async historyLists(canonicalWorkspace: string, category: WorkspaceEditCategory) {
    const workspace = toPosix(path.relative(this.paths.workspaceRootReal, canonicalWorkspace))
    const entries = this.manifests()
      .filter((manifest) => manifest.category === category && manifest.workspace === workspace)
      .sort((left, right) => right.historySequence - left.historySequence)

    return {
      redo: entries.filter((manifest) => manifest.state === 'undone'),
      undo: entries.filter(
        (manifest) => manifest.state === 'finalized' || manifest.state === 'redone',
      ),
    }
  }

  /** Two windows read one list; reversing anything but its head would reorder history under them. */
  private async assertHistoryHead(
    manifest: WorkspaceEditJournalManifest,
    direction: 'redo' | 'undo',
  ) {
    if (manifest.category !== 'file-operation') return
    const lists = await this.historyLists(this.workspaceAbsolute(manifest), manifest.category)
    const head = lists[direction][0]
    if (head?.operationId === manifest.operationId) return

    throw new FsError('WORKSPACE_EDIT_NOT_HEAD', undefined, undefined, {
      fix: `Reload the file history and ${direction} the newest operation first.`,
      internal: { direction, headOperationId: head?.operationId ?? null },
      why: `Another window has ${direction === 'undo' ? 'done' : 'undone'} a newer file operation since this one.`,
    })
  }

  private async abortPrepared(manifest: WorkspaceEditJournalManifest) {
    const next = advanceManifest(manifest, 'aborted', this.clock(), {
      eventPublication: 'suppressed',
    })
    return next
  }

  private async rollbackProvisional(manifest: WorkspaceEditJournalManifest, transitionId: string) {
    if (manifest.state === 'committed') {
      return this.runProgramTransition(manifest, transitionId, 'reverse', 'rolled-back')
    }
    if (manifest.state === 'redo-committed') {
      return this.runProgramTransition(manifest, transitionId, 'reverse', 'undone')
    }

    return this.runProgramTransition(
      manifest,
      transitionId,
      'forward',
      manifest.provisionalFrom ?? 'finalized',
    )
  }

  private async undoStable(
    manifest: WorkspaceEditJournalManifest,
    transitionId: string,
  ): Promise<WorkspaceEditJournalManifest> {
    await this.assertHistoryHead(manifest, 'undo')
    await this.revalidateDirectionState(manifest, 'forward')
    await this.assertTransitionQuota(manifest, await this.reverseProgram(manifest))
    this.beginBarrier(manifest)
    const next = await this.runProgramTransition(
      manifest,
      transitionId,
      'reverse',
      'undo-committed',
    )
    if (next.state !== 'undo-committed') return next

    return {
      ...next,
      provisionalFrom: manifest.state === 'redone' ? 'redone' : 'finalized',
    }
  }

  private async redoUndone(manifest: WorkspaceEditJournalManifest, transitionId: string) {
    await this.assertHistoryHead(manifest, 'redo')
    await this.revalidateDirectionState(manifest, 'reverse')
    await this.assertTransitionQuota(manifest, await this.forwardProgram(manifest))
    this.beginBarrier(manifest)
    return this.runProgramTransition(manifest, transitionId, 'forward', 'redo-committed')
  }

  private async runProgramTransition(
    manifest: WorkspaceEditJournalManifest,
    transitionId: string,
    direction: 'forward' | 'reverse',
    successState: WorkspaceEditState,
  ) {
    const active = withActiveTransition(manifest, direction, transitionId)
    await this.journalOf(active.operationId).persist(active)
    const steps =
      direction === 'forward'
        ? await this.forwardProgram(active)
        : await this.reverseProgram(active)
    const execution = await this.executeProgram(active, steps, direction, transitionId)
    if (!execution.ok) {
      const recoveryTarget = compensationTarget(manifest, direction)
      return this.compensateFailure(active, execution, recoveryTarget, transitionId)
    }

    try {
      return advanceManifest(active, successState, this.clock(), {
        activeTransition: undefined,
        eventPublication: 'pending',
        stagedBytes: await this.journalHeldBytes(active),
        ...directionGuardChange(direction, await this.snapshotCurrentGuards(active)),
      })
    } catch (error) {
      return this.compensateFailure(
        active,
        { error, ok: false, remaining: [], steps: execution.steps },
        compensationTarget(manifest, direction),
        transitionId,
      )
    }
  }

  private async compensateFailure(
    manifest: WorkspaceEditJournalManifest,
    execution: Extract<ProgramExecution, { ok: false }>,
    recoveryTarget: WorkspaceEditRecoveryTarget,
    transitionId: string,
  ) {
    const compensation = await this.compensate(manifest, execution.steps, transitionId)
    if (!compensation.ok) {
      const partial = advanceManifest(manifest, 'partial', this.clock(), {
        activeTransition: undefined,
        eventPublication: 'published',
        recoveryProgram: compensation.remaining,
        recoveryGuards: await this.snapshotRecoveryGuards(manifest),
        recoveryTarget,
        unrecoveredPaths: recoveryPaths(compensation.remaining),
      })
      this.releaseLease(manifest.operationId)
      return partial
    }

    const restored = advanceManifest(manifest, recoveryTarget, this.clock(), {
      activeTransition: undefined,
      eventPublication: 'suppressed',
      recoveryProgram: undefined,
      recoveryGuards: undefined,
      recoveryTarget: undefined,
      rolledBackPaths: manifest.affectedPaths,
      unrecoveredPaths: [],
    })
    return restored
  }

  private async recoverPartial(
    manifest: WorkspaceEditJournalManifest,
    transitionId: string,
    recoveryTarget: WorkspaceEditRecoveryTarget,
  ) {
    if (manifest.recoveryTarget !== recoveryTarget) throw new FsError('WORKSPACE_EDIT_STALE')
    const program = manifest.recoveryProgram ?? []
    const recoveryGuards = manifest.recoveryGuards ?? []
    if (program.length > 0 && recoveryGuards.length === 0) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    await this.revalidateRecordedGuards(manifest, recoveryGuards)
    await this.preflightRecovery(manifest, program)
    this.beginBarrier(manifest)
    const execution = await this.executeRecoveryProgram(manifest, program, transitionId)
    if (!execution.ok) {
      const partial = advanceManifest(manifest, 'partial', this.clock(), {
        eventPublication: 'published',
        recoveryProgram: execution.remaining,
        recoveryGuards: await this.snapshotRecoveryGuards(manifest),
        unrecoveredPaths: recoveryPaths(execution.remaining),
      })
      return partial
    }

    const recovered = advanceManifest(manifest, recoveryTarget, this.clock(), {
      eventPublication: recoveryTarget === 'rolled-back' ? 'suppressed' : 'published',
      recoveryProgram: undefined,
      recoveryGuards: undefined,
      recoveryTarget: undefined,
      rolledBackPaths: manifest.affectedPaths,
      unrecoveredPaths: [],
    })
    return recovered
  }

  private async releaseOperation(
    manifest: WorkspaceEditJournalManifest,
    body: WorkspaceEditReleaseRequest,
  ) {
    if (manifest.state === 'partial') this.assertPartialAcknowledgement(manifest, body)

    return advanceManifest(manifest, 'released', this.clock(), {
      eventPublication: 'suppressed',
      recoveryGuards: undefined,
      recoveryProgram: undefined,
      recoveryTarget: undefined,
      unrecoveredPaths: [],
    })
  }

  private assertPartialAcknowledgement(
    manifest: WorkspaceEditJournalManifest,
    body: WorkspaceEditReleaseRequest,
  ) {
    const acknowledgement = body.acknowledgePartial
    if (!acknowledgement) throw new FsError('WORKSPACE_EDIT_PARTIAL')
    if (acknowledgement.generation !== manifest.generation) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    if (!sameStrings(acknowledgement.unrecoveredPaths, manifest.unrecoveredPaths)) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  private async preparePlan(body: WorkspaceEditPrepareRequest): Promise<PreparedPlan> {
    const workspaceAbsolute = await this.resolveWorkspace(body.workspace)
    assertDisjointResourcePaths(body.operations)
    const placement = await this.journals.forPath(workspaceAbsolute)
    await this.ensureJournalLoaded(placement.journal)
    this.journalByOperation.set(body.operationId, placement.journal)
    const context: PrepareContext = {
      guards: new Map(),
      legs: [],
      operationId: body.operationId,
      placement,
      readMode: body.category === 'file-operation' ? 'entry' : 'content',
      stagedResourceBytes: 0,
      stagingModes: new Set(),
      virtual: new Map(),
      workspaceAbsolute,
    }
    const blobs: StagedBlob[] = []
    const affectedPaths: string[] = []

    for (const operation of body.operations) {
      await this.prepareOperation(operation, context, blobs)
      addAffectedPaths(affectedPaths, operation)
    }
    recordRequestContext({
      workspaceEdit: {
        category: body.category,
        journalKind: placement.kind,
        journalRoot: placement.journal.root,
        stagingModes: Array.from(context.stagingModes),
      },
    })

    const blobBytes = blobs.reduce((total, blob) => total + blob.bytes.byteLength, 0)
    return {
      affectedPaths,
      blobs,
      guards: Array.from(context.guards.values()),
      legs: context.legs,
      placement,
      stagedBytes: blobBytes + context.stagedResourceBytes,
      workspaceAbsolute,
    }
  }

  private async prepareOperation(
    operation: WorkspacePersistenceOperation,
    context: PrepareContext,
    blobs: StagedBlob[],
  ) {
    if (operation.kind === 'write') {
      await this.prepareWrite(operation, context, blobs)
      return
    }
    if (operation.kind === 'create') {
      await this.prepareCreate(operation, context)
      return
    }
    if (operation.kind === 'rename') {
      await this.prepareRename(operation, context)
      return
    }
    if (operation.kind === 'copy') {
      await this.prepareCopy(operation, context)
      return
    }

    await this.prepareDelete(operation, context)
  }

  private async prepareWrite(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'write' }>,
    context: PrepareContext,
    blobs: StagedBlob[],
  ) {
    const current = await this.virtualResource(
      operation.path,
      operation.expected,
      operation.index,
      context,
    )
    if (!current.exists) throw new FsError('WORKSPACE_EDIT_STALE')
    if (!current.bytes) throw new FsError('WORKSPACE_EDIT_INVALID')
    // Same round-trip rule as `/fs/write`: an edit is computed against decoded text, so committing
    // it over bytes that do not decode losslessly would write substitutions nobody reviewed.
    if (!isByteExactText(current.bytes)) throw new FsError('LOSSY_WRITE_BLOCKED')
    const beforeName = `write-${operation.index}-before`
    const afterName = `write-${operation.index}-after`
    const after = Buffer.from(operation.text, 'utf8')
    blobs.push({ bytes: current.bytes, name: beforeName }, { bytes: after, name: afterName })
    context.legs.push({
      afterStage: `stage/${afterName}`,
      beforeMode: current.mode,
      beforeMtimeMs: current.mtimeMs,
      beforeStage: `stage/${beforeName}`,
      index: operation.index,
      kind: 'write',
      path: operation.path,
    })
    context.virtual.set(operation.path, {
      ...current,
      bytes: after,
      generation: operation.index,
      size: after.byteLength,
      version: hashBytes(after),
    })
  }

  private async prepareCreate(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'create' }>,
    context: PrepareContext,
  ) {
    const destination = await this.virtualResource(
      operation.path,
      operation.destination,
      operation.index,
      context,
    )
    const noOp = destination.exists && !operation.overwrite && operation.ignoreIfExists
    if (destination.exists && !noOp && !operation.overwrite) throw occupiedError(operation.path)
    const folder = operation.folder ?? false
    if (folder && operation.overwrite) throw new FsError('WORKSPACE_EDIT_INVALID')

    const reservedPath = operation.overwrite
      ? await this.reserveStage(context, `resource-${operation.index}`)
      : undefined
    if (destination.exists && operation.overwrite) {
      await this.stageResource(context, operation.path, destination)
    }
    context.legs.push({
      destinationExists: destination.exists,
      folder,
      index: operation.index,
      kind: 'create',
      noOp,
      overwrite: operation.overwrite,
      path: operation.path,
      reservedPath,
      undoSlot: await this.reserveStage(context, `undo-${operation.index}`),
    })
    context.virtual.set(
      operation.path,
      noOp
        ? { ...destination, generation: operation.index }
        : createdVirtual(operation.path, operation.index, folder),
    )
  }

  private async prepareRename(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'rename' }>,
    context: PrepareContext,
  ) {
    const source = await this.transferSource(operation, context)
    if (operation.oldPath === operation.newPath) {
      context.legs.push({ ...operation, destinationExists: true, kind: 'rename', noOp: true })
      context.virtual.set(operation.oldPath, { ...source, generation: operation.index })
      return
    }

    const destination = await this.virtualResource(
      operation.newPath,
      operation.destination,
      operation.index,
      context,
    )
    if (sameIdentity(source, destination)) throw new FsError('WORKSPACE_EDIT_INVALID')
    const noOp = destination.exists && !operation.overwrite && operation.ignoreIfExists
    if (destination.exists && !noOp && !operation.overwrite) throw occupiedError(operation.newPath)
    const reservedPath = operation.overwrite
      ? await this.reserveStage(context, `resource-${operation.index}`)
      : undefined
    if (destination.exists && operation.overwrite) {
      await this.stageResource(context, operation.newPath, destination)
    }
    context.legs.push({
      destinationExists: destination.exists,
      index: operation.index,
      kind: 'rename',
      newPath: operation.newPath,
      noOp,
      oldPath: operation.oldPath,
      overwrite: operation.overwrite,
      reservedPath,
    })
    if (noOp) {
      context.virtual.set(operation.oldPath, { ...source, generation: operation.index })
      context.virtual.set(operation.newPath, { ...destination, generation: operation.index })
      return
    }

    context.virtual.set(operation.oldPath, {
      exists: false,
      generation: operation.index,
      path: operation.oldPath,
    })
    context.virtual.set(operation.newPath, {
      ...source,
      generation: operation.index,
      path: operation.newPath,
    })
  }

  /** Rename and copy both read an existing source, and neither may target its own alias. */
  private async transferSource(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'copy' | 'rename' }>,
    context: PrepareContext,
  ) {
    if (isPathAlias(operation.oldPath, operation.newPath)) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }
    const source = await this.virtualResource(
      operation.oldPath,
      operation.source,
      operation.index,
      context,
    )
    if (source.exists) return source

    throw new FsError('WORKSPACE_EDIT_STALE')
  }

  private async prepareCopy(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'copy' }>,
    context: PrepareContext,
  ) {
    const source = await this.transferSource(operation, context)
    const destination = await this.virtualResource(
      operation.newPath,
      operation.destination,
      operation.index,
      context,
    )
    if (destination.exists) throw occupiedError(operation.newPath)

    context.legs.push({
      index: operation.index,
      kind: 'copy',
      newPath: operation.newPath,
      oldPath: operation.oldPath,
      undoSlot: await this.reserveStage(context, `undo-${operation.index}`),
    })
    context.virtual.set(operation.oldPath, { ...source, generation: operation.index })
    context.virtual.set(operation.newPath, {
      ...source,
      dev: -1,
      generation: operation.index,
      ino: -1,
      path: operation.newPath,
    })
  }

  private async prepareDelete(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'delete' }>,
    context: PrepareContext,
  ) {
    const current = await this.virtualResource(
      operation.path,
      operation.expected,
      operation.index,
      context,
    )
    const noOp = !current.exists && operation.ignoreIfNotExists
    if (!current.exists && !noOp) throw new FsError('WORKSPACE_EDIT_STALE')
    if (current.exists && current.type === 'directory' && !operation.recursive) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }
    if (current.exists) await this.stageResource(context, operation.path, current)
    const reservedPath = current.exists
      ? await this.reserveStage(context, `resource-${operation.index}`)
      : undefined
    context.legs.push({
      index: operation.index,
      kind: 'delete',
      noOp,
      path: operation.path,
      reservedPath,
    })
    context.virtual.set(operation.path, {
      exists: false,
      generation: operation.index,
      path: operation.path,
    })
  }

  private async reserveStage(context: PrepareContext, name: string) {
    const reservedPath = `stage/${name}-${randomUUID()}`
    await context.placement.journal.assertReservedPathMissing(context.operationId, reservedPath)
    return reservedPath
  }

  /** Records how a resource about to move into the journal gets there, and what it will hold. */
  private async stageResource(
    context: PrepareContext,
    relativePath: string,
    resource: Extract<VirtualResource, { exists: true }>,
  ) {
    if (resource.dev < 0) return
    context.stagingModes.add(resource.dev === context.placement.device ? 'rename' : 'copy')
    const absolutePath = await this.resolveTarget(context.workspaceAbsolute, relativePath)
    const remaining = MAX_WORKSPACE_EDIT_OPERATION_BYTES - context.stagedResourceBytes
    context.stagedResourceBytes += await this.measureResource(absolutePath, resource, remaining)
  }

  private async measureResource(
    absolutePath: string,
    resource: Extract<VirtualResource, { exists: true }>,
    limit: number,
  ) {
    if (resource.type !== 'directory') return resource.size
    return this.measureTree(absolutePath, limit)
  }

  /** Stops walking once past `limit`: the quota check only needs to know it was exceeded. */
  private async measureTree(absolutePath: string, limit: number) {
    let total = 0
    const pending = [absolutePath]
    while (pending.length > 0) {
      const directory = pending.pop()!
      for (const entry of await this.driver.readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          pending.push(child)
          continue
        }
        total += (await this.driver.lstat(child)).size
        if (total > limit) return total
      }
    }

    return total
  }

  private async virtualResource(
    relativePath: string,
    precondition: WorkspaceResourcePrecondition,
    operationIndex: number,
    context: PrepareContext,
  ) {
    if (precondition.kind === 'transaction') {
      const current = context.virtual.get(relativePath)
      if (!current || current.generation !== precondition.afterOperation) {
        throw new FsError('WORKSPACE_EDIT_INVALID')
      }
      if (precondition.afterOperation >= operationIndex) throw new FsError('WORKSPACE_EDIT_INVALID')

      return current
    }
    if (context.virtual.has(relativePath)) throw new FsError('WORKSPACE_EDIT_INVALID')

    const mode = preconditionReadMode(precondition, context.readMode)
    const actual = await this.readActual(context.workspaceAbsolute, relativePath, mode)
    assertPrecondition(actual, precondition)
    context.virtual.set(relativePath, actual)
    context.guards.set(relativePath, actualGuard(actual))
    return actual
  }

  private async readActual(
    workspaceAbsolute: string,
    relativePath: string,
    mode: ReadMode = 'content',
  ): Promise<ActualResource> {
    const absolutePath = await this.resolveTarget(workspaceAbsolute, relativePath)
    const stats = await statOptionalVia(this.driver.lstat, absolutePath)
    if (!stats) return { exists: false, path: relativePath }
    if (stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')
    if (mode === 'entry') return entryResource(relativePath, stats)
    if (!stats.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')

    const bytes = await this.driver.readFile(absolutePath)
    return {
      bytes,
      dev: stats.dev,
      exists: true,
      ino: stats.ino,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
      path: relativePath,
      size: stats.size,
      type: 'file',
      version: hashBytes(bytes),
    }
  }

  private async resolveWorkspace(input: string) {
    const target = this.paths.resolve(input)
    const stats = await this.driver.lstat(target.absolutePath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new FsError('WORKSPACE_EDIT_INVALID')
    const canonical = await this.driver.realpath(target.absolutePath)
    this.paths.assertRealInside(canonical)
    const expected = toPosix(path.relative(this.paths.workspaceRootReal, canonical))
    if (expected !== target.relativePath) throw new FsError('WORKSPACE_EDIT_INVALID')

    return canonical
  }

  private async resolveTarget(workspaceAbsolute: string, relativePath: string) {
    assertRelativeWorkspaceEditPath(relativePath)
    const target = path.resolve(workspaceAbsolute, relativePath)
    assertInside(workspaceAbsolute, target)
    await this.assertNotJournalTarget(target)
    await this.assertRealParentInside(workspaceAbsolute, target)
    return target
  }

  private canonicalMutationPath(input: string) {
    const absolutePath = path.resolve(input)
    assertInside(this.paths.workspaceRootReal, absolutePath)
    return absolutePath
  }

  /** A journal must never be staged into itself, nor a resource moved inside one. */
  private async assertNotJournalTarget(target: string) {
    if (target.split(path.sep).some((segment) => this.internalNames.includes(segment))) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }
    for (const journal of this.journals.known()) {
      const journalRoot = await this.driver.realpath(journal.root).catch(() => journal.root)
      if (!pathsOverlap(journalRoot, target)) continue

      throw new FsError('WORKSPACE_EDIT_INVALID')
    }
  }

  private async assertRealParentInside(workspaceAbsolute: string, target: string) {
    let candidate = target

    while (true) {
      const stats = await statOptionalVia(this.driver.lstat, candidate)
      if (stats) {
        if (stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')
        // ENOTDIR reads as missing, so a path under a file is refused here, before prepare stages it.
        if (candidate !== target && !stats.isDirectory())
          throw ancestorNotDirectoryError(workspaceAbsolute, candidate)
        const canonical = await this.driver.realpath(candidate)
        assertInside(workspaceAbsolute, canonical)
      }

      if (candidate === workspaceAbsolute) return
      candidate = path.dirname(candidate)
    }
  }

  /**
   * An undo parks what a create or copy made, a redo re-stages what a delete took, and either
   * may have grown since the operation ran; measure it at the moment it moves.
   */
  private async assertTransitionQuota(
    manifest: WorkspaceEditJournalManifest,
    steps: readonly WorkspaceEditProgramStep[],
  ) {
    let incoming = 0
    for (const step of steps) {
      if (step.kind !== 'move' || !step.to.startsWith('journal:')) continue
      if (!step.from.startsWith('workspace:')) continue
      const source = this.resolvePathReference(manifest, step.from)
      const stats = await statOptionalVia(this.driver.lstat, source)
      if (!stats) continue
      const remaining = MAX_WORKSPACE_EDIT_OPERATION_BYTES - incoming
      incoming += stats.isDirectory() ? await this.measureTree(source, remaining) : stats.size
    }
    if (incoming === 0) return
    if (incoming > MAX_WORKSPACE_EDIT_OPERATION_BYTES) {
      throw quotaError('transition', incoming, MAX_WORKSPACE_EDIT_OPERATION_BYTES, 0)
    }
    const held = this.heldBytes(this.journalOf(manifest.operationId), manifest.operationId)
    if (held + incoming <= MAX_WORKSPACE_EDIT_JOURNAL_BYTES) return

    throw quotaError('transition', incoming, MAX_WORKSPACE_EDIT_JOURNAL_BYTES, held)
  }

  private heldBytes(journal: WorkspaceEditJournal, exceptOperationId?: string) {
    return this.manifests()
      .filter((manifest) => manifest.operationId !== exceptOperationId)
      .filter((manifest) => this.journalByOperation.get(manifest.operationId) === journal)
      .filter((manifest) => holdsStaging(manifest.state))
      .reduce((total, manifest) => total + manifest.stagedBytes, 0)
  }

  /** What this operation's journal holds right now: staged writes and parked resources. */
  private async journalHeldBytes(manifest: WorkspaceEditJournalManifest) {
    const journal = this.journalOf(manifest.operationId)
    const stage = journal.storedPath(manifest.operationId, 'stage')
    if (!(await statOptionalVia(this.driver.lstat, stage))) return 0

    return this.measureTree(stage, Number.POSITIVE_INFINITY)
  }

  private assertQuota(plan: PreparedPlan) {
    if (plan.stagedBytes > MAX_WORKSPACE_EDIT_OPERATION_BYTES) {
      throw quotaError('operation', plan.stagedBytes, MAX_WORKSPACE_EDIT_OPERATION_BYTES, 0)
    }
    const held = this.heldBytes(plan.placement.journal)
    if (held + plan.stagedBytes <= MAX_WORKSPACE_EDIT_JOURNAL_BYTES) return

    throw quotaError('journal', plan.stagedBytes, MAX_WORKSPACE_EDIT_JOURNAL_BYTES, held)
  }

  private async revalidateGuards(manifest: WorkspaceEditJournalManifest) {
    await this.assertGuardsMatch(manifest, manifest.guards)
  }

  private async assertGuardsMatch(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditJournalGuard[],
  ) {
    const workspace = this.workspaceAbsolute(manifest)
    for (const guard of guards) {
      const mode = guardReadMode(guard, manifestReadMode(manifest))
      const actual = await this.readActual(workspace, guard.path, mode)
      if (!guard.exists && actual.exists) throw occupiedError(guard.path)
      if (!guardMatches(guard, actual)) throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  private async revalidateDirectionState(
    manifest: WorkspaceEditJournalManifest,
    currentDirection: 'forward' | 'reverse',
  ) {
    const guards = currentDirection === 'forward' ? manifest.forwardGuards : manifest.reverseGuards
    if (!guards) throw new FsError('WORKSPACE_EDIT_STALE')
    await this.revalidateRecordedGuards(manifest, guards)
    const steps =
      currentDirection === 'forward'
        ? await this.reverseProgram(manifest)
        : await this.forwardProgram(manifest)
    await this.preflightProgram(
      manifest,
      steps.map((step) => ({ direction: currentDirection, step })),
    )
  }

  private async revalidateRecordedGuards(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditJournalGuard[],
  ) {
    if (guards.length === 0 && manifest.affectedPaths.length > 0) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }

    await this.assertGuardsMatch(manifest, guards)
  }

  private async snapshotCurrentGuards(manifest: WorkspaceEditJournalManifest) {
    const workspace = this.workspaceAbsolute(manifest)
    const mode = manifestReadMode(manifest)
    const guards: WorkspaceEditJournalGuard[] = []
    for (const relativePath of manifest.affectedPaths) {
      guards.push(actualGuard(await this.readActual(workspace, relativePath, mode)))
    }

    return guards
  }

  private async snapshotRecoveryGuards(manifest: WorkspaceEditJournalManifest) {
    try {
      return await this.snapshotCurrentGuards(manifest)
    } catch {
      return []
    }
  }

  private async publishTransitionOutcome(next: WorkspaceEditJournalManifest) {
    if (isProvisionalWorkspaceEditState(next.state)) return
    if (next.state === 'released' || next.state === 'aborted') {
      this.changes.forgetTransactionResults(next.operationId)
    } else {
      await this.recordTransactionResults(next)
    }
    if (next.state === 'partial') {
      this.changes.finishTransaction(
        next.operationId,
        'publish',
        this.invalidationEvents(next, next.unrecoveredPaths),
      )
      return
    }
    if (next.eventPublication === 'published') {
      this.changes.finishTransaction(
        next.operationId,
        'publish',
        await this.safeSemanticEvents(next),
      )
      return
    }
    this.changes.finishTransaction(next.operationId, 'drop')
  }

  private async recordTransactionResults(manifest: WorkspaceEditJournalManifest) {
    const entries = await this.resultEntries(manifest, semanticOperationPaths(manifest.legs))
    const results = entries.map((entry) => ({
      exists: entry.exists,
      path: joinRelative(manifest.workspace, entry.path),
      version: entry.exists && entry.type === 'file' ? entry.version : undefined,
    }))
    this.changes.recordTransactionResults(manifest.operationId, manifest.generation, results)
  }

  private async safeSemanticEvents(manifest: WorkspaceEditJournalManifest) {
    try {
      return await this.semanticEvents(manifest)
    } catch {
      return this.invalidationEvents(manifest, manifest.affectedPaths)
    }
  }

  private invalidationEvents(
    manifest: WorkspaceEditJournalManifest,
    relativePaths: readonly string[],
  ) {
    return relativePaths.map((relativePath) => ({
      origin: 'workspace-edit' as const,
      path: joinRelative(manifest.workspace, relativePath),
      type: 'changed' as const,
      writeId: manifest.operationId,
    }))
  }

  private async forwardProgram(manifest: WorkspaceEditJournalManifest) {
    const steps: WorkspaceEditProgramStep[] = []

    for (const leg of manifest.legs) {
      if (leg.kind === 'write') {
        steps.push(writeStep(leg))
        continue
      }
      if (leg.kind === 'copy') {
        steps.push(await this.restoreOr(manifest, leg.undoSlot, leg.newPath, copyStep(leg)))
        continue
      }
      if (leg.noOp) continue
      if (leg.kind === 'create') {
        await this.addCreateForwardSteps(manifest, leg, steps)
        continue
      }
      if (leg.kind === 'rename') {
        this.addRenameForwardSteps(leg, steps)
        continue
      }

      steps.push({
        from: workspacePathRef(leg.path),
        kind: 'move',
        to: journalPathRef(leg.reservedPath!),
      })
    }

    return steps
  }

  private async addCreateForwardSteps(
    manifest: WorkspaceEditJournalManifest,
    leg: Extract<WorkspaceEditPreparedLeg, { kind: 'create' }>,
    steps: WorkspaceEditProgramStep[],
  ) {
    if (leg.destinationExists && leg.overwrite) {
      steps.push({
        from: workspacePathRef(leg.path),
        kind: 'move',
        to: journalPathRef(leg.reservedPath!),
      })
    }

    const create: WorkspaceEditProgramStep = leg.folder
      ? { folder: true, kind: 'create', path: leg.path }
      : { kind: 'create', path: leg.path }
    steps.push(await this.restoreOr(manifest, leg.undoSlot, leg.path, create))
  }

  /** A redo returns what the undo parked, edits and all; only the first forward creates afresh. */
  private async restoreOr(
    manifest: WorkspaceEditJournalManifest,
    undoSlot: string,
    relativePath: string,
    fresh: WorkspaceEditProgramStep,
  ): Promise<WorkspaceEditProgramStep> {
    if (!(await this.journalPathExists(manifest, undoSlot))) return fresh

    return { from: journalPathRef(undoSlot), kind: 'move', to: workspacePathRef(relativePath) }
  }

  private addRenameForwardSteps(
    leg: Extract<WorkspaceEditPreparedLeg, { kind: 'rename' }>,
    steps: WorkspaceEditProgramStep[],
  ) {
    if (leg.destinationExists && leg.overwrite) {
      steps.push({
        from: workspacePathRef(leg.newPath),
        kind: 'move',
        to: journalPathRef(leg.reservedPath!),
      })
    }

    steps.push({
      from: workspacePathRef(leg.oldPath),
      kind: 'move',
      to: workspacePathRef(leg.newPath),
    })
  }

  private async reverseProgram(manifest: WorkspaceEditJournalManifest) {
    const steps: WorkspaceEditProgramStep[] = []

    for (const leg of manifest.legs.toReversed()) {
      if (leg.kind === 'write') {
        steps.push(writeStep(leg))
        continue
      }
      if (leg.kind === 'copy') {
        steps.push(parkStep(leg.newPath, leg.undoSlot))
        continue
      }
      if (leg.noOp) continue
      if (leg.kind === 'create') {
        steps.push(parkStep(leg.path, leg.undoSlot))
        if (leg.reservedPath && (await this.journalPathExists(manifest, leg.reservedPath))) {
          steps.push({
            from: journalPathRef(leg.reservedPath),
            kind: 'move',
            to: workspacePathRef(leg.path),
          })
        }
        continue
      }
      if (leg.kind === 'rename') {
        steps.push({
          from: workspacePathRef(leg.newPath),
          kind: 'move',
          to: workspacePathRef(leg.oldPath),
        })
        if (leg.reservedPath && (await this.journalPathExists(manifest, leg.reservedPath))) {
          steps.push({
            from: journalPathRef(leg.reservedPath),
            kind: 'move',
            to: workspacePathRef(leg.newPath),
          })
        }
        continue
      }

      steps.push({
        from: journalPathRef(leg.reservedPath!),
        kind: 'move',
        to: workspacePathRef(leg.path),
      })
    }

    return steps
  }

  private async executeProgram(
    manifest: WorkspaceEditJournalManifest,
    steps: readonly WorkspaceEditProgramStep[],
    direction: 'forward' | 'reverse',
    transitionId: string,
  ): Promise<ProgramExecution> {
    const executed: WorkspaceEditRecoveryStep[] = []

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex]!
      const guards = await this.intentGuards(manifest, step, direction)
      await this.assertIntentGuards(manifest, guards.before)
      await this.journalOf(manifest.operationId).append(manifest.operationId, {
        after: guards.after,
        before: guards.before,
        direction,
        step,
        stepIndex,
        transitionId,
        type: 'intent',
      })
      executed.push({ direction, step })
      try {
        await this.applyStep(manifest, step, direction)
        await this.assertIntentGuards(manifest, guards.after)
        await this.journalOf(manifest.operationId).append(manifest.operationId, {
          stepIndex,
          transitionId,
          type: 'complete',
        })
      } catch (error) {
        const beforeStillMatches = await this.intentGuardsCurrentlyMatch(manifest, guards.before)
        const failedSteps = beforeStillMatches ? executed.slice(0, -1) : executed
        return { error, ok: false, remaining: steps.slice(stepIndex), steps: failedSteps }
      }
    }

    return { ok: true, steps: executed }
  }

  private async compensate(
    manifest: WorkspaceEditJournalManifest,
    executed: readonly WorkspaceEditRecoveryStep[],
    transitionId: string,
  ): Promise<CompensationResult> {
    return this.executeRecoveryProgram(
      manifest,
      executed.toReversed().map(invertRecoveryStep),
      transitionId,
      true,
    )
  }

  private async executeRecoveryProgram(
    manifest: WorkspaceEditJournalManifest,
    program: readonly WorkspaceEditRecoveryStep[],
    transitionId: string,
    reverseStepIndexes = false,
  ) {
    for (let index = 0; index < program.length; index += 1) {
      const current = program[index]!
      try {
        const guards = await this.intentGuards(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.before)
        await this.applyStep(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.after)
        await this.journalOf(manifest.operationId).append(manifest.operationId, {
          stepIndex: reverseStepIndexes ? program.length - index - 1 : index,
          transitionId,
          type: 'compensated',
        })
      } catch {
        return { ok: false as const, remaining: program.slice(index) }
      }
    }

    return { ok: true as const }
  }

  private async preflightRecovery(
    manifest: WorkspaceEditJournalManifest,
    program: readonly WorkspaceEditRecoveryStep[],
  ) {
    await this.preflightProgram(manifest, program)
  }

  private async preflightProgram(
    manifest: WorkspaceEditJournalManifest,
    program: readonly WorkspaceEditRecoveryStep[],
  ) {
    const existence = new Map<string, boolean>()
    for (const recovery of program) {
      await this.assertStepMutationPaths(manifest, recovery.step)
      await this.preflightStep(manifest, recovery, existence)
    }
  }

  private async preflightStep(
    manifest: WorkspaceEditJournalManifest,
    recovery: WorkspaceEditRecoveryStep,
    existence: Map<string, boolean>,
  ) {
    const step = recovery.step
    if (step.kind === 'write') {
      const target = this.workspaceTarget(manifest, step.path)
      if (await this.virtualPathExists(target, existence)) return
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    if (step.kind === 'create') {
      const target = this.workspaceTarget(manifest, step.path)
      if (await this.virtualPathExists(target, existence)) throw occupiedError(step.path)
      existence.set(target, true)
      return
    }
    if (step.kind === 'remove') {
      const target = this.workspaceTarget(manifest, step.path)
      if (!(await this.virtualPathExists(target, existence))) {
        throw new FsError('WORKSPACE_EDIT_STALE')
      }
      existence.set(target, false)
      return
    }

    const source = this.resolvePathReference(manifest, step.from)
    const destination = this.resolvePathReference(manifest, step.to)
    if (!(await this.virtualPathExists(source, existence))) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    if (await this.virtualPathExists(destination, existence)) throw occupiedReferenceError(step.to)
    if (step.kind === 'move') existence.set(source, false)
    existence.set(destination, true)
  }

  private async virtualPathExists(target: string, existence: Map<string, boolean>) {
    const known = existence.get(target)
    if (known !== undefined) return known

    const exists = await this.pathExists(target)
    existence.set(target, exists)
    return exists
  }

  private async applyStep(
    manifest: WorkspaceEditJournalManifest,
    step: WorkspaceEditProgramStep,
    direction: 'forward' | 'reverse',
  ) {
    await this.assertStepMutationPaths(manifest, step)
    if (step.kind === 'move') {
      await this.movePath(manifest, step)
      return
    }
    if (step.kind === 'copy') {
      await this.copyPath(manifest, step)
      return
    }
    if (step.kind === 'create') {
      await this.createEmptyPath(manifest, step.path, step.folder ?? false)
      return
    }
    if (step.kind === 'remove') {
      await this.removeWorkspacePath(manifest, step.path)
      return
    }

    await this.applyWrite(manifest, step, direction)
  }

  private async intentGuards(
    manifest: WorkspaceEditJournalManifest,
    step: WorkspaceEditProgramStep,
    direction: 'forward' | 'reverse',
  ) {
    const mode: ReadMode = step.kind === 'write' ? 'content' : 'entry'
    const references = stepReferences(step)
    const before = await Promise.all(
      references.map((reference) => this.intentPathGuard(manifest, reference, mode)),
    )
    const after = await this.expectedIntentAfter(manifest, step, direction, before)
    return { after, before }
  }

  private async expectedIntentAfter(
    manifest: WorkspaceEditJournalManifest,
    step: WorkspaceEditProgramStep,
    direction: 'forward' | 'reverse',
    before: readonly WorkspaceEditIntentPathGuard[],
  ): Promise<readonly WorkspaceEditIntentPathGuard[]> {
    if (step.kind === 'move') {
      const source = before[0]!
      const sameDevice = await this.movesWithinDevice(manifest, step)
      return [
        { exists: false, reference: step.from },
        sameDevice
          ? { ...source, reference: step.to }
          : { exists: true, reference: step.to, type: source.type },
      ]
    }
    if (step.kind === 'copy') {
      return [before[0]!, { exists: true, reference: step.to, type: before[0]!.type }]
    }
    if (step.kind === 'create' && step.folder) {
      return [{ exists: true, reference: workspacePathRef(step.path), type: 'directory' }]
    }
    if (step.kind === 'create') {
      return [
        {
          exists: true,
          reference: workspacePathRef(step.path),
          size: 0,
          type: 'file',
          version: hashBytes(new Uint8Array()),
        },
      ]
    }
    if (step.kind === 'remove') {
      return [{ exists: false, reference: workspacePathRef(step.path) }]
    }

    const stage = direction === 'forward' ? step.afterStage : step.beforeStage
    const bytes = await this.journalOf(manifest.operationId).readStage(manifest.operationId, stage)
    return [
      {
        exists: true,
        mode: direction === 'reverse' ? step.beforeMode : before[0]?.mode,
        reference: workspacePathRef(step.path),
        size: bytes.byteLength,
        type: 'file',
        version: hashBytes(bytes),
      },
    ]
  }

  private async intentPathGuard(
    manifest: WorkspaceEditJournalManifest,
    reference: string,
    mode: ReadMode,
  ): Promise<WorkspaceEditIntentPathGuard> {
    const target = reference.startsWith('workspace:')
      ? await this.resolveTarget(
          this.workspaceAbsolute(manifest),
          reference.slice('workspace:'.length),
        )
      : this.resolvePathReference(manifest, reference)
    const stats = await statOptionalVia(this.driver.lstat, target)
    if (!stats) return { exists: false, reference }
    const type = resourceType(stats)
    if (!type) throw new FsError('WORKSPACE_EDIT_STALE')
    if (mode === 'entry') return { dev: stats.dev, exists: true, ino: stats.ino, reference, type }
    if (type !== 'file') throw new FsError('WORKSPACE_EDIT_STALE')
    const bytes = await this.driver.readFile(target)
    return {
      dev: stats.dev,
      exists: true,
      ino: stats.ino,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
      reference,
      size: stats.size,
      type,
      version: hashBytes(bytes),
    }
  }

  private async assertIntentGuards(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditIntentPathGuard[],
  ) {
    for (const expected of guards) {
      const mode: ReadMode = expected.version === undefined ? 'entry' : 'content'
      const actual = await this.intentPathGuard(manifest, expected.reference, mode)
      if (!intentGuardMatches(expected, actual)) throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  private async assertStepMutationPaths(
    manifest: WorkspaceEditJournalManifest,
    step: WorkspaceEditProgramStep,
  ) {
    const workspace = this.workspaceAbsolute(manifest)
    for (const reference of stepReferences(step)) {
      if (reference.startsWith('workspace:')) {
        await this.resolveTarget(workspace, reference.slice('workspace:'.length))
        continue
      }

      const target = this.resolvePathReference(manifest, reference)
      const parent = await this.driver.lstat(path.dirname(target))
      if (parent.isSymbolicLink() || !parent.isDirectory()) {
        throw new FsError('WORKSPACE_EDIT_STALE')
      }
      const stats = await statOptionalVia(this.driver.lstat, target)
      if (stats?.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  /** A rename keeps the inode; between drives the resource is copied, so only its type survives. */
  private async movesWithinDevice(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'move' }>,
  ) {
    const from = this.resolvePathReference(manifest, step.from)
    const to = this.resolvePathReference(manifest, step.to)
    const source = await statOptionalVia(this.driver.lstat, from)
    if (!source) return true

    return source.dev === (await this.driver.stat(path.dirname(to))).dev
  }

  private async movePath(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'move' }>,
  ) {
    const from = this.resolvePathReference(manifest, step.from)
    const to = this.resolvePathReference(manifest, step.to)
    if (await this.movesWithinDevice(manifest, step)) {
      await this.driver.rename(from, to)
    } else {
      await this.copyIntoPlace(manifest, from, to, step.to)
      await this.driver.rm(from, { force: false, recursive: true })
    }
    await this.fsyncDirectories(path.dirname(from), path.dirname(to))
  }

  private async copyPath(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'copy' }>,
  ) {
    const from = this.resolvePathReference(manifest, step.from)
    const to = this.resolvePathReference(manifest, step.to)
    await this.copyIntoPlace(manifest, from, to, step.to)
    await fsyncVia(this.driver.open, path.dirname(to))
  }

  /** Copies beside the destination and renames into place, so a crash never leaves half a copy there. */
  private async copyIntoPlace(
    manifest: WorkspaceEditJournalManifest,
    from: string,
    to: string,
    toReference: string,
  ) {
    const temporary = path.join(path.dirname(to), `.${path.basename(to)}.${randomUUID()}.partial`)
    if (toReference.startsWith('workspace:')) {
      const relative = path.posix.join(
        path.posix.dirname(toReference.slice('workspace:'.length)),
        path.basename(temporary),
      )
      this.changes.addTransactionPaths(manifest.operationId, [
        joinRelative(manifest.workspace, relative),
      ])
    }
    let placed = false
    try {
      await this.driver.cp(from, temporary, {
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      })
      await this.syncTree(temporary)
      await this.driver.rename(temporary, to)
      placed = true
    } finally {
      if (!placed) await this.driver.rm(temporary, { force: true, recursive: true })
    }
  }

  private async syncTree(target: string): Promise<void> {
    const stats = await this.driver.lstat(target)
    if (stats.isSymbolicLink()) return
    if (stats.isDirectory()) {
      const entries = await this.driver.readdir(target, { withFileTypes: true })
      for (const entry of entries) await this.syncTree(path.join(target, entry.name))
    }
    await fsyncVia(this.driver.open, target)
  }

  private async createEmptyPath(
    manifest: WorkspaceEditJournalManifest,
    relativePath: string,
    folder: boolean,
  ) {
    const target = this.workspaceTarget(manifest, relativePath)
    if (folder) {
      await this.driver.mkdir(target, { mode: 0o755, recursive: false })
    } else {
      await this.driver.writeFile(target, new Uint8Array(), { flag: 'wx', mode: 0o600 })
    }
    await fsyncVia(this.driver.open, target)
    await fsyncVia(this.driver.open, path.dirname(target))
  }

  /** Compensation only: removes an empty created resource or a copy this operation made. */
  private async removeWorkspacePath(manifest: WorkspaceEditJournalManifest, relativePath: string) {
    const target = this.workspaceTarget(manifest, relativePath)
    const stats = await this.driver.lstat(target)
    await this.driver.rm(target, { force: false, recursive: stats.isDirectory() })
    await fsyncVia(this.driver.open, path.dirname(target))
  }

  private async applyWrite(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'write' }>,
    direction: 'forward' | 'reverse',
  ) {
    const target = this.workspaceTarget(manifest, step.path)
    const stage = direction === 'forward' ? step.afterStage : step.beforeStage
    const bytes = await this.journalOf(manifest.operationId).readStage(manifest.operationId, stage)
    const current = await this.driver.lstat(target)
    if (!current.isFile() || current.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_STALE')
    const temporary = atomicTemporaryPath(target)
    const mode = direction === 'reverse' ? step.beforeMode : current.mode
    const temporaryRelativePath = path.posix.join(
      path.posix.dirname(step.path),
      path.basename(temporary),
    )
    this.changes.addTransactionPaths(manifest.operationId, [
      joinRelative(manifest.workspace, temporaryRelativePath),
    ])

    await writeFileAtomic(target, bytes, {
      driver: this.driver,
      durability: 'fsync-all',
      mode,
      temporary,
    })
    if (direction !== 'reverse') return
    const beforeTime = new Date(step.beforeMtimeMs)
    await this.driver.utimes(target, beforeTime, beforeTime)
    await fsyncVia(this.driver.open, target)
  }

  private resolvePathReference(manifest: WorkspaceEditJournalManifest, reference: string) {
    if (reference.startsWith('workspace:')) {
      return this.workspaceTarget(manifest, reference.slice('workspace:'.length))
    }
    if (reference.startsWith('journal:')) {
      return this.journalOf(manifest.operationId).storedPath(
        manifest.operationId,
        reference.slice('journal:'.length),
      )
    }

    throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private workspaceTarget(manifest: WorkspaceEditJournalManifest, relativePath: string) {
    const workspace = this.workspaceAbsolute(manifest)
    const target = path.resolve(workspace, relativePath)
    assertInside(workspace, target)
    return target
  }

  private workspaceAbsolute(manifest: WorkspaceEditJournalManifest) {
    const workspace = path.resolve(this.paths.workspaceRootReal, manifest.workspace)
    assertInside(this.paths.workspaceRootReal, workspace)
    return workspace
  }

  private async journalPathExists(manifest: WorkspaceEditJournalManifest, relativePath: string) {
    return this.pathExists(
      this.journalOf(manifest.operationId).storedPath(manifest.operationId, relativePath),
    )
  }

  private async pathExists(target: string) {
    return (await statOptionalVia(this.driver.lstat, target)) !== null
  }

  private async result(manifest: WorkspaceEditJournalManifest): Promise<WorkspaceEditResult> {
    return {
      affectedPaths: manifest.affectedPaths,
      entries: await this.resultEntries(manifest),
      eventPublication: manifest.eventPublication,
      generation: manifest.generation,
      operationId: manifest.operationId,
      recoveryTarget: manifest.recoveryTarget,
      rolledBackPaths: manifest.rolledBackPaths,
      serverEpoch: this.serverEpoch,
      state: manifest.state,
      unrecoveredPaths: manifest.unrecoveredPaths,
    }
  }

  private async resultEntries(
    manifest: WorkspaceEditJournalManifest,
    relativePaths: readonly string[] = manifest.affectedPaths,
  ) {
    const entries: WorkspaceEditResultEntry[] = []
    for (const relativePath of relativePaths) {
      const entry = await this.resultEntry(manifest, relativePath)
      if (entry) entries.push(entry)
    }
    return entries
  }

  private async resultEntry(
    manifest: WorkspaceEditJournalManifest,
    relativePath: string,
  ): Promise<WorkspaceEditResultEntry | null> {
    try {
      const target = await this.resolveTarget(this.workspaceAbsolute(manifest), relativePath)
      const stats = await statOptionalVia(this.driver.lstat, target)
      if (!stats) return { exists: false, path: relativePath }
      if (stats.isSymbolicLink()) return null
      if (stats.isDirectory()) {
        return { exists: true, mtimeMs: stats.mtimeMs, path: relativePath, type: 'directory' }
      }
      if (!stats.isFile()) return null
      // A file operation never reads contents: its entries carry the stat version the tree uses.
      const version =
        manifestReadMode(manifest) === 'entry'
          ? fileVersion(stats)
          : hashBytes(await this.driver.readFile(target))
      return {
        exists: true,
        mtimeMs: stats.mtimeMs,
        path: relativePath,
        size: stats.size,
        type: 'file',
        version,
      }
    } catch {
      return null
    }
  }

  private async semanticEvents(manifest: WorkspaceEditJournalManifest) {
    if (manifest.category === 'file-operation') return this.fileOperationEvents(manifest)
    const semanticPaths = semanticOperationPaths(manifest.legs)
    const entries = await this.resultEntries(manifest, semanticPaths)
    if (entries.length !== semanticPaths.length) throw new FsError('WORKSPACE_EDIT_STALE')

    const initialByPath = new Map(manifest.guards.map((guard) => [guard.path, guard]))
    const workspacePrefix = manifest.workspace
    const events = []
    for (const entry of entries) {
      const relativePath = joinRelative(workspacePrefix, entry.path)
      const existedBefore = initialByPath.get(entry.path)?.exists ?? false
      if (!entry.exists && existedBefore) {
        events.push({
          origin: 'workspace-edit',
          path: relativePath,
          type: 'deleted' as const,
          writeId: manifest.operationId,
        })
        continue
      }
      if (!entry.exists) continue

      events.push({
        origin: 'workspace-edit',
        path: relativePath,
        type: existedBefore ? ('changed' as const) : ('created' as const),
        ...(entry.type === 'file' ? { version: entry.version } : {}),
        writeId: manifest.operationId,
      })
    }

    return events
  }

  /**
   * One event per leg in the direction that landed. A move is a `renamed` event, so a window
   * that has not moved its documents follows the file, and the one that has ignores it.
   */
  private async fileOperationEvents(manifest: WorkspaceEditJournalManifest) {
    const reverse = manifest.state === 'undone'
    const legs = reverse ? manifest.legs.toReversed() : manifest.legs
    const events: WatchServerMessage[] = []
    for (const change of legs.flatMap((leg) => legChanges(leg, reverse))) {
      const relativePath = joinRelative(manifest.workspace, change.path)
      const writeId = fileOperationWriteId(manifest.operationId, manifest.generation)
      if (change.type === 'renamed') {
        const oldPath = joinRelative(manifest.workspace, change.oldPath)
        events.push({
          oldPath,
          origin: 'workspace-edit',
          path: relativePath,
          type: 'renamed',
          writeId,
        })
        continue
      }
      if (change.type === 'deleted') {
        events.push({ origin: 'workspace-edit', path: relativePath, type: 'deleted', writeId })
        continue
      }
      const entry = await this.resultEntry(manifest, change.path)
      const version = entry?.exists && entry.type === 'file' ? { version: entry.version } : {}
      events.push({
        origin: 'workspace-edit',
        path: relativePath,
        type: 'created',
        writeId,
        ...version,
      })
    }

    return events
  }

  private beginBarrier(manifest: WorkspaceEditJournalManifest) {
    this.changes.beginTransaction(
      manifest.operationId,
      manifest.affectedPaths.map((relativePath) => joinRelative(manifest.workspace, relativePath)),
    )
  }

  private acquireLease(operationId: string, root: string) {
    this.assertWorkspaceLeaseAvailable(operationId, root)
    const lease: WorkspaceLease = {
      expiresAt: this.clock() + WORKSPACE_EDIT_LEASE_MS,
      operationId,
      root,
      running: false,
    }
    this.leases.set(operationId, lease)
    this.scheduleLease(lease)
  }

  private assertWorkspaceLeaseAvailable(operationId: string, root: string) {
    for (const lease of this.leases.values()) {
      if (lease.operationId === operationId) continue
      if (pathsOverlap(lease.root, root)) throw new FsError('WORKSPACE_EDIT_BUSY')
    }
    for (const mutation of this.legacyMutations) {
      if (pathsOverlap(mutation, root)) throw new FsError('WORKSPACE_EDIT_BUSY')
    }
  }

  private assertLegacyMutationAvailable(targets: readonly string[]) {
    for (const lease of this.leases.values()) {
      if (targets.some((target) => pathsOverlap(target, lease.root))) {
        throw new FsError('WORKSPACE_EDIT_BUSY')
      }
    }
    for (const mutation of this.legacyMutations) {
      if (targets.some((target) => pathsOverlap(target, mutation))) {
        throw new FsError('WORKSPACE_EDIT_BUSY')
      }
    }
  }

  private renewLease(operationId: string) {
    const lease = this.leases.get(operationId)
    if (!lease) return

    clearTimeout(lease.timer)
    lease.expiresAt = this.clock() + WORKSPACE_EDIT_LEASE_MS
    this.scheduleLease(lease)
  }

  private scheduleLease(lease: WorkspaceLease) {
    const delay = Math.max(0, lease.expiresAt - this.clock())
    lease.timer = setTimeout(() => {
      runDetached(() => this.expireLease(lease.operationId), {
        area: 'fs',
        operation: 'workspace_edit_expire_lease',
        operationId: lease.operationId,
      })
    }, delay)
    lease.timer.unref?.()
  }

  private releaseLease(operationId: string) {
    const lease = this.leases.get(operationId)
    if (!lease) return
    clearTimeout(lease.timer)
    this.leases.delete(operationId)
  }

  private async reapExpired() {
    const expired = Array.from(this.leases.values()).filter(
      (lease) => !lease.running && lease.expiresAt <= this.clock(),
    )
    for (const lease of expired) await this.expireLease(lease.operationId)
    await this.reapExpiredStableJournals()
  }

  private async reapExpiredStableJournals() {
    const expired = Array.from(this.slots.values())
      .map((slot) => slot.manifest)
      .filter((manifest): manifest is WorkspaceEditJournalManifest => Boolean(manifest))
      .filter((manifest) => WORKSPACE_EDIT_STABLE_STATES.has(manifest.state))
      .filter((manifest) => manifest.touchedAt + WORKSPACE_EDIT_STABLE_TTL_MS <= this.clock())

    for (const manifest of expired) {
      await this.journalOf(manifest.operationId).remove(manifest.operationId)
      this.changes.forgetTransactionResults(manifest.operationId)
      const slot = this.slots.get(manifest.operationId)
      if (!slot) continue
      slot.manifest = advanceManifest(manifest, 'released', this.clock())
    }
  }

  private async expireLease(operationId: string) {
    const release = await this.transitionMutex.acquire(operationId)
    try {
      await this.expireLeaseLocked(operationId)
    } finally {
      release()
    }
  }

  private async expireLeaseLocked(operationId: string) {
    const lease = this.leases.get(operationId)
    if (!lease || lease.running || lease.expiresAt > this.clock()) return
    const slot = this.slots.get(operationId)
    if (!slot?.manifest) {
      this.releaseLease(operationId)
      return
    }
    if (slot.manifest.state === 'prepared') {
      const next = advanceManifest(slot.manifest, 'aborted', this.clock(), {
        eventPublication: 'suppressed',
      })
      await this.journalOf(next.operationId).persist(next)
      slot.manifest = next
      this.releaseLease(operationId)
      await this.journalOf(operationId).clearStaging(operationId)
      return
    }
    if (!isProvisionalWorkspaceEditState(slot.manifest.state)) return

    const transitionId = randomUUID()
    const next = await this.rollbackProvisional(slot.manifest, transitionId)
    await this.journalOf(next.operationId).persist(next)
    slot.manifest = next
    await this.publishTransitionOutcome(next)
    if (shouldClearTerminalStaging(next.state)) {
      await this.journalOf(operationId).clearStaging(operationId)
    }
    this.finishTransitionLease(next)
  }

  private async ensureInitialized() {
    this.initializePromise ??= this.initialize()
    return this.initializePromise
  }

  private async initialize() {
    await this.ensureJournalLoaded((await this.journals.homeJournal()).journal)
  }

  /** Replays a journal's crash recovery the first time any operation needs it. */
  private ensureJournalLoaded(journal: WorkspaceEditJournal) {
    let loaded = this.loadedJournals.get(journal)
    if (!loaded) {
      loaded = this.loadJournal(journal)
      this.loadedJournals.set(journal, loaded)
    }

    return loaded
  }

  private async loadJournal(journal: WorkspaceEditJournal) {
    await journal.initialize()
    const manifests = await journal.list()
    for (const manifest of manifests) {
      this.journalByOperation.set(manifest.operationId, journal)
      this.historySequence = Math.max(this.historySequence, manifest.historySequence)
    }
    for (const manifest of manifests) await this.recoverStartupManifest(manifest)
  }

  private journalOf(operationId: string) {
    const journal = this.journalByOperation.get(operationId)
    if (!journal) throw new FsError('WORKSPACE_EDIT_NOT_FOUND')

    return journal
  }

  private async recoverStartupManifest(manifest: WorkspaceEditJournalManifest) {
    if (manifest.activeTransition) {
      const previousState = manifest.activeTransition.previousState
      if (await this.recoverActiveTransition(manifest)) return

      const restored = {
        ...manifest,
        activeTransition: undefined,
        state: previousState,
      }
      await this.journalOf(restored.operationId).persist(restored)
      await this.recoverStartupManifest(restored)
      return
    }
    if (manifest.state === 'partial') {
      this.slots.set(manifest.operationId, { cancelled: false, manifest })
      return
    }
    if (WORKSPACE_EDIT_STABLE_STATES.has(manifest.state)) {
      // The file history outlives a restart; every window reads it from here.
      const retained = manifest.touchedAt + WORKSPACE_EDIT_STABLE_TTL_MS > this.clock()
      if (manifest.category === 'file-operation' && retained) {
        this.slots.set(manifest.operationId, { cancelled: false, manifest })
        return
      }
      await this.journalOf(manifest.operationId).remove(manifest.operationId)
      return
    }
    if (manifest.state === 'prepared' || manifest.state === 'preparing') {
      await this.journalOf(manifest.operationId).remove(manifest.operationId)
      return
    }
    if (manifest.state === 'committed') {
      await this.recoverStartupDirection(manifest, 'reverse', 'rolled-back')
      return
    }
    if (manifest.state === 'redo-committed') {
      await this.recoverStartupDirection(manifest, 'reverse', 'undone')
      return
    }
    if (manifest.state === 'undo-committed') {
      await this.recoverStartupDirection(
        manifest,
        'forward',
        manifest.provisionalFrom ?? 'finalized',
      )
      return
    }

    await this.journalOf(manifest.operationId).remove(manifest.operationId)
  }

  private async recoverActiveTransition(manifest: WorkspaceEditJournalManifest) {
    if (!manifest.activeTransition) return false
    const records = await this.journalOf(manifest.operationId).records(manifest.operationId)
    const compensatedSteps = new Set(
      records
        .filter((record) => record.type === 'compensated')
        .filter((record) => record.transitionId === manifest.activeTransition!.transitionId)
        .map((record) => record.stepIndex),
    )
    const intents = records
      .filter((record) => record.type === 'intent')
      .filter((record) => record.transitionId === manifest.activeTransition!.transitionId)
      .filter((record) => !compensatedSteps.has(record.stepIndex))
    const executed: WorkspaceEditRecoveryStep[] = []
    let ambiguous = false
    for (const intent of intents) {
      if (await this.intentGuardsCurrentlyMatch(manifest, intent.after)) {
        executed.push({ direction: intent.direction, step: intent.step })
        continue
      }
      if (await this.intentGuardsCurrentlyMatch(manifest, intent.before)) continue

      ambiguous = true
      executed.push({ direction: intent.direction, step: intent.step })
    }
    if (ambiguous) {
      await this.persistStartupPartial(manifest, executed)
      return true
    }
    const compensation = await this.compensate(
      manifest,
      executed,
      manifest.activeTransition.transitionId,
    )
    if (compensation.ok) return false

    const partial = advanceManifest(manifest, 'partial', this.clock(), {
      activeTransition: undefined,
      recoveryGuards: await this.snapshotRecoveryGuards(manifest),
      recoveryProgram: compensation.remaining,
      recoveryTarget: compensationTarget(manifest, manifest.activeTransition.direction),
      unrecoveredPaths: recoveryPaths(compensation.remaining),
    })
    await this.journalOf(partial.operationId).persist(partial)
    this.slots.set(partial.operationId, { cancelled: false, manifest: partial })
    return true
  }

  private async intentGuardsCurrentlyMatch(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditIntentPathGuard[],
  ) {
    try {
      await this.assertIntentGuards(manifest, guards)
      return true
    } catch {
      return false
    }
  }

  private async persistStartupPartial(
    manifest: WorkspaceEditJournalManifest,
    executed: readonly WorkspaceEditRecoveryStep[],
  ) {
    const recoveryProgram = executed.toReversed().map(invertRecoveryStep)
    const partial = advanceManifest(manifest, 'partial', this.clock(), {
      activeTransition: undefined,
      recoveryGuards: await this.snapshotRecoveryGuards(manifest),
      recoveryProgram,
      recoveryTarget: compensationTarget(manifest, manifest.activeTransition!.direction),
      unrecoveredPaths: recoveryPaths(recoveryProgram),
    })
    await this.journalOf(partial.operationId).persist(partial)
    this.slots.set(partial.operationId, { cancelled: false, manifest: partial })
  }

  private async recoverStartupDirection(
    manifest: WorkspaceEditJournalManifest,
    direction: 'forward' | 'reverse',
    target: WorkspaceEditState,
  ) {
    const steps =
      direction === 'forward'
        ? await this.forwardProgram(manifest)
        : await this.reverseProgram(manifest)
    const guards = direction === 'forward' ? manifest.reverseGuards : manifest.forwardGuards
    if (!guards || !(await this.recordedGuardsCurrentlyMatch(manifest, guards))) {
      await this.persistStartupRecoveryPartial(manifest, direction, steps, target)
      return
    }
    const execution = await this.executeProgram(manifest, steps, direction, randomUUID())
    if (!execution.ok) {
      await this.persistStartupRecoveryPartial(manifest, direction, execution.remaining, target)
      return
    }
    if (manifest.category === 'file-operation' && WORKSPACE_EDIT_STABLE_STATES.has(target)) {
      await this.persistStartupHistoryState(manifest, direction, target)
      return
    }

    await this.journalOf(manifest.operationId).remove(manifest.operationId)
  }

  /**
   * An interrupted undo or redo of a file operation lands back where it started, still in the
   * history: its journal holds whatever the undo parked, and removing it would delete that.
   */
  private async persistStartupHistoryState(
    manifest: WorkspaceEditJournalManifest,
    direction: 'forward' | 'reverse',
    target: WorkspaceEditState,
  ) {
    const recovered = advanceManifest(manifest, target, this.clock(), {
      activeTransition: undefined,
      eventPublication: 'published',
      provisionalFrom: undefined,
      stagedBytes: await this.journalHeldBytes(manifest),
      ...directionGuardChange(direction, await this.snapshotCurrentGuards(manifest)),
    })
    await this.journalOf(recovered.operationId).persist(recovered)
    this.slots.set(recovered.operationId, { cancelled: false, manifest: recovered })
  }

  private async recordedGuardsCurrentlyMatch(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditJournalGuard[],
  ) {
    try {
      await this.revalidateRecordedGuards(manifest, guards)
      return true
    } catch {
      return false
    }
  }

  private async persistStartupRecoveryPartial(
    manifest: WorkspaceEditJournalManifest,
    direction: 'forward' | 'reverse',
    steps: readonly WorkspaceEditProgramStep[],
    target: WorkspaceEditState,
  ) {
    const recoveryProgram = steps.map((step) => ({ direction, step }))
    const partial = advanceManifest(manifest, 'partial', this.clock(), {
      recoveryGuards: await this.snapshotRecoveryGuards(manifest),
      recoveryProgram,
      recoveryTarget: target as WorkspaceEditRecoveryTarget,
      unrecoveredPaths: recoveryPaths(recoveryProgram),
    })
    await this.journalOf(partial.operationId).persist(partial)
    this.slots.set(partial.operationId, { cancelled: false, manifest: partial })
  }

  private async fsyncDirectories(...targets: string[]) {
    for (const target of new Set(targets)) await fsyncVia(this.driver.open, target)
  }
}

function preparedManifest(
  body: WorkspaceEditPrepareRequest,
  plan: PreparedPlan,
  now: number,
): WorkspaceEditJournalManifest {
  return {
    affectedPaths: plan.affectedPaths,
    bodyDigest: body.bodyDigest,
    category: body.category,
    createdAt: now,
    eventPublication: 'pending',
    generation: 1,
    guards: plan.guards,
    historySequence: 0,
    label: body.label,
    legs: plan.legs,
    operationId: body.operationId,
    rolledBackPaths: [],
    stagedBytes: plan.stagedBytes,
    state: 'prepared',
    touchedAt: now,
    transitionResults: {},
    unrecoveredPaths: [],
    version: 1,
    workspace: body.workspace,
  }
}

function advanceManifest(
  manifest: WorkspaceEditJournalManifest,
  state: WorkspaceEditState,
  now: number,
  changes: Partial<WorkspaceEditJournalManifest> = {},
): WorkspaceEditJournalManifest {
  return {
    ...manifest,
    ...changes,
    generation: manifest.generation + 1,
    state,
    touchedAt: now,
  }
}

function withActiveTransition(
  manifest: WorkspaceEditJournalManifest,
  direction: 'forward' | 'reverse',
  transitionId: string,
): WorkspaceEditJournalManifest {
  return {
    ...manifest,
    activeTransition: { direction, previousState: manifest.state, transitionId },
  }
}

function cacheTransition(
  manifest: WorkspaceEditJournalManifest,
  kind: WorkspaceEditTransitionKind,
  body: WorkspaceEditTransitionRequest,
  result: WorkspaceEditResult,
  now: number,
): WorkspaceEditJournalManifest {
  return {
    ...manifest,
    touchedAt: now,
    transitionResults: {
      ...manifest.transitionResults,
      [body.transitionId]: {
        fingerprint: transitionFingerprint(kind, body),
        result,
      },
    },
  }
}

function cachedTransition(
  manifest: WorkspaceEditJournalManifest,
  kind: WorkspaceEditTransitionKind,
  body: WorkspaceEditTransitionRequest,
) {
  const cached = manifest.transitionResults[body.transitionId]
  if (!cached) return undefined
  if (cached.fingerprint !== transitionFingerprint(kind, body)) {
    throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  return cached.result
}

function transitionFingerprint(
  kind: WorkspaceEditTransitionKind,
  body: WorkspaceEditTransitionRequest,
) {
  return canonicalJson({ body, kind })
}

function prepareFingerprint(body: WorkspaceEditPrepareRequest) {
  return canonicalJson({
    bodyDigest: body.bodyDigest,
    category: body.category,
    label: body.label,
    operationId: body.operationId,
    operations: body.operations,
    origin: body.origin,
    workspace: body.workspace,
  })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const record = value as Record<string, unknown>
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${fields.join(',')}}`
}

function finalizedState(state: WorkspaceEditState): WorkspaceEditState {
  if (state === 'committed') return 'finalized'
  if (state === 'undo-committed') return 'undone'
  if (state === 'redo-committed') return 'redone'

  throw new FsError('WORKSPACE_EDIT_STALE')
}

function compensationTarget(
  manifest: WorkspaceEditJournalManifest,
  direction: 'forward' | 'reverse',
): WorkspaceEditRecoveryTarget {
  if (manifest.state === 'prepared') return 'rolled-back'
  if (direction === 'forward' && manifest.state === 'undone') return 'undone'
  if (direction === 'reverse' && manifest.state === 'redo-committed') return 'redone'
  if (direction === 'reverse') return manifest.state === 'redone' ? 'redone' : 'finalized'
  if (manifest.provisionalFrom) return manifest.provisionalFrom

  return 'rolled-back'
}

function isLeaseHoldingState(state: WorkspaceEditState) {
  return state === 'preparing' || state === 'prepared' || state.endsWith('-committed')
}

function shouldClearTerminalStaging(state: WorkspaceEditState) {
  return state === 'aborted' || state === 'rolled-back'
}

function directionGuardChange(
  direction: 'forward' | 'reverse',
  guards: readonly WorkspaceEditJournalGuard[],
): Partial<WorkspaceEditJournalManifest> {
  if (direction === 'forward') return { forwardGuards: guards }

  return { reverseGuards: guards }
}

function preparingResult(operationId: string, serverEpoch: string): WorkspaceEditResult {
  return {
    affectedPaths: [],
    entries: [],
    eventPublication: 'pending',
    generation: 0,
    operationId,
    rolledBackPaths: [],
    serverEpoch,
    state: 'preparing',
    unrecoveredPaths: [],
  }
}

function recordWorkspaceEditRequest(
  action: string,
  operationId?: string,
  details: Record<string, unknown> = {},
) {
  recordRequestContext({
    area: 'fs',
    operation: 'workspace_edit',
    workspaceEdit: { action, operationId, ...details },
  })
}

function recordWorkspaceEditOutcome(
  action: string,
  result: WorkspaceEditResult,
  details: Record<string, unknown> = {},
) {
  recordRequestContext({
    workspaceEdit: {
      action,
      affectedPathCount: result.affectedPaths.length,
      eventPublication: result.eventPublication,
      generation: result.generation,
      operationId: result.operationId,
      rolledBackPathCount: result.rolledBackPaths.length,
      rolledBackPaths: result.rolledBackPaths,
      state: result.state,
      unrecoveredPathCount: result.unrecoveredPaths.length,
      unrecoveredPaths: result.unrecoveredPaths,
      ...details,
    },
  })
}

function releaseAuditDetails(
  manifest: WorkspaceEditJournalManifest,
  body: WorkspaceEditReleaseRequest,
): Record<string, unknown> {
  if (manifest.state !== 'partial') return {}
  const acknowledgement = body.acknowledgePartial
  if (!acknowledgement) return {}

  return {
    destructiveAcknowledgement: {
      action: 'discard-partial-recovery',
      generation: acknowledgement.generation,
      unrecoveredPaths: acknowledgement.unrecoveredPaths,
    },
  }
}

function abortedResult(
  operationId: string,
  serverEpoch: string,
  generation: number,
): WorkspaceEditResult {
  return {
    affectedPaths: [],
    entries: [],
    eventPublication: 'suppressed',
    generation,
    operationId,
    rolledBackPaths: [],
    serverEpoch,
    state: 'aborted',
    unrecoveredPaths: [],
  }
}

function normalizeWorkspaceEditError(error: unknown) {
  if (error instanceof FsError) return error

  return new FsError('WORKSPACE_EDIT_INVALID', undefined, error)
}

function assertPrecondition(actual: ActualResource, expected: WorkspaceResourcePrecondition) {
  if (expected.kind === 'transaction') throw new FsError('WORKSPACE_EDIT_INVALID')
  if (expected.kind === 'missing') {
    if (actual.exists) throw occupiedError(actual.path)
    return
  }
  if (!actual.exists) throw new FsError('WORKSPACE_EDIT_STALE')
  if (expected.kind === 'present') {
    if (actual.type === expected.type) return
    throw new FsError('WORKSPACE_EDIT_STALE')
  }
  if (actual.version !== expected.version) throw new FsError('WORKSPACE_EDIT_STALE')
  if (Math.abs(actual.mtimeMs - expected.mtimeMs) <= 1) return

  throw new FsError('WORKSPACE_EDIT_STALE')
}

function actualGuard(actual: ActualResource): WorkspaceEditJournalGuard {
  if (!actual.exists) return { exists: false, path: actual.path }
  if (actual.version === undefined) {
    return { exists: true, guard: 'entry', path: actual.path, type: actual.type }
  }

  return {
    dev: actual.dev,
    exists: true,
    ino: actual.ino,
    mode: actual.mode,
    mtimeMs: actual.mtimeMs,
    path: actual.path,
    size: actual.size,
    version: actual.version,
  }
}

function guardMatches(guard: WorkspaceEditJournalGuard, actual: ActualResource) {
  if (!guard.exists) return !actual.exists
  if (!actual.exists) return false
  if ('guard' in guard) return guard.type === actual.type
  if (guard.dev !== actual.dev || guard.ino !== actual.ino) return false
  if (guard.mode !== actual.mode || guard.size !== actual.size) return false
  if (guard.version !== actual.version) return false

  return Math.abs(guard.mtimeMs - actual.mtimeMs) <= 1
}

function createdVirtual(
  relativePath: string,
  generation: number,
  folder: boolean,
): VirtualResource {
  if (folder) {
    return {
      dev: -1,
      entry: true,
      exists: true,
      generation,
      ino: -1,
      mode: 0o40755,
      mtimeMs: 0,
      path: relativePath,
      size: 0,
      type: 'directory',
    }
  }
  const bytes = Buffer.alloc(0)
  return {
    bytes,
    dev: -1,
    exists: true,
    generation,
    ino: -1,
    mode: 0o100600,
    mtimeMs: 0,
    path: relativePath,
    size: 0,
    type: 'file',
    version: hashBytes(bytes),
  }
}

function entryResource(relativePath: string, stats: Stats): EntryResource {
  const type = resourceType(stats)
  if (!type) throw new FsError('WORKSPACE_EDIT_INVALID')

  return {
    dev: stats.dev,
    entry: true,
    exists: true,
    ino: stats.ino,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    path: relativePath,
    size: stats.size,
    type,
  }
}

function resourceType(stats: Stats): WorkspaceResourceType | null {
  if (stats.isSymbolicLink()) return null
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'

  return null
}

/** File operations guard on identity; everything else guards on content. */
function manifestReadMode(manifest: WorkspaceEditJournalManifest): ReadMode {
  return manifest.category === 'file-operation' ? 'entry' : 'content'
}

function guardReadMode(guard: WorkspaceEditJournalGuard, fallback: ReadMode): ReadMode {
  if (!guard.exists) return fallback
  return 'guard' in guard ? 'entry' : 'content'
}

function preconditionReadMode(
  precondition: WorkspaceResourcePrecondition,
  fallback: ReadMode,
): ReadMode {
  if (precondition.kind === 'present') return 'entry'
  if (precondition.kind === 'snapshot') return 'content'

  return fallback
}

function holdsStaging(state: WorkspaceEditState) {
  return state !== 'released' && state !== 'aborted' && state !== 'rolled-back'
}

function occupiedError(relativePath: string) {
  return new FsError(
    'WORKSPACE_EDIT_TARGET_OCCUPIED',
    `${relativePath} already exists`,
    undefined,
    {
      fix: `Move or rename ${relativePath}, then try again.`,
      why: 'Nothing is ever overwritten to restore or place a file.',
    },
  )
}

function ancestorNotDirectoryError(workspaceAbsolute: string, ancestor: string) {
  return new FsError('WORKSPACE_EDIT_INVALID', undefined, undefined, {
    internal: { ancestorNotDirectory: toPosix(path.relative(workspaceAbsolute, ancestor)) },
  })
}

function occupiedReferenceError(reference: string) {
  if (!reference.startsWith('workspace:')) return new FsError('WORKSPACE_EDIT_STALE')

  return occupiedError(reference.slice('workspace:'.length))
}

function quotaError(
  scope: 'journal' | 'operation' | 'transition',
  measuredBytes: number,
  limitBytes: number,
  heldBytes: number,
) {
  const guidance =
    scope === 'transition'
      ? {
          fix: 'Move or delete those files yourself; the operation stays in the history.',
          why: 'It would move more into the undo journal than the journal allows.',
        }
      : {
          fix: 'Delete it permanently, or wait for older undo history to expire.',
          why: 'Keeping it for undo would hold more disk space than the undo journal allows.',
        }
  return new FsError('WORKSPACE_EDIT_QUOTA', undefined, undefined, {
    ...guidance,
    internal: { heldBytes, limitBytes, measuredBytes, scope },
  })
}

/** One operation's resources may not nest: a later leg would read a path an earlier one moved. */
function assertDisjointResourcePaths(operations: readonly WorkspacePersistenceOperation[]) {
  const paths = Array.from(new Set(operations.flatMap(operationPaths)))
  for (const left of paths) {
    for (const right of paths) {
      if (left !== right && slashPathsOverlap(left, right)) {
        throw new FsError('WORKSPACE_EDIT_INVALID', undefined, undefined, {
          internal: { nestedPaths: [left, right] },
        })
      }
    }
  }
}

function operationPaths(operation: WorkspacePersistenceOperation) {
  if (operation.kind === 'rename' || operation.kind === 'copy') {
    return [operation.oldPath, operation.newPath]
  }

  return [operation.path]
}

function resourceLegPaths(manifest: WorkspaceEditJournalManifest) {
  return semanticOperationPaths(manifest.legs.filter((leg) => leg.kind !== 'write'))
}

/**
 * The file operations a landed operation invalidates, newest first. An evicted operation's paths
 * join the seed: an older operation touching them could only be undone through it.
 */
function dependentFileOperations(
  manifest: WorkspaceEditJournalManifest,
  newestFirst: readonly WorkspaceEditJournalManifest[],
) {
  const seed = resourceLegPaths(manifest)
  if (seed.length === 0) return []
  const evicted: WorkspaceEditJournalManifest[] = []
  for (const candidate of newestFirst) {
    if (candidate.category !== 'file-operation') continue
    const touches = candidate.affectedPaths.some((candidatePath) =>
      seed.some((seedPath) => slashPathsOverlap(candidatePath, seedPath)),
    )
    if (!touches) continue
    evicted.push(candidate)
    seed.push(...candidate.affectedPaths)
  }

  return evicted
}

type LegChange =
  | { readonly oldPath: string; readonly path: string; readonly type: 'renamed' }
  | { readonly path: string; readonly type: 'created' | 'deleted' }

function legChanges(leg: WorkspaceEditPreparedLeg, reverse: boolean): LegChange[] {
  const appeared = reverse ? 'deleted' : 'created'
  const vanished = reverse ? 'created' : 'deleted'
  if (leg.kind === 'write') return []
  if (leg.kind === 'copy') return [{ path: leg.newPath, type: appeared }]
  if (leg.noOp) return []
  if (leg.kind === 'create') return [{ path: leg.path, type: appeared }]
  if (leg.kind === 'delete') return [{ path: leg.path, type: vanished }]
  if (reverse) return [{ oldPath: leg.newPath, path: leg.oldPath, type: 'renamed' }]

  return [{ oldPath: leg.oldPath, path: leg.newPath, type: 'renamed' }]
}

function historyEntry(manifest: WorkspaceEditJournalManifest): WorkspaceEditHistoryEntry {
  return {
    category: manifest.category,
    generation: manifest.generation,
    label: manifest.label,
    legs: manifest.legs.flatMap(historyLeg),
    operationId: manifest.operationId,
    state: manifest.state,
  }
}

function historyLeg(leg: WorkspaceEditPreparedLeg): WorkspaceEditHistoryLeg[] {
  if (leg.kind === 'write') return [{ kind: 'write', path: leg.path }]
  if (leg.kind === 'copy') return [{ kind: 'copy', newPath: leg.newPath, oldPath: leg.oldPath }]
  if (leg.noOp) return []
  if (leg.kind === 'create') return [{ folder: leg.folder, kind: 'create', path: leg.path }]
  if (leg.kind === 'rename') {
    return [{ kind: 'rename', newPath: leg.newPath, oldPath: leg.oldPath }]
  }

  return [{ kind: 'delete', path: leg.path }]
}

function sameIdentity(left: VirtualResource, right: VirtualResource) {
  if (!left.exists || !right.exists) return false
  if (left.dev < 0 || right.dev < 0) return false

  return left.dev === right.dev && left.ino === right.ino
}

function isPathAlias(left: string, right: string) {
  if (left === right) return false
  return (
    left.normalize('NFC').toLocaleLowerCase('en-US') ===
    right.normalize('NFC').toLocaleLowerCase('en-US')
  )
}

function addAffectedPaths(paths: string[], operation: WorkspacePersistenceOperation) {
  if (operation.kind === 'rename' || operation.kind === 'copy') {
    addUnique(paths, operation.oldPath)
    addUnique(paths, operation.newPath)
    return
  }

  addUnique(paths, operation.path)
}

function semanticOperationPaths(legs: readonly WorkspaceEditPreparedLeg[]) {
  const paths: string[] = []
  for (const leg of legs) {
    if (leg.kind === 'write') {
      addUnique(paths, leg.path)
      continue
    }
    if (leg.kind === 'copy') {
      addUnique(paths, leg.newPath)
      continue
    }
    if (leg.noOp) continue
    if (leg.kind === 'rename') {
      addUnique(paths, leg.oldPath)
      addUnique(paths, leg.newPath)
      continue
    }

    addUnique(paths, leg.path)
  }

  return paths
}

function addUnique(paths: string[], value: string) {
  if (!paths.includes(value)) paths.push(value)
}

function writeStep(
  leg: Extract<WorkspaceEditPreparedLeg, { kind: 'write' }>,
): WorkspaceEditProgramStep {
  return {
    afterStage: leg.afterStage,
    beforeMode: leg.beforeMode,
    beforeMtimeMs: leg.beforeMtimeMs,
    beforeStage: leg.beforeStage,
    kind: 'write',
    path: leg.path,
  }
}

function copyStep(
  leg: Extract<WorkspaceEditPreparedLeg, { kind: 'copy' }>,
): WorkspaceEditProgramStep {
  return { from: workspacePathRef(leg.oldPath), kind: 'copy', to: workspacePathRef(leg.newPath) }
}

function parkStep(relativePath: string, undoSlot: string): WorkspaceEditProgramStep {
  return { from: workspacePathRef(relativePath), kind: 'move', to: journalPathRef(undoSlot) }
}

function invertRecoveryStep(recovery: WorkspaceEditRecoveryStep): WorkspaceEditRecoveryStep {
  const direction = recovery.direction === 'forward' ? 'reverse' : 'forward'
  const step = recovery.step
  if (step.kind === 'move') {
    return { direction, step: { from: step.to, kind: 'move', to: step.from } }
  }
  if (step.kind === 'create') {
    return { direction, step: { kind: 'remove', path: step.path } }
  }
  if (step.kind === 'copy') {
    return { direction, step: { kind: 'remove', path: step.to.slice('workspace:'.length) } }
  }
  if (step.kind === 'remove') {
    return { direction, step: { kind: 'create', path: step.path } }
  }

  return { direction, step }
}

function stepReferences(step: WorkspaceEditProgramStep) {
  if (step.kind === 'move' || step.kind === 'copy') return [step.from, step.to]

  return [workspacePathRef(step.path)]
}

function intentGuardMatches(
  expected: WorkspaceEditIntentPathGuard,
  actual: WorkspaceEditIntentPathGuard,
) {
  if (expected.exists !== actual.exists) return false
  if (!expected.exists) return true
  if (!actual.exists) return false
  if (!optionalGuardFieldMatches(expected.dev, actual.dev)) return false
  if (!optionalGuardFieldMatches(expected.ino, actual.ino)) return false
  if (!optionalGuardFieldMatches(expected.mode, actual.mode)) return false
  if (!optionalGuardFieldMatches(expected.size, actual.size)) return false
  if (!optionalGuardFieldMatches(expected.version, actual.version)) return false
  if (!optionalGuardFieldMatches(expected.type, actual.type)) return false
  if (expected.mtimeMs === undefined) return true
  if (actual.mtimeMs === undefined) return false

  return Math.abs(expected.mtimeMs - actual.mtimeMs) <= 1
}

function optionalGuardFieldMatches<T>(expected: T | undefined, actual: T | undefined) {
  if (expected === undefined) return true

  return expected === actual
}

function recoveryPaths(program: readonly WorkspaceEditRecoveryStep[]) {
  const paths = new Set<string>()
  for (const recovery of program) {
    const step = recovery.step
    if (step.kind === 'move' || step.kind === 'copy') {
      addWorkspaceReferencePath(paths, step.from)
      addWorkspaceReferencePath(paths, step.to)
      continue
    }

    paths.add(step.path)
  }

  return Array.from(paths).sort()
}

function addWorkspaceReferencePath(paths: Set<string>, reference: string) {
  if (!reference.startsWith('workspace:')) return
  paths.add(reference.slice('workspace:'.length))
}

function workspacePathRef(relativePath: string) {
  return `workspace:${relativePath}`
}

function journalPathRef(relativePath: string) {
  return `journal:${relativePath}`
}

function hashBytes(bytes: Uint8Array) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function assertRelativeWorkspaceEditPath(input: string) {
  if (!input || input.includes('\\') || input.includes('\0')) {
    throw new FsError('WORKSPACE_EDIT_INVALID')
  }
  if (path.posix.isAbsolute(input) || input === '.' || input === '..') {
    throw new FsError('WORKSPACE_EDIT_INVALID')
  }
  if (input.startsWith('../') || path.posix.normalize(input) !== input) {
    throw new FsError('WORKSPACE_EDIT_INVALID')
  }
}

function assertInside(root: string, target: string) {
  if (isSameOrDescendant(root, target)) return

  throw new FsError('WORKSPACE_EDIT_INVALID')
}

function pathsOverlap(left: string, right: string) {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left)
}

// A plain template join: search-shared's normalises (`a/` + `b` → `a/b`), and nothing proves the
// journal-loaded `manifest.workspace` prefix and relative halves are already normalised.
function joinRelative(prefix: string, relativePath: string) {
  if (!prefix) return relativePath
  return `${prefix}/${relativePath}`
}

class AsyncKeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()

  async acquire(key: string) {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let releaseHold: () => void = noop
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve
    })
    const tail = previous.then(() => hold)
    this.tails.set(key, tail)
    await previous

    return () => {
      releaseHold()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

function noop() {}
