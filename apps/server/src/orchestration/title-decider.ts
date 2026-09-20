import type { OrchestrationCommand } from '@workspace/contracts'
import { one } from './event-factory'
import { requireSession, type OrchestrationReadModel } from './read-model'

type TitleCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | 'session.title.generate.complete'
      | 'session.title.refine'
      | 'session.title.regeneration.complete'
  }
>

export function decideSessionTitle(
  command: TitleCommand,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSession(model, command.sessionId)
  const base = { sessionId: command.sessionId, updatedAt: session.updatedAt }
  if (command.type === 'session.title.generate.complete') {
    const current =
      session.titleState?.source !== 'manual' &&
      session.title === command.expectedTitle &&
      (session.titleState?.version ?? null) === command.expectedVersion &&
      !session.titleRegeneration
    return one(command, at, 'session.meta-updated', {
      ...base,
      ...(current
        ? {
            title: command.title,
            titleState: {
              source: 'generated' as const,
              version: command.commandId,
              needsRefinement: command.needsRefinement,
            },
          }
        : {}),
    })
  }
  if (command.type === 'session.title.refine') {
    const current =
      session.titleState?.source === 'generated' &&
      session.titleState.version === command.expectedVersion &&
      session.titleState.needsRefinement &&
      !session.titleRegeneration &&
      session.latestTurn?.state === 'completed' &&
      session.runtime?.status === 'ready'
    return one(command, at, 'session.meta-updated', {
      ...base,
      ...(current
        ? {
            titleState: {
              source: 'generated' as const,
              version: command.commandId,
              needsRefinement: false,
            },
            regenerateTitle: true,
            previousTitle: session.title,
            titleRegeneration: { requestId: command.commandId, startedAt: at },
            titleGenerationError: null,
          }
        : {}),
    })
  }
  const current = session.titleRegeneration?.requestId === command.requestId
  return one(command, at, 'session.meta-updated', {
    ...base,
    ...(current
      ? {
          title: command.title,
          titleRegeneration: null,
          titleGenerationError: command.error ?? null,
          updatedAt: at,
        }
      : {}),
  })
}

export function titleMetadata(
  command: Extract<OrchestrationCommand, { type: 'session.meta.update' }>,
  session: ReturnType<typeof requireSession>,
  at: string,
) {
  if (command.title !== undefined)
    return {
      titleState: { source: 'manual' as const, version: command.commandId, needsRefinement: false },
      titleRegeneration: null,
      titleGenerationError: null,
    }
  if (!command.regenerateTitle) return {}
  return {
    titleState: {
      source: 'generated' as const,
      version: command.commandId,
      needsRefinement: false,
    },
    regenerateTitle: true,
    previousTitle: session.title,
    titleRegeneration: { requestId: command.commandId, startedAt: at },
    titleGenerationError: null,
  }
}
