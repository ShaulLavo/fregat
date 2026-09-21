import {
  conflictId,
  documentKey,
  filesystemPath,
  settingsJsonDocument,
} from '@/lib/documents/utils/identity'
import type { UnsyncedDocumentRef } from '@/lib/documents/utils/types'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { vi } from 'vitest'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DEFAULT_SETTING_VALUES, type SettingId, type SettingsValues } from '@workspace/contracts'

import { expect, test } from '../../../../test/fixtures'
import { EditorDocumentStateContext } from '@/features/editor/state/document-state'
import { EditorRuntimeContext } from '@/features/editor/providers/runtime-context'
import { createTestEditorRuntime } from '../../../../test/factories/editor-runtime'
import { useAutoSave } from '@/features/editor/hooks/use-auto-save'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import type { FileResult } from '@/lib/file-system-types'
import { fetchFile } from '@/lib/file-server'

function harness(overrides: Partial<SettingsValues>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(settingsKeys.document(), {
    diagnostics: [],
    layers: [],
    revision: '',
    values: { ...DEFAULT_SETTING_VALUES, ...overrides },
  })
  const runtime = createTestEditorRuntime(queryClient)
  const { documentStore } = runtime

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        EditorRuntimeContext,
        { value: runtime },
        createElement(EditorDocumentStateContext, { value: documentStore }, children),
      ),
    )

  return { documentStore, queryClient, runtime, wrapper }
}

test('does nothing at all when autosave is off', async ({ client }) => {
  expect(client).toBeDefined()
  const { documentStore, wrapper } = harness({ 'files.autoSave': 'off' })
  const subscribe = documentStore.subscribe
  let subscriptions = 0
  documentStore.subscribe = ((...args: Parameters<typeof subscribe>) => {
    subscriptions += 1

    return subscribe(...args)
  }) as typeof subscribe

  renderHook(() => useAutoSave(), { wrapper })

  // Off means off: no store subscription and no window listener, so the default
  // costs nothing at all.
  expect(subscriptions).toBe(0)
})

test('subscribes to the document store when saving after a delay', async ({ client }) => {
  expect(client).toBeDefined()
  const { documentStore, wrapper } = harness({
    'files.autoSave': 'afterDelay',
    'files.autoSaveDelay': 100,
  })
  const subscribe = documentStore.subscribe
  let subscriptions = 0
  documentStore.subscribe = ((...args: Parameters<typeof subscribe>) => {
    subscriptions += 1

    return subscribe(...args)
  }) as typeof subscribe

  renderHook(() => useAutoSave(), { wrapper })

  await waitFor(() => expect(subscriptions).toBe(1))
})

test('listens for blur when saving on focus change', async ({ client }) => {
  expect(client).toBeDefined()
  const { wrapper } = harness({ 'files.autoSave': 'onWindowChange' })
  const added: string[] = []
  const original = window.addEventListener
  window.addEventListener = ((type: string, ...rest: unknown[]) => {
    added.push(type)

    return (original as never as (...args: unknown[]) => void)(type, ...rest)
  }) as typeof window.addEventListener

  renderHook(() => useAutoSave(), { wrapper })
  window.addEventListener = original

  expect(added).toContain('blur')
})

test('skips a focus-change save when the workspace mutation gate is closed', async ({ client }) => {
  expect(client).toBeDefined()
  const { documentStore, runtime, wrapper } = harness({ 'files.autoSave': 'onWindowChange' })
  const runWorkspaceMutation = vi
    .spyOn(runtime.workspaceEditService, 'runWorkspaceMutation')
    .mockRejectedValue({ code: 'workspace-edit-busy' })
  documentStore.getState().ensureLiveEditorDocument(fileResult('src/dirty.ts'))
  documentStore.getState().setLiveEditorDocumentDirty(testDocumentKey('src/dirty.ts'), true)
  renderHook(() => useAutoSave(), { wrapper })

  window.dispatchEvent(new Event('blur'))

  await waitFor(() => expect(runWorkspaceMutation).toHaveBeenCalledOnce())
  expect(runWorkspaceMutation.mock.calls[0]?.[0]).toEqual(['src/dirty.ts'])
  expect(documentStore.getState().dirtyDocumentKeys).toContain(testDocumentKey('src/dirty.ts'))
})

test('deletion alone does not trigger autosave; edited deleted buffers save normally', async ({
  client,
  server,
}) => {
  const path = filesystemPath('deleted.txt')
  await writeFile(join(server.root, path), 'saved')
  const { documentStore, runtime, wrapper } = harness({ 'files.autoSave': 'onWindowChange' })
  const document = documentStore
    .getState()
    .ensureLiveEditorDocument(await fetchFile(path, new AbortController().signal, client))
  await rm(join(server.root, path))
  documentStore.getState().setFileOrphaned(document.key, true)
  const saveMany = vi.spyOn(runtime.saveService, 'saveMany')
  const hook = renderHook(() => useAutoSave(), { wrapper })
  window.dispatchEvent(new Event('blur'))
  expect(saveMany).not.toHaveBeenCalled()
  await expect(readFile(join(server.root, path), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  createEditorBufferSession(document.buffer).applyText(' edited')
  window.dispatchEvent(new Event('blur'))
  await waitFor(() => expect(document.buffer.isDirty()).toBe(false))
  expect(await readFile(join(server.root, path), 'utf8')).toBe('saved edited')
  hook.unmount()
})

test('the setting exists with an off default, so nothing changes until asked', ({ client }) => {
  expect(client).toBeDefined()

  expect(DEFAULT_SETTING_VALUES['files.autoSave' as SettingId]).toBe('off')
  expect(DEFAULT_SETTING_VALUES['files.autoSaveDelay' as SettingId]).toBe(1_000)
})

test.for(['afterDelay', 'onWindowChange'] as const)(
  '%s writes dirty files while leaving settings, references, conflicts and recovery buffers dirty',
  async (mode, { client, server }) => {
    const path = filesystemPath('autosave.ts')
    const recoveryPath = filesystemPath('recovery.ts')
    await writeFile(join(server.root, path), 'saved')
    await writeFile(join(server.root, recoveryPath), 'recovering')
    const { documentStore, queryClient, runtime, wrapper } = harness({
      'files.autoSave': mode,
      'files.autoSaveDelay': 50,
    })
    const file = await fetchFile(path, new AbortController().signal, client)
    const recoveryFile = await fetchFile(recoveryPath, new AbortController().signal, client)
    const document = documentStore.getState().ensureLiveEditorDocument(file)
    const recovery = documentStore.getState().ensureLiveEditorDocument(recoveryFile)
    const unsyncedTargets: readonly UnsyncedDocumentRef[] = [
      { kind: 'git-ref', source: { path, ref: 'HEAD' } },
      { kind: 'conflict', conflictId: conflictId('autosave-conflict'), path },
    ]
    for (const target of unsyncedTargets) {
      const member = documentStore
        .getState()
        .ensureUnsyncedEditorDocument({ content: '{}', target })
      createEditorBufferSession(member.buffer).applyText(' dirty')
    }
    for (const target of ['user', 'workspace'] as const) {
      const member = documentStore.getState().ensureSettingsDocument(settingsJsonDocument(target), {
        content: '{}',
        revision: `${target}-revision`,
      })
      createEditorBufferSession(member.buffer).applyText(' dirty')
    }
    const excludedIds = [
      documentKey(settingsJsonDocument('user')),
      documentKey(settingsJsonDocument('workspace')),
      ...unsyncedTargets.map(documentKey),
    ]
    createEditorBufferSession(recovery.buffer).applyText(' dirty')
    documentStore.getState().markWorkspaceDocumentRecoveryConflict([recoveryPath], 'partial')
    const hook = renderHook(() => useAutoSave(), { wrapper })

    try {
      createEditorBufferSession(document.buffer).applyText(' edited')
      if (mode === 'onWindowChange') window.dispatchEvent(new Event('blur'))

      await waitFor(() => expect(document.buffer.isDirty()).toBe(false))
      expect(await readFile(join(server.root, path), 'utf8')).toBe('saved edited')
      expect(await readFile(join(server.root, recoveryPath), 'utf8')).toBe('recovering')
      expect(documentStore.getState().dirtyDocumentKeys).toEqual(
        new Set([...excludedIds, testDocumentKey(recoveryPath)]),
      )
    } finally {
      hook.unmount()
      runtime.dispose()
      queryClient.clear()
    }
  },
)

function fileResult(path: string): FileResult {
  return {
    content: `contents of ${path}`,
    mtimeMs: 100,
    path: filesystemPath(path),
    size: 20,
    version: `test:${path}`,
  }
}
