import { expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import {
  awaitEditorSyntaxWorkerIdleFences,
  disposeEditorSyntaxHighlighting,
} from '@/features/editor/state/syntax-highlighting'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import {
  assertRetentionAcceptancePaint,
  awaitRetentionAcceptanceReady,
  captureRetentionAcceptancePaint,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'

const readyPath = filesystemPath('repo/src/editor-tab-a.ts')
const failedPath = filesystemPath('repo/src/editor-tab-b.ts')

test.for([
  { undoTiming: 'during', text: 'x', scriptDelayMs: 0 },
  { undoTiming: 'after', text: 'abcdefgh', scriptDelayMs: 0 },
  { undoTiming: 'during', text: 'x', scriptDelayMs: 1_500 },
] as const)(
  'an unavailable real highlighter keeps plain text interactive with Undo $undoTiming retry and $scriptDelayMs ms worker delivery',
  { timeout: 30_000 },
  async ({ undoTiming, text, scriptDelayMs }, context) => {
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, readyPath)
    expect(await app.read().commands.openFileSurface(readyPath)).toMatchObject({
      status: 'applied',
    })
    await awaitRetentionAcceptanceReady(app, readyPath)
    const ready = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
    assertRetentionAcceptancePaint(
      captureRetentionAcceptancePaint(app, readyPath, ready.id),
      retentionAcceptanceReference(app, readyPath),
      readyPath,
    )
    expect(await app.read().commands.closeTab(ready.id)).toMatchObject({ status: 'applied' })
    await awaitEditorSyntaxWorkerIdleFences()
    await disposeEditorSyntaxHighlighting()

    const NativeWorker = Worker
    const unavailable: string[] = []
    // The browser still creates a real Worker; its script load fails at the network boundary.
    vi.stubGlobal(
      'Worker',
      class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          const target = String(url)
          if (target.includes('shiki.worker')) {
            unavailable.push(target)
            super(new URL('/__unavailable-highlighter-worker__.js', location.origin), options)
            return
          }
          super(url, options)
        }
      },
    )
    context.onTestFinished(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })
    await ensureFileSnapshotQuery(app.queryClient, failedPath)
    expect(await app.read().commands.openFileSurface(failedPath)).toMatchObject({
      status: 'applied',
    })
    const failed = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)!
    await expect.poll(() => unavailable.length).toBeGreaterThan(0)
    await expect
      .poll(
        () =>
          app.read().ui.getState().controllersByTabId.get(failed.id)?.getSnapshot()
            ?.initialHighlightStatus,
        { timeout: 10_000 },
      )
      .toBe('error')
    const controller = app.read().ui.getState().controllersByTabId.get(failed.id)!
    const document = retentionAcceptanceSubject(app, failedPath).document
    const before = document.buffer.materializeFullText()
    const sample = captureRetentionAcceptancePaint(app, failedPath, failed.id)
    expect(sample.installed.initialHighlightStatus).toBe('error')
    expect(sample.frame.rows.length).toBeGreaterThan(0)
    expect(sample.frame.rows.every((row) => row.presentation === 'live')).toBe(true)
    expect(sample.frame.runs).toEqual([])
    expect(sample.source).toBe(before)
    expect(
      document.analysis
        .inspectRetention()
        .entries.some((entry) => entry.family === 'highlighter' && entry.status === 'failed'),
    ).toBe(true)
    // The edit debounce is 75 ms; the retry ladder delays are 100 and 400 ms.
    // Freeze only timer scheduling so real keyboard events and Worker failures still run.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const workerAttempts = unavailable.length
    controller.commands.setSelection(0)
    controller.commands.focus()
    if (undoTiming === 'during') await commands.proofKeyPress({ key: text })
    // Deliver the multi-key burst in one turn, before worker delivery can divide it.
    if (undoTiming === 'after') {
      const input = window.document.activeElement!
      for (const character of text) {
        input.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: character,
            inputType: 'insertText',
          }),
        )
      }
    }
    const edited = text + before
    expect(document.buffer.materializeFullText()).toBe(edited)
    expect(controller.getSnapshot()?.initialHighlightStatus).toBe('loading')
    await nextFrame()
    assertPlainFallback(edited)
    // The entire burst shares the failed edit request and its bounded recovery ladder.
    expect(unavailable.length - workerAttempts).toBeLessThanOrEqual(4)
    if (undoTiming === 'after') await assertBoundedRecovery(edited, workerAttempts)

    if (scriptDelayMs > 0)
      await commands.delayRequest({
        ms: scriptDelayMs,
        path: '/__unavailable-highlighter-worker__.js',
      })
    const attemptsBeforeUndo = unavailable.length
    expect(controller.commands.dispatchCommand('undo')).toBe(true)
    expect(document.buffer.materializeFullText()).toBe(before)
    expect(controller.getSnapshot()?.initialHighlightStatus).toBe('loading')
    await nextFrame()
    assertPlainFallback(before)
    await assertBoundedRecovery(before, attemptsBeforeUndo)
    vi.useRealTimers()
    await awaitEditorSyntaxWorkerIdleFences()
    assertPlainFallback(before)

    function nextFrame() {
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }

    async function assertBoundedRecovery(source: string, attemptsBeforeBurst: number) {
      // The retry clock is fake; failed script loads still settle on the browser's clock.
      for (let elapsed = 0; elapsed < 2_000; elapsed += 50) {
        await vi.advanceTimersByTimeAsync(50)
        await awaitEditorSyntaxWorkerIdleFences()
        await nextFrame()
        assertPlainFallback(source)
        if (controller.getSnapshot()?.initialHighlightStatus === 'error') break
      }
      expect(controller.getSnapshot()?.initialHighlightStatus).toBe('error')
      await vi.advanceTimersByTimeAsync(2_000)
      await nextFrame()
      expect(controller.getSnapshot()?.initialHighlightStatus).toBe('error')
      assertPlainFallback(source)
      // One failed edit request and three refresh attempts form one recovery ladder.
      const attempts = unavailable.length - attemptsBeforeBurst
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(4)
    }

    function assertPlainFallback(source: string) {
      const current = captureRetentionAcceptancePaint(app, failedPath, failed.id)
      expect(current.source).toBe(source)
      expect(current.installed.source).toBe(source)
      expect(current.frame.rows.length).toBeGreaterThan(0)
      expect(current.frame.rows.every((row) => row.presentation === 'live')).toBe(true)
      expect(current.frame.rows.every((row) => row.mapping === 'source')).toBe(true)
      expect(current.frame.runs).toEqual([])
    }
    await context.annotate(
      JSON.stringify({ unavailable, undoTiming, sample }),
      'highlighter-failure-fallback',
    )
  },
)
