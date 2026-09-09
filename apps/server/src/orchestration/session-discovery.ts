import { realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  commandIdSchema,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationWorktree,
  type ProviderInstanceId,
  type SessionId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { GitWorktreeService } from '../git/worktrees'
import { DEFAULT_CLAUDE_MODEL } from '../provider/adapters/utils/claude-models'
import type { ProviderService } from '../provider/provider-service'
import type { ProviderDiscoveredSession, ProviderHistoryMessage } from '../provider/types'
import { errorSummary } from '../observability/logging'
import { isEvlogError } from '../observability/structured-errors'
import { recordChatPipelineInfo, recordChatPipelineWarning } from './orchestration-logging'
import type { OrchestrationReadModel, OrchestrationProjectedWorktree } from './read-model'
import { resolveRepositoryIdentity, type RegistrationBoundary } from './registration'
import { internalCommandKey, repositoryKey, worktreeIdForCheckout } from './utils/repository-ids'

const DISCOVERY_PAGE_SIZE = 50
const DISCOVERY_INTERVAL_MS = 60_000
const DISCOVERY_FAILURE_EXAMPLE_LIMIT = 10

type DiscoveryFailureContext = {
  providerInstanceId: ProviderInstanceId
  cwd: string | null
} & (
  | { stage: 'provider-scan'; offset: number }
  | { stage: 'reconciliation'; sessionId: ProviderDiscoveredSession['sessionId'] }
)

type DiscoveryFailure = DiscoveryFailureContext & {
  error: ReturnType<typeof discoveryErrorDetails>
}

export type DiscoveryScanResult = {
  scanned: number
  imported: number
  refreshed: number
  messages: number
  skipped: Record<string, number>
  failures: DiscoveryFailure[]
}

type DiscoveryOptions = {
  providerService: Pick<
    ProviderService,
    'discoveryInstances' | 'discoverSessions' | 'readSessionHistory' | 'importSources'
  >
  registration: RegistrationBoundary
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  getReadModel: () => OrchestrationReadModel
  keepUpdated: () => boolean
  canImportHistory: (sessionId: SessionId) => boolean
  needsHistory: (sessionId: SessionId, sourceUpdatedAt: string) => boolean
  importHistory: (
    sessionId: SessionId,
    history: readonly ProviderHistoryMessage[],
    sourceUpdatedAt: string,
  ) => Promise<boolean>
}

type CheckoutMatch = { project: OrchestrationProject; worktree: OrchestrationWorktree }

export class SessionDiscoveryReconciler {
  private readonly options: DiscoveryOptions
  private readonly gitWorktrees: GitWorktreeService
  private interval: ReturnType<typeof setInterval> | null = null
  private pending: Promise<DiscoveryScanResult> | null = null
  private closed = false

  constructor(options: DiscoveryOptions) {
    this.options = options
    this.gitWorktrees = new GitWorktreeService(options.registration.git)
  }

  start() {
    if (this.closed || this.interval) return
    this.interval = setInterval(() => {
      this.refreshInBackground()
    }, DISCOVERY_INTERVAL_MS)
    this.interval.unref()
    this.refreshInBackground()
  }

  private refreshInBackground() {
    if (!this.options.keepUpdated() || this.pending) return
    void this.refresh().catch((error) =>
      recordChatPipelineWarning('chat.pipeline.discovery.failed', {
        error: discoveryErrorDetails(error),
      }),
    )
  }

  refresh() {
    return this.enqueueScan(undefined, true)
  }

  scan(providerInstanceId?: ProviderInstanceId): Promise<DiscoveryScanResult> {
    return this.enqueueScan(providerInstanceId, false)
  }

  private enqueueScan(providerInstanceId: ProviderInstanceId | undefined, importedOnly: boolean) {
    const pending = (this.pending ?? Promise.resolve()).then(() =>
      this.runScan(providerInstanceId, importedOnly),
    )
    this.pending = pending
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = null
      })
      .catch(() => {})
    return pending
  }

  async close() {
    this.closed = true
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    await this.pending
  }

  private async runScan(
    selectedInstance: ProviderInstanceId | undefined,
    importedOnly: boolean,
  ): Promise<DiscoveryScanResult> {
    const started = performance.now()
    const result: DiscoveryScanResult = {
      scanned: 0,
      imported: 0,
      refreshed: 0,
      messages: 0,
      skipped: {},
      failures: [],
    }
    const roots = [...this.options.getReadModel().worktrees.values()].filter(
      (worktree) => !worktree.retiredAt,
    )
    const seen = new Set<string>()
    for (const providerInstanceId of this.options.providerService.discoveryInstances()) {
      if (selectedInstance && selectedInstance !== providerInstanceId) continue
      if (importedOnly && !this.hasImportedSessions(providerInstanceId)) continue
      await this.scanInstance(providerInstanceId, roots, seen, result, importedOnly)
    }
    const record = Object.keys(result.skipped).length
      ? recordChatPipelineWarning
      : recordChatPipelineInfo
    record('chat.pipeline.discovery.scan', { ...result, durationMs: performance.now() - started })
    return result
  }

  private hasImportedSessions(providerInstanceId: ProviderInstanceId) {
    return [...this.options.getReadModel().sessions.values()].some(
      (session) =>
        session.origin === 'discovered' &&
        !session.deletedAt &&
        session.modelSelection.providerInstanceId === providerInstanceId &&
        !session.latestTurn &&
        !session.runtime,
    )
  }

  private async scanInstance(
    providerInstanceId: ProviderInstanceId,
    roots: readonly OrchestrationWorktree[],
    seen: Set<string>,
    result: DiscoveryScanResult,
    importedOnly: boolean,
  ) {
    for (const root of roots) {
      if (this.closed) return
      await this.scanDirectory(providerInstanceId, root.canonicalPath, seen, result, importedOnly)
    }
  }

  private async scanDirectory(
    providerInstanceId: ProviderInstanceId,
    cwd: string,
    seen: Set<string>,
    result: DiscoveryScanResult,
    importedOnly: boolean,
  ) {
    for (let offset = 0; !this.closed; offset += DISCOVERY_PAGE_SIZE) {
      const rows = await this.discoverPage(providerInstanceId, cwd, offset, result)
      if (!rows) return
      await this.importPage(providerInstanceId, rows, seen, result, importedOnly)
      if (rows.length < DISCOVERY_PAGE_SIZE) return
    }
  }

  private async discoverPage(
    providerInstanceId: ProviderInstanceId,
    cwd: string,
    offset: number,
    result: DiscoveryScanResult,
  ) {
    try {
      return await this.options.providerService.discoverSessions({
        providerInstanceId,
        cwd,
        limit: DISCOVERY_PAGE_SIZE,
        offset,
      })
    } catch (error) {
      recordScanFailure(result, { stage: 'provider-scan', providerInstanceId, cwd, offset }, error)
      return null
    }
  }

  private async importPage(
    providerInstanceId: ProviderInstanceId,
    rows: readonly ProviderDiscoveredSession[],
    seen: Set<string>,
    result: DiscoveryScanResult,
    importedOnly: boolean,
  ) {
    for (const row of rows) {
      if (this.closed) return
      if (importedOnly && !this.options.keepUpdated()) return
      const fingerprint = internalCommandKey(
        'metadata',
        providerInstanceId,
        row.sessionId,
        row.cwd ?? '',
        row.title,
        row.sourceUpdatedAt,
        row.gitBranch ?? '',
      )
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      result.scanned += 1
      if (importedOnly && !this.options.getReadModel().sessions.has(row.sessionId)) continue
      await this.importOne(providerInstanceId, row, result)
    }
  }

  private async importOne(
    providerInstanceId: ProviderInstanceId,
    row: ProviderDiscoveredSession,
    result: DiscoveryScanResult,
  ) {
    try {
      const match = await this.resolveCheckout(row.cwd, result)
      if (!match) return
      await this.dispatchSession(providerInstanceId, row, match, result)
    } catch (error) {
      recordScanFailure(
        result,
        { stage: 'reconciliation', providerInstanceId, cwd: row.cwd, sessionId: row.sessionId },
        error,
      )
    }
  }

  private async dispatchSession(
    providerInstanceId: ProviderInstanceId,
    row: ProviderDiscoveredSession,
    match: CheckoutMatch,
    result: DiscoveryScanResult,
  ) {
    const existing = this.options.getReadModel().sessions.get(row.sessionId)
    if (existing?.deletedAt) return skipped(result, 'deleted-session')
    if (existing && existing.modelSelection.providerInstanceId !== providerInstanceId)
      return skipped(result, 'provider-instance-conflict')
    if (existing && existing.worktreeId !== match.worktree.id)
      return skipped(result, 'session-reparent-conflict')
    if (
      existing &&
      (existing.origin !== 'discovered' || !this.options.canImportHistory(row.sessionId))
    )
      return skipped(result, 'continued-in-platform')
    if (existing && !this.options.needsHistory(row.sessionId, row.sourceUpdatedAt)) return
    const history = await this.options.providerService.readSessionHistory({
      providerInstanceId,
      sessionId: row.sessionId,
      cwd: match.worktree.canonicalPath,
    })
    if (history.length === 0) return skipped(result, 'no-conversation-text')
    const modelSelection =
      existing?.modelSelection ??
      discoveryModel(
        match.project,
        providerInstanceId,
        this.options.providerService
          .importSources()
          .find((source) => source.providerInstanceId === providerInstanceId)?.driverKind ??
          'claude',
      )
    if (!existing) {
      await this.options.dispatch({
        type: 'session.discover',
        commandId: commandId('session.discover', providerInstanceId, row.sessionId),
        sessionId: row.sessionId,
        worktreeId: match.worktree.id,
        title: row.title,
        modelSelection,
        runtimeMode: 'full-access',
        interactionMode: 'default',
        sourceUpdatedAt: row.sourceUpdatedAt,
      })
    }
    await this.options.dispatch({
      type: 'session.discovery-metadata.update',
      commandId: commandId(
        'session.discovery-metadata',
        providerInstanceId,
        row.sessionId,
        row.title,
        row.sourceUpdatedAt,
        row.gitBranch ?? '',
      ),
      sessionId: row.sessionId,
      worktreeId: match.worktree.id,
      modelSelection,
      title: row.title,
      sourceUpdatedAt: row.sourceUpdatedAt,
    })
    const changed = await this.options.importHistory(row.sessionId, history, row.sourceUpdatedAt)
    if (!changed) return
    result.messages += history.length
    if (existing) result.refreshed += 1
    else result.imported += 1
  }

  private async resolveCheckout(
    cwd: string | null,
    result: DiscoveryScanResult,
  ): Promise<CheckoutMatch | null> {
    if (!cwd) return skipped(result, 'missing-cwd')
    const canonicalCwd = await realpath(cwd)
    this.options.registration.paths.assertRealInside(canonicalCwd)
    const model = this.options.getReadModel()
    const candidates = [...model.worktrees.values()]
      .filter(
        (worktree) => !worktree.retiredAt && containsPath(worktree.canonicalPath, canonicalCwd),
      )
      .sort((left, right) => right.canonicalPath.length - left.canonicalPath.length)
    const candidate = candidates[0]
    if (candidate && candidates[1]?.canonicalPath.length === candidate.canonicalPath.length)
      return skipped(result, 'ambiguous-cwd')
    const repository = (await this.options.registration.git.repo(canonicalCwd)).repository
    const root = repository
      ? await realpath(this.options.registration.paths.resolve(repository.path).absolutePath)
      : canonicalCwd
    const project = candidate ? model.projects.get(candidate.projectId) : undefined
    if (
      candidate &&
      project &&
      !project.deletedAt &&
      ((project.repositoryKind === 'directory' && !repository) || root === candidate.canonicalPath)
    )
      return { project, worktree: candidate }
    if (!repository) return skipped(result, 'unknown-cwd')
    return this.registerExternalCheckout(root, repository.branch, result)
  }

  private async registerExternalCheckout(
    canonicalPath: string,
    branch: string | null,
    result: DiscoveryScanResult,
  ): Promise<CheckoutMatch | null> {
    const identity = await resolveRepositoryIdentity(
      this.options.registration.git,
      canonicalPath,
      true,
    )
    const key = repositoryKey(identity)
    const model = this.options.getReadModel()
    const projects = [...model.projects.values()].filter(
      (project) => !project.deletedAt && project.repositoryKey === key,
    )
    if (projects.length !== 1) return skipped(result, 'unknown-or-ambiguous-repository')
    const project = projects[0]
    if (!project) return null
    const roots = [...model.worktrees.values()].filter(
      (worktree) => !worktree.retiredAt && worktree.projectId === project.id,
    )
    const linked = await this.isLinkedCheckout(roots, canonicalPath)
    if (!linked) return skipped(result, 'unverified-checkout')
    const id = worktreeIdForCheckout(key, canonicalPath)
    const previous = model.worktrees.get(id)
    if (previous && !previous.retiredAt) return { project, worktree: previous }
    const worktree = externalCheckout(
      project,
      id,
      canonicalPath,
      this.options.registration.paths.toRealRelative(canonicalPath),
      branch,
      previous,
    )
    await this.registerWorktree(worktree, key, previous)
    return { project, worktree }
  }

  private async isLinkedCheckout(roots: readonly OrchestrationWorktree[], canonicalPath: string) {
    for (const root of roots) {
      const linked = await this.gitWorktrees.list(root.path)
      if (linked.some((worktree) => worktree.absolutePath === canonicalPath)) return true
    }
    return false
  }

  private async registerWorktree(
    worktree: OrchestrationWorktree,
    key: string,
    previous: OrchestrationProjectedWorktree | undefined,
  ) {
    const { id, retiredAt: _retiredAt, ...fields } = worktree
    if (previous?.retiredAt && previous.retirementSequence !== null) {
      await this.options.dispatch({
        ...fields,
        type: 'worktree.revive',
        worktreeId: id,
        commandId: commandId(
          'worktree.revive',
          key,
          worktree.canonicalPath,
          previous.retirementSequence,
        ),
        retirementSequence: previous.retirementSequence,
      })
      return
    }
    await this.options.dispatch({
      ...fields,
      type: 'worktree.register',
      worktreeId: id,
      commandId: commandId('worktree.register', key, worktree.canonicalPath),
    })
  }
}

function skipped(result: DiscoveryScanResult, reason: string): null {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
  return null
}

function recordScanFailure(
  result: DiscoveryScanResult,
  context: DiscoveryFailureContext,
  error: unknown,
) {
  skipped(
    result,
    context.stage === 'provider-scan' ? 'provider-scan-failed' : 'reconciliation-refused',
  )
  if (result.failures.length >= DISCOVERY_FAILURE_EXAMPLE_LIMIT) return
  result.failures.push({ ...context, error: discoveryErrorDetails(error) })
}

function discoveryErrorDetails(error: unknown) {
  return {
    ...errorSummary(error),
    ...(isEvlogError(error) ? { internal: error.internal } : {}),
    ...(error instanceof Error && error.cause ? { cause: errorSummary(error.cause) } : {}),
  }
}

function commandId(kind: string, ...parts: readonly (string | number)[]) {
  return v.parse(commandIdSchema, internalCommandKey(kind, ...parts))
}

function containsPath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function discoveryModel(
  project: OrchestrationProject,
  providerInstanceId: ProviderInstanceId,
  driverKind: string,
): ModelSelection {
  if (project.defaultModelSelection?.providerInstanceId === providerInstanceId)
    return project.defaultModelSelection
  return { providerInstanceId, model: driverKind === 'codex' ? 'gpt-5.5' : DEFAULT_CLAUDE_MODEL }
}

function externalCheckout(
  project: OrchestrationProject,
  id: OrchestrationWorktree['id'],
  canonicalPath: string,
  apiPath: string,
  branch: string | null,
  previous: OrchestrationProjectedWorktree | undefined,
): OrchestrationWorktree {
  const now = new Date().toISOString()
  return {
    id,
    projectId: project.id,
    canonicalPath,
    path: apiPath,
    branch,
    kind: 'linked',
    ownership: 'external',
    registrationGeneration: previous ? previous.registrationGeneration + 1 : 0,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    retiredAt: null,
    lifecycle: { state: 'ready' },
    operationId: null,
    baseWorktreeId: null,
    baseCommit: null,
    headCommit: null,
    metadataVersion: 0,
    pathKind: 'legacy',
    activeTerminalCount: 0,
    terminalOwnershipUnknown: false,
    externalDriverUnverified: previous?.externalDriverUnverified ?? false,
    removedAt: null,
    worktreeCreationCapability:
      project.repositoryKind === 'git' ? { allowed: true } : { allowed: false, reason: 'not-git' },
    cleanupEligibility: { reason: 'external', nonDeletedSessionCount: 0, canResolveMissing: false },
  }
}
