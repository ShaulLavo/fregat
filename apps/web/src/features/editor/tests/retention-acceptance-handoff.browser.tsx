import { expect, test } from 'vitest'
import { page, commands } from 'vitest/browser'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { RetentionAcceptanceSurface } from '../../../../test/factories/retention-acceptance-surface'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import {
  assertRetentionAcceptancePaint,
  awaitRetentionAcceptanceReady,
  captureRetentionAcceptancePaint,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'

const path = filesystemPath('repo/src/editor-tab-a.ts')

test(
  'actual chat and workbench layouts preserve disjoint view identity and shared dirty Undo through handoff',
  { timeout: 30_000 },
  async (context) => {
    const app = await mountRetentionAcceptanceApp(
      [],
      'surfaces',
      <RetentionAcceptanceSurface rootPath={filesystemPath('repo')} />,
    )
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitRetentionAcceptanceReady(app, path)
    const groups = app.read().workspace.getState().workbenchPanels.editorGroups
    const original = activeEditorTab(groups)
    expect(original).not.toBeNull()
    if (!original) return
    expect(
      await app.read().commands.placeTab({
        tabId: original.id,
        mode: 'copy',
        target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
      }),
    ).toMatchObject({ status: 'applied' })
    await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(2)
    const tabs = allEditorGroups(
      app.read().workspace.getState().workbenchPanels.editorGroups,
    ).flatMap((group) => group.tabs)
    const copy = tabs.find((tab) => tab.id !== original.id)
    expect(copy).toBeDefined()
    if (!copy) return
    const views = [original.id, copy.id].map(
      (id) => app.read().documents.getState().viewsByTabId[id]?.view,
    )
    expect(views[0]).not.toBe(views[1])
    const first = app.read().ui.getState().controllersByTabId.get(original.id)
    const second = app.read().ui.getState().controllersByTabId.get(copy.id)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return
    first.commands.setSelection(2)
    second.commands.setSelection(8)
    const canonical = retentionAcceptanceSubject(app, path).document
    const initial = canonical.buffer.materializeFullText()
    second.commands.edit({ from: 0, to: 0, text: '// cross-layout dirty\n' })
    await awaitRetentionAcceptanceReady(app, path)
    const selections = [first.getEditor()?.getSelections(), second.getEditor()?.getSelections()]
    for (const mode of ['chat', 'workbench'] as const) {
      expect(await app.navigation.setMode(mode)).toMatchObject({ status: 'applied' })
      await expect.poll(() => app.read().workspace.getState().uiMode).toBe(mode)
      await context.annotate(
        JSON.stringify({
          mode,
          dom: document.body.innerHTML,
          panels: app.read().workspace.getState().chatModePanels,
        }),
        'retention-acceptance-layout-setup',
      )
      if (mode === 'chat') await page.getByRole('button', { name: 'Editor', exact: true }).click()
      await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(2)
      await awaitRetentionAcceptanceReady(app, path)
      const currentViews = [original.id, copy.id].map(
        (id) => app.read().documents.getState().viewsByTabId[id]?.view,
      )
      expect(currentViews).toEqual(views)
      expect(
        [original.id, copy.id].map((id) =>
          app.read().ui.getState().controllersByTabId.get(id)?.getEditor()?.getSelections(),
        ),
      ).toEqual(selections)
      expect(canonical.buffer.materializeFullText()).toBe('// cross-layout dirty\n' + initial)
      const reference = retentionAcceptanceReference(app, path)
      const samples = [original.id, copy.id].map((id) =>
        captureRetentionAcceptancePaint(app, path, id),
      )
      await context.annotate(
        JSON.stringify({ mode, samples, reference }),
        'retention-acceptance-cross-layout-frames',
      )
      for (const sample of samples) assertRetentionAcceptancePaint(sample, reference, path)
      if (typeof commands.retentionAcceptanceScreenshot === 'function')
        await commands.retentionAcceptanceScreenshot(`handoff-${mode}`)
    }
    const survivor = app.read().ui.getState().controllersByTabId.get(original.id)
    expect(survivor?.commands.dispatchCommand('undo')).toBe(true)
    expect(canonical.buffer.materializeFullText()).toBe(initial)
    expect(survivor?.commands.dispatchCommand('redo')).toBe(true)
    expect(canonical.buffer.materializeFullText()).toBe('// cross-layout dirty\n' + initial)
  },
)

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceScreenshot(label: string): Promise<string>
  }
}
