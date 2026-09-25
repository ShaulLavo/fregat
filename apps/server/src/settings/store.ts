import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  applySettingsOperations,
  descriptorFor,
  errorNumberField,
  errorStringField,
  isSettingId,
  layerAllowsScope,
  resolveSettings,
  SETTING_IDS,
  type SettingId,
  type SettingsEvent,
  type SettingsLayer,
  type SettingsLayerId,
  type SettingsMutationRequest,
  type SettingsMutationResult,
  type SettingsOperation,
  type SettingsRawWriteRequest,
  type SettingsRawWriteResult,
  type SettingsServerVersion,
  type SettingsSnapshot,
  type SettingsValues,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import * as v from 'valibot'
import { errorSummary, recordRequestContext, recordRequestWarning } from '../observability'
import {
  discardStagedSettingsFile,
  editSettingsText,
  parseSettingsDocument,
  stageSettingsFile,
  tryCommitStagedSettingsFile,
  type DocumentEdit,
  type StagedSettingsFile,
} from './json-document'
import {
  SettingsFileLayer,
  type LayerChange,
  type LayerContents,
  type LayerWriteContext,
  type SettingsLayerReader,
} from './layer'
import { settingsPaths, type SettingsPathOptions } from './paths'
import {
  applyProviderSecrets,
  extractRawProviderSecrets,
  maskProviderSecrets,
  SecretStore,
  type SecretRef,
  type ServerSecretRef,
} from './secrets'
import {
  rawRevisionStaleError,
  settingsErrors,
  settingsWriteContendedError,
} from './structured-errors'
import {
  commitSettingsSecretTransactionOwned,
  recoverSettingsTransactionSync,
  settingsTransactionJournalPath,
  withSettingsSecretTransactionOwner,
  type SettingsSecretTransaction,
  type SettingsSecretTransactionResult,
  type SettingsTransactionHooks,
} from './transaction'
import { canonicalSettingsPathSync } from './write-coordinator'

const PROVIDER_INSTANCES = 'providers.instances' as const
const EVERY_SECRET_REF = { has: () => true } as unknown as ReadonlySet<SecretRef>
const DEFAULT_RECEIPT_LIMIT = 512
const DEFAULT_REBASE_ATTEMPTS = 8
const DEFAULT_REBASE_BUDGET_MS = 2_000
const storesBySecretsPath = new Map<string, Set<SettingsStore>>()

type SettingsWriteStageContext = {
  readonly attempt: number
  readonly id: string
  readonly kind: 'raw' | 'semantic'
  readonly staged: StagedSettingsFile
  readonly target: SettingsWriteTarget
}

export type SettingsWriteHooks = {
  readonly afterStage?: (context: SettingsWriteStageContext) => void | Promise<void>
}

export type SettingsStoreOptions = SettingsPathOptions & {
  /** Test seam for deterministic watcher read failures. */
  readonly layerReader?: SettingsLayerReader
  readonly policy?: Record<string, unknown>
  readonly receiptLimit?: number
  readonly rebaseAttempts?: number
  readonly rebaseBudgetMs?: number
  readonly transactionHooks?: SettingsTransactionHooks
  readonly watch?: boolean
  readonly writeHooks?: SettingsWriteHooks
}

type WriteKind = 'raw' | 'semantic'

type WriteReceipt = {
  readonly appliedVersion: SettingsServerVersion
  readonly changedSettingIds: readonly SettingId[]
  readonly fingerprint: string
  readonly kind: WriteKind
}

type WriteMetrics = {
  readonly coordinatorWaitMs: number
  readonly rebaseAttempts: number
}

type WriteExecution = {
  readonly metrics: WriteMetrics
  readonly receipt: WriteReceipt
  readonly snapshot: SettingsSnapshot
}

type IdempotentWrite = WriteExecution & {
  readonly duplicate: boolean
}

type InFlightWrite = {
  readonly fingerprint: string
  readonly kind: WriteKind
  readonly promise: Promise<WriteExecution>
}

type PreparedReduction = {
  readonly changedSettingIds: readonly SettingId[]
  readonly edits: readonly DocumentEdit[]
  readonly secretEdits: ReadonlyMap<SecretRef, string | null>
}

type PreparedRawDocument = {
  readonly raw: Readonly<Record<string, unknown>>
  readonly registeredSettingIds: readonly SettingId[]
  readonly secretEdits: ReadonlyMap<SecretRef, string | null>
  readonly text: string
}

type SemanticAttemptState = {
  current: LayerContents
  rebases: number
}

/** Server-authoritative settings over layered JSON files. */
export class SettingsStore {
  private readonly epoch = randomUUID()
  private readonly inFlightWrites = new Map<string, InFlightWrite>()
  private readonly listeners = new Set<(event: SettingsEvent) => void>()
  private readonly policy: Record<string, unknown>
  private readonly rebaseAttempts: number
  private readonly rebaseBudgetMs: number
  private readonly receiptLimit: number
  private readonly receipts = new Map<string, WriteReceipt>()
  private readonly secretStore: SecretStore
  private readonly secretsPath: string
  private readonly settingsFilePaths: readonly string[]
  private readonly transactionHooks: SettingsTransactionHooks
  private readonly user: SettingsFileLayer
  private readonly workspace: SettingsFileLayer | null
  private readonly writeHooks: SettingsWriteHooks

  private cachedSnapshot: SettingsSnapshot | null = null
  private resolved: SettingsValues | null = null
  private secretRefs: ReadonlySet<SecretRef> = new Set()
  private secretRefsStale = false
  private recoveryBlocked = false
  private sequence = 0

  constructor(options: SettingsStoreOptions) {
    const paths = settingsPaths(options)
    const configuredSettingsPaths = paths.workspace ? [paths.user, paths.workspace] : [paths.user]
    const settingsFilePaths = configuredSettingsPaths.map(canonicalSettingsPathSync)
    const secretsPath = canonicalSettingsPathSync(paths.secrets)
    recoverSettingsTransactionSync(settingsFilePaths, secretsPath)

    this.secretsPath = secretsPath
    this.settingsFilePaths = settingsFilePaths
    this.user = new SettingsFileLayer('user', paths.user, options.layerReader)
    this.workspace = paths.workspace
      ? new SettingsFileLayer('workspace', paths.workspace, options.layerReader)
      : null
    this.secretStore = new SecretStore(secretsPath)
    this.policy = options.policy ?? {}
    this.receiptLimit = positiveInteger(options.receiptLimit, DEFAULT_RECEIPT_LIMIT)
    this.rebaseAttempts = positiveInteger(options.rebaseAttempts, DEFAULT_REBASE_ATTEMPTS)
    this.rebaseBudgetMs = positiveNumber(options.rebaseBudgetMs, DEFAULT_REBASE_BUDGET_MS)
    this.transactionHooks = options.transactionHooks ?? {}
    this.writeHooks = options.writeHooks ?? {}

    for (const layer of this.fileLayers()) layer.loadSync()
    this.loadSecretRefsAtStartup(secretsPath)
    registerSettingsStore(this.secretsPath, this)

    if (options.watch === false) return
    for (const layer of this.fileLayers()) {
      layer.watch((change) => this.publishLayerChange(change))
    }
  }

  snapshot(): SettingsSnapshot {
    this.assertOperational()
    if (this.cachedSnapshot) return this.cachedSnapshot

    const resolution = resolveSettings(this.layers(), { previous: this.resolved ?? undefined })
    this.resolved = resolution.values
    this.cachedSnapshot = {
      values: {
        ...resolution.values,
        [PROVIDER_INSTANCES]: maskProviderSecrets(
          resolution.values[PROVIDER_INSTANCES],
          this.maskingRefs(),
        ),
      },
      diagnostics: [...resolution.diagnostics],
      layers: this.layerSnapshots(),
      serverVersion: this.serverVersion(),
    }

    return this.cachedSnapshot
  }

  async providerInstancesForSpawn(): Promise<SettingsValues[typeof PROVIDER_INSTANCES]> {
    this.assertOperational()
    const secrets = await this.secretStore.read()

    return applyProviderSecrets(this.snapshot().values[PROVIDER_INSTANCES], secrets)
  }

  /**
   * Reads a server-owned secret, creating it on first use. Runs under the same
   * coordinator as settings writes, so two first uses agree on one value.
   */
  async ensureSecret(ref: ServerSecretRef, create: () => string): Promise<string> {
    this.assertOperational()
    return withSettingsSecretTransactionOwner(this.secretsPath, async (lease) => {
      recoverSettingsTransactionSync(this.settingsFilePaths, this.secretsPath)
      const existing = (await this.secretStore.read()).get(ref)
      if (existing) return existing

      const value = create()
      const outcome = await this.secretStore.write(new Map([[ref, value]]))
      if (outcome === 'revision-mismatch')
        throw settingsErrors.SERVER_SECRET_CONTENDED({
          internal: {
            coordinatorWaitMs: lease.waitMs,
            file: 'secrets',
            operation: 'ensure-secret',
            ref,
          },
        })

      this.reloadSecretRefs()
      return value
    })
  }

  providerInstancesForSpawnSync(): SettingsValues[typeof PROVIDER_INSTANCES] {
    this.assertOperational()
    return applyProviderSecrets(
      this.snapshot().values[PROVIDER_INSTANCES],
      this.secretStore.readSync(),
    )
  }

  async write(
    request: SettingsMutationRequest,
    signal?: AbortSignal,
  ): Promise<SettingsMutationResult> {
    try {
      this.assertOperational()
      const touchedSettingIds = applySettingsOperations({}, request.operations).touchedSettingIds
      const fingerprint = semanticFingerprint(request)
      const write = await this.runIdempotentWrite('semantic', request.mutationId, fingerprint, () =>
        this.validateAndApplySemanticWrite(request, touchedSettingIds, fingerprint, signal),
      )
      recordRequestContext(successLogContext(write))

      return {
        mutationId: request.mutationId,
        appliedVersion: write.receipt.appliedVersion,
        changedSettingIds: write.receipt.changedSettingIds,
        duplicate: write.duplicate,
        snapshot: write.snapshot,
      }
    } catch (error) {
      this.blockIfRecoveryPending()
      recordRequestContext(failureLogContext(error))
      throw error
    }
  }

  rawLayer(target: SettingsWriteTarget): { text: string; revision: string } {
    this.assertOperational()
    const contents = this.layerFor(target).snapshot()

    return { text: contents.text, revision: contents.revision ?? '' }
  }

  async writeRaw(request: SettingsRawWriteRequest): Promise<SettingsRawWriteResult> {
    try {
      this.assertOperational()
      const fingerprint = rawFingerprint(request)
      const write = await this.runIdempotentWrite('raw', request.writeId, fingerprint, () =>
        this.prepareAndApplyRawWrite(request, fingerprint),
      )
      recordRequestContext(successLogContext(write))

      return {
        writeId: request.writeId,
        appliedVersion: write.receipt.appliedVersion,
        changedSettingIds: write.receipt.changedSettingIds,
        duplicate: write.duplicate,
        snapshot: write.snapshot,
      }
    } catch (error) {
      this.blockIfRecoveryPending()
      recordRequestContext(failureLogContext(error))
      throw error
    }
  }

  onChange(listener: (event: SettingsEvent) => void): () => void {
    this.assertOperational()
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  async *changes(signal?: AbortSignal): AsyncGenerator<SettingsEvent> {
    this.assertOperational()
    const queue: SettingsEvent[] = []
    let wake: (() => void) | null = null
    const stop = this.onChange((event) => {
      queue.push(event)
      wake?.()
    })
    const onAbort = () => wake?.()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      while (!signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = null
          continue
        }

        yield queue.shift() as SettingsEvent
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      stop()
    }
  }

  close(): void {
    unregisterSettingsStore(this.secretsPath, this)
    for (const layer of this.fileLayers()) layer.close()
    this.listeners.clear()
  }

  private assertOperational() {
    if (!this.recoveryBlocked) return

    throw settingsErrors.TRANSACTION_RECOVERY_REQUIRED({
      internal: { journal: settingsTransactionJournalPath(this.secretsPath) },
    })
  }

  private blockIfRecoveryPending() {
    if (!existsSync(settingsTransactionJournalPath(this.secretsPath))) return

    for (const store of storesBySecretsPath.get(this.secretsPath) ?? []) {
      store.recoveryBlocked = true
      for (const layer of store.fileLayers()) layer.close()
    }
  }

  private async applySemanticWrite(
    request: SettingsMutationRequest,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<WriteExecution> {
    const layer = this.layerFor(request.target)

    return layer.coordinateWrite((context) =>
      this.runSemanticAttempts(layer, context, request, fingerprint, performance.now(), signal),
    )
  }

  private async validateAndApplySemanticWrite(
    request: SettingsMutationRequest,
    touchedSettingIds: readonly SettingId[],
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<WriteExecution> {
    this.assertRequestWritable(touchedSettingIds, request.target)

    return this.applySemanticWrite(request, fingerprint, signal)
  }

  private async runSemanticAttempts(
    layer: SettingsFileLayer,
    context: LayerWriteContext,
    request: SettingsMutationRequest,
    fingerprint: string,
    startedAt: number,
    signal?: AbortSignal,
  ): Promise<WriteExecution> {
    this.assertOperational()
    const state: SemanticAttemptState = { current: context.current, rebases: 0 }

    try {
      return await this.executeSemanticAttempts(
        layer,
        context,
        request,
        fingerprint,
        startedAt,
        state,
        signal,
      )
    } catch (error) {
      throw attachWriteMetrics(error, context.coordinatorWaitMs, state.rebases)
    }
  }

  private async executeSemanticAttempts(
    layer: SettingsFileLayer,
    context: LayerWriteContext,
    request: SettingsMutationRequest,
    fingerprint: string,
    startedAt: number,
    state: SemanticAttemptState,
    signal?: AbortSignal,
  ): Promise<WriteExecution> {
    while (this.canAttempt(state.rebases, startedAt, signal)) {
      this.acceptFreshIfNeeded(layer, state.current)
      this.assertCurrentDocumentValid(state.current)
      const prepared = this.prepareReduction(state.current.raw, request.operations)
      if (prepared.changedSettingIds.length === 0 && prepared.secretEdits.size === 0) {
        return this.acceptNoop(
          layer,
          state.current,
          'semantic',
          fingerprint,
          context,
          state.rebases,
        )
      }

      const text = editSettingsText(state.current.text, prepared.edits)
      const outcome = await this.commitSemanticAttempt(
        context.destination,
        state.current,
        text,
        prepared.secretEdits,
        request,
        state.rebases + 1,
      )
      if (outcome.kind === 'committed') {
        return this.acceptCommittedWrite(
          layer,
          text,
          outcome.revision,
          request.mutationId,
          'semantic',
          fingerprint,
          context.coordinatorWaitMs,
          state.rebases,
        )
      }

      state.rebases += 1
      state.current = await layer.readFresh()
    }

    this.acceptFreshIfNeeded(layer, state.current)
    throw settingsWriteContendedError(state.rebases, context.coordinatorWaitMs)
  }

  private async commitSemanticAttempt(
    destination: string,
    current: LayerContents,
    text: string,
    secretEdits: ReadonlyMap<SecretRef, string | null>,
    request: SettingsMutationRequest,
    attempt: number,
  ): Promise<
    | { readonly kind: 'committed'; readonly revision: string }
    | { readonly kind: 'revision-mismatch' }
  > {
    if (secretEdits.size > 0) {
      return withSettingsSecretTransactionOwner(this.secretsPath, async () => {
        recoverSettingsTransactionSync(this.settingsFilePaths, this.secretsPath)
        const secrets = await this.secretStore.prepare(secretEdits)
        if (!secrets.changed) {
          return this.commitStagedSemanticSettings(destination, current, text, request, attempt)
        }

        const outcome = await this.commitSecretTransaction({
          allowedSettingsPaths: this.settingsFilePaths,
          expectedSecretsRevision: secrets.expectedRevision,
          expectedSettingsRevision: current.revision,
          id: request.mutationId,
          secretsPath: this.secretsPath,
          secretsText: secrets.text,
          settingsPath: destination,
          settingsText: text,
        })
        if (outcome.kind === 'revision-mismatch') return { kind: 'revision-mismatch' }

        return { kind: 'committed', revision: outcome.settingsRevision }
      })
    }

    return this.commitStagedSemanticSettings(destination, current, text, request, attempt)
  }

  private async commitStagedSemanticSettings(
    destination: string,
    current: LayerContents,
    text: string,
    request: SettingsMutationRequest,
    attempt: number,
  ): Promise<
    | { readonly kind: 'committed'; readonly revision: string }
    | { readonly kind: 'revision-mismatch' }
  > {
    const staged = await stageSettingsFile(destination, text, await fileMode(destination))
    try {
      await this.writeHooks.afterStage?.({
        attempt,
        id: request.mutationId,
        kind: 'semantic',
        staged,
        target: request.target,
      })
      const outcome = await tryCommitStagedSettingsFile(staged, current.revision)
      if (outcome.kind === 'committed') return outcome

      await discardStagedSettingsFile(staged)
      return { kind: 'revision-mismatch' }
    } catch (error) {
      await discardStagedSettingsFile(staged)
      throw error
    }
  }

  private async applyRawWrite(
    request: SettingsRawWriteRequest,
    document: PreparedRawDocument,
    fingerprint: string,
  ): Promise<WriteExecution> {
    const layer = this.layerFor(request.target)

    return layer.coordinateWrite((context) =>
      this.applyRawWriteCoordinated(request, document, fingerprint, layer, context),
    )
  }

  private async applyRawWriteCoordinated(
    request: SettingsRawWriteRequest,
    document: PreparedRawDocument,
    fingerprint: string,
    layer: SettingsFileLayer,
    context: LayerWriteContext,
  ): Promise<WriteExecution> {
    try {
      this.assertOperational()
      this.acceptFreshIfNeeded(layer, context.current)
      if (document.secretEdits.size > 0) {
        return withSettingsSecretTransactionOwner(this.secretsPath, async () => {
          recoverSettingsTransactionSync(this.settingsFilePaths, this.secretsPath)
          const secrets = await this.secretStore.prepare(document.secretEdits)
          return this.applyPreparedRawWrite(request, document, layer, context, secrets, fingerprint)
        })
      }

      return this.applyPreparedRawWrite(
        request,
        document,
        layer,
        context,
        { changed: false, expectedRevision: null, text: '' },
        fingerprint,
      )
    } catch (error) {
      throw attachWriteMetrics(error, context.coordinatorWaitMs, 0)
    }
  }

  private async applyPreparedRawWrite(
    request: SettingsRawWriteRequest,
    document: PreparedRawDocument,
    layer: SettingsFileLayer,
    context: LayerWriteContext,
    secrets: {
      readonly changed: boolean
      readonly expectedRevision: string | null
      readonly text: string
    },
    fingerprint: string,
  ): Promise<WriteExecution> {
    if (context.current.text === document.text && !secrets.changed) {
      return this.acceptNoop(layer, context.current, 'raw', fingerprint, context, 0)
    }

    const expectedRevision = request.baseRevision || null
    if (context.current.revision !== expectedRevision) {
      throw rawRevisionStaleError({
        coordinatorWaitMs: context.coordinatorWaitMs,
        foundRevision: context.current.revision ?? '',
        target: request.target,
      })
    }

    const revision = await this.commitRawDocument(
      layer,
      context.current,
      document,
      secrets,
      request,
      context.destination,
      context.coordinatorWaitMs,
    )
    return this.acceptCommittedWrite(
      layer,
      document.text,
      revision,
      request.writeId,
      'raw',
      fingerprint,
      context.coordinatorWaitMs,
      0,
      secrets.changed ? [PROVIDER_INSTANCES] : [],
    )
  }

  private async prepareAndApplyRawWrite(
    request: SettingsRawWriteRequest,
    fingerprint: string,
  ): Promise<WriteExecution> {
    const document = this.prepareRawDocument(request.target, request.text)
    recordRequestContext({ settings: { settingIds: document.registeredSettingIds } })

    return this.applyRawWrite(request, document, fingerprint)
  }

  private async commitRawDocument(
    layer: SettingsFileLayer,
    current: LayerContents,
    document: PreparedRawDocument,
    secrets: {
      readonly changed: boolean
      readonly expectedRevision: string | null
      readonly text: string
    },
    request: SettingsRawWriteRequest,
    destination: string,
    coordinatorWaitMs: number,
  ): Promise<string> {
    if (secrets.changed) {
      const outcome = await this.commitSecretTransaction({
        allowedSettingsPaths: this.settingsFilePaths,
        expectedSecretsRevision: secrets.expectedRevision,
        expectedSettingsRevision: current.revision,
        id: request.writeId,
        secretsPath: this.secretsPath,
        secretsText: secrets.text,
        settingsPath: destination,
        settingsText: document.text,
      })
      if (outcome.kind === 'committed') return outcome.settingsRevision
      if (outcome.source === 'secrets') throw settingsWriteContendedError(1, coordinatorWaitMs)

      await this.refreshAfterRawConflict(layer)
      throw rawRevisionStaleError({
        coordinatorWaitMs,
        foundRevision: outcome.foundRevision ?? '',
        target: request.target,
      })
    }

    const staged = await stageSettingsFile(destination, document.text, await fileMode(destination))
    try {
      await this.writeHooks.afterStage?.({
        attempt: 1,
        id: request.writeId,
        kind: 'raw',
        staged,
        target: request.target,
      })
      const outcome = await tryCommitStagedSettingsFile(staged, current.revision)
      if (outcome.kind === 'committed') return outcome.revision

      await discardStagedSettingsFile(staged)
      await this.refreshAfterRawConflict(layer)
      throw rawRevisionStaleError({
        coordinatorWaitMs,
        foundRevision: outcome.foundRevision ?? '',
        target: request.target,
      })
    } catch (error) {
      await discardStagedSettingsFile(staged)
      throw error
    }
  }

  private async refreshAfterRawConflict(layer: SettingsFileLayer) {
    this.acceptFreshIfNeeded(layer, await layer.readFresh())
  }

  private async commitSecretTransaction(
    transaction: SettingsSecretTransaction,
  ): Promise<SettingsSecretTransactionResult> {
    try {
      return await commitSettingsSecretTransactionOwned(transaction, this.transactionHooks)
    } catch (error) {
      this.blockIfRecoveryPending()
      throw error
    }
  }

  private acceptNoop(
    layer: SettingsFileLayer,
    current: LayerContents,
    kind: WriteKind,
    fingerprint: string,
    context: LayerWriteContext,
    rebaseAttempts: number,
  ): WriteExecution {
    const changed = this.acceptFreshIfNeeded(layer, current)
    const snapshot = changed?.snapshot ?? this.snapshot()
    const changedSettingIds = changed?.changedSettingIds ?? []

    return execution(
      kind,
      fingerprint,
      changedSettingIds,
      snapshot,
      context.coordinatorWaitMs,
      rebaseAttempts,
    )
  }

  private acceptCommittedWrite(
    layer: SettingsFileLayer,
    text: string,
    revision: string,
    originMutationId: string,
    kind: WriteKind,
    fingerprint: string,
    coordinatorWaitMs: number,
    rebaseAttempts: number,
    additionalChangedSettingIds: readonly SettingId[] = [],
  ): WriteExecution {
    const change = layer.acceptCommitted(text, revision)
    const changedSettingIds = mergeSettingIds(
      changedRegisteredSettingIds(change.previous.raw, change.next.raw),
      additionalChangedSettingIds,
    )
    const event = this.publish(changedSettingIds, originMutationId)

    return execution(
      kind,
      fingerprint,
      event.changedSettingIds,
      event.snapshot,
      coordinatorWaitMs,
      rebaseAttempts,
    )
  }

  private acceptFreshIfNeeded(
    layer: SettingsFileLayer,
    current: LayerContents,
  ): SettingsEvent | null {
    const previous = layer.snapshot()
    if (sameLayerBytes(previous, current)) return null

    const change = layer.acceptFresh(current)
    return this.publish(changedRegisteredSettingIds(change.previous.raw, change.next.raw))
  }

  private prepareReduction(
    current: Readonly<Record<string, unknown>>,
    operations: readonly SettingsOperation[],
  ): PreparedReduction {
    const reduction = applySettingsOperations(current, operations)
    let raw = reduction.raw
    const secretEdits = new Map<SecretRef, string | null>()
    if (reduction.touchedSettingIds.includes(PROVIDER_INSTANCES)) {
      // Disk raw already stores existing credentials as ''. Treating that as an
      // explicit clear would wipe every secret on an enabled toggle.
      const split = extractRawProviderSecrets(raw[PROVIDER_INSTANCES])
      for (const [ref, value] of split.secrets) secretEdits.set(ref, value)
      if (split.instances !== raw[PROVIDER_INSTANCES]) {
        raw = { ...raw, [PROVIDER_INSTANCES]: split.instances }
      }
    }

    this.assertReductionValid(raw)
    const changedSettingIds = reduction.touchedSettingIds.filter((id) =>
      settingChanged(current, raw, id),
    )
    const edits = changedSettingIds.map((key) => documentEdit(raw, key))

    return { changedSettingIds, edits, secretEdits }
  }

  private prepareRawDocument(target: SettingsWriteTarget, text: string): PreparedRawDocument {
    const parsed = parseSettingsDocument(text)
    if (parsed.parseErrors.length > 0) {
      throw settingsErrors.FILE_MALFORMED({
        detail: parsed.parseErrors[0].message,
        internal: { at: 'raw-write', target, parseErrorCount: parsed.parseErrors.length },
      })
    }

    const registeredSettingIds = Object.keys(parsed.values).filter(isSettingId)
    if (!Object.hasOwn(parsed.values, PROVIDER_INSTANCES)) {
      return { raw: parsed.values, registeredSettingIds, secretEdits: new Map(), text }
    }

    const split = extractRawProviderSecrets(parsed.values[PROVIDER_INSTANCES])
    if (split.secrets.size === 0) {
      return { raw: parsed.values, registeredSettingIds, secretEdits: split.secrets, text }
    }
    if (target !== 'user') {
      throw settingsErrors.SCOPE_NOT_ALLOWED({
        key: PROVIDER_INSTANCES,
        scope: 'application',
        target,
        internal: { at: 'raw-write', secretCount: split.secrets.size },
      })
    }

    const strippedText = editSettingsText(text, [
      { key: PROVIDER_INSTANCES, value: split.instances },
    ])
    return {
      raw: parseSettingsDocument(strippedText).values,
      registeredSettingIds,
      secretEdits: split.secrets,
      text: strippedText,
    }
  }

  private assertCurrentDocumentValid(current: LayerContents) {
    if (current.parseErrors.length === 0) return

    throw settingsErrors.FILE_MALFORMED({
      detail: current.parseErrors[0].message,
      internal: { at: 'current-document', parseErrorCount: current.parseErrors.length },
    })
  }

  private assertReductionValid(raw: Readonly<Record<string, unknown>>) {
    for (const id of SETTING_IDS) {
      if (!Object.hasOwn(raw, id)) continue
      const parsed = v.safeParse(descriptorFor(id).schema, raw[id])
      if (parsed.success) continue

      throw settingsErrors.WRITE_INVALID({
        key: id,
        reason: validationReason(parsed.issues),
        internal: { at: 'reduction', issueCount: parsed.issues.length },
      })
    }
  }

  private assertRequestWritable(ids: readonly SettingId[], target: SettingsWriteTarget) {
    this.layerFor(target)
    for (const id of ids) this.assertWritable(id, target)
  }

  private assertWritable(key: SettingId, target: SettingsWriteTarget) {
    if (!isSettingId(key))
      throw settingsErrors.UNKNOWN_KEY({
        key,
        internal: { at: 'assert-writable', registeredCount: SETTING_IDS.length },
      })
    if (Object.hasOwn(this.policy, key))
      throw settingsErrors.POLICY_CONTROLLED({
        key,
        internal: { policyKeys: Object.keys(this.policy) },
      })

    const { scope } = descriptorFor(key)
    if (layerAllowsScope(target, scope)) return

    throw settingsErrors.SCOPE_NOT_ALLOWED({
      key,
      scope,
      target,
      internal: { at: 'assert-writable' },
    })
  }

  private async runIdempotentWrite(
    kind: WriteKind,
    id: string,
    fingerprint: string,
    operation: () => Promise<WriteExecution>,
  ): Promise<IdempotentWrite> {
    const retained = this.receipts.get(id)
    if (retained) return this.duplicateWrite(retained, kind, fingerprint)

    const inFlight = this.inFlightWrites.get(id)
    if (inFlight) return this.awaitDuplicateWrite(inFlight, kind, fingerprint)

    const promise = Promise.resolve().then(operation)
    const marker = { fingerprint, kind, promise }
    this.inFlightWrites.set(id, marker)

    try {
      const completed = await promise
      this.rememberReceipt(id, completed.receipt)
      return { ...completed, duplicate: false }
    } finally {
      if (this.inFlightWrites.get(id) === marker) this.inFlightWrites.delete(id)
    }
  }

  private duplicateWrite(
    receipt: WriteReceipt,
    kind: WriteKind,
    fingerprint: string,
  ): IdempotentWrite {
    this.assertFingerprint(receipt, kind, fingerprint)

    return {
      duplicate: true,
      metrics: { coordinatorWaitMs: 0, rebaseAttempts: 0 },
      receipt,
      snapshot: this.snapshot(),
    }
  }

  private async awaitDuplicateWrite(
    inFlight: InFlightWrite,
    kind: WriteKind,
    fingerprint: string,
  ): Promise<IdempotentWrite> {
    this.assertFingerprint(inFlight, kind, fingerprint)
    const completed = await inFlight.promise

    return { ...completed, duplicate: true, snapshot: this.snapshot() }
  }

  private assertFingerprint(
    retained: Pick<WriteReceipt, 'fingerprint' | 'kind'>,
    kind: WriteKind,
    fingerprint: string,
  ) {
    if (retained.kind === kind && retained.fingerprint === fingerprint) return

    throw settingsErrors.ID_COLLISION({
      internal: {
        retainedKind: retained.kind,
        requestedKind: kind,
        fingerprintMatches: retained.fingerprint === fingerprint,
      },
    })
  }

  private rememberReceipt(id: string, receipt: WriteReceipt) {
    this.receipts.set(id, receipt)
    while (this.receipts.size > this.receiptLimit) {
      const oldest = this.receipts.keys().next().value
      if (typeof oldest !== 'string') return
      this.receipts.delete(oldest)
    }
  }

  private canAttempt(rebases: number, startedAt: number, signal?: AbortSignal) {
    if (signal?.aborted) return false
    if (rebases >= this.rebaseAttempts) return false

    return performance.now() - startedAt <= this.rebaseBudgetMs
  }

  private publishLayerChange(change: LayerChange) {
    this.publish(changedRegisteredSettingIds(change.previous.raw, change.next.raw))
  }

  private publish(
    changedSettingIds: readonly SettingId[],
    originMutationId?: string,
  ): SettingsEvent {
    this.sequence += 1
    this.cachedSnapshot = null
    this.reloadSecretRefs()
    const event: SettingsEvent = {
      changedSettingIds,
      originMutationId,
      snapshot: this.snapshot(),
    }

    for (const listener of this.listeners) this.notifyListener(listener, event)
    return event
  }

  private notifyListener(listener: (event: SettingsEvent) => void, event: SettingsEvent) {
    try {
      listener(event)
    } catch (error) {
      recordRequestContext({
        area: 'settings',
        operation: 'notify',
        settingsListenerError: error,
      })
    }
  }

  private loadSecretRefsAtStartup(filePath: string) {
    try {
      this.secretRefs = new Set(this.secretStore.readSync().keys())
    } catch (error) {
      throw settingsErrors.SECRETS_UNREADABLE({
        file: filePath,
        detail: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error : undefined,
        internal: { at: 'startup', errorCode: errorStringField(error, 'code') },
      })
    }
  }

  private reloadSecretRefs() {
    try {
      this.secretRefs = new Set(this.secretStore.readSync().keys())
      this.secretRefsStale = false
    } catch (error) {
      this.secretRefsStale = true
      recordRequestWarning('settings.secrets.unreadable', {
        area: 'settings',
        operation: 'invalidate',
        settings: { secretRefsStale: true },
        error: errorSummary(error),
      })
    }
  }

  private maskingRefs(): ReadonlySet<SecretRef> {
    return this.secretRefsStale ? EVERY_SECRET_REF : this.secretRefs
  }

  private layerFor(target: SettingsWriteTarget): SettingsFileLayer {
    if (target === 'user') return this.user
    if (this.workspace) return this.workspace

    throw settingsErrors.SCOPE_NOT_ALLOWED({
      key: 'workspace settings',
      scope: 'window',
      target: 'workspace (no folder open)',
      internal: { at: 'layer-for', requested: target },
    })
  }

  private fileLayers(): SettingsFileLayer[] {
    return this.workspace ? [this.user, this.workspace] : [this.user]
  }

  private layers(): SettingsLayer[] {
    const layers: SettingsLayer[] = this.fileLayers().map((layer) => ({
      id: layer.id,
      raw: layer.snapshot().raw,
    }))
    if (Object.keys(this.policy).length > 0) layers.push({ id: 'policy', raw: this.policy })

    return layers
  }

  private layerSnapshots() {
    const files = this.fileLayers().map((layer) => layerSnapshot(layer))
    if (Object.keys(this.policy).length === 0) return files

    return [...files, { id: 'policy' as SettingsLayerId, present: true, raw: this.policy }]
  }

  private serverVersion(): SettingsServerVersion {
    return { epoch: this.epoch, sequence: this.sequence }
  }
}

function execution(
  kind: WriteKind,
  fingerprint: string,
  changedSettingIds: readonly SettingId[],
  snapshot: SettingsSnapshot,
  coordinatorWaitMs: number,
  rebaseAttempts: number,
): WriteExecution {
  return {
    metrics: { coordinatorWaitMs, rebaseAttempts },
    receipt: { appliedVersion: snapshot.serverVersion, changedSettingIds, fingerprint, kind },
    snapshot,
  }
}

function registerSettingsStore(secretsPath: string, store: SettingsStore) {
  const stores = storesBySecretsPath.get(secretsPath)
  if (stores) {
    stores.add(store)
    return
  }

  storesBySecretsPath.set(secretsPath, new Set([store]))
}

function unregisterSettingsStore(secretsPath: string, store: SettingsStore) {
  const stores = storesBySecretsPath.get(secretsPath)
  if (!stores) return

  stores.delete(store)
  if (stores.size === 0) storesBySecretsPath.delete(secretsPath)
}

function layerSnapshot(layer: SettingsFileLayer) {
  const contents = layer.snapshot()

  return {
    id: layer.id,
    present: contents.present,
    raw: contents.raw as Record<string, unknown>,
    file: {
      text: contents.text,
      revision: contents.revision ?? '',
      parseErrors: [...contents.parseErrors],
      keyRanges: { ...contents.keyRanges },
    },
  }
}

function changedRegisteredSettingIds(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): SettingId[] {
  return SETTING_IDS.filter((id) => settingChanged(previous, next, id))
}

function mergeSettingIds(
  first: readonly SettingId[],
  second: readonly SettingId[],
): readonly SettingId[] {
  if (second.length === 0) return first
  const included = new Set([...first, ...second])

  return SETTING_IDS.filter((id) => included.has(id))
}

function settingChanged(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  id: SettingId,
) {
  if (Object.hasOwn(previous, id) !== Object.hasOwn(next, id)) return true

  return !jsonEqual(previous[id], next[id])
}

function documentEdit(raw: Readonly<Record<string, unknown>>, key: SettingId): DocumentEdit {
  if (!Object.hasOwn(raw, key)) return { key }

  return { key, value: raw[key] }
}

function sameLayerBytes(left: LayerContents, right: LayerContents) {
  return left.revision === right.revision && left.text === right.text
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) return arraysEqual(left, right)
  if (!isRecord(left) || !isRecord(right)) return false

  return recordsEqual(left, right)
}

function arraysEqual(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false

  return left.every((value, index) => jsonEqual(value, right[index]))
}

function recordsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
) {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false

  return keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
}

function semanticFingerprint(request: SettingsMutationRequest): string {
  return fingerprint({ operations: request.operations, target: request.target })
}

function rawFingerprint(request: SettingsRawWriteRequest): string {
  return fingerprint({
    baseRevision: request.baseRevision,
    target: request.target,
    textHash: createHash('sha256').update(request.text).digest('hex'),
  })
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)

  return `{${entries.join(',')}}`
}

function successLogContext(write: IdempotentWrite) {
  return {
    settings: {
      appliedSequence: write.receipt.appliedVersion.sequence,
      coordinatorWaitMs: write.metrics.coordinatorWaitMs,
      epoch: write.receipt.appliedVersion.epoch,
      outcome: write.duplicate ? 'duplicate-ack' : 'applied',
      rebaseAttempts: write.metrics.rebaseAttempts,
    },
  }
}

function failureLogContext(error: unknown) {
  const code = errorStringField(error, 'code')
  const status = errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status')

  return {
    settings: {
      error: { code, status },
      coordinatorWaitMs: numberErrorField(error, 'coordinatorWaitMs') ?? 0,
      outcome: failureOutcome(code),
      rebaseAttempts: numberErrorField(error, 'attempts') ?? 0,
    },
  }
}

function failureOutcome(code: string | undefined) {
  if (code === 'settings.WRITE_CONTENDED') return 'contended'
  if (code === 'settings.RAW_REVISION_STALE') return 'raw-conflict'

  return 'rejected'
}

function numberErrorField(error: unknown, key: string) {
  if (!isRecord(error)) return undefined
  const value = error[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function attachWriteMetrics(error: unknown, coordinatorWaitMs: number, attempts: number) {
  if (!isRecord(error)) return error

  if (numberErrorField(error, 'coordinatorWaitMs') === undefined) {
    Object.assign(error, { coordinatorWaitMs })
  }
  if (numberErrorField(error, 'attempts') === undefined) Object.assign(error, { attempts })

  return error
}

async function fileMode(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mode & 0o777
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function positiveInteger(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback
}

function positiveNumber(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function validationReason(issues: readonly { readonly message: string }[]) {
  const messages = issues.slice(0, 3).map((issue) => issue.message.split(' but received ')[0])

  return messages.join('; ')
}
