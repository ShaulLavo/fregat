import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import * as v from 'valibot'
import {
  commandIdSchema,
  errorMessage,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type SessionId,
} from '@workspace/contracts'
import type { ProviderService } from '../provider/provider-service'
import type { OrchestrationReadModel, OrchestrationProjectedSession } from './read-model'
import { formatSessionTitleContext, type SessionTitleMessage } from './title-context'
import { generateSessionTitle } from './title-generation'
import { recordChatPipelineWarning } from './orchestration-logging'

type Dependencies = {
  attachmentsDir: string
  service: ProviderService
  messages: (sessionId: SessionId) => readonly SessionTitleMessage[]
  model: () => OrchestrationReadModel
  selection: (projectId: string) => Promise<ModelSelection>
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
}

export class SessionTitleReactor {
  readonly name = 'session-title-reactor'
  private readonly dependencies: Dependencies
  private readonly tasks = new Set<Promise<void>>()
  private readonly abort = new AbortController()
  private readonly initial = new Set<SessionId>()

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies
  }

  handleEvents(events: OrchestrationEvent[]) {
    for (const event of events) {
      if (event.type === 'session.turn-start-requested') {
        this.track(() => this.generateInitial(event))
        continue
      }
      if (event.type === 'session.meta-updated' && event.payload.regenerateTitle) {
        this.track(() => this.regenerate(event))
        continue
      }
      if (event.type !== 'session.runtime-set' && event.type !== 'session.meta-updated') continue
      this.track(() => this.refine(event.payload.sessionId))
    }
  }

  isIdle() {
    return this.tasks.size === 0
  }
  async drain() {
    while (this.tasks.size) await Promise.all(this.tasks)
  }
  async close() {
    this.abort.abort()
    await this.drain()
  }

  async recover() {
    for (const session of this.dependencies.model().sessions.values()) {
      if (session.deletedAt || !session.titleRegeneration) continue
      await this.complete(
        session.id,
        session.titleRegeneration.requestId,
        undefined,
        'Title generation was interrupted. Retry to generate a title.',
      )
    }
    for (const session of this.dependencies.model().sessions.values()) {
      if (session.deletedAt) continue
      await this.refine(session.id)
    }
  }

  private track(run: () => Promise<void>) {
    if (this.abort.signal.aborted) return
    const task = run()
      .catch((error: unknown) => {
        if (this.abort.signal.aborted) return
        recordChatPipelineWarning('chat.pipeline.title.failed', { error: errorMessage(error) })
      })
      .finally(() => this.tasks.delete(task))
    this.tasks.add(task)
  }

  private session(id: SessionId) {
    const session = this.dependencies.model().sessions.get(id)
    return session?.deletedAt ? undefined : session
  }

  private async request(session: OrchestrationProjectedSession, previousTitle?: string) {
    const worktree = this.dependencies.model().worktrees.get(session.worktreeId)
    if (!worktree) return null
    const context = formatSessionTitleContext(this.dependencies.messages(session.id))
    if (!context.message) return null
    const modelSelection = await this.dependencies.selection(worktree.projectId)
    return generateSessionTitle(this.dependencies.service, {
      ...context,
      cwd: worktree.path,
      attachmentsDir: this.dependencies.attachmentsDir,
      modelSelection,
      previousTitle,
      signal: this.abort.signal,
    })
  }

  private async generateInitial(
    event: Extract<OrchestrationEvent, { type: 'session.turn-start-requested' }>,
  ) {
    const session = this.session(event.payload.sessionId)
    if (!session || session.titleState || this.initial.has(session.id)) return
    if (session.messages.filter((message) => message.role === 'user').length !== 1) return
    if (session.title !== 'New chat' && session.title !== event.payload.titleSeed) return
    this.initial.add(session.id)
    try {
      const generated = await this.initialRequest(session)
      if (!generated) return
      await this.dependencies.dispatch({
        type: 'session.title.generate.complete',
        commandId: id(),
        sessionId: session.id,
        expectedTitle: session.title,
        expectedVersion: null,
        title: generated.title === 'New chat' ? session.title : generated.title,
        needsRefinement: generated.needsRefinement || generated.title === 'New chat',
      })
    } finally {
      this.initial.delete(session.id)
    }
    await this.refine(session.id)
  }

  private async initialRequest(session: OrchestrationProjectedSession) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(session)
      } catch (error) {
        if (attempt >= 2 || this.abort.signal.aborted) throw error
        await delay(2_000 * 2 ** attempt, undefined, { signal: this.abort.signal })
      }
    }
  }

  private async refine(sessionId: SessionId) {
    const session = this.session(sessionId)
    if (
      !session ||
      session.titleState?.source !== 'generated' ||
      !session.titleState.needsRefinement ||
      session.titleRegeneration
    )
      return
    if (session.latestTurn?.state !== 'completed' || session.runtime?.status !== 'ready') return
    if (session.messages.filter((message) => message.role === 'user').length !== 1) return
    await this.dependencies.dispatch({
      type: 'session.title.refine',
      commandId: id(),
      sessionId,
      expectedVersion: session.titleState.version,
    })
  }

  private async regenerate(event: Extract<OrchestrationEvent, { type: 'session.meta-updated' }>) {
    const session = this.session(event.payload.sessionId)
    const requestId = event.payload.titleRegeneration?.requestId
    if (
      !session ||
      !requestId ||
      session.titleRegeneration?.requestId !== requestId ||
      session.title !== event.payload.previousTitle
    )
      return
    try {
      const generated = await this.request(session, session.title)
      const latest = this.session(session.id)
      if (latest?.titleRegeneration?.requestId !== requestId || latest.title !== session.title)
        return
      const title = generated?.title
      await this.complete(
        session.id,
        requestId,
        title === 'New chat' || title === session.title ? undefined : title,
      )
    } catch (error) {
      if (this.abort.signal.aborted) return
      await this.complete(session.id, requestId, undefined, errorMessage(error))
    }
  }

  private complete(sessionId: SessionId, requestId: string, title?: string, error?: string) {
    return this.dependencies.dispatch({
      type: 'session.title.regeneration.complete',
      commandId: id(),
      sessionId,
      requestId,
      title,
      error,
    })
  }
}

function id() {
  return v.parse(commandIdSchema, `session-title:${randomUUID()}`)
}
