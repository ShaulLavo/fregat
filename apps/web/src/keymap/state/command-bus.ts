import type { ClientError } from '@/lib/client-error-taxonomy'
import {
  reportError as defaultReportError,
  toClientError as defaultToClientError,
} from '@/lib/client-error-taxonomy'
import { createWideEventScope } from '@/lib/wide-event-scope'
import type {
  CommandExecution,
  CommandTargetKind,
  CommandUndoCategory,
  CommandWhen,
} from '@workspace/client-core/commands/metadata'
import {
  commandWhenDisabledReason,
  type CommandWhenSnapshot,
  type CommandWhenTarget,
} from '@/keymap/utils/when'
import type { MenuSurfaceId } from '@/keymap/types'

type CommandSource =
  | { readonly kind: 'keybinding' }
  | { readonly kind: 'menu'; readonly surface: MenuSurfaceId }
  | { readonly kind: 'palette' }
  | { readonly caller: string; readonly kind: 'programmatic' }

export type CommandInvocation = {
  readonly event?: unknown
  readonly origin?: unknown
  readonly source: CommandSource
}

type CommandFailure =
  | { readonly error: ClientError; readonly owner: 'command-bus' }
  | { readonly operationId: string; readonly owner: 'domain' }

export type ImmediateCommandDisposition =
  | { readonly status: 'handled' }
  | { readonly reason: 'dirty-close'; readonly status: 'deferred' }
  | { readonly reason: 'handler-declined'; readonly status: 'unhandled' }

export type AsyncCommandSettlement =
  | ImmediateCommandDisposition
  | { readonly reason: 'domain-discarded'; readonly status: 'cancelled' }
  | { readonly failure: CommandFailure; readonly status: 'failed' }

export type AsyncCommandStart =
  | ImmediateCommandDisposition
  | {
      readonly completion: Promise<AsyncCommandSettlement>
      readonly status: 'started'
    }

export type CommandOutcome =
  | AsyncCommandSettlement
  | { readonly reason: string; readonly status: 'disabled' }
  | { readonly reason: 'target-unavailable'; readonly status: 'unhandled' }

export type CommandDispatchTicket = {
  readonly claimed: boolean
  readonly completion: Promise<CommandOutcome>
}

export type ResolvedCommandTarget = CommandWhenTarget & {
  /** A stable, non-sensitive identifier safe to include in command telemetry. */
  readonly logIdentity?: string
}

type CommandDefinitionBase<Id extends string> = {
  readonly execution: CommandExecution
  readonly id: Id
  readonly target: CommandTargetKind
  readonly undoCategory: CommandUndoCategory
  readonly when: readonly CommandWhen[]
}

export type CommandHandlerContext<
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = {
  readonly invocation: Invocation
  readonly runtime: Runtime
  readonly snapshot: Snapshot
  readonly target: Target
}

export type EditorCommandDefinition<Id extends string> = CommandDefinitionBase<Id> & {
  readonly execution: 'sync'
  readonly target: 'editor'
}

export type SyncWorkspaceCommandDefinition<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = CommandDefinitionBase<Id> & {
  readonly execution: 'sync'
  readonly run: (
    context: CommandHandlerContext<Runtime, Snapshot, Target, Invocation>,
  ) => ImmediateCommandDisposition
  readonly target: 'workspace'
}

export type AsyncWorkspaceCommandDefinition<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = CommandDefinitionBase<Id> & {
  readonly execution: 'async'
  readonly run: (
    context: CommandHandlerContext<Runtime, Snapshot, Target, Invocation>,
  ) => AsyncCommandStart
  readonly target: 'workspace'
}

export type CommandDefinition<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> =
  | EditorCommandDefinition<Id>
  | SyncWorkspaceCommandDefinition<Id, Runtime, Snapshot, Target, Invocation>
  | AsyncWorkspaceCommandDefinition<Id, Runtime, Snapshot, Target, Invocation>

export type ReadyCommandInspection<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = {
  readonly entry: CommandDefinition<Id, Runtime, Snapshot, Target, Invocation>
  readonly runtime: Runtime
  readonly snapshot: Snapshot
  readonly status: 'ready'
  readonly target: Target
}

type DisabledCommandInspection<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = {
  readonly entry: CommandDefinition<Id, Runtime, Snapshot, Target, Invocation> | null
  readonly reason: string
  readonly snapshot: Snapshot | null
  readonly status: 'disabled'
  readonly target: Target | null
}

export type CommandInspection<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> =
  | ReadyCommandInspection<Id, Runtime, Snapshot, Target, Invocation>
  | DisabledCommandInspection<Id, Runtime, Snapshot, Target, Invocation>

export type CommandEventScope = {
  readonly end: (context?: Record<string, unknown>) => void
  readonly error: (error: unknown, context?: Record<string, unknown>) => void
}

export type CommandEventFactory = (base: {
  readonly action: string
  readonly area: string
  readonly [key: string]: unknown
}) => CommandEventScope

type ResolveCommandTargetInput<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = {
  readonly entry: CommandDefinition<Id, Runtime, Snapshot, Target, Invocation>
  readonly invocation: Invocation
  readonly runtime: Runtime
  readonly snapshot: Snapshot
}

export type CommandBusOptions<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
> = {
  readonly captureRuntime: () => Runtime | null
  readonly captureSnapshot: (runtime: Runtime, invocation: Invocation) => Snapshot
  readonly createEvent?: CommandEventFactory
  readonly dispatchEditor: (
    entry: EditorCommandDefinition<Id>,
    context: CommandHandlerContext<Runtime, Snapshot, Target, Invocation>,
  ) => boolean
  readonly lookup: (
    id: Id,
  ) => CommandDefinition<Id, Runtime, Snapshot, Target, Invocation> | null | undefined
  readonly now: () => number
  readonly reportError?: (error: ClientError) => void
  readonly resolveTarget: (
    input: ResolveCommandTargetInput<Id, Runtime, Snapshot, Target, Invocation>,
  ) => Target | null
  readonly targetIsAvailable: (target: Target, runtime: Runtime) => boolean
  readonly toClientError?: (error: unknown) => ClientError
}

const commandInspectionDisabledReasons = {
  runtimeUnavailable: 'The environment is switching.',
  targetUnavailable: 'No compatible command target is available.',
  unknownCommand: 'Command is not registered.',
} as const

export class CommandBus<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation = CommandInvocation,
> {
  readonly #options: CommandBusOptions<Id, Runtime, Snapshot, Target, Invocation>

  constructor(options: CommandBusOptions<Id, Runtime, Snapshot, Target, Invocation>) {
    this.#options = options
  }

  inspect(
    id: Id,
    invocation: Invocation,
  ): CommandInspection<Id, Runtime, Snapshot, Target, Invocation> {
    return this.capture(invocation).inspect(id)
  }

  capture(invocation: Invocation) {
    const runtime = this.#options.captureRuntime()
    const snapshot = runtime ? this.#options.captureSnapshot(runtime, invocation) : null
    const targets = new Map<CommandTargetKind, Target | null>()
    const inspections = new Map<Id, CommandInspection<Id, Runtime, Snapshot, Target, Invocation>>()
    const inspect = (id: Id) => {
      const existing = inspections.get(id)
      if (existing) return existing
      const inspection = this.#inspectCaptured(id, invocation, runtime, snapshot, targets)
      inspections.set(id, inspection)
      return inspection
    }
    return {
      inspect,
      dispatch: (id: Id) => this.dispatch(id, invocation, inspect(id)),
    }
  }

  #inspectCaptured(
    id: Id,
    invocation: Invocation,
    runtime: Runtime | null,
    snapshot: Snapshot | null,
    targets: Map<CommandTargetKind, Target | null>,
  ): CommandInspection<Id, Runtime, Snapshot, Target, Invocation> {
    const entry = this.#options.lookup(id)
    if (!entry) return disabledInspection(commandInspectionDisabledReasons.unknownCommand)
    if (!runtime || !snapshot)
      return disabledInspection(commandInspectionDisabledReasons.runtimeUnavailable)

    const target = targets.has(entry.target)
      ? (targets.get(entry.target) ?? null)
      : this.#options.resolveTarget({ entry, invocation, runtime, snapshot })
    targets.set(entry.target, target)
    if (!target || target.kind !== entry.target) {
      return disabledInspection(commandInspectionDisabledReasons.targetUnavailable, {
        entry,
        snapshot,
        target,
      })
    }

    const reason = commandWhenDisabledReason(entry.when, snapshot, target)
    if (reason) return disabledInspection(reason, { entry, snapshot, target })

    return { entry, runtime, snapshot, status: 'ready', target }
  }

  dispatch(
    id: Id,
    invocation: Invocation,
    captured?: CommandInspection<Id, Runtime, Snapshot, Target, Invocation>,
  ): CommandDispatchTicket {
    return this.#dispatch(id, invocation, () => captured ?? this.inspect(id, invocation))
  }

  #dispatch(
    id: Id,
    invocation: Invocation,
    inspect: () => CommandInspection<Id, Runtime, Snapshot, Target, Invocation>,
  ): CommandDispatchTicket {
    const startedAt = this.#now()
    let inspection: CommandInspection<Id, Runtime, Snapshot, Target, Invocation>
    try {
      inspection = inspect()
    } catch (error) {
      return this.#failedInspectionTicket(id, invocation, startedAt, error)
    }

    const scope = this.#createEvent(commandEventBase(id, invocation, inspection))
    if (inspection.status === 'disabled') {
      const outcome = { reason: inspection.reason, status: 'disabled' } as const
      return this.#immediateTicket(false, scope, startedAt, outcome)
    }
    let targetIsAvailable: boolean
    try {
      targetIsAvailable = this.#options.targetIsAvailable(inspection.target, inspection.runtime)
    } catch (error) {
      return this.#immediateTicket(false, scope, startedAt, this.#busFailure(error))
    }
    if (!targetIsAvailable) {
      const outcome = { reason: 'target-unavailable', status: 'unhandled' } as const
      return this.#immediateTicket(false, scope, startedAt, outcome)
    }

    let start: AsyncCommandStart
    try {
      start = this.#execute(inspection, invocation)
    } catch (error) {
      return this.#immediateTicket(true, scope, startedAt, this.#busFailure(error))
    }

    if (start.status !== 'started') {
      return this.#immediateTicket(immediateDispositionClaimed(start), scope, startedAt, start)
    }

    const completion = start.completion.then(
      (outcome) => this.#finish(scope, startedAt, outcome),
      (error: unknown) => this.#finish(scope, startedAt, this.#busFailure(error)),
    )
    return { claimed: true, completion }
  }

  #execute(
    inspection: ReadyCommandInspection<Id, Runtime, Snapshot, Target, Invocation>,
    invocation: Invocation,
  ): AsyncCommandStart {
    const context = {
      invocation,
      runtime: inspection.runtime,
      snapshot: inspection.snapshot,
      target: inspection.target,
    }
    if (inspection.entry.target === 'editor') {
      return this.#options.dispatchEditor(inspection.entry, context)
        ? { status: 'handled' }
        : { reason: 'handler-declined', status: 'unhandled' }
    }

    return inspection.entry.run(context)
  }

  #failedInspectionTicket(
    id: Id,
    invocation: Invocation,
    startedAt: number | null,
    error: unknown,
  ) {
    const scope = this.#createEvent(unknownCommandEventBase(id, invocation))
    return this.#immediateTicket(false, scope, startedAt, this.#busFailure(error))
  }

  #immediateTicket(
    claimed: boolean,
    scope: CommandEventScope,
    startedAt: number | null,
    outcome: CommandOutcome,
  ): CommandDispatchTicket {
    return {
      claimed,
      completion: Promise.resolve(this.#finish(scope, startedAt, outcome)),
    }
  }

  #busFailure(error: unknown): AsyncCommandSettlement {
    return {
      failure: { error: this.#toClientError(error), owner: 'command-bus' },
      status: 'failed',
    }
  }

  #toClientError(error: unknown): ClientError {
    const convert = this.#options.toClientError ?? defaultToClientError
    try {
      return convert(error)
    } catch {
      try {
        return defaultToClientError(error)
      } catch {
        return { category: 'unknown', message: 'Something unexpected went wrong.' }
      }
    }
  }

  #finish(
    scope: CommandEventScope,
    startedAt: number | null,
    outcome: CommandOutcome,
  ): CommandOutcome {
    if (isBusOwnedFailure(outcome)) {
      safely(() =>
        scope.error(outcome.failure.error.cause ?? outcome.failure.error, {
          category: outcome.failure.error.category,
        }),
      )
      safely(() => (this.#options.reportError ?? defaultReportError)(outcome.failure.error))
    }

    const finishedAt = this.#now()
    const durationMs =
      startedAt === null || finishedAt === null ? 0 : Math.max(0, finishedAt - startedAt)
    safely(() => scope.end(commandOutcomeEvent(outcome, durationMs)))
    return outcome
  }

  #now() {
    try {
      return this.#options.now()
    } catch {
      return null
    }
  }

  #createEvent(base: Parameters<CommandEventFactory>[0]): CommandEventScope {
    const create = this.#options.createEvent ?? createWideEventScope
    try {
      return create(base)
    } catch {
      return noopCommandEventScope
    }
  }
}

export function createCommandBus<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation = CommandInvocation,
>(options: CommandBusOptions<Id, Runtime, Snapshot, Target, Invocation>) {
  return new CommandBus(options)
}

function disabledInspection<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
>(
  reason: string,
  partial: Partial<DisabledCommandInspection<Id, Runtime, Snapshot, Target, Invocation>> = {},
): DisabledCommandInspection<Id, Runtime, Snapshot, Target, Invocation> {
  return {
    entry: partial.entry ?? null,
    reason,
    snapshot: partial.snapshot ?? null,
    status: 'disabled',
    target: partial.target ?? null,
  }
}

function immediateDispositionClaimed(disposition: ImmediateCommandDisposition) {
  return disposition.status !== 'unhandled'
}

function commandEventBase<
  Id extends string,
  Runtime,
  Snapshot extends CommandWhenSnapshot,
  Target extends ResolvedCommandTarget,
  Invocation extends CommandInvocation,
>(
  id: Id,
  invocation: Invocation,
  inspection: CommandInspection<Id, Runtime, Snapshot, Target, Invocation>,
) {
  return {
    action: 'command.dispatch',
    area: 'command',
    commandId: id,
    execution: inspection.entry?.execution ?? 'unknown',
    ...commandSourceEvent(invocation.source),
    targetIdentity: inspection.target?.logIdentity,
    targetKind: inspection.entry?.target ?? 'unknown',
    undoCategory: inspection.entry?.undoCategory ?? 'unknown',
  }
}

function unknownCommandEventBase<Id extends string, Invocation extends CommandInvocation>(
  id: Id,
  invocation: Invocation,
) {
  return {
    action: 'command.dispatch',
    area: 'command',
    commandId: id,
    execution: 'unknown',
    ...commandSourceEvent(invocation.source),
    targetKind: 'unknown',
    undoCategory: 'unknown',
  }
}

// Not `source`: the client log drain stamps its own `source: 'client'` over the
// payload, which silently ate the field that tells a keystroke from a click.
function commandSourceEvent(source: CommandSource): Record<string, unknown> {
  if (source.kind === 'menu') {
    return { commandSource: source.kind, menuSurface: source.surface }
  }
  if (source.kind === 'programmatic') {
    return { commandSource: source.kind, sourceCaller: source.caller }
  }

  return { commandSource: source.kind }
}

function commandOutcomeEvent(outcome: CommandOutcome, durationMs: number) {
  const base = { durationMs, outcome: outcome.status }
  if (outcome.status === 'disabled') return { ...base, disabledReason: outcome.reason }
  if (outcome.status === 'unhandled') return { ...base, reason: outcome.reason }
  if (outcome.status === 'cancelled' || outcome.status === 'deferred') {
    return { ...base, reason: outcome.reason }
  }
  if (outcome.status !== 'failed') return base
  if (outcome.failure.owner === 'domain') {
    return { ...base, failureOwner: 'domain', operationId: outcome.failure.operationId }
  }

  return { ...base, errorCategory: outcome.failure.error.category, failureOwner: 'command-bus' }
}

function isBusOwnedFailure(outcome: CommandOutcome): outcome is Extract<
  AsyncCommandSettlement,
  { status: 'failed' }
> & {
  readonly failure: Extract<CommandFailure, { owner: 'command-bus' }>
} {
  return outcome.status === 'failed' && outcome.failure.owner === 'command-bus'
}

function safely(action: () => void) {
  try {
    action()
  } catch {
    // Diagnostics must not change command settlement.
  }
}

const noopCommandEventScope: CommandEventScope = {
  end: () => undefined,
  error: () => undefined,
}
