import assert from 'node:assert/strict'
import type { MessageId } from '@workspace/contracts'
import { act } from 'react'
import { ScrollBoxRenderable } from '@opentui/core'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { test, expect } from '../../../test/fixtures'
import { appendAgentMessage, renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'
import { createTimelineLayout } from '@/agent-stage/state/timeline-layout'
import { timelineRows } from '@/agent-stage/utils/timeline'

test('timeline windows traverse mixed-height messages in both directions', async ({ server }) => {
  const app = await renderAgentStage(server, { conversation: true, height: 30 })
  const { frame, chat, submission } = app
  assert(submission)
  try {
    await act(async () => {
      for (let index = 0; index < 90; index += 1)
        await appendAgentMessage(server, {
          sessionId: submission.command.sessionId,
          turnId: submission.command.turnId,
          text: `Transcript item ${index}${index % 7 === 0 ? `\n${'Detail line\n'.repeat(30)}` : ''}`,
          createdAt: new Date(Date.now() + index).toISOString(),
        })
    })
    await expect
      .poll(
        () =>
          selectChatSessionById(chat.getSnapshot().projection, submission.command.sessionId)
            ?.messages.length,
      )
      .toBe(91)
    const conversation = selectChatSessionById(
      chat.getSnapshot().projection,
      submission.command.sessionId,
    )
    assert(conversation)
    const rows = timelineRows(conversation).filter((row) => row.kind === 'message')
    const layout = createTimelineLayout()
    let window = layout.window(rows, 95, 12, rows[0].id)
    const ids = new Set(window.rows.map((row) => row.id))
    while (window.end < rows.length) {
      window = layout.window(rows, 95, 12, layout.next(rows, 95, 12, window.end))
      for (const row of window.rows) ids.add(row.id)
    }
    expect(ids.size).toBe(rows.length)
    await runPaletteCommand(frame, 'Previous transcript page')
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).not.toContain('Transcript item 89')
    await runPaletteCommand(frame, 'Next transcript page')
    await runPaletteCommand(frame, 'Jump to latest message')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Transcript item 89')
  } finally {
    await app.cleanup()
  }
})

test('streamed markdown follows the tail until manual scroll and survives resize without jumping back', async ({
  server,
}) => {
  const app = await renderAgentStage(server, { conversation: true })
  const { frame, submission } = app
  assert(submission)
  try {
    const text = Array.from(
      { length: 140 },
      (_, index) => `Line ${index} ${'wide 界 text '.repeat(8)}\n\n`,
    ).join('')
    let messageId: MessageId | undefined
    await act(async () => {
      messageId = await appendAgentMessage(server, {
        sessionId: submission.command.sessionId,
        turnId: submission.command.turnId,
        text,
      })
    })
    assert(messageId)
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Line 139')
    await runPaletteCommand(frame, 'Focus transcript')
    await act(async () => {
      frame.mockInput.pressKey('\x1b[5~')
      frame.mockInput.pressKey('\x1b[5~')
    })
    const scroll = frame.renderer.root.findDescendantById('agent-timeline')
    assert(scroll instanceof ScrollBoxRenderable)
    expect(scroll.scrollTop + scroll.viewport.height).toBeLessThan(scroll.scrollHeight)
    const before = scroll.scrollTop
    await act(async () => {
      await appendAgentMessage(server, {
        sessionId: submission.command.sessionId,
        turnId: submission.command.turnId,
        messageId,
        text: '\n\nLAST_STREAMED_MARKER',
      })
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(scroll.scrollTop).toBe(before)
    expect(frame.captureCharFrame()).not.toContain('LAST_STREAMED_MARKER')
    await act(async () => {
      frame.resize(112, 35)
      await frame.renderOnce()
    })
    expect(scroll.scrollTop + scroll.viewport.height).toBeLessThan(scroll.scrollHeight)
    await runPaletteCommand(frame, 'Jump to latest message')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('LAST_STREAMED_MARKER')
  } finally {
    await app.cleanup()
  }
})
