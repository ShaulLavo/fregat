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

test(
  'an unavailable real highlighter settles into an interactive live plain fallback',
  { timeout: 30_000 },
  async (context) => {
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
    const workerAttempts = unavailable.length
    controller.commands.setSelection(0)
    controller.commands.focus()
    await commands.proofKeyPress({ key: 'x' })
    expect(document.buffer.materializeFullText()).toBe('x' + before)
    await assertTerminalFallback('x' + before)
    expect(controller.commands.dispatchCommand('undo')).toBe(true)
    expect(document.buffer.materializeFullText()).toBe(before)
    await assertTerminalFallback(before)

    async function assertTerminalFallback(source: string) {
      await awaitEditorSyntaxWorkerIdleFences()
      const current = captureRetentionAcceptancePaint(app, failedPath, failed.id)
      expect(unavailable).toHaveLength(workerAttempts)
      expect(current.installed.initialHighlightStatus).toBe('error')
      expect(current.source).toBe(source)
      expect(current.frame.rows.length).toBeGreaterThan(0)
      expect(current.frame.rows.every((row) => row.presentation === 'live')).toBe(true)
      expect(current.frame.runs).toEqual([])
    }
    await context.annotate(JSON.stringify({ unavailable, sample }), 'highlighter-failure-fallback')
  },
)
