import { commandById, type CommandId } from '@workspace/client-core/commands/catalog'
import type { CommandMetadata } from '@workspace/client-core/commands/metadata'

import type { FocusRegistry, FocusTarget, FocusToken } from '@/commands/state/focus'
import { sameScope } from '@/commands/state/focus'

export type CommandSource = 'keybinding' | 'palette' | 'programmatic'
export type CommandContext = {
  readonly source: CommandSource
  readonly origin: FocusToken | null
  readonly target: FocusTarget | null
}
type CommandHandler = {
  readonly disabledReason?: (context: CommandContext) => string | null
  readonly run: (context: CommandContext) => void | boolean | Promise<void | boolean>
}
export type CommandHandlers = Readonly<Partial<Record<CommandId, CommandHandler>>>
type CommandOutcome =
  | { readonly status: 'handled' | 'unhandled' }
  | { readonly status: 'disabled'; readonly reason: string }
  | { readonly status: 'failed'; readonly error: unknown }
export type CommandTicket = {
  readonly claimed: boolean
  readonly completion: Promise<CommandOutcome>
}
export type CommandInspection =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'disabled'
      readonly command: CommandMetadata<CommandId>
      readonly reason: string
    }
  | { readonly status: 'ready'; readonly command: CommandMetadata<CommandId> }

type Options = {
  readonly focus: FocusRegistry
  readonly handlers: CommandHandlers
  readonly onExecuted?: (command: CommandId) => void
  readonly onError: (error: unknown, command: CommandId) => void
  readonly signal?: AbortSignal
}
type Callbacks = Pick<Options, 'onExecuted' | 'onError'>

export function createCommandBus(options: Options) {
  let handlers = options.handlers
  let callbacks = { onExecuted: options.onExecuted, onError: options.onError }
  const registrations = new Map<object, CommandHandlers>()
  let disposed = false
  const completionCallbacks: Callbacks = {
    onExecuted: (command) => {
      if (!disposed) callbacks.onExecuted?.(command)
    },
    onError: (error, command) => {
      if (!disposed) callbacks.onError(error, command)
    },
  }

  function capture(source: CommandSource = 'programmatic', origin = options.focus.capture()) {
    const currentHandlers: Partial<Record<CommandId, CommandHandler>> = { ...handlers }
    for (const registration of registrations.values()) Object.assign(currentHandlers, registration)
    const target = options.focus.resolveTarget({
      origin,
      compatible: (target) => !target.capabilities.overlay,
    })
    const scope = options.focus.getSnapshot().scope
    const context: CommandContext = { source, origin, target }
    const inspections = new Map<CommandId, CommandInspection>()

    function inspect(id: CommandId): CommandInspection {
      if (disposed) return { status: 'unavailable' }
      const cached = inspections.get(id)
      if (cached) return cached
      const inspection = inspectCommand(id, currentHandlers[id], context)
      inspections.set(id, inspection)
      return inspection
    }

    function dispatch(id: CommandId): CommandTicket {
      if (disposed)
        return settled({ status: 'disabled', reason: 'The command owner has closed.' }, false)
      if (!sameScope(scope, options.focus.getSnapshot().scope))
        return settled(
          { status: 'disabled', reason: 'The active screen or environment changed.' },
          false,
        )
      const inspection = inspect(id)
      if (inspection.status === 'disabled')
        return settled({ status: 'disabled', reason: inspection.reason }, false)
      const handler = currentHandlers[id]
      if (inspection.status === 'unavailable' || !handler)
        return settled({ status: 'unhandled' }, false)
      return runCommand(handler, context, id, completionCallbacks)
    }

    return { inspect, dispatch, list: () => listCommands(currentHandlers, inspect) }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    handlers = {}
    registrations.clear()
    options.signal?.removeEventListener('abort', dispose)
  }
  if (options.signal?.aborted) dispose()
  else options.signal?.addEventListener('abort', dispose, { once: true })

  return {
    capture,
    dispose,
    setCallbacks(next: Pick<Options, 'onExecuted' | 'onError'>) {
      if (disposed) return
      callbacks = { onExecuted: next.onExecuted, onError: next.onError }
    },
    setHandlers(next: CommandHandlers) {
      if (disposed) return
      handlers = next
    },
    registerHandlers(initial: CommandHandlers) {
      const owner = {}
      if (!disposed) registrations.set(owner, initial)
      return {
        update(next: CommandHandlers) {
          if (disposed) return
          registrations.set(owner, next)
        },
        unregister() {
          registrations.delete(owner)
        },
      }
    },
  }
}

export type CommandBus = ReturnType<typeof createCommandBus>

function inspectCommand(
  id: CommandId,
  handler: CommandHandler | undefined,
  context: CommandContext,
): CommandInspection {
  const command = commandById(id)
  if (!handler || !command) return { status: 'unavailable' }
  const reason = handler.disabledReason?.(context)
  if (reason) return { status: 'disabled', command, reason }
  return { status: 'ready', command }
}

function settled(outcome: CommandOutcome, claimed: boolean): CommandTicket {
  return { claimed, completion: Promise.resolve(outcome) }
}

function runCommand(
  handler: CommandHandler,
  context: CommandContext,
  id: CommandId,
  options: Callbacks,
): CommandTicket {
  try {
    const result = handler.run(context)
    if (result instanceof Promise)
      return {
        claimed: true,
        completion: result
          .then((value) => finish(value, id, options))
          .catch((error) => failed(error, id, options)),
      }
    return settled(finish(result, id, options), result !== false)
  } catch (error) {
    return settled(failed(error, id, options), true)
  }
}

function finish(result: void | boolean, id: CommandId, options: Callbacks): CommandOutcome {
  if (result === false) return { status: 'unhandled' }
  options.onExecuted?.(id)
  return { status: 'handled' }
}

function failed(error: unknown, id: CommandId, options: Callbacks): CommandOutcome {
  try {
    options.onError(error, id)
  } catch {
    // Reporting failures must not reject an already settled command ticket.
  }
  return { status: 'failed', error }
}

function listCommands(handlers: CommandHandlers, inspect: (id: CommandId) => CommandInspection) {
  return Object.keys(handlers).flatMap((id) => {
    const command = commandById(id)
    if (!command || command.hiddenInPalette) return []
    const result = inspect(command.id)
    return result.status === 'unavailable' ? [] : [result]
  })
}
