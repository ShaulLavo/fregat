import assert from 'node:assert/strict'
import { act } from 'react'
import { approvalRequestIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { appendAgentRequest, renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'

// Digits in queued composer input must never accept a newly arrived approval.
test('an approval waits for typing to stop, preserves the draft, and sends only the intentional decision', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server, { conversation: true, width: 60 })
  const { frame, submission } = app
  assert(submission)
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    const requestId = v.parse(approvalRequestIdSchema, 'approval-native')
    await act(async () => {
      await frame.mockInput.typeText('Keep typing ')
      await appendAgentRequest(server, {
        sessionId: submission.command.sessionId,
        turnId: submission.command.turnId,
        kind: 'approval.requested',
        payload: { requestId, requestKind: 'command', detail: 'Run pwd?' },
      })
      await frame.mockInput.typeText('123 more draft')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Keep typing 123 more draft')
    expect(server.providerAdapter.approvalResponses).toHaveLength(0)
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-approval')
    })
    expect(server.providerAdapter.approvalResponses).toHaveLength(0)
    await runPaletteCommand(frame, 'Toggle session rail')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await runPaletteCommand(frame, 'Toggle session rail')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-approval')
    expect(server.providerAdapter.approvalResponses).toHaveLength(0)
    await act(async () => {
      frame.mockInput.pressKey('3')
    })
    await expect.poll(() => server.providerAdapter.approvalResponses.length).toBe(1)
    expect(server.providerAdapter.approvalResponses[0]).toMatchObject({
      requestId,
      decision: 'decline',
    })
    await act(async () => {
      await appendAgentRequest(server, {
        sessionId: submission.command.sessionId,
        turnId: submission.command.turnId,
        kind: 'approval.resolved',
        payload: { requestId },
      })
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Keep typing 123 more draft')
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await frame.mockInput.typeText(' continued')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Keep typing 123 more draft continued')
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('secret questions mask every character and send the complete answer on immediate Enter', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server, { conversation: true })
  const { frame, submission } = app
  assert(submission)
  try {
    const requestId = v.parse(approvalRequestIdSchema, 'question-native')
    await act(async () => {
      await appendAgentRequest(server, {
        sessionId: submission.command.sessionId,
        turnId: submission.command.turnId,
        kind: 'user-input.requested',
        payload: {
          requestId,
          questions: [
            {
              id: 'credential',
              prompt: 'Enter the test credential',
              secret: true,
              answerKind: 'text',
            },
          ],
        },
      })
    })
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-question')
    })
    await act(async () => {
      await frame.mockInput.typeText('private-value-29')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).not.toContain('private-value-29')
    expect(frame.captureCharFrame()).toContain('••••')
    await act(async () => {
      await frame.mockInput.typeText('!')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => server.providerAdapter.userInputResponses.length).toBe(1)
    expect(server.providerAdapter.userInputResponses[0]).toMatchObject({
      requestId,
      answers: { credential: 'private-value-29!' },
    })
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('out-of-range question shortcuts preserve the supported choices', async ({ server }) => {
  const app = await renderAgentStage(server, { conversation: true })
  assert(app.submission)
  const ids = { sessionId: app.submission.command.sessionId, turnId: app.submission.command.turnId }
  try {
    await act(async () => {
      await appendAgentRequest(server, {
        ...ids,
        kind: 'user-input.requested',
        payload: {
          requestId: v.parse(approvalRequestIdSchema, 'choice-shortcuts'),
          questions: [
            {
              id: 'choice',
              prompt: 'Choose one',
              answerKind: 'single-select',
              allowOther: false,
              options: [
                { label: 'Alpha', value: 'a' },
                { label: 'Beta', value: 'b' },
              ],
            },
          ],
        },
      })
    })
    await act(async () => {
      await expect
        .poll(() => app.frame.renderer.currentFocusedRenderable?.id)
        .toBe('agent-question')
      app.frame.mockInput.pressKey('9')
    })
    await act(async () => {
      await app.frame.renderOnce()
    })
    expect(app.frame.captureCharFrame()).toContain('Alpha')
    expect(app.frame.captureCharFrame()).toContain('Beta')
    expect(app.frame.captureCharFrame()).not.toContain('Type your answer')
    await act(async () => {
      app.frame.mockInput.pressKey('2')
    })
    await act(async () => {
      await app.frame.renderOnce()
    })
    expect(app.frame.captureCharFrame()).toContain('[x] 2 Beta')
  } finally {
    await app.cleanup()
  }
})

test.for([
  { overlay: 'command-palette', origin: 'agent-approval' },
  { overlay: 'agent-model-filter', origin: 'agent-approval' },
  { overlay: 'command-palette', origin: 'agent-rail' },
])(
  'approval resolution preserves $overlay focus opened from $origin',
  async ({ overlay, origin }, { server }) => {
    const app = await renderAgentStage(server, { conversation: true, width: 60 })
    assert(app.submission)
    const { frame } = app
    const ids = {
      sessionId: app.submission.command.sessionId,
      turnId: app.submission.command.turnId,
    }
    const requestId = v.parse(approvalRequestIdSchema, `approval-${overlay}`)
    try {
      await act(async () => {
        await appendAgentRequest(server, {
          ...ids,
          kind: 'approval.requested',
          payload: { requestId, requestKind: 'command', detail: 'Run pwd?' },
        })
      })
      await act(async () => {
        await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-approval')
      })
      if (origin === 'agent-rail') await runPaletteCommand(frame, 'Toggle session rail')
      if (overlay === 'command-palette')
        await act(async () => {
          frame.mockInput.pressKey('F1')
        })
      if (overlay === 'agent-model-filter') await runPaletteCommand(frame, 'Choose model')
      await act(async () => {
        await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe(overlay)
      })
      await act(async () => {
        await appendAgentRequest(server, {
          ...ids,
          kind: 'approval.resolved',
          payload: { requestId },
        })
      })
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe(overlay)
      await act(async () => {
        frame.mockInput.pressKey('ESCAPE')
      })
      await act(async () => {
        await expect
          .poll(() => frame.renderer.currentFocusedRenderable?.id)
          .toBe(origin === 'agent-approval' ? 'agent-composer' : 'agent-rail')
      })
    } finally {
      await app.cleanup()
    }
  },
)
