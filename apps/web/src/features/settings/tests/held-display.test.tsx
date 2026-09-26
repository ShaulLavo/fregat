import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useHeldDisplay } from '@/features/settings/hooks/use-held-display'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { fetchSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { tabId, documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { createEditorTextBuffer, createEditorViewSession } from '@singapore-editor/core/document'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'

test('holds the view, scope, owner and document until the next JSON buffer is ready', async ({
  client,
}) => {
  const formOwner = createTestQueryClient()
  const editorOwner = createTestQueryClient()
  editorOwner.setDefaultOptions({ queries: { enabled: false } })
  const snapshot = await fetchSettings(undefined, client)
  formOwner.setQueryData(settingsKeys.document(), snapshot)
  selectSettingsScope('user')
  selectSettingsView('form')
  const initialProps: { document: EditorRenderDocument | null } = { document: null }
  const { result, rerender, unmount } = renderHook(
    ({ document }: { document: EditorRenderDocument | null }) =>
      useHeldDisplay(tabId('held'), document),
    {
      initialProps,
      wrapper: ({ children }) => (
        <QueryClientProvider client={editorOwner}>
          <SettingsOwnerProvider queryClient={formOwner}>{children}</SettingsOwnerProvider>
        </QueryClientProvider>
      ),
    },
  )
  try {
    expect(result.current.owner).toBe(formOwner)
    act(() => {
      selectSettingsScope('default')
      selectSettingsView('json')
    })
    expect(result.current.pending).toBe(true)
    expect(result.current.showJson).toBe(false)
    expect(result.current.scope).toBe('user')
    expect(result.current.owner).toBe(formOwner)
    act(() => editorOwner.setQueryData(settingsKeys.document(), snapshot))
    await waitFor(() => expect(editorOwner.getQueryData(settingsKeys.document())).toBeDefined())
    expect(result.current.showJson).toBe(false)
    const buffer = createEditorTextBuffer('{}')
    const target = settingsJsonDocument('default')
    const document: EditorRenderDocument = {
      buffer,
      key: documentKey(target),
      target,
      editability: 'readonly',
      view: createEditorViewSession(buffer, 'held-defaults'),
    }
    rerender({ document })
    await waitFor(() => expect(result.current.showJson).toBe(true))
    expect(result.current.scope).toBe('default')
    expect(result.current.owner).toBe(editorOwner)
    expect(result.current.liveDocument).toBe(document)
    expect(result.current.pending).toBe(false)
    act(() => selectSettingsView('form'))
    act(() => selectSettingsScope('user'))
    expect(result.current.owner).toBe(formOwner)
    expect(result.current.showJson).toBe(false)
  } finally {
    unmount()
    selectSettingsView('form')
    selectSettingsScope('user')
    formOwner.clear()
    editorOwner.clear()
  }
})
