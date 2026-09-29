import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEditorBufferSession, createEditorViewSession } from '@singapore-editor/core/document'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { SettingsPage } from '@/features/settings/components/page'
import { selectSettingsScope, settingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView, settingsView } from '@/features/settings/state/view-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { documentKey, settingsJsonDocument, tabId } from '@/lib/documents/utils/identity'
import { EditorWorkspaceStateContext } from '@/features/editor/state/workspace-state'
import { FocusService } from '@/lib/focus/state/service'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { createTestCommandRuntime } from '../../../../test/factories/command-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'

test.afterEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('')
})

for (const initialView of ['json', 'form'] as const) {
  test(`Save follows the shown ${initialView} while another dirty scope is requested`, async ({
    client,
    server,
  }) => {
    await client.fs['workspace-root'].post({ path: server.root })
    const snapshot = await fetchSettings(undefined, client)
    const owner = createTestQueryClient()
    const formOwner = createTestQueryClient()
    formOwner.setQueryData(settingsKeys.document(), snapshot)
    owner.setDefaultOptions({ queries: { enabled: false } })
    if (initialView === 'json') owner.setQueryData(settingsKeys.document(), snapshot)
    const command = createTestCommandRuntime({
      focus: new FocusService(),
      queryClient: owner,
      options: { rootPath: server.root },
    })
    await command.runtime.editor.openSettingsEditor()
    const id = command.captureSnapshot().activeTabId!
    const documents = command.runtime.documents.store
    for (const [scope, size] of [
      ['user', 19],
      ['workspace', 23],
    ] as const) {
      const target = settingsJsonDocument(scope)
      const file = snapshot.layers.find((layer) => layer.id === scope)!.file!
      documents
        .getState()
        .ensureSettingsDocument(target, { content: file.text, revision: file.revision })
      const buffer = documents.getState().getLiveEditorDocument(documentKey(target))!.buffer
      const session = createEditorBufferSession(buffer)
      session.setSelection(0, file.text.length)
      session.applyText(JSON.stringify({ 'editor.fontSize': size }))
      expect(buffer.isDirty()).toBe(true)
    }
    const shown = documents
      .getState()
      .getLiveEditorDocument(documentKey(settingsJsonDocument('user')))!
    selectSettingsView(initialView)
    selectSettingsSearch('font size')
    const rendered = renderWithProviders(
      <TestEditorStateProvider>
        <EditorWorkspaceStateContext value={command.runtime.workspace}>
          <SettingsPage
            tabId={id}
            liveDocument={{
              ...shown,
              editability: 'editable',
              view: createEditorViewSession(shown.buffer, 'held-save'),
            }}
          />
        </EditorWorkspaceStateContext>
      </TestEditorStateProvider>,
      { queryClient: owner, settingsOwner: formOwner },
    )
    try {
      await screen.findByRole('tab', { name: 'Workspace' })
      if (initialView === 'form')
        await userEvent.click(screen.getByRole('tab', { name: 'settings.json' }))
      if (initialView === 'json')
        await userEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
      expect(screen.getByRole('status', { name: 'Loading settings view' })).toBeVisible()
      expect(screen.getByRole('tab', { name: 'User' })).toHaveAttribute('aria-selected', 'true')
      await act(async () => {
        await command.bus.dispatch('workspace.saveFile', {
          source: { kind: 'programmatic', caller: 'settings-page-test' },
        }).completion
      })
      const saved = await fetchSettings(undefined, client)
      expect(saved.layers.find((layer) => layer.id === 'user')?.raw).toEqual(
        initialView === 'json' ? { 'editor.fontSize': 19 } : {},
      )
      expect(saved.layers.find((layer) => layer.id === 'workspace')?.raw).toEqual({})
      expect(shown.buffer.isDirty()).toBe(initialView === 'form')
      expect(
        documents
          .getState()
          .getLiveEditorDocument(documentKey(settingsJsonDocument('workspace')))!
          .buffer.isDirty(),
      ).toBe(true)
    } finally {
      rendered.unmount()
      owner.clear()
      formOwner.clear()
    }
  })
}

for (const control of ['Workspace', 'Settings']) {
  test(`cancelling Defaults through ${control} restores the shown Workspace form`, async ({
    client,
    server,
  }) => {
    await client.fs['workspace-root'].post({ path: server.root })
    const snapshot = await fetchSettings(undefined, client)
    const formOwner = createTestQueryClient()
    const editorOwner = createTestQueryClient()
    editorOwner.setDefaultOptions({ queries: { enabled: false } })
    formOwner.setQueryData(settingsKeys.document(), snapshot)
    selectSettingsScope('workspace')
    selectSettingsView('form')
    selectSettingsSearch('font size')
    const rendered = renderWithProviders(<SettingsPage tabId={tabId('held-cancel')} />, {
      queryClient: editorOwner,
      settingsOwner: formOwner,
    })
    try {
      await userEvent.click(await screen.findByRole('tab', { name: 'Defaults' }))
      expect(screen.getByRole('status', { name: 'Loading settings view' })).toBeVisible()
      expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await userEvent.click(screen.getByRole('tab', { name: control }))
      expect(settingsScope()).toBe('workspace')
      expect(settingsView()).toBe('form')
      expect(screen.queryByRole('status', { name: 'Loading settings view' })).toBeNull()
      act(() => editorOwner.setQueryData(settingsKeys.document(), snapshot))
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'Settings form' })).toBeVisible(),
      )
      expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
    } finally {
      rendered.unmount()
      formOwner.clear()
      editorOwner.clear()
    }
  })
}

for (const action of ['Enter', 'Reset to default', 'Reset all workspace settings']) {
  test(`${action} writes the held Workspace form during a Defaults request`, async ({
    client,
    server,
  }) => {
    await client.fs['workspace-root'].post({ path: server.root })
    for (const [target, value] of [
      ['user', 17],
      ['workspace', 19],
    ] as const) {
      await saveSettings(
        {
          mutationId: `held-${target}`,
          target,
          operations: [{ kind: 'set', key: 'editor.fontSize', value }],
        },
        client,
      )
    }
    const formOwner = createTestQueryClient()
    const editorOwner = createTestQueryClient()
    editorOwner.setDefaultOptions({ queries: { enabled: false } })
    formOwner.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
    selectSettingsScope('workspace')
    selectSettingsView('form')
    selectSettingsSearch('font size')
    const rendered = renderWithProviders(<SettingsPage tabId={tabId('held-write')} />, {
      queryClient: editorOwner,
      settingsOwner: formOwner,
    })
    try {
      const input = await screen.findByRole('spinbutton', { name: 'Font size' })
      if (action === 'Reset to default')
        await userEvent.click(screen.getByRole('button', { name: 'Actions for editor.fontSize' }))
      if (action === 'Reset all workspace settings')
        await userEvent.click(screen.getByRole('button', { name: 'Settings actions' }))
      act(() => {
        selectSettingsScope('default')
        selectSettingsView('json')
      })
      expect(screen.getByRole('status', { name: 'Loading settings view' })).toBeVisible()
      // A portal or an already-dispatched input event can outlive the fieldset's inert state.
      if (action === 'Enter') {
        fireEvent.change(input, { target: { value: '27' } })
        fireEvent.keyDown(input, { key: 'Enter' })
      } else {
        await userEvent.click(screen.getByRole('menuitem', { name: action }))
      }
      await waitFor(async () => {
        const saved = await fetchSettings(undefined, client)
        expect(saved.layers.find((layer) => layer.id === 'user')?.raw).toEqual({
          'editor.fontSize': 17,
        })
        expect(saved.layers.find((layer) => layer.id === 'workspace')?.raw).toEqual(
          action === 'Enter' ? { 'editor.fontSize': 27 } : {},
        )
      })
    } finally {
      rendered.unmount()
      formOwner.clear()
      editorOwner.clear()
    }
  })
}
