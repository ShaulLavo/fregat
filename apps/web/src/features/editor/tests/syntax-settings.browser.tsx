import { expect, test, vi, type TestContext } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { allEditorGroups, activeEditorTab } from '@/lib/documents/utils/groups'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { previewEditorTheme } from '@/features/editor/state/color-theme-store'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsIntentStore } from '@workspace/client-core/settings/intent-store'
import type { SettingsSnapshot } from '@workspace/contracts'
import type { EditorViewSnapshot } from '@singapore-editor/core/editor'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import type { RetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import { captureRetentionAcceptancePaint } from '../../../../test/factories/retention-acceptance-paint'
import { holdSyntaxWorkerReply } from '../../../../test/factories/syntax-settings-worker'

const path = filesystemPath('repo/src/editor-tab-a.ts')

declare module 'vitest' {
  interface TaskMeta {
    initialSyntaxReadiness?: unknown
  }
}

type InitialSyntaxRead<T> = { kind: 'observed'; value: T } | { kind: 'UNKNOWN' }

function initialSyntaxRead<T>(read: () => T): InitialSyntaxRead<T> {
  try {
    const value = read()
    if (value === undefined) return { kind: 'UNKNOWN' }
    return { kind: 'observed', value }
  } catch {
    return { kind: 'UNKNOWN' }
  }
}

function cachedSyntaxRequest(entry: PerformanceEntry) {
  if (!(entry instanceof PerformanceMark)) return { at: entry.startTime, kind: 'UNKNOWN' }
  const detail: unknown = entry.detail
  if (!detail || typeof detail !== 'object') return { at: entry.startTime, kind: 'UNKNOWN' }
  return {
    at: entry.startTime,
    family: 'family' in detail && typeof detail.family === 'string' ? detail.family : null,
    type: 'type' in detail && typeof detail.type === 'string' ? detail.type : null,
    runtimeSessionId:
      'runtimeSessionId' in detail && typeof detail.runtimeSessionId === 'string'
        ? detail.runtimeSessionId
        : null,
  }
}

function initialSyntaxObservation(
  app: RetentionAcceptanceApp,
  snapshot: EditorViewSnapshot | null,
  nativeSyntaxStatus: EditorViewSnapshot['syntaxStatus'] | undefined,
  fence: { readonly startedAt: number; readonly settledAt: number },
  gate?: ReturnType<typeof holdSyntaxWorkerReply>,
) {
  const confirmed = initialSyntaxRead(() =>
    app.queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document()),
  )
  const intents = initialSyntaxRead(() =>
    settingsIntentStore.getState().active.filter((entry) => entry.patch.owner === app.queryClient),
  )
  const canonical = initialSyntaxRead(() =>
    app.read().documents.getState().getLiveEditorDocument(fileDocumentKey(path)),
  )
  return {
    at: performance.now(),
    native: initialSyntaxRead(() => ({
      nativeSyntaxStatus: nativeSyntaxStatus ?? 'UNKNOWN',
      snapshotPresent: snapshot !== null,
      documentId: snapshot?.documentId ?? null,
      revision: snapshot?.documentSyncPoint.revision ?? null,
      textVersion: snapshot?.textVersion ?? null,
      language: snapshot?.languageId ?? null,
      initialHighlightStatus: snapshot?.initialHighlightStatus ?? null,
      paintAvailable: snapshot ? snapshot.paintLayers !== null : false,
    })),
    canonical:
      canonical.kind === 'observed'
        ? initialSyntaxRead(() => ({
            documentId: canonical.value?.analysis.documentId ?? null,
            revision: canonical.value?.buffer.getRevision() ?? null,
          }))
        : { kind: 'UNKNOWN' },
    configuration: initialSyntaxRead(() => {
      const theme = app.read().theme
      return {
        selectedTheme: theme.selectedThemeId,
        appliedTheme: theme.appliedThemeId,
        contentHash: theme.appliedThemeContentHash,
        configuredTags: editorPreparedDocumentTags(
          path,
          {
            selectedThemeId: theme.selectedThemeId,
            appliedThemeId: theme.appliedThemeId,
            appliedThemeContentHash: theme.appliedThemeContentHash,
            syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
          },
          true,
        ),
      }
    }),
    settings: {
      confirmed: initialSyntaxRead(() =>
        confirmed.kind === 'observed'
          ? confirmed.value?.values['editor.syntaxHighlighting.enabled']
          : undefined,
      ),
      projected: initialSyntaxRead(() =>
        confirmed.kind === 'observed' && confirmed.value && intents.kind === 'observed'
          ? projectSettings(confirmed.value, intents.value).values[
              'editor.syntaxHighlighting.enabled'
            ]
          : undefined,
      ),
      mirror: initialSyntaxRead(() => readSettingsMirror()['editor.syntaxHighlighting.enabled']),
      queryStatus: initialSyntaxRead(
        () => app.queryClient.getQueryState(settingsKeys.document())?.status,
      ),
      ownerIntents: initialSyntaxRead(() =>
        intents.kind === 'observed' ? intents.value.map((entry) => entry.intentId) : undefined,
      ),
    },
    fence,
    transport: initialSyntaxRead(() => {
      const requests = performance
        .getEntriesByName('editor.worker.request')
        .filter((entry) => entry.startTime >= fence.startedAt)
      return {
        cachedRequestsSinceFence: requests.length,
        latest: requests.slice(-3).map(cachedSyntaxRequest),
      }
    }),
    preArmHeld: initialSyntaxRead(() => gate?.held()),
    sdkPending: 'UNKNOWN',
    nativeCallbackDelivery: 'UNKNOWN',
  }
}

async function recordInitialSyntaxReadiness(context: TestContext, packet: unknown) {
  try {
    context.task.meta.initialSyntaxReadiness = packet
    const serialized = JSON.stringify(packet)
    console.info(`syntax-initial-readiness ${serialized}`)
    await context.annotate(serialized, 'syntax-initial-readiness')
  } catch {}
}

test('calibrates the native worker delivery gate', async (context) => {
  const gate = holdSyntaxWorkerReply('shiki')
  const url = URL.createObjectURL(
    new Blob(['onmessage = (event) => postMessage(event.data)'], { type: 'text/javascript' }),
  )
  const worker = new Worker(url)
  const delivered: unknown[] = []
  worker.onmessage = (event) => delivered.push(event.data)
  try {
    gate.arm()
    performance.mark('editor.worker.request', {
      detail: { family: 'shiki', type: 'edit', runtimeSessionId: 'calibration' },
    })
    worker.postMessage({ id: 1, payload: { type: 'edit', runtimeSessionId: 'calibration' } })
    await expect.poll(() => gate.held()).not.toBeNull()
    await context.annotate(
      JSON.stringify({ held: gate.held(), delivered }),
      'native-worker-delivery-calibration',
    )
    expect(delivered).toEqual([])
    gate.release()
    expect(delivered).toHaveLength(1)
  } finally {
    gate.restore()
    worker.terminate()
    URL.revokeObjectURL(url)
    performance.clearMarks('editor.worker.request')
  }
})

function SyntaxSettingsFixture() {
  const enabled = useSettingValue('editor.syntaxHighlighting.enabled')
  const settings = useSettingsActions()
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <button onClick={() => settings.setSetting('editor.syntaxHighlighting.enabled', !enabled)}>
        Toggle syntax highlighting
      </button>
      <div className='flex min-h-0 flex-1'>
        {allEditorGroups(groups).map((group) => (
          <EditorGroup
            key={group.id}
            active={group.id === groups.activeGroupId}
            conflicts={{}}
            gitFiles={[]}
            group={group}
            rootPath={filesystemPath('repo')}
          />
        ))}
      </div>
    </div>
  )
}

test.for(['dark-plus', 'tree-sitter-dark'] as const)(
  '%s mounted syntax follows the configured highlighting setting',
  async (theme, context) => {
    const app = await mountRetentionAcceptanceApp([], 'surfaces', <SyntaxSettingsFixture />)
    previewEditorTheme('dark', theme)
    await expect.poll(() => app.read().theme.appliedThemeId).toBe(theme)
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    await expect.poll(() => app.read().ui.getState().controllersByTabId.get(tab.id)).toBeDefined()
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const paint = () => captureRetentionAcceptancePaint(app, path, tab.id)
    const fenceStartedAt = performance.now()
    await awaitEditorSyntaxWorkerIdleFences()
    const fence = { startedAt: fenceStartedAt, settledAt: performance.now() }
    let lastPoll: unknown = null
    try {
      await expect
        .poll(() => {
          const snapshot = controller.getSnapshot()
          const nativeSyntaxStatus = snapshot?.syntaxStatus
          lastPoll = initialSyntaxRead(() =>
            initialSyntaxObservation(app, snapshot, nativeSyntaxStatus, fence),
          )
          return nativeSyntaxStatus
        })
        .toBe('ready')
    } catch (error) {
      await recordInitialSyntaxReadiness(context, { phase: 'mounted-initial', theme, lastPoll })
      throw error
    }
    await recordInitialSyntaxReadiness(context, { phase: 'mounted-initial', theme, lastPoll })
    await expect.poll(() => controller.getSnapshot()?.initialHighlightStatus).toBe('painted')
    const colored = paint()
    expect(new Set(colored.frame.runs.map((run) => run.style.color)).size).toBeGreaterThan(1)
    const groups = app.read().workspace.getState().workbenchPanels.editorGroups
    expect(
      await app.read().commands.placeTab({
        tabId: tab.id,
        mode: 'copy',
        target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
      }),
    ).toMatchObject({ status: 'applied' })
    const copy = allEditorGroups(app.read().workspace.getState().workbenchPanels.editorGroups)
      .flatMap((group) => group.tabs)
      .find((other) => other.id !== tab.id)
    expect(copy).toBeDefined()
    if (!copy) return
    await expect
      .poll(
        () => app.read().ui.getState().controllersByTabId.get(copy.id)?.getSnapshot()?.syntaxStatus,
      )
      .toBe('ready')
    const copyController = app.read().ui.getState().controllersByTabId.get(copy.id)
    expect(copyController).toBeDefined()
    if (!copyController) return
    controller.commands.setSelection(2)
    copyController.commands.setSelection(8)
    const selections = [
      controller.getEditor()?.getSelections(),
      copyController.getEditor()?.getSelections(),
    ]
    expect(selections[0]).not.toEqual(selections[1])
    await context.annotate(JSON.stringify({ theme, colored }), 'known-good-colored')
    try {
      await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
      await expect.poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled']).toBe(false)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await context.annotate(JSON.stringify({ theme, disabled: paint() }), 'disabled-observation')
      if (typeof commands.retentionAcceptanceScreenshot === 'function')
        await commands.retentionAcceptanceScreenshot(`disabled-${theme}`)
      await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('plain')
      expect(controller.getSnapshot()?.initialHighlightStatus).toBe('plain')
      await expect.poll(() => paint().frame.runs).toEqual([])
      expect(
        paint()
          .frame.rows.map((row) => row.text)
          .join('\n'),
      ).toBe(colored.source)
      await expect.poll(() => copyController.getSnapshot()?.syntaxStatus).toBe('plain')
      await expect
        .poll(() => captureRetentionAcceptancePaint(app, path, copy.id).frame.runs)
        .toEqual([])
      const otherPath = filesystemPath('repo/src/editor-tab-b.ts')
      await ensureFileSnapshotQuery(app.queryClient, otherPath)
      expect(await app.read().commands.openFileSurface(otherPath)).toMatchObject({
        status: 'applied',
      })
      const mounted = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
      expect(mounted).not.toBeNull()
      if (!mounted) return
      await expect
        .poll(
          () =>
            app.read().ui.getState().controllersByTabId.get(mounted.id)?.getSnapshot()
              ?.syntaxStatus,
        )
        .toBe('plain')
      expect(captureRetentionAcceptancePaint(app, otherPath, mounted.id).frame.runs).toEqual([])
      expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
      await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
      await expect.poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled']).toBe(true)
      await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('ready')
      await expect.poll(() => controller.getSnapshot()?.initialHighlightStatus).toBe('painted')
      await awaitEditorSyntaxWorkerIdleFences()
      expect(paint().source).toBe(colored.source)
      expect(paint().frame.runs).toEqual(colored.frame.runs)
      await expect.poll(() => copyController.getSnapshot()?.syntaxStatus).toBe('ready')
      expect(captureRetentionAcceptancePaint(app, path, copy.id).frame.runs).toEqual(
        colored.frame.runs,
      )
      expect([
        controller.getEditor()?.getSelections(),
        copyController.getEditor()?.getSelections(),
      ]).toEqual(selections)
    } finally {
      if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) {
        await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
        await expect
          .poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled'])
          .toBe(true)
      }
    }
  },
)

test.for(['shiki', 'tree-sitter'] as const)(
  '%s late native edit reply cannot repaint a disabled view',
  async (family, context) => {
    vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
    const original = location.href
    const url = new URL(original)
    url.searchParams.set('editorPerfTrace', '1')
    history.replaceState(null, '', url)
    installEditorPerformanceTraceFromUrl()
    context.onTestFinished(() => {
      history.replaceState(null, '', original)
      installEditorPerformanceTraceFromUrl()
      vi.unstubAllEnvs()
    })
    const gate = holdSyntaxWorkerReply(family)
    const app = await mountRetentionAcceptanceApp([], 'surfaces', <SyntaxSettingsFixture />)
    const theme = family === 'shiki' ? 'dark-plus' : 'tree-sitter-dark'
    previewEditorTheme('dark', theme)
    await expect.poll(() => app.read().theme.appliedThemeId).toBe(theme)
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    await expect.poll(() => app.read().ui.getState().controllersByTabId.get(tab.id)).toBeDefined()
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const paint = () => captureRetentionAcceptancePaint(app, path, tab.id)
    const fenceStartedAt = performance.now()
    await awaitEditorSyntaxWorkerIdleFences()
    const fence = { startedAt: fenceStartedAt, settledAt: performance.now() }
    let lastPoll: unknown = null
    try {
      await expect
        .poll(() => {
          const snapshot = controller.getSnapshot()
          const nativeSyntaxStatus = snapshot?.syntaxStatus
          lastPoll = initialSyntaxRead(() =>
            initialSyntaxObservation(app, snapshot, nativeSyntaxStatus, fence, gate),
          )
          return nativeSyntaxStatus
        })
        .toBe('ready')
    } catch (error) {
      await recordInitialSyntaxReadiness(context, { phase: 'late-reply-initial', family, lastPoll })
      throw error
    }
    await recordInitialSyntaxReadiness(context, { phase: 'late-reply-initial', family, lastPoll })
    const originalSource = paint().source
    gate.arm()
    controller.commands.edit({ from: 0, to: 0, text: '// delayed syntax\n' })
    await expect.poll(() => gate.held()).not.toBeNull()
    try {
      await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
      await expect.poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled']).toBe(false)
      await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('plain')
      await expect.poll(() => paint().frame.runs).toEqual([])
      await context.annotate(
        JSON.stringify({ family, held: gate.held(), disabled: paint() }),
        'held-disabled',
      )
      gate.release()
      await awaitEditorSyntaxWorkerIdleFences()
      await expect.poll(() => paint().frame.runs).toEqual([])
      expect(controller.getSnapshot()?.syntaxStatus).toBe('plain')
      expect(paint().source).toBe('// delayed syntax\n' + originalSource)
      await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
      await expect.poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled']).toBe(true)
      await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('ready')
      await awaitEditorSyntaxWorkerIdleFences()
      expect(new Set(paint().frame.runs.map((run) => run.style.color)).size).toBeGreaterThan(1)
      expect(paint().source).toBe('// delayed syntax\n' + originalSource)
      expect(
        paint()
          .frame.rows.map((row) => row.text)
          .join('\n'),
      ).toBe('// delayed syntax\n' + originalSource)
      expect(paint().frame.runs.some((run) => run.text === '// delayed syntax')).toBe(true)
      expect(controller.commands.dispatchCommand('undo')).toBe(true)
      await awaitEditorSyntaxWorkerIdleFences()
      await expect.poll(() => paint().source).toBe(originalSource)
      await context.annotate(JSON.stringify({ family, enabled: paint() }), 'held-reenabled-current')
    } finally {
      gate.release()
      if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) {
        await userEvent.click(page.getByRole('button', { name: 'Toggle syntax highlighting' }))
        await expect
          .poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled'])
          .toBe(true)
      }
    }
  },
)
