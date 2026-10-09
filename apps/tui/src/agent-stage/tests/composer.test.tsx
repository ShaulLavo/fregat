import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'
import { makeTestServer } from '../../../test/server'
import { conversationTurns } from '../../../test/factories/chat'
import { TextareaRenderable, parseColor, type SyntaxStyle } from '@opentui/core'
import { findMarkdown, setAgentTheme } from '../../../test/factories/agent-theme'
import assert from 'node:assert/strict'

test('mounted prompt repaints syntax while retaining marks, undo, selection and focus', async ({
  server,
}) => {
  const app = await renderAgentStage(server, { noColor: false, colorMode: 'truecolor' })
  const { frame } = app
  let finalSyntax: SyntaxStyle | null = null
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    const input = frame.renderer.root.findDescendantById('agent-composer')
    assert(input instanceof TextareaRenderable)
    await act(async () => {
      await frame.mockInput.typeText('Inspect @alpha.txt ')
      await frame.mockInput.pasteBracketedText('Detailed line\n'.repeat(16))
      await frame.renderOnce()
    })
    const originalSyntax = input.syntaxStyle
    assert(originalSyntax)
    const originalMarks = input.extmarks.getAll()
    expect(originalMarks).toHaveLength(2)
    const text = input.plainText
    const partId = originalSyntax.getStyleId('prompt-part')
    const referenceId = originalSyntax.getStyleId('prompt-reference')
    expect(partId).not.toBeNull()
    expect(referenceId).not.toBeNull()
    input.editorView.setSelection(0, 7)
    const selection = input.editorView.getSelection()
    const cursor = input.cursorOffset
    for (const [appearance, palette] of [
      ['light', 'graphite'],
      ['light', 'sage'],
    ] as const) {
      const previousSyntax: SyntaxStyle | null = input.syntaxStyle
      const theme = await setAgentTheme(app, appearance, palette)
      expect(frame.renderer.root.findDescendantById('agent-composer')).toBe(input)
      expect(input.plainText).toBe(text)
      expect(input.cursorOffset).toBe(cursor)
      expect(input.editorView.getSelection()).toEqual(selection)
      expect(frame.renderer.currentFocusedRenderable).toBe(input)
      expect(input.extmarks.getAll()).toEqual(originalMarks)
      const syntax: SyntaxStyle | null = input.syntaxStyle
      assert(syntax)
      finalSyntax = syntax
      expect(syntax).toBe(previousSyntax)
      expect(syntax.getStyleCount()).toBe(2)
      expect(syntax.getStyleId('prompt-part')).toBe(partId)
      expect(syntax.getStyleId('prompt-reference')).toBe(referenceId)
      expect(syntax.getStyle('prompt-reference')?.fg?.toInts()).toEqual(
        parseColor(theme.info).toInts(),
      )
      expect(syntax.getStyle('prompt-part')?.bg?.toInts()).toEqual(
        parseColor(theme.accent).toInts(),
      )
      const spans = frame.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes('@alpha.txt'))?.fg.toInts()).toEqual(
        parseColor(theme.info).toInts(),
      )
      expect(spans.find((span) => span.text.includes('[Paste'))?.fg.toInts()).toEqual(
        parseColor(theme.info).toInts(),
      )
      expect(spans.find((span) => span.text.includes('[Paste'))?.bg.toInts()).toEqual(
        parseColor(theme.accent).toInts(),
      )
    }
    await act(async () => {
      input.editorView.resetSelection()
    })
    await runPaletteCommand(frame, 'Undo prompt edit')
    expect(input.plainText).toBe('Inspect @alpha.txt ')
    await runPaletteCommand(frame, 'Redo prompt edit')
    expect(input.plainText).toBe(text)
    expect(input.extmarks.getVirtual()).toHaveLength(1)
    await act(async () => {
      await frame.mockInput.pasteBracketedText('\nNew pasted detail'.repeat(16))
      await frame.renderOnce()
    })
    expect(input.extmarks.getVirtual()).toHaveLength(2)
    expect(input.extmarks.getVirtual().every((mark) => mark.styleId === partId)).toBe(true)
  } finally {
    await app.cleanup()
  }
  expect(() => finalSyntax?.getStyleCount()).toThrow('destroyed')
})

test.for(['16', '256'] as const)(
  '%s-color syntax resources retain ownership across equivalent theme objects',
  async (colorMode, { server }) => {
    const app = await renderAgentStage(server, { conversation: true, noColor: false, colorMode })
    const { frame } = app
    try {
      await frame.renderOnce()
      const input = frame.renderer.root.findDescendantById('agent-composer')
      assert(input instanceof TextareaRenderable)
      const markdown = findMarkdown(frame.renderer.root, 'Initial conversation')
      assert(markdown)
      const prompt = input.syntaxStyle
      const transcript = markdown.syntaxStyle
      const state = app.session.getSnapshot()
      assert(state.kind === 'ready')
      await act(async () => {
        const saved = state.owner.submit('user', [
          { kind: 'set', key: 'workbench.reduceMotion', value: true },
        ])
        assert(saved.kind === 'submitted')
        await saved.settled
        await frame.renderOnce()
      })
      expect(input.syntaxStyle).toBe(prompt)
      expect(markdown.syntaxStyle).toBe(transcript)
      expect(prompt?.getStyleCount()).toBeGreaterThan(0)
      expect(transcript.getStyleCount()).toBeGreaterThan(0)
    } finally {
      await app.cleanup()
    }
  },
)

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
    await expect.poll(() => conversationTurns(server.providerAdapter).length).toBe(1)
    expect(conversationTurns(server.providerAdapter)[0]?.messageText).toBe(`Inspect 🦊 ${pasted}`)
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
