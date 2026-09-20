import { nowMs } from '@workspace/utils/timing'
import { createWideEventScope } from '@/lib/wide-event-scope'
import type { WideEventScope } from '@workspace/observability/scope'

export type WorkspaceEditOperationPhase =
  | 'committing'
  | 'finalizing'
  | 'preparing'
  | 'preview'
  | 'rolling-back'

export type WorkspaceEditOperationCounts = {
  readonly affectedPathCount: number
  readonly dirtyTargetCount: number
  readonly openTargetCount: number
  readonly operationCount: number
  readonly unopenedTargetCount: number
}

export type WorkspaceEditOperationSettlement = {
  readonly outcome: string
  readonly recoveryPaths?: readonly string[]
  readonly rollbackOutcome?: string
}

export type WorkspaceEditOperationEventOptions = {
  readonly createScope?: typeof createWideEventScope
  readonly now?: () => number
  readonly owner: { readonly environmentId: string | null; readonly machine: string | null }
  readonly rootGeneration: number | null
  readonly sourceKind: 'computed-text' | 'language-server'
  readonly operationId: string
  readonly source: string
}

export class WorkspaceEditOperationEvent {
  private currentPhase: WorkspaceEditOperationPhase | null = 'preparing'
  private ended = false
  private readonly now: () => number
  private readonly phaseDurationsMs: Partial<Record<WorkspaceEditOperationPhase, number>> = {}
  private phaseStartedAt: number | null
  private readonly scope: WideEventScope
  private readonly startedAt: number | null

  constructor(options: WorkspaceEditOperationEventOptions) {
    this.now = options.now ?? nowMs
    this.startedAt = this.readClock()
    this.phaseStartedAt = this.startedAt
    const createScope = options.createScope ?? createWideEventScope
    this.scope = createScope({
      ...options.owner,
      rootGeneration: options.rootGeneration,
      sourceKind: options.sourceKind,
      action: 'workspace_edit.apply',
      area: 'workspace-edit',
      operationId: options.operationId,
      source: options.source,
    })
  }

  setPrepared(counts: WorkspaceEditOperationCounts): void {
    if (this.ended) return
    this.scope.set({ counts })
  }

  transition(next: WorkspaceEditOperationPhase): void {
    if (this.ended || next === this.currentPhase) return
    const now = this.readClock()
    this.recordCurrentPhase(now)
    this.currentPhase = next
    this.phaseStartedAt = now
  }

  end(settlement: WorkspaceEditOperationSettlement): void {
    if (this.ended) return
    this.ended = true
    const finishedAt = this.readClock()
    this.recordCurrentPhase(finishedAt)
    const durationMs = elapsed(this.startedAt, finishedAt)

    this.scope.end({
      durationMs,
      outcome: settlement.outcome,
      phaseDurationsMs: this.phaseDurationsMs,
      recoveryPaths: settlement.recoveryPaths ?? [],
      rollbackOutcome: settlement.rollbackOutcome ?? 'not-needed',
    })
  }

  private readClock(): number | null {
    try {
      const value = this.now()
      return Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  private recordCurrentPhase(finishedAt: number | null): void {
    const phase = this.currentPhase
    if (!phase) return
    const duration = elapsed(this.phaseStartedAt, finishedAt)
    this.phaseDurationsMs[phase] = (this.phaseDurationsMs[phase] ?? 0) + duration
  }
}

function elapsed(startedAt: number | null, finishedAt: number | null): number {
  if (startedAt === null || finishedAt === null) return 0
  return Math.max(0, finishedAt - startedAt)
}
