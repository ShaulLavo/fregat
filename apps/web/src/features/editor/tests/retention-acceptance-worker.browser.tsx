import { expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import {
  assertRetentionAcceptancePaint,
  awaitRetentionAcceptanceReady,
  captureRetentionAcceptancePaint,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'
import { holdRetentionAcceptanceWorkerReply } from '../../../../test/factories/retention-acceptance-worker-reply'

const path = filesystemPath('repo/src/editor-tab-a.ts')

test.for(['shiki', 'tree-sitter'] as const)(
  '$0 held real response across edit preserves typing and current ready output',
  { timeout: 30_000 },
  async (family, context) => {
    vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
    const originalUrl = location.href
    const tracedUrl = new URL(originalUrl)
    tracedUrl.searchParams.set('editorPerfTrace', '1')
    history.replaceState(null, '', tracedUrl)
    installEditorPerformanceTraceFromUrl()
    context.onTestFinished(() => {
      history.replaceState(null, '', originalUrl)
      installEditorPerformanceTraceFromUrl()
      vi.unstubAllEnvs()
    })
    const gate = holdRetentionAcceptanceWorkerReply()
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitRetentionAcceptanceReady(app, path)
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const initial = retentionAcceptanceReference(app, path)
    assertRetentionAcceptancePaint(
      captureRetentionAcceptancePaint(app, path, tab.id),
      initial,
      path,
    )
    gate.arm('edit', family)
    controller.commands.edit({ from: 0, to: 0, text: '// held worker revision\n' })
    try {
      await expect.poll(() => gate.held().length).toBe(1)
    } finally {
      await context.annotate(
        JSON.stringify({
          family,
          requests: gate.requests(),
          marks: performance.getEntriesByName('editor.worker.request'),
        }),
        'retention-acceptance-worker-gate-calibration',
      )
    }
    await context.annotate(
      JSON.stringify({ family, initial, held: gate.held() }),
      'retention-acceptance-held-real-response',
    )
    const observations: {
      readonly status: string | null
      readonly snapshotRevision: number | null
      readonly sample: ReturnType<typeof captureRetentionAcceptancePaint>
    }[] = []
    let recording = true
    let frameHandle = 0
    const record = () => {
      if (!recording) return
      const snapshot = controller.getSnapshot()
      observations.push({
        status: snapshot?.syntaxStatus ?? null,
        snapshotRevision: snapshot?.documentSyncPoint.revision ?? null,
        sample: captureRetentionAcceptancePaint(app, path, tab.id),
      })
      frameHandle = requestAnimationFrame(record)
    }
    frameHandle = requestAnimationFrame(record)
    try {
      controller.commands.setSelection(0)
      controller.commands.focus()
      const document = retentionAcceptanceSubject(app, path).document
      const before = document.buffer.materializeFullText()
      await commands.proofKeyPress({ key: 'x' })
      expect(document.buffer.materializeFullText()).toBe('x' + before)
      const revision = document.buffer.getRevision()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      expect(gate.held()).toHaveLength(1)
      gate.release()
      await awaitRetentionAcceptanceReady(app, path)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const current = retentionAcceptanceReference(app, path)
      expect(current.identity.revision).toBe(revision)
      const ready = observations.filter((observation) => observation.status === 'ready')
      for (const observation of ready) {
        expect(observation.snapshotRevision).toBe(revision)
        assertRetentionAcceptancePaint(observation.sample, current, path)
      }
      assertRetentionAcceptancePaint(
        captureRetentionAcceptancePaint(app, path, tab.id),
        current,
        path,
      )
      if (typeof commands.retentionAcceptanceScreenshot === 'function')
        await commands.retentionAcceptanceScreenshot(`held-edit-${family}`)
    } finally {
      recording = false
      cancelAnimationFrame(frameHandle)
      gate.release()
      await context.annotate(
        JSON.stringify({ family, observations }),
        'retention-acceptance-worker-raw-frames',
      )
    }
  },
)

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (input: { readonly key: string }) => Promise<void>
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceScreenshot(label: string): Promise<string>
  }
}
