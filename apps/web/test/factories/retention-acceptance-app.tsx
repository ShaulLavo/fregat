import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import { useLayoutEffect, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { expect, onTestFinished } from 'vitest'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  resetEditorColorThemeStore,
  syncEditorThemeSelection,
} from '@/features/editor/state/color-theme-store'
import { disposeEditorSyntaxHighlighting } from '@/features/editor/state/syntax-highlighting'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import { allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import { createClientInvariantError } from '@/lib/structured-errors'
import { createBrowserWorkspace } from './browser-workspace'
import { TestEditorStateProvider } from './editor-state-provider'
import { AppProviders, seedHtmlTheme } from '../render'
import { RetentionAcceptanceIntent } from './retention-acceptance-intent'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { EditorTabActionsProvider } from '@/features/editor/providers/tab-actions-provider'
import { useDirtyTabCloseRequest } from '@/features/editor/hooks/use-dirty-tab-close'
import { EditorGroupsDragProvider } from '@/features/workbench/providers/editor-groups-drag-provider'

type AcceptancePrediction = { readonly path: FilesystemPath; readonly slot: string }

type AcceptanceRuntime = {
  readonly commands: ReturnType<typeof useEditorCommands>
  readonly documents: ReturnType<typeof useEditorDocumentStoreApi>
  readonly workspace: ReturnType<typeof useEditorWorkspaceStoreApi>
  readonly ui: ReturnType<typeof useEditorUiStoreApi>
  readonly theme: ReturnType<typeof useEditorColorTheme>
  readonly interests: ReturnType<typeof useFileOpenIntent>
}

export async function mountRetentionAcceptanceApp(
  predictions: readonly AcceptancePrediction[] = [],
  layout: 'groups' | 'surfaces' = 'groups',
  surface?: ReactNode,
) {
  seedHtmlTheme('dark')
  resetEditorColorThemeStore()
  syncEditorThemeSelection('dark', 'dark-plus')
  const rootPath = filesystemPath('repo')
  const fixture = await createBrowserWorkspace(rootPath)
  const container = document.createElement('main')
  container.dataset.workbench = ''
  container.style.width = layout === 'groups' ? '800px' : '1200px'
  container.style.height = layout === 'groups' ? '320px' : '700px'
  document.body.append(container)
  const root = createRoot(container)
  let runtime: AcceptanceRuntime | null = null
  const capture = (value: AcceptanceRuntime | null) => {
    runtime = value
  }
  const read = (): AcceptanceRuntime => {
    if (!runtime)
      throw createClientInvariantError('Retention acceptance application has not mounted')
    return runtime
  }
  const render = (targets: readonly AcceptancePrediction[]) =>
    flushSync(() =>
      root.render(
        <AppProviders
          application={fixture.application}
          navigation={fixture.navigation}
          queryClient={fixture.queryClient}
        >
          <TestEditorStateProvider>
            <RetentionAcceptanceApp
              capture={capture}
              rootPath={rootPath}
              predictions={targets}
              layout={layout}
              surface={surface}
            />
          </TestEditorStateProvider>
        </AppProviders>,
      ),
    )
  render(predictions)
  onTestFinished(async () => {
    flushSync(() => root.unmount())
    container.remove()
    await disposeEditorSyntaxHighlighting()
    resetEditorColorThemeStore()
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'light')
  })
  await expect.poll(() => runtime).not.toBeNull()
  await expect.poll(() => read().theme.appliedThemeId).toBe('dark-plus')
  return { ...fixture, container, read, rootPath, setPredictions: render }
}

function RetentionAcceptanceApp({
  capture,
  rootPath,
  predictions,
  layout,
  surface,
}: {
  readonly capture: (value: AcceptanceRuntime | null) => void
  readonly rootPath: ReturnType<typeof filesystemPath>
  readonly predictions: readonly AcceptancePrediction[]
  readonly layout: 'groups' | 'surfaces'
  readonly surface?: ReactNode
}) {
  const commands = useEditorCommands()
  const documents = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceStoreApi()
  const ui = useEditorUiStoreApi()
  const theme = useEditorColorTheme()
  const interests = useFileOpenIntent()
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const { dirtyTabCloseDialog, requestCloseTab, requestCloseTabs } = useDirtyTabCloseRequest()
  useLayoutEffect(() => {
    capture({ commands, documents, workspace, ui, theme, interests })
    return () => capture(null)
  }, [capture, commands, documents, workspace, ui, theme, interests])
  const visible = allEditorGroups(groups)
  return (
    <EditorTabActionsProvider requestCloseTab={requestCloseTab} requestCloseTabs={requestCloseTabs}>
      <EditorGroupsDragProvider>
        <div className='flex h-full min-h-0 flex-col'>
          <div className='flex min-h-0 flex-1'>
            {layout === 'surfaces'
              ? surface
              : visible.map((group, index) => (
                  <div key={group.id} style={{ width: index === 0 ? 500 : 300 }}>
                    <EditorGroup
                      active={group.id === groups.activeGroupId}
                      conflicts={{}}
                      gitFiles={[]}
                      group={group}
                      rootPath={rootPath}
                    />
                  </div>
                ))}
          </div>
          <div className='flex'>
            {predictions.map((prediction) => (
              <RetentionAcceptanceIntent key={prediction.slot} {...prediction} />
            ))}
          </div>
        </div>
        {dirtyTabCloseDialog}
      </EditorGroupsDragProvider>
    </EditorTabActionsProvider>
  )
}

export type RetentionAcceptanceApp = Awaited<ReturnType<typeof mountRetentionAcceptanceApp>>
