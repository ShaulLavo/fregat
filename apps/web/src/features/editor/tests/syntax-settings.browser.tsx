import { expect, test, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { allEditorGroups, activeEditorTab } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { previewEditorTheme } from '@/features/editor/state/color-theme-store'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import { captureRetentionAcceptancePaint } from '../../../../test/factories/retention-acceptance-paint'
import { holdSyntaxWorkerReply } from '../../../../test/factories/syntax-settings-worker'

const path = filesystemPath('repo/src/editor-tab-a.ts')

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
    await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('ready')
    await expect.poll(() => controller.getSnapshot()?.initialHighlightStatus).toBe('painted')
    await awaitEditorSyntaxWorkerIdleFences()
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
    await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('ready')
    await awaitEditorSyntaxWorkerIdleFences()
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
