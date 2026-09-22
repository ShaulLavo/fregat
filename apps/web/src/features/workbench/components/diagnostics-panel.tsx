import type {
  LanguageServerDefinitionTarget,
  LanguageServerStatus,
} from '@singapore-editor/lsp-plugin/websocket'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { useEditorLanguageServerStatus } from '@/features/editor/hooks/use-editor-language-server-status'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { useEditorUiState, useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { useMarkerResources } from '@/hooks/use-markers'
import { DiagnosticsLoading } from '@/features/workbench/components/diagnostics-loading'
import { FocusablePanel } from '@/components/focusable-panel'
import { basename, parentPath } from '@/lib/path-formatters'
import { DiagnosticList } from '@/features/workbench/components/diagnostic-list'

const idleLanguageServerStatusSource = createEditorLanguageServerStatusSource()

export function DiagnosticsPanel() {
  const statusBarSource = useEditorUiState((state) => state.statusBarSource)
  const commands = useEditorCommands()
  const uiStore = useEditorUiStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  // Status still comes from the active tab's servers: it answers "is anything checking",
  // which the marker store cannot — an empty store and a broken server look alike.
  const { status } = useEditorLanguageServerStatus(
    statusBarSource?.languageServerStatusSource ?? idleLanguageServerStatusSource,
  )
  const resources = useMarkerResources()

  function previewDiagnostic(target: LanguageServerDefinitionTarget) {
    const tab = activeEditorTab(workspaceStore.getState().workbenchPanels.editorGroups)
    if (tab) uiStore.getState().setDefinitionTarget(target, tab.id)
  }

  function openDiagnostic(target: LanguageServerDefinitionTarget) {
    void commands.openDefinition(target)
  }

  if (resources.length === 0) {
    return (
      <FocusablePanel
        area='problems'
        target={{ kind: 'problems' }}
        className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
      >
        {renderDiagnosticsState(statusBarSource ? status : 'idle')}
      </FocusablePanel>
    )
  }

  return (
    <FocusablePanel
      area='problems'
      target={{ kind: 'problems' }}
      className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
    >
      <div className='min-h-0 flex-1 overflow-auto p-3 text-xs'>
        {resources.map((resource) => (
          <section className='mb-4 last:mb-0' key={resource.uri}>
            <div className='text-muted-foreground mb-2 truncate' title={resource.path}>
              <span className='text-foreground'>{basename(resource.path)}</span>
              {parentPath(resource.path) ? (
                <span className='ml-2'>{parentPath(resource.path)}</span>
              ) : null}
            </div>
            <DiagnosticList
              diagnostics={resource.summary}
              onOpenDiagnostic={openDiagnostic}
              onPreviewDiagnostic={previewDiagnostic}
              path={resource.path}
            />
          </section>
        ))}
      </div>
    </FocusablePanel>
  )
}

function renderDiagnosticsState(status: LanguageServerStatus) {
  if (status === 'loading') {
    return <DiagnosticsLoading />
  }
  // No retry: no restart handle is exposed here; reopening the file restarts its language server.
  if (status === 'error') {
    return <EmptyState className='min-h-0 flex-1' title='Diagnostics unavailable' tone='error' />
  }

  return (
    <EmptyState
      className='min-h-0 flex-1'
      description='A file is checked once it is opened.'
      title='No problems reported'
    />
  )
}
