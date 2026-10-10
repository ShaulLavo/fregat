import assert from 'node:assert/strict'
import { act } from 'react'
import {
  BoxRenderable,
  CliRenderEvents,
  ScrollBoxRenderable,
  TextareaRenderable,
  parseColor,
} from '@opentui/core'
import { test, expect } from '../../../test/fixtures'
import { setAgentTheme } from '../../../test/factories/agent-theme'
import {
  renderThemeTranscript,
  settleTranscript,
  transcriptMarkers,
  transcriptMarkdown,
  transcriptCode,
  transcriptRenderables,
} from '../../../test/factories/transcript-theme'
import { createMarkdownPaint } from '@/agent-stage/state/markdown-paint'

test('all mounted static and streaming Markdown blocks repaint with the theme', async ({
  server,
}) => {
  const app = await renderThemeTranscript(server)
  const user = transcriptMarkdown(app.frame.renderer.root, 'Static user prose')
  const assistant = transcriptMarkdown(app.frame.renderer.root, 'Theme assistant paragraph')
  const plan = transcriptMarkdown(app.frame.renderer.root, 'Plan retained paragraph')
  try {
    for (const [appearance, palette] of [
      ['light', 'graphite'],
      ['light', 'sage'],
    ] as const) {
      const theme = await setAgentTheme(app, appearance, palette)
      await settleTranscript(app.frame)
      const spans = app.frame.captureSpans().lines.flatMap((line) => line.spans)
      const cells = transcriptMarkers.flatMap((marker) => {
        const matched = spans.filter((span) => span.text.includes(marker))
        expect(matched.length, marker).toBeGreaterThan(0)
        return matched
      })
      for (const cell of cells)
        expect(cell.fg.toInts(), cell.text).toEqual(parseColor(theme.foreground).toInts())
      const numbers = spans.filter((span) => /^\d+\./.test(span.text.trim()))
      expect(numbers.length).toBeGreaterThan(2)
      for (const number of numbers)
        expect(number.fg.toInts()).toEqual(parseColor(theme.foreground).toInts())
      const rules = transcriptRenderables(app.frame.renderer.root).filter(
        (node): node is BoxRenderable =>
          node instanceof BoxRenderable && node.id.includes('-block-') && node.height === 1,
      )
      expect(rules.length).toBeGreaterThan(1)
      for (const rule of rules)
        expect(parseColor(rule.borderColor).toInts()).toEqual(parseColor(theme.foreground).toInts())
      expect(transcriptMarkdown(app.frame.renderer.root, 'Static user prose')).toBe(user)
      expect(transcriptMarkdown(app.frame.renderer.root, 'Theme assistant paragraph')).toBe(
        assistant,
      )
      expect(transcriptMarkdown(app.frame.renderer.root, 'Plan retained paragraph')).toBe(plan)
    }
  } finally {
    await app.cleanup()
  }
})

test.for([false, true])(
  'cross-block transcript selection survives repaint, dragging=%s',
  async (dragging, { server }) => {
    const app = await renderThemeTranscript(server)
    const { frame } = app
    try {
      const user = transcriptMarkdown(frame.renderer.root, 'Static user prose')
      const start = transcriptCode(user, 'Static user prose')
      const end = transcriptCode(user, 'Static user code')
      await act(async () => {
        await frame.mockMouse.pressDown(start.x, start.y)
        await frame.mockMouse.moveTo(end.x + 15, end.y)
        if (!dragging) await frame.mockMouse.release(end.x + 15, end.y)
      })
      const selection = frame.renderer.getSelection()
      assert(selection)
      const text = selection.getSelectedText()
      const anchor = selection.anchor
      const focus = selection.focus
      expect(text).toContain('Static user prose')
      expect(text).toContain('Static user code')
      expect(selection.selectedRenderables.length).toBeGreaterThan(1)
      for (const palette of ['graphite', 'sage'] as const) {
        await setAgentTheme(app, 'light', palette)
        await settleTranscript(frame)
        expect(frame.renderer.getSelection()?.getSelectedText()).toBe(text)
        expect(frame.renderer.getSelection()?.isDragging).toBe(dragging)
        expect(frame.renderer.getSelection()?.anchor).toEqual(anchor)
        expect(frame.renderer.getSelection()?.focus).toEqual(focus)
        expect(transcriptMarkdown(frame.renderer.root, 'Static user prose')).toBe(user)
      }
    } finally {
      await app.cleanup()
    }
  },
)

test('a pending repaint cannot restore a superseded selection and releases its frame listener', async ({
  server,
}) => {
  const app = await renderThemeTranscript(server)
  const { frame } = app
  const paint = createMarkdownPaint(frame.renderer)
  try {
    const scroll = frame.renderer.root.findDescendantById('agent-timeline')
    const input = frame.renderer.root.findDescendantById('agent-composer')
    assert(scroll instanceof ScrollBoxRenderable)
    assert(input instanceof TextareaRenderable)
    const start = transcriptCode(scroll, 'Static user prose')
    frame.renderer.startSelection(start, start.x, start.y)
    frame.renderer.updateSelection(start, start.x + 7, start.y, { finishDragging: true })
    const count = frame.renderer.listenerCount(CliRenderEvents.FRAME)
    const before = frame.renderer.listeners(CliRenderEvents.FRAME)
    paint.repaint(scroll)
    expect(frame.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(count + 1)
    const old = frame.renderer
      .listeners(CliRenderEvents.FRAME)
      .find((listener) => !before.includes(listener))
    assert(old)
    const cleared = frame.renderer.getSelection()
    paint.repaint(scroll)
    expect(frame.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(count + 1)
    old()
    expect(frame.renderer.getSelection()).toBe(cleared)
    expect(frame.renderer.getSelection()?.getSelectedText()).toBe('')
    frame.renderer.startSelection(input, input.x, input.y)
    frame.renderer.updateSelection(input, input.x + 3, input.y, { finishDragging: true })
    const replacement = frame.renderer.getSelection()
    assert(replacement)
    await settleTranscript(frame)
    expect(frame.renderer.getSelection()).toBe(replacement)
    expect(frame.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(count)
    const current = transcriptCode(scroll, 'Static user prose')
    frame.renderer.startSelection(current, current.x, current.y)
    frame.renderer.updateSelection(current, current.x + 7, current.y, { finishDragging: true })
    paint.repaint(scroll)
    expect(frame.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(count + 1)
    paint.dispose()
    expect(frame.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(count)
  } finally {
    paint.dispose()
    await app.cleanup()
  }
})

test('repaint keeps the latest mouse drag endpoints and release on the same selection owner', async ({
  server,
}) => {
  const app = await renderThemeTranscript(server)
  const { frame } = app
  const paint = createMarkdownPaint(frame.renderer)
  try {
    const scroll = frame.renderer.root.findDescendantById('agent-timeline')
    assert(scroll instanceof ScrollBoxRenderable)
    const start = transcriptCode(scroll, 'Static user prose')
    const end = transcriptCode(scroll, 'Static user code')
    const endpoint = { x: end.x + 15, y: end.y }
    await act(async () => {
      await frame.mockMouse.pressDown(start.x, start.y)
      await frame.mockMouse.moveTo(end.x + 7, end.y)
    })
    const original = frame.renderer.getSelection()
    assert(original)
    const anchor = original.anchor
    expect(original.isDragging).toBe(true)
    paint.repaint(scroll)
    await frame.mockMouse.moveTo(endpoint.x, endpoint.y)
    expect(frame.renderer.getSelection()).toBe(original)
    expect(original.focus.x).toBe(endpoint.x)
    await settleTranscript(frame)
    expect(frame.renderer.getSelection()?.getSelectedText()).toContain('Static user code')
    expect(frame.renderer.getSelection()?.focus.x).toBe(endpoint.x)
    expect(frame.renderer.getSelection()?.focus).toEqual(endpoint)
    expect(frame.renderer.getSelection()?.anchor).toEqual(anchor)
    const current = frame.renderer.getSelection()
    assert(current)
    const text = current.getSelectedText()
    paint.repaint(scroll)
    await frame.mockMouse.release(endpoint.x, endpoint.y)
    expect(frame.renderer.getSelection()).toBe(current)
    expect(current.isDragging).toBe(false)
    await settleTranscript(frame)
    expect(frame.renderer.getSelection()?.getSelectedText()).toBe(text)
    expect(frame.renderer.getSelection()?.isDragging).toBe(false)
    expect(frame.renderer.getSelection()?.anchor).toEqual(anchor)
    expect(frame.renderer.getSelection()?.focus).toEqual(endpoint)
    paint.repaint(scroll)
    paint.repaint(scroll)
    await settleTranscript(frame)
    expect(frame.renderer.getSelection()?.getSelectedText()).toBe(text)
    expect(frame.renderer.getSelection()?.anchor).toEqual(anchor)
    expect(frame.renderer.getSelection()?.focus).toEqual(endpoint)
    paint.repaint(scroll)
    frame.renderer.clearSelection()
    await settleTranscript(frame)
    expect(frame.renderer.getSelection()).toBeNull()
  } finally {
    paint.dispose()
    await app.cleanup()
  }
})
