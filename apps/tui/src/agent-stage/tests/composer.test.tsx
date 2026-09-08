import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'
import { makeTestServer } from '../../../test/server'
import type { TextareaRenderable } from '@opentui/core'
import assert from 'node:assert/strict'

test('Tab completes a real file token and ordinary Tab still moves focus', async ({ server }) => {
  await writeFile(`${server.root}/alpha.txt`, 'file')
  const app = await renderAgentStage(server)
  const { frame } = app
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      await frame.mockInput.typeText('Read @alp')
      frame.mockInput.pressKey('TAB')
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-completions')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('alpha.txt')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Read @alpha.txt')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).not.toBe('agent-composer')
    await runPaletteCommand(frame, 'Focus prompt')
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    })
  } finally {
    await app.cleanup()
  }
})

test('large paste is an atomic native placeholder and sends its full contents after undo', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server)
  const { frame } = app
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    const input = frame.renderer.root.findDescendantById('agent-composer') as TextareaRenderable
    assert(input)
    const pasted = Array.from(
      { length: 16 },
      (_, index) => `Detailed line ${index}: explain this`,
    ).join('\n')
    await act(async () => {
      await frame.mockInput.pasteBracketedText('Inspect 🦊 ')
      await frame.mockInput.pasteBracketedText(pasted)
    })
    expect(input.plainText).toContain('[Paste 16 lines')
    expect(input.plainText).not.toContain('Detailed line 15')
    await act(async () => {
      frame.mockInput.pressKey('BACKSPACE')
    })
    expect(input.plainText).toBe('Inspect 🦊 ')
    await runPaletteCommand(frame, 'Undo prompt edit')
    expect(input.plainText).toContain('[Paste 16 lines')
    expect(input.extmarks.getVirtual()).toHaveLength(1)
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => server.providerAdapter.startedTurns.length).toBe(1)
    expect(server.providerAdapter.startedTurns[0]?.messageText).toBe(`Inspect 🦊 ${pasted}`)
    await expect.poll(() => app.chat.getSnapshot().selectedSessionId).not.toBeNull()
    await runPaletteCommand(frame, 'Previous prompt')
    const restored = frame.renderer.root.findDescendantById('agent-composer') as TextareaRenderable
    expect(restored.plainText).toContain('[Paste 16 lines')
    expect(restored.extmarks.getVirtual()).toHaveLength(1)
    await runPaletteCommand(frame, 'Next prompt')
    expect(restored.plainText).toBe('')
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})
