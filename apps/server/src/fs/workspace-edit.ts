import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
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
} from '@workspace/contracts'
import { FsError, nodeErrorCode } from './errors'
import type { WorkspacePaths } from './path'
import type { FileChangeHub } from './watch'
import { recordRequestContext, runDetached } from '../observability'
import {
  MAX_WORKSPACE_EDIT_JOURNAL_BYTES,
  MAX_WORKSPACE_EDIT_OPERATION_BYTES,
  WORKSPACE_EDIT_STABLE_STATES,
  WORKSPACE_EDIT_STABLE_TTL_MS,
  WorkspaceEditJournal,
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
  type WorkspaceEditJournalGuard,
  type WorkspaceEditJournalManifest,
  type WorkspaceEditIntentPathGuard,
  type WorkspaceEditPreparedLeg,
  type WorkspaceEditProgramStep,
  type WorkspaceEditRecoveryStep,
} from './workspace-edit-journal'

export const WORKSPACE_EDIT_LEASE_MS = 60_000
const JOURNAL_ALLOCATION_MUTEX_KEY = 'journal-allocation'

type WorkspaceEditClock = () => number

export type WorkspaceEditControllerOptions = {
  readonly changes: FileChangeHub
  readonly clock?: WorkspaceEditClock
  readonly driver?: WorkspaceEditFileSystemDriver
  readonly journalRoot: string
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
      version: string
    }

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
  stagedBytes: number
  workspaceAbsolute: string
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
  private readonly journal
  private readonly leases = new Map<string, WorkspaceLease>()
  private readonly legacyMutations = new Set<string>()
  private readonly paths
  private readonly slots = new Map<string, OperationSlot>()
  private readonly transitionMutex = new AsyncKeyedMutex()
  private initializePromise?: Promise<void>

  constructor(options: WorkspaceEditControllerOptions) {
    this.paths = options.paths
    this.changes = options.changes
    this.clock = options.clock ?? Date.now
    this.driver = options.driver ?? nodeWorkspaceEditFileSystemDriver
    this.journal = new WorkspaceEditJournal(options.journalRoot, this.driver)
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
    return this.runTransition(
      'finalize',
      body,
      ['committed', 'undo-committed', 'redo-committed'],
      (manifest) => this.finalizeProvisional(manifest),
    )
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
    const operations = Array.from(this.slots.values())
      .map((slot) => slot.manifest)
      .filter((manifest): manifest is WorkspaceEditJournalManifest => Boolean(manifest))
      .filter((manifest) => manifest.state === 'partial')
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
      await this.assertQuota(plan.stagedBytes)
      await this.journal.createOperation(body.operationId)
      this.assertNotCancelled(slot)
      await this.persistStages(body.operationId, plan.blobs, slot)
      const manifest = preparedManifest(body, plan, this.clock())
      await this.journal.persist(manifest)
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
      await this.journal.writeStage(operationId, blob.name, blob.bytes)
      this.assertNotCancelled(slot)
    }
  }

  private async finishCancelledPrepare(slot: OperationSlot, operationId: string) {
    await this.journal.remove(operationId)
    this.releaseLease(operationId)
    const result = abortedResult(operationId, this.serverEpoch, 1)
    slot.prepare = undefined
    slot.tombstone = result
    recordWorkspaceEditOutcome('prepare', result)
    return result
  }

  private async cleanupFailedPrepare(operationId: string) {
    await this.journal.remove(operationId).catch(() => undefined)
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
        await this.journal.clearStaging(body.operationId)
      }
      if (options.removeAfter && cached.state === 'released') {
        await this.journal.remove(body.operationId)
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
      await this.journal.persist(cachedManifest)
      slot.manifest = cachedManifest
      await this.publishTransitionOutcome(cachedManifest)
      this.finishTransitionLease(cachedManifest)
      if (options.clearStagingAfter || shouldClearTerminalStaging(cachedManifest.state)) {
        await this.journal.clearStaging(cachedManifest.operationId)
      }
      if (options.removeAfter && cachedManifest.state === 'released') {
        await this.journal.remove(cachedManifest.operationId)
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
    await this.journal.persist(active)
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
    const next = advanceManifest(manifest, state, this.clock(), {
      eventPublication: 'published',
      provisionalFrom: undefined,
    })
    return next
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
    await this.revalidateDirectionState(manifest, 'forward')
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
    await this.revalidateDirectionState(manifest, 'reverse')
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
    await this.journal.persist(active)
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
    const virtual = new Map<string, VirtualResource>()
    const guards = new Map<string, WorkspaceEditJournalGuard>()
    const legs: WorkspaceEditPreparedLeg[] = []
    const blobs: StagedBlob[] = []
    const affectedPaths: string[] = []

    for (const operation of body.operations) {
      await this.prepareOperation(
        body.operationId,
        operation,
        workspaceAbsolute,
        virtual,
        guards,
        legs,
        blobs,
      )
      addAffectedPaths(affectedPaths, operation)
    }

    const stagedBytes = blobs.reduce((total, blob) => total + blob.bytes.byteLength, 0)
    return {
      affectedPaths,
      blobs,
      guards: Array.from(guards.values()),
      legs,
      stagedBytes,
      workspaceAbsolute,
    }
  }

  private async prepareOperation(
    operationId: string,
    operation: WorkspacePersistenceOperation,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
    legs: WorkspaceEditPreparedLeg[],
    blobs: StagedBlob[],
  ) {
    if (operation.kind === 'write') {
      await this.prepareWrite(operation, workspaceAbsolute, virtual, guards, legs, blobs)
      return
    }
    if (operation.kind === 'create') {
      await this.prepareCreate(operationId, operation, workspaceAbsolute, virtual, guards, legs)
      return
    }
    if (operation.kind === 'rename') {
      await this.prepareRename(operationId, operation, workspaceAbsolute, virtual, guards, legs)
      return
    }

    await this.prepareDelete(operationId, operation, workspaceAbsolute, virtual, guards, legs)
  }

  private async prepareWrite(
    operation: Extract<WorkspacePersistenceOperation, { kind: 'write' }>,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
    legs: WorkspaceEditPreparedLeg[],
    blobs: StagedBlob[],
  ) {
    const current = await this.virtualResource(
      operation.path,
      operation.expected,
      operation.index,
      workspaceAbsolute,
      virtual,
      guards,
    )
    if (!current.exists) throw new FsError('WORKSPACE_EDIT_STALE')
    const beforeName = `write-${operation.index}-before`
    const afterName = `write-${operation.index}-after`
    const after = Buffer.from(operation.text, 'utf8')
    blobs.push({ bytes: current.bytes, name: beforeName }, { bytes: after, name: afterName })
    legs.push({
      afterStage: `stage/${afterName}`,
      beforeMode: current.mode,
      beforeMtimeMs: current.mtimeMs,
      beforeStage: `stage/${beforeName}`,
      index: operation.index,
      kind: 'write',
      path: operation.path,
    })
    virtual.set(operation.path, {
      ...current,
      bytes: after,
      generation: operation.index,
      size: after.byteLength,
      version: hashBytes(after),
    })
  }

  private async prepareCreate(
    operationId: string,
    operation: Extract<WorkspacePersistenceOperation, { kind: 'create' }>,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
    legs: WorkspaceEditPreparedLeg[],
  ) {
    const destination = await this.virtualResource(
      operation.path,
      operation.destination,
      operation.index,
      workspaceAbsolute,
      virtual,
      guards,
    )
    const noOp = destination.exists && !operation.overwrite && operation.ignoreIfExists
    if (destination.exists && !noOp && !operation.overwrite) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    if (destination.exists && operation.overwrite) {
      await this.assertResourceDevice(workspaceAbsolute, operation.path, destination)
    }

    const reservedPath = operation.overwrite
      ? `stage/resource-${operation.index}-${randomUUID()}`
      : undefined
    if (reservedPath) await this.journal.assertReservedPathMissing(operationId, reservedPath)
    legs.push({
      destinationExists: destination.exists,
      index: operation.index,
      kind: 'create',
      noOp,
      overwrite: operation.overwrite,
      path: operation.path,
      reservedPath,
    })
    virtual.set(
      operation.path,
      noOp
        ? { ...destination, generation: operation.index }
        : createdVirtual(operation.path, operation.index),
    )
  }

  private async prepareRename(
    operationId: string,
    operation: Extract<WorkspacePersistenceOperation, { kind: 'rename' }>,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
    legs: WorkspaceEditPreparedLeg[],
  ) {
    if (isPathAlias(operation.oldPath, operation.newPath)) {
      throw new FsError('WORKSPACE_EDIT_INVALID')
    }
    const source = await this.virtualResource(
      operation.oldPath,
      operation.source,
      operation.index,
      workspaceAbsolute,
      virtual,
      guards,
    )
    if (!source.exists) throw new FsError('WORKSPACE_EDIT_STALE')
    if (operation.oldPath === operation.newPath) {
      legs.push({ ...operation, destinationExists: true, kind: 'rename', noOp: true })
      virtual.set(operation.oldPath, { ...source, generation: operation.index })
      return
    }

    const destination = await this.virtualResource(
      operation.newPath,
      operation.destination,
      operation.index,
      workspaceAbsolute,
      virtual,
      guards,
    )
    await this.assertResourceDevice(workspaceAbsolute, operation.oldPath, source)
    await this.assertResourceDevice(workspaceAbsolute, operation.newPath, destination)
    if (sameIdentity(source, destination)) throw new FsError('WORKSPACE_EDIT_INVALID')
    const noOp = destination.exists && !operation.overwrite && operation.ignoreIfExists
    if (destination.exists && !noOp && !operation.overwrite) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    const reservedPath = operation.overwrite
      ? `stage/resource-${operation.index}-${randomUUID()}`
      : undefined
    if (reservedPath) await this.journal.assertReservedPathMissing(operationId, reservedPath)
    legs.push({
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
      virtual.set(operation.oldPath, { ...source, generation: operation.index })
      virtual.set(operation.newPath, { ...destination, generation: operation.index })
      return
    }

    virtual.set(operation.oldPath, {
      exists: false,
      generation: operation.index,
      path: operation.oldPath,
    })
    virtual.set(operation.newPath, {
      ...source,
      generation: operation.index,
      path: operation.newPath,
    })
  }

  private async prepareDelete(
    operationId: string,
    operation: Extract<WorkspacePersistenceOperation, { kind: 'delete' }>,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
    legs: WorkspaceEditPreparedLeg[],
  ) {
    const current = await this.virtualResource(
      operation.path,
      operation.expected,
      operation.index,
      workspaceAbsolute,
      virtual,
      guards,
    )
    const noOp = !current.exists && operation.ignoreIfNotExists
    if (!current.exists && !noOp) throw new FsError('WORKSPACE_EDIT_STALE')
    if (current.exists) await this.assertResourceDevice(workspaceAbsolute, operation.path, current)
    const reservedPath = current.exists
      ? `stage/resource-${operation.index}-${randomUUID()}`
      : undefined
    if (reservedPath) await this.journal.assertReservedPathMissing(operationId, reservedPath)
    legs.push({ index: operation.index, kind: 'delete', noOp, path: operation.path, reservedPath })
    virtual.set(operation.path, {
      exists: false,
      generation: operation.index,
      path: operation.path,
    })
  }

  private async virtualResource(
    relativePath: string,
    precondition: WorkspaceResourcePrecondition,
    operationIndex: number,
    workspaceAbsolute: string,
    virtual: Map<string, VirtualResource>,
    guards: Map<string, WorkspaceEditJournalGuard>,
  ) {
    if (precondition.kind === 'transaction') {
      const current = virtual.get(relativePath)
      if (!current || current.generation !== precondition.afterOperation) {
        throw new FsError('WORKSPACE_EDIT_INVALID')
      }
      if (precondition.afterOperation >= operationIndex) throw new FsError('WORKSPACE_EDIT_INVALID')

      return current
    }
    if (virtual.has(relativePath)) throw new FsError('WORKSPACE_EDIT_INVALID')

    const actual = await this.readActual(workspaceAbsolute, relativePath)
    assertPrecondition(actual, precondition)
    virtual.set(relativePath, actual)
    guards.set(relativePath, actualGuard(actual))
    return actual
  }

  private async readActual(
    workspaceAbsolute: string,
    relativePath: string,
  ): Promise<ActualResource> {
    const absolutePath = await this.resolveTarget(workspaceAbsolute, relativePath)
    const stats = await this.lstatOptional(absolutePath)
    if (!stats) return { exists: false, path: relativePath }
    if (stats.isSymbolicLink() || !stats.isFile()) throw new FsError('WORKSPACE_EDIT_INVALID')

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
      version: hashBytes(bytes),
    }
  }

  private async resolveWorkspace(input: string) {
    const target = this.paths.resolve(input)
    const stats = await this.driver.lstat(target.absolutePath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new FsError('WORKSPACE_EDIT_INVALID')
    const canonical = await this.driver.realpath(target.absolutePath)
    this.paths.assertRealInside(canonical)
    const expected = toPortablePath(path.relative(this.paths.workspaceRootReal, canonical))
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

  private async assertNotJournalTarget(target: string) {
    const journalRoot = await this.driver.realpath(this.journal.root)
    if (!isSameOrDescendant(journalRoot, target)) return

    throw new FsError('WORKSPACE_EDIT_INVALID')
  }

  private async assertRealParentInside(workspaceAbsolute: string, target: string) {
    let candidate = target

    while (true) {
      const stats = await this.lstatOptional(candidate)
      if (stats) {
        if (stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_INVALID')
        const canonical = await this.driver.realpath(candidate)
        assertInside(workspaceAbsolute, canonical)
      }

      if (candidate === workspaceAbsolute) return
      candidate = path.dirname(candidate)
    }
  }

  private async assertResourceDevice(
    workspaceAbsolute: string,
    relativePath: string,
    resource: VirtualResource,
  ) {
    const journalDevice = (await this.driver.stat(this.journal.root)).dev
    if (resource.exists && resource.dev >= 0 && resource.dev !== journalDevice) {
      throw new FsError('WORKSPACE_EDIT_DEVICE_UNSUPPORTED')
    }
    if (resource.exists && resource.dev >= 0) return

    const target = await this.resolveTarget(workspaceAbsolute, relativePath)
    const parent = await this.nearestExistingParent(path.dirname(target))
    if ((await this.driver.stat(parent)).dev === journalDevice) return

    throw new FsError('WORKSPACE_EDIT_DEVICE_UNSUPPORTED')
  }

  private async nearestExistingParent(input: string): Promise<string> {
    const stats = await this.lstatOptional(input)
    if (stats) {
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new FsError('WORKSPACE_EDIT_INVALID')
      }
      return input
    }

    const parent = path.dirname(input)
    if (parent === input) throw new FsError('WORKSPACE_EDIT_INVALID')
    return this.nearestExistingParent(parent)
  }

  private async assertQuota(operationBytes: number) {
    if (operationBytes > MAX_WORKSPACE_EDIT_OPERATION_BYTES) {
      throw new FsError('WORKSPACE_EDIT_QUOTA')
    }
    if ((await this.journal.sizeBytes()) + operationBytes <= MAX_WORKSPACE_EDIT_JOURNAL_BYTES)
      return

    throw new FsError('WORKSPACE_EDIT_QUOTA')
  }

  private async revalidateGuards(manifest: WorkspaceEditJournalManifest) {
    const workspace = this.workspaceAbsolute(manifest)
    for (const guard of manifest.guards) {
      const actual = await this.readActual(workspace, guard.path)
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

    const workspace = this.workspaceAbsolute(manifest)
    for (const guard of guards) {
      const actual = await this.readActual(workspace, guard.path)
      if (!guardMatches(guard, actual)) throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  private async snapshotCurrentGuards(manifest: WorkspaceEditJournalManifest) {
    const workspace = this.workspaceAbsolute(manifest)
    const guards: WorkspaceEditJournalGuard[] = []
    for (const relativePath of manifest.affectedPaths) {
      guards.push(actualGuard(await this.readActual(workspace, relativePath)))
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
    if (isProvisionalState(next.state)) return
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
      version: entry.exists ? entry.version : undefined,
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
      if (leg.noOp) continue
      if (leg.kind === 'create') {
        this.addCreateForwardSteps(leg, steps)
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

  private addCreateForwardSteps(
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

    steps.push({ kind: 'create', path: leg.path })
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
      if (leg.noOp) continue
      if (leg.kind === 'create') {
        steps.push({ kind: 'remove', path: leg.path })
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
      await this.journal.append(manifest.operationId, {
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
        await this.journal.append(manifest.operationId, {
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
    const program = executed.toReversed().map(invertRecoveryStep)

    for (let index = 0; index < program.length; index += 1) {
      const current = program[index]!
      try {
        const guards = await this.intentGuards(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.before)
        await this.applyStep(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.after)
        await this.journal.append(manifest.operationId, {
          stepIndex: executed.length - index - 1,
          transitionId,
          type: 'compensated',
        })
      } catch {
        return { ok: false, remaining: program.slice(index) }
      }
    }

    return { ok: true }
  }

  private async executeRecoveryProgram(
    manifest: WorkspaceEditJournalManifest,
    program: readonly WorkspaceEditRecoveryStep[],
    transitionId: string,
  ) {
    for (let index = 0; index < program.length; index += 1) {
      const current = program[index]!
      try {
        const guards = await this.intentGuards(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.before)
        await this.applyStep(manifest, current.step, current.direction)
        await this.assertIntentGuards(manifest, guards.after)
        await this.journal.append(manifest.operationId, {
          stepIndex: index,
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
      if (await this.virtualPathExists(target, existence)) throw new FsError('WORKSPACE_EDIT_STALE')
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
    if (await this.virtualPathExists(destination, existence)) {
      throw new FsError('WORKSPACE_EDIT_STALE')
    }
    existence.set(source, false)
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
    if (step.kind === 'create') {
      await this.createEmptyPath(manifest, step.path)
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
    const references = stepReferences(step)
    const before = await Promise.all(
      references.map((reference) => this.intentPathGuard(manifest, reference)),
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
      return [
        { exists: false, reference: step.from },
        { ...source, reference: step.to },
      ]
    }
    if (step.kind === 'create') {
      return [
        {
          exists: true,
          reference: workspacePathRef(step.path),
          size: 0,
          version: hashBytes(new Uint8Array()),
        },
      ]
    }
    if (step.kind === 'remove') {
      return [{ exists: false, reference: workspacePathRef(step.path) }]
    }

    const stage = direction === 'forward' ? step.afterStage : step.beforeStage
    const bytes = await this.journal.readStage(manifest.operationId, stage)
    return [
      {
        exists: true,
        mode: direction === 'reverse' ? step.beforeMode : before[0]?.mode,
        reference: workspacePathRef(step.path),
        size: bytes.byteLength,
        version: hashBytes(bytes),
      },
    ]
  }

  private async intentPathGuard(
    manifest: WorkspaceEditJournalManifest,
    reference: string,
  ): Promise<WorkspaceEditIntentPathGuard> {
    const target = reference.startsWith('workspace:')
      ? await this.resolveTarget(
          this.workspaceAbsolute(manifest),
          reference.slice('workspace:'.length),
        )
      : this.resolvePathReference(manifest, reference)
    const stats = await this.lstatOptional(target)
    if (!stats) return { exists: false, reference }
    if (!stats.isFile() || stats.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_STALE')
    const bytes = await this.driver.readFile(target)
    return {
      dev: stats.dev,
      exists: true,
      ino: stats.ino,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
      reference,
      size: stats.size,
      version: hashBytes(bytes),
    }
  }

  private async assertIntentGuards(
    manifest: WorkspaceEditJournalManifest,
    guards: readonly WorkspaceEditIntentPathGuard[],
  ) {
    for (const expected of guards) {
      const actual = await this.intentPathGuard(manifest, expected.reference)
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
      const stats = await this.lstatOptional(target)
      if (stats?.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_STALE')
    }
  }

  private async movePath(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'move' }>,
  ) {
    const from = this.resolvePathReference(manifest, step.from)
    const to = this.resolvePathReference(manifest, step.to)
    await this.driver.rename(from, to)
    await this.fsyncDirectories(path.dirname(from), path.dirname(to))
  }

  private async createEmptyPath(manifest: WorkspaceEditJournalManifest, relativePath: string) {
    const target = this.workspaceTarget(manifest, relativePath)
    await this.driver.writeFile(target, new Uint8Array(), { flag: 'wx', mode: 0o600 })
    await this.fsyncFile(target)
    await this.fsyncDirectory(path.dirname(target))
  }

  private async removeWorkspacePath(manifest: WorkspaceEditJournalManifest, relativePath: string) {
    const target = this.workspaceTarget(manifest, relativePath)
    await this.driver.rm(target, { force: false, recursive: false })
    await this.fsyncDirectory(path.dirname(target))
  }

  private async applyWrite(
    manifest: WorkspaceEditJournalManifest,
    step: Extract<WorkspaceEditProgramStep, { kind: 'write' }>,
    direction: 'forward' | 'reverse',
  ) {
    const target = this.workspaceTarget(manifest, step.path)
    const stage = direction === 'forward' ? step.afterStage : step.beforeStage
    const bytes = await this.journal.readStage(manifest.operationId, stage)
    const current = await this.driver.lstat(target)
    if (!current.isFile() || current.isSymbolicLink()) throw new FsError('WORKSPACE_EDIT_STALE')
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${randomUUID()}.tmp`,
    )
    const mode = direction === 'reverse' ? step.beforeMode : current.mode
    const temporaryRelativePath = path.posix.join(
      path.posix.dirname(step.path),
      path.basename(temporary),
    )
    this.changes.addTransactionPaths(manifest.operationId, [
      joinRelative(manifest.workspace, temporaryRelativePath),
    ])

    let replaced = false
    try {
      await this.driver.writeFile(temporary, bytes, { flag: 'wx', mode })
      await this.driver.chmod(temporary, mode)
      await this.fsyncFile(temporary)
      await this.driver.rename(temporary, target)
      replaced = true
      if (direction === 'reverse') {
        const beforeTime = new Date(step.beforeMtimeMs)
        await this.driver.utimes(target, beforeTime, beforeTime)
        await this.fsyncFile(target)
      }
      await this.fsyncDirectory(path.dirname(target))
    } finally {
      if (!replaced) await this.driver.rm(temporary, { force: true, recursive: false })
    }
  }

  private resolvePathReference(manifest: WorkspaceEditJournalManifest, reference: string) {
    if (reference.startsWith('workspace:')) {
      return this.workspaceTarget(manifest, reference.slice('workspace:'.length))
    }
    if (reference.startsWith('journal:')) {
      return this.journal.storedPath(manifest.operationId, reference.slice('journal:'.length))
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
    return this.pathExists(this.journal.storedPath(manifest.operationId, relativePath))
  }

  private async pathExists(target: string) {
    return (await this.lstatOptional(target)) !== null
  }

  private async lstatOptional(target: string) {
    try {
      return await this.driver.lstat(target)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return null
      throw error
    }
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
      const stats = await this.lstatOptional(target)
      if (!stats) return { exists: false, path: relativePath }
      if (!stats.isFile() || stats.isSymbolicLink()) return null
      const bytes = await this.driver.readFile(target)
      return {
        exists: true,
        mtimeMs: stats.mtimeMs,
        path: relativePath,
        size: stats.size,
        type: 'file',
        version: hashBytes(bytes),
      }
    } catch {
      return null
    }
  }

  private async semanticEvents(manifest: WorkspaceEditJournalManifest) {
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
        version: entry.version,
        writeId: manifest.operationId,
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
      await this.journal.remove(manifest.operationId)
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
      await this.journal.persist(next)
      slot.manifest = next
      this.releaseLease(operationId)
      await this.journal.clearStaging(operationId)
      return
    }
    if (!isProvisionalState(slot.manifest.state)) return

    const transitionId = randomUUID()
    const next = await this.rollbackProvisional(slot.manifest, transitionId)
    await this.journal.persist(next)
    slot.manifest = next
    await this.publishTransitionOutcome(next)
    if (shouldClearTerminalStaging(next.state)) {
      await this.journal.clearStaging(operationId)
    }
    this.finishTransitionLease(next)
  }

  private async ensureInitialized() {
    this.initializePromise ??= this.initialize()
    return this.initializePromise
  }

  private async initialize() {
    await this.journal.initialize()
    const manifests = await this.journal.list()
    for (const manifest of manifests) await this.recoverStartupManifest(manifest)
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
      await this.journal.persist(restored)
      await this.recoverStartupManifest(restored)
      return
    }
    if (manifest.state === 'partial') {
      this.slots.set(manifest.operationId, { cancelled: false, manifest })
      return
    }
    if (WORKSPACE_EDIT_STABLE_STATES.has(manifest.state)) {
      await this.journal.remove(manifest.operationId)
      return
    }
    if (manifest.state === 'prepared' || manifest.state === 'preparing') {
      await this.journal.remove(manifest.operationId)
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

    await this.journal.remove(manifest.operationId)
  }

  private async recoverActiveTransition(manifest: WorkspaceEditJournalManifest) {
    if (!manifest.activeTransition) return false
    const records = await this.journal.records(manifest.operationId)
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
    await this.journal.persist(partial)
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
    await this.journal.persist(partial)
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
      const recoveryProgram = execution.remaining.map((step) => ({ direction, step }))
      const partial = advanceManifest(manifest, 'partial', this.clock(), {
        recoveryGuards: await this.snapshotRecoveryGuards(manifest),
        recoveryProgram,
        recoveryTarget: target as WorkspaceEditRecoveryTarget,
        unrecoveredPaths: recoveryPaths(recoveryProgram),
      })
      await this.journal.persist(partial)
      this.slots.set(partial.operationId, { cancelled: false, manifest: partial })
      return
    }

    await this.journal.remove(manifest.operationId)
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
    await this.journal.persist(partial)
    this.slots.set(partial.operationId, { cancelled: false, manifest: partial })
  }

  private async fsyncFile(target: string) {
    const handle = await this.driver.open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async fsyncDirectory(target: string) {
    const handle = await this.driver.open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private async fsyncDirectories(...targets: string[]) {
    for (const target of new Set(targets)) await this.fsyncDirectory(target)
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
    createdAt: now,
    eventPublication: 'pending',
    generation: 1,
    guards: plan.guards,
    legs: plan.legs,
    operationId: body.operationId,
    rolledBackPaths: [],
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

function isProvisionalState(state: WorkspaceEditState) {
  return state === 'committed' || state === 'undo-committed' || state === 'redo-committed'
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
    if (actual.exists) throw new FsError('WORKSPACE_EDIT_STALE')
    return
  }
  if (!actual.exists) throw new FsError('WORKSPACE_EDIT_STALE')
  if (actual.version !== expected.version) throw new FsError('WORKSPACE_EDIT_STALE')
  if (Math.abs(actual.mtimeMs - expected.mtimeMs) <= 1) return

  throw new FsError('WORKSPACE_EDIT_STALE')
}

function actualGuard(actual: ActualResource): WorkspaceEditJournalGuard {
  if (!actual.exists) return { exists: false, path: actual.path }

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
  if (guard.dev !== actual.dev || guard.ino !== actual.ino) return false
  if (guard.mode !== actual.mode || guard.size !== actual.size) return false
  if (guard.version !== actual.version) return false

  return Math.abs(guard.mtimeMs - actual.mtimeMs) <= 1
}

function createdVirtual(relativePath: string, generation: number): VirtualResource {
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
    version: hashBytes(bytes),
  }
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
  if (operation.kind === 'rename') {
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

function invertRecoveryStep(recovery: WorkspaceEditRecoveryStep): WorkspaceEditRecoveryStep {
  const direction = recovery.direction === 'forward' ? 'reverse' : 'forward'
  const step = recovery.step
  if (step.kind === 'move') {
    return { direction, step: { from: step.to, kind: 'move', to: step.from } }
  }
  if (step.kind === 'create') {
    return { direction, step: { kind: 'remove', path: step.path } }
  }
  if (step.kind === 'remove') {
    return { direction, step: { kind: 'create', path: step.path } }
  }

  return { direction, step }
}

function stepReferences(step: WorkspaceEditProgramStep) {
  if (step.kind === 'move') return [step.from, step.to]

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
    if (step.kind === 'move') {
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
  const relative = path.relative(root, target)
  if (relative === '') return
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return

  throw new FsError('WORKSPACE_EDIT_INVALID')
}

function isSameOrDescendant(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative === '') return true
  return !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function pathsOverlap(left: string, right: string) {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left)
}

function joinRelative(prefix: string, relativePath: string) {
  if (!prefix) return relativePath
  return `${prefix}/${relativePath}`
}

function toPortablePath(input: string) {
  return input.split(path.sep).join('/')
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
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
