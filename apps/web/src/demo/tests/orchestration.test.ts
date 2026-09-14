import * as v from 'valibot'
import {
  clientOrchestrationCommandSchema,
  orchestrationSessionDetailSnapshotSchema,
  providerListResultSchema,
  providerCommandCatalogSchema,
} from '@workspace/contracts'
import { expect, test } from '../../../test/fixtures'
import { server } from '../../../test/msw/server'
import { DemoWorkspace } from '../state/workspace'
import { DemoOrchestration } from '../state/orchestration'
import { demoHttpHandler } from '../transport/http'

const API = 'https://fregat-demo.invalid'

test('provider HTTP responses have the envelope consumed by the real chat UI', async () => {
  const workspace = await DemoWorkspace.create()
  const orchestration = new DemoOrchestration(workspace)
  server.use(
    demoHttpHandler(
      API,
      workspace,
      orchestration,
      { font: '/font.ttf', wallpaper: '/garden.jpg' },
      { requests: [], unhandled: [], logs: [] },
    ),
  )
  const response = await fetch(`${API}/providers`)
  const result = v.parse(providerListResultSchema, await response.json())
  expect(result.providers.map((provider) => provider.providerInstanceId)).toEqual([
    'claude',
    'codex',
  ])
  const commands = await fetch(`${API}/providers/claude/commands`)
  expect(v.parse(providerCommandCatalogSchema, await commands.json())).toMatchObject({
    commands: [],
    skills: [],
    supported: false,
  })
})

test('supported session commands update snapshots; unsupported commands do not receive receipts', async () => {
  const workspace = await DemoWorkspace.create()
  const orchestration = new DemoOrchestration(workspace)
  const sessionId = '339499fb-d9c6-4767-a147-c5d845ba02aa'
  const dispatch = (command: unknown) =>
    orchestration.dispatch(v.parse(clientOrchestrationCommandSchema, command))
  const created = dispatch({
    type: 'session.create',
    commandId: 'create',
    sessionId,
    title: 'Autumn plans',
    modelSelection: { providerInstanceId: 'codex', model: 'demo-garden' },
    worktreeTarget: { kind: 'current', worktreeId: workspace.worktree.id },
  })
  dispatch({ type: 'session.meta.update', commandId: 'title', sessionId, title: 'Garden notes' })
  dispatch({
    type: 'session.interaction-mode.set',
    commandId: 'mode',
    sessionId,
    interactionMode: 'plan',
  })
  dispatch({ type: 'session.pin', commandId: 'pin', sessionId, orderKey: 'm' })
  const snapshot = v.parse(
    orchestrationSessionDetailSnapshotSchema,
    orchestration.detail(sessionId),
  )
  expect(snapshot.session).toMatchObject({
    title: 'Garden notes',
    interactionMode: 'plan',
    pinOrderKey: 'm',
  })
  expect(snapshot.session.pinnedAt).toBeTruthy()
  expect(snapshot.session).not.toHaveProperty('commandId')
  const sequence = workspace.sequence
  expect(() =>
    dispatch({
      type: 'session.checkpoint.revert',
      commandId: 'unsupported',
      sessionId,
      turnCount: 0,
    }),
  ).toThrow('does not support')
  expect(workspace.sequence).toBe(sequence)
  expect(created.sequence).toBeLessThan(sequence)
  dispatch({ type: 'session.delete', commandId: 'delete', sessionId })
  expect(orchestration.shell().sessions.some((session) => session.id === sessionId)).toBe(false)
})

test('a first message can bootstrap a new session and its command receipt is idempotent', async () => {
  const workspace = await DemoWorkspace.create()
  const orchestration = new DemoOrchestration(workspace)
  const sessionId = 'bd8b2d99-3fe6-42fc-8746-7a0b420b4fef'
  const command = v.parse(clientOrchestrationCommandSchema, {
    type: 'session.turn.start',
    commandId: 'start',
    sessionId,
    turnId: 'first-turn',
    message: { messageId: 'first-message', role: 'user', text: 'Explain the garden' },
    bootstrap: {
      createSession: {
        title: 'First conversation',
        worktreeTarget: { kind: 'current', worktreeId: workspace.worktree.id },
        modelSelection: { providerInstanceId: 'claude', model: 'demo-garden' },
      },
    },
  })
  try {
    const receipt = orchestration.dispatch(command)
    expect(orchestration.dispatch(command)).toEqual({ ...receipt, deduped: true })
    expect(
      orchestration.detail(sessionId).session.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(1)
    orchestration.dispatch(
      v.parse(clientOrchestrationCommandSchema, {
        type: 'session.turn.interrupt',
        commandId: 'interrupt',
        sessionId,
      }),
    )
    expect(orchestration.detail(sessionId).session.latestTurn?.state).toBe('interrupted')
  } finally {
    orchestration.stop()
  }
})
