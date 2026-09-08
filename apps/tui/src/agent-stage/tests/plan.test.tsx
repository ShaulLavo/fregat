import assert from 'node:assert/strict'
import { act } from 'react'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { appendAgentPlan, renderAgentStage } from '../../../test/factories/agent-stage'

test('a terminal-context-only prompt refines the proposed plan without marking it implemented', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server, {
    conversation: true,
    terminalContext: {
      source: 'shell (selected excerpt)',
      lineStart: 1,
      lineEnd: 1,
      text: 'The build needs another dependency',
    },
  })
  const { frame, submission, chat } = app
  assert(submission)
  const sessionId = submission.command.sessionId
  try {
    await act(async () => {
      await appendAgentPlan(server, {
        sessionId,
        turnId: submission.command.turnId,
        text: '# Implement the build',
      })
    })
    await expect
      .poll(
        () => selectChatSessionById(chat.getSnapshot().projection, sessionId)?.proposedPlans.length,
      )
      .toBe(1)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => server.providerAdapter.startedTurns.length).toBe(2)
    expect(server.providerAdapter.startedTurns[1]).toMatchObject({
      interactionMode: 'plan',
      messageText: expect.stringContaining('The build needs another dependency'),
    })
    expect(server.providerAdapter.startedTurns[1]?.messageText).not.toContain(
      'Implement the following plan',
    )
    const plan = selectChatSessionById(chat.getSnapshot().projection, sessionId)?.proposedPlans[0]
    assert(plan)
    expect(plan.implementedAt).toBeNull()
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})
