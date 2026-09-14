import * as v from 'valibot'
import {
  orchestrationSessionShellSchema,
  orchestrationMessageSchema,
  sessionRuntimeStateSchema,
  messageIdSchema,
  type ClientOrchestrationCommand,
  type OrchestrationDispatchResult,
  type OrchestrationShellSnapshot,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSession,
  type SessionCreateCommand,
} from '@workspace/contracts'
import { seedSession } from '../seed'
import { DemoWorkspace, demoError } from './workspace'

export class DemoOrchestration {
  private readonly receipts = new Map<string, OrchestrationDispatchResult>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(readonly workspace: DemoWorkspace) {}

  shell(): OrchestrationShellSnapshot {
    return {
      snapshotSequence: this.workspace.sequence,
      projects: [this.workspace.project],
      worktrees: [this.workspace.worktree],
      sessions: [...this.workspace.sessions.values()]
        .filter((session) => !session.deletedAt)
        .map((session) =>
          v.parse(orchestrationSessionShellSchema, {
            ...session,
            latestUserMessageAt:
              session.messages.findLast((message) => message.role === 'user')?.createdAt ?? null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: false,
          }),
        ),
      updatedAt: new Date().toISOString(),
    }
  }

  detail(id: string): OrchestrationSessionDetailSnapshot {
    const session = this.workspace.sessions.get(id)
    if (!session) throw demoError('This demo session does not exist.', 'NOT_FOUND', 404)
    return {
      snapshotSequence: this.workspace.sequence,
      session,
      proposedPlans: [],
      checkpoints: [],
    }
  }

  dispatch(command: ClientOrchestrationCommand): OrchestrationDispatchResult {
    const existing = this.receipts.get(command.commandId)
    if (existing) return { ...existing, deduped: true }
    const result = this.apply(command)
    this.workspace.updated()
    const receipt = { deduped: false, sequence: this.workspace.sequence, result }
    this.receipts.set(command.commandId, receipt)
    return receipt
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private apply(command: ClientOrchestrationCommand): OrchestrationDispatchResult['result'] {
    if (command.type === 'project.create') {
      if (
        this.workspace.path(command.workspaceRoot) !==
        this.workspace.project.repositoryIdentity.canonical
      )
        throw unsupported(command)
      return {
        projectId: this.workspace.project.id,
        worktreeId: this.workspace.worktree.id,
        disposition: 'existing-worktree',
      }
    }
    if (command.type === 'session.create') {
      if (this.workspace.sessions.has(command.sessionId))
        throw demoError('This session already exists.')
      this.createSession(command.sessionId, command)
      return null
    }
    if (!('sessionId' in command)) throw unsupported(command)
    if (command.type === 'session.turn.start' && !this.workspace.sessions.has(command.sessionId)) {
      const create = command.bootstrap?.createSession
      if (!create) throw demoError('Create a demo session before sending a message.')
      this.createSession(command.sessionId, create)
    }
    const session = this.detail(command.sessionId).session
    this.applySession(session, command)
    session.updatedAt = new Date().toISOString()
    return null
  }

  private createSession(
    id: string,
    input: Pick<
      SessionCreateCommand,
      'worktreeTarget' | 'title' | 'modelSelection' | 'runtimeMode' | 'interactionMode'
    >,
  ) {
    if (
      input.worktreeTarget.kind !== 'current' ||
      input.worktreeTarget.worktreeId !== this.workspace.worktree.id
    )
      throw demoError('Demo sessions use the existing garden worktree.')
    const session = seedSession(id, input.title)
    session.modelSelection = input.modelSelection
    session.runtimeMode = input.runtimeMode
    session.interactionMode = input.interactionMode
    this.workspace.sessions.set(session.id, session)
  }

  private applySession(session: OrchestrationSession, command: ClientOrchestrationCommand) {
    const now = new Date().toISOString()
    switch (command.type) {
      case 'session.turn.start':
        return this.startTurn(session, command)
      case 'session.turn.interrupt':
        return this.interrupt(session)
      case 'session.runtime.stop':
        this.interrupt(session)
        if (session.runtime) session.runtime.status = 'stopped'
        return
      case 'session.meta.update':
        if (command.title !== undefined) session.title = command.title
        if (command.modelSelection !== undefined) session.modelSelection = command.modelSelection
        return
      case 'session.runtime-mode.set':
        session.runtimeMode = command.runtimeMode
        return
      case 'session.interaction-mode.set':
        session.interactionMode = command.interactionMode
        return
      case 'session.archive':
        session.archivedAt = now
        return
      case 'session.unarchive':
        session.archivedAt = null
        return
      case 'session.delete':
        this.interrupt(session)
        session.deletedAt = now
        return
      case 'session.settle':
        session.settledOverride = 'settled'
        session.settledAt = now
        return
      case 'session.unsettle':
        session.settledOverride = 'active'
        session.settledAt = null
        return
      case 'session.snooze':
        session.snoozedUntil = command.snoozedUntil
        session.snoozedAt = now
        return
      case 'session.unsnooze':
        session.snoozedUntil = null
        session.snoozedAt = null
        return
      case 'session.pin':
        session.pinnedAt = now
        session.pinOrderKey = command.orderKey ?? null
        return
      case 'session.unpin':
        session.pinnedAt = null
        session.pinOrderKey = null
        return
      case 'session.pin.reorder':
        session.pinOrderKey = command.orderKey
        return
      default:
        throw unsupported(command)
    }
  }

  private startTurn(
    session: OrchestrationSession,
    command: Extract<ClientOrchestrationCommand, { type: 'session.turn.start' }>,
  ) {
    this.interrupt(session)
    const now = new Date().toISOString()
    const replyId = v.parse(messageIdSchema, `demo-${command.turnId}`)
    session.messages.push(
      v.parse(orchestrationMessageSchema, {
        id: command.message.messageId,
        sessionId: session.id,
        role: 'user',
        text: command.message.text,
        attachments: [],
        turnId: command.turnId,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      }),
    )
    session.messages.push(
      v.parse(orchestrationMessageSchema, {
        id: replyId,
        sessionId: session.id,
        role: 'assistant',
        text: '',
        attachments: [],
        turnId: command.turnId,
        streaming: true,
        createdAt: now,
        updatedAt: now,
      }),
    )
    session.attentionState = 'working'
    session.settledOverride = null
    session.snoozedUntil = null
    if (command.modelSelection) session.modelSelection = command.modelSelection
    session.runtimeMode = command.runtimeMode
    session.interactionMode = command.interactionMode
    session.updatedAt = now
    session.latestTurn = {
      turnId: command.turnId,
      state: 'running',
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: replyId,
      providerStartState: 'adopted',
      providerStartGeneration: 1,
      providerStartSequence: this.workspace.sequence,
      runtimeEpoch: 'garden-demo',
    }
    session.runtime = v.parse(sessionRuntimeStateSchema, {
      sessionId: session.id,
      status: 'running',
      providerName: 'demo',
      providerInstanceId: session.modelSelection.providerInstanceId,
      providerBindingHandle: null,
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'garden-demo',
      runtimeMode: session.runtimeMode,
      activeTurnId: command.turnId,
      lastError: null,
      updatedAt: now,
    })
    const answer = this.answer(command.message.text)
    this.streamReply(session, replyId, answer, 0)
  }

  private streamReply(
    session: OrchestrationSession,
    replyId: string,
    answer: string,
    offset: number,
  ) {
    const timer = setTimeout(() => {
      const message = session.messages.find((item) => item.id === replyId)
      if (!message) return
      const end = Math.min(answer.length, offset + 38)
      message.text = answer.slice(0, end)
      message.updatedAt = new Date().toISOString()
      message.streaming = end < answer.length
      if (!message.streaming) this.finishTurn(session)
      this.workspace.updated()
      if (message.streaming) this.streamReply(session, replyId, answer, end)
    }, 90)
    this.timers.set(session.id, timer)
  }

  private finishTurn(session: OrchestrationSession) {
    session.attentionState = 'settled'
    if (session.runtime) {
      session.runtime.status = 'ready'
      session.runtime.activeTurnId = null
    }
    if (session.latestTurn) {
      session.latestTurn.state = 'completed'
      session.latestTurn.completedAt = new Date().toISOString()
    }
    this.timers.delete(session.id)
  }

  private interrupt(session: OrchestrationSession) {
    clearTimeout(this.timers.get(session.id))
    this.timers.delete(session.id)
    for (const message of session.messages) message.streaming = false
    session.attentionState = 'settled'
    if (session.runtime) {
      session.runtime.status = 'interrupted'
      session.runtime.activeTurnId = null
    }
    if (session.latestTurn?.state === 'running') {
      session.latestTurn.state = 'interrupted'
      session.latestTurn.completedAt = new Date().toISOString()
    }
  }

  private answer(prompt: string) {
    if (/change|diff|git|review/i.test(prompt)) {
      const files = this.workspace.gitStatus().files
      return `This is a simulated review of your current workspace.\n\n${files.length ? files.map((file) => `- \`${file.path.replace('/garden/', '')}\`: ${file.status}`).join('\n') : 'Your working tree is clean.'}\n\nOpen the Git sidebar to review the actual before and after text, stage your changes, and create a local demo commit.`
    }
    if (/test/i.test(prompt))
      return 'The demo project includes two example tests in `tests/garden.test.ts`: autumn planting includes lavender, and the garden has two beds.\n\nTry `bun test` in the terminal to see simulated output. This browser demo does not execute the test runner.'
    const count = this.workspace.readFile('src/garden.ts')?.content.split('\n').length ?? 0
    return `The planting schedule lives in \`src/garden.ts\` (${count} lines in your saved file).\n\n1. \`garden\` groups plants into two beds: the sunny border and the kitchen door.\n2. \`plantingSchedule(season)\` keeps plants whose \`plantingSeasons\` include that season.\n3. Each result includes the bed, plant name, spacing, and a care note.\n\nLavender is planted in spring or autumn. You can change its spacing in \`src/plants.ts\`, save, and review the change in Git.\n\n*This reply is simulated locally from the demo workspace; no AI service is connected.*`
  }
}

function unsupported(command: ClientOrchestrationCommand) {
  return demoError(
    `The browser demo does not support ${command.type}.`,
    'DEMO_COMMAND_UNSUPPORTED',
    501,
  )
}
