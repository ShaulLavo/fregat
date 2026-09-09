import { useEffect, useLayoutEffect, type ReactNode } from 'react'

import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { EditorActivationContext } from '@/features/editor/providers/file-open-activation-context'
import { useLanguageServerMatchConfiguration } from '@/features/editor/providers/language-server-match-context'
import { MountedEditorProvider } from '@/features/editor/providers/mounted-editor-provider'
import { EditorRuntimeContext } from '@/features/editor/providers/runtime-context'
import { WorkspaceEditProvider } from '@/features/editor/providers/workspace-edit-provider'
import { EditorConflictStateContext } from '@/features/editor/state/conflict-state'
import { EditorDocumentStateContext } from '@/features/editor/state/document-state'
import { registerEditorOpenBenchmarkControl } from '@/features/editor/state/performance-trace'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { EditorUiStateContext } from '@/features/editor/state/ui-state'
import { EditorWorkspaceStateContext } from '@/features/editor/state/workspace-state'
import { languageServerMatchQueryOptions } from '@/features/editor/utils/language-server-match-query'
import { createPlatformFileOpenPreparer } from '@/features/editor/utils/prepared-document'
import { SearchBufferStateContext } from '@/features/search/state/buffer-state'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { FileOpenIntentProvider } from '@/lib/file-open-intent/providers/context'

export function EditorStateProvider({
  children,
  runtime,
}: {
  readonly children: ReactNode
  readonly runtime: EditorRuntime
}) {
  const { appliedThemeContentHash, appliedThemeId, selectedThemeId } = useEditorColorTheme()
  const syntaxHighlightingEnabled = useSettingValue('editor.syntaxHighlighting.enabled')
  const languageServerMatchConfiguration = useLanguageServerMatchConfiguration()
  const { editorOpenBenchmarkControl, fileOpenIntentOwner, queryClient } = runtime

  useEffect(
    () => registerEditorOpenBenchmarkControl(editorOpenBenchmarkControl),
    [editorOpenBenchmarkControl],
  )

  useLayoutEffect(() => {
    fileOpenIntentOwner.setEnvironment(
      createPlatformFileOpenPreparer({
        appliedThemeContentHash,
        appliedThemeId,
        selectedThemeId,
        syntaxHighlightingEnabled,
      }),
    )
  }, [
    appliedThemeContentHash,
    appliedThemeId,
    fileOpenIntentOwner,
    selectedThemeId,
    syntaxHighlightingEnabled,
  ])

  useLayoutEffect(() => {
    fileOpenIntentOwner.setRelatedPrefetch((rootPath, path) =>
      queryClient.prefetchQuery(
        languageServerMatchQueryOptions(rootPath, path, languageServerMatchConfiguration),
      ),
    )
  }, [fileOpenIntentOwner, languageServerMatchConfiguration, queryClient])

  useEffect(() => {
    runtime.resume()
    return () => runtime.suspend()
  }, [runtime])

  return (
    <EditorRuntimeContext value={runtime}>
      <EditorWorkspaceStateContext value={runtime.workspaceStore}>
        <EditorConflictStateContext value={runtime.conflictStore}>
          <EditorDocumentStateContext value={runtime.documentStore}>
            <SearchBufferStateContext value={runtime.searchBufferStore}>
              <EditorUiStateContext value={runtime.uiStore}>
                <FileOpenIntentProvider value={runtime.fileOpenIntent}>
                  <EditorActivationContext value={runtime.editorActivation}>
                    <MountedEditorProvider registry={runtime.mountedEditors}>
                      <WorkspaceEditProvider
                        host={runtime.workspaceEditHost}
                        service={runtime.workspaceEditService}
                      >
                        {children}
                      </WorkspaceEditProvider>
                    </MountedEditorProvider>
                  </EditorActivationContext>
                </FileOpenIntentProvider>
              </EditorUiStateContext>
            </SearchBufferStateContext>
          </EditorDocumentStateContext>
        </EditorConflictStateContext>
      </EditorWorkspaceStateContext>
    </EditorRuntimeContext>
  )
}
