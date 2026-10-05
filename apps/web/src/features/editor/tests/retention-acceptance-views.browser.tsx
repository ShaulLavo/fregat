import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
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
  'pairs actual tab header and complete source paint with observer-negative calibration',
  { timeout: 30_000 },
  async (context) => {
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitEditorSyntaxWorkerIdleFences()
    await awaitRetentionAcceptanceReady(app, path)
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    await expect
      .poll(() => app.read().ui.getState().controllersByTabId.get(tab.id)?.getSnapshot())
      .toBeDefined()
    const reference = retentionAcceptanceReference(app, path)
    const sample = captureRetentionAcceptancePaint(app, path, tab.id)
    await context.annotate(
      JSON.stringify({ sample, reference }),
      'retention-acceptance-header-frame',
    )
    assertRetentionAcceptancePaint(sample, reference, path)
    for (const installed of [
      { ...sample.installed, languageId: 'python' },
      {
        ...sample.installed,
        theme: {
          ...sample.installed.theme,
          type: 'light' as const,
          backgroundColor: '#ffffff',
          foregroundColor: '#000000',
        },
      },
      { ...sample.installed, syntaxStatus: 'loading' as const },
      { ...sample.installed, initialHighlightStatus: 'loading' as const },
      { ...sample.installed, paintLayers: null },
    ])
      expect(() =>
        assertRetentionAcceptancePaint({ ...sample, installed }, reference, path),
      ).toThrow()

    if (typeof commands.retentionAcceptanceScreenshot === 'function')
      await commands.retentionAcceptanceScreenshot('header')
  },
)

test.for(['original', 'copy'] as const)(
  '$0 departure preserves independently selected dirty survivor and Undo',
  { timeout: 30_000 },
  async (departing, context) => {
    const app = await mountRetentionAcceptanceApp()
    await ensureFileSnapshotQuery(app.queryClient, path)
    expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
    await awaitEditorSyntaxWorkerIdleFences()
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
    await awaitEditorSyntaxWorkerIdleFences()
    await awaitRetentionAcceptanceReady(app, path)
    const copies = allEditorGroups(
      app.read().workspace.getState().workbenchPanels.editorGroups,
    ).flatMap((group) => group.tabs)
    const copy = copies.find((tab) => tab.id !== original.id)
    expect(copy).toBeDefined()
    if (!copy) return
    await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(2)
    const first = app.read().ui.getState().controllersByTabId.get(original.id)
    const second = app.read().ui.getState().controllersByTabId.get(copy.id)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return
    first.commands.setSelection(2)
    second.commands.setSelection(8)
    const document = retentionAcceptanceSubject(app, path).document
    const source = document.buffer.materializeFullText()
    const editing = departing === 'original' ? first : second
    editing.commands.edit({ from: 0, to: 0, text: '// shared dirty acceptance\n' })
    expect(document.buffer.materializeFullText()).toBe('// shared dirty acceptance\n' + source)
    expect(document.buffer.isDirty()).toBe(true)
    expect(first.getEditor()?.getSelections()).not.toEqual(second.getEditor()?.getSelections())
    await awaitEditorSyntaxWorkerIdleFences()
    await awaitRetentionAcceptanceReady(app, path)
    const reference = retentionAcceptanceReference(app, path)
    const samples = [original.id, copy.id].map((id) =>
      captureRetentionAcceptancePaint(app, path, id),
    )
    await context.annotate(
      JSON.stringify({ departing, samples, reference }),
      'retention-acceptance-two-view-frames',
    )
    for (const sample of samples) assertRetentionAcceptancePaint(sample, reference, path)
    const closed = departing === 'original' ? original : copy
    const survivor = departing === 'original' ? copy : original
    const controller = departing === 'original' ? second : first
    expect(await app.read().commands.closeTab(closed.id)).toMatchObject({ status: 'applied' })
    expect(app.read().documents.getState().viewsByTabId[closed.id]).toBeUndefined()
    expect(app.read().documents.getState().viewsByTabId[survivor.id]?.documentKey).toBe(
      document.key,
    )
    expect(controller.commands.dispatchCommand('undo')).toBe(true)
    expect(document.buffer.materializeFullText()).toBe(source)
    expect(controller.commands.dispatchCommand('redo')).toBe(true)
    expect(document.buffer.materializeFullText()).toBe('// shared dirty acceptance\n' + source)
    await awaitEditorSyntaxWorkerIdleFences()
    await awaitRetentionAcceptanceReady(app, path)
    assertRetentionAcceptancePaint(
      captureRetentionAcceptancePaint(app, path, survivor.id),
      retentionAcceptanceReference(app, path),
      path,
    )
    if (typeof commands.retentionAcceptanceScreenshot === 'function')
      await commands.retentionAcceptanceScreenshot(`survivor-${departing}`)
  },
)

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceScreenshot(label: string): Promise<string>
  }
}
