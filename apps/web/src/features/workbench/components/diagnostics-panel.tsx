import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useState } from 'react'

import { useEditorLanguageServerStatus } from '@/features/editor/hooks/use-editor-language-server-status'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { useEditorUiState, useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { useMarkerResources } from '@/hooks/use-markers'
import { DiagnosticsLoading } from '@/features/workbench/components/diagnostics-loading'
import { FocusablePanel } from '@/components/focusable-panel'
import { DiagnosticGroupRow } from '@/features/workbench/components/diagnostic-group-row'
import { DiagnosticRow } from '@/features/workbench/components/diagnostic-row'
import {
  diagnosticRows,
  survivingActiveId,
  type ActiveDiagnostic,
} from '@/features/workbench/utils/diagnostic-rows'
import { toggledSet } from '@/lib/toggled-set'
import {
  diagnosticsEmptyState,
  type DiagnosticsEmptyState,
} from '@/features/workbench/utils/diagnostics-empty-state'

const idleLanguageServerStatusSource = createEditorLanguageServerStatusSource()

export function DiagnosticsPanel() {
  const statusBarSource = useEditorUiState((state) => state.statusBarSource)
  const commands = useEditorCommands()
  const uiStore = useEditorUiStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  // Status still comes from the active tab's servers: it answers "is anything checking",
  // which the marker store cannot — an empty store and a broken server look alike.
  const { diagnostics, status } = useEditorLanguageServerStatus(
    statusBarSource?.languageServerStatusSource ?? idleLanguageServerStatusSource,
  )
  const resources = useMarkerResources()
  const [collapsedUris, setCollapsedUris] = useState<ReadonlySet<string>>(() => new Set())
  const [active, setActive] = useState<ActiveDiagnostic | null>(null)
  const rows = diagnosticRows(resources, collapsedUris)
  const activeId = survivingActiveId(rows, active)

  function previewDiagnostic(target: LanguageServerDefinitionTarget) {
    const tab = activeEditorTab(workspaceStore.getState().workbenchPanels.editorGroups)
    if (tab) uiStore.getState().setDefinitionTarget(target, tab.id)
  }

  function openDiagnostic(target: LanguageServerDefinitionTarget) {
    void commands.openDefinition(target)
  }

  function toggle(uri: string) {
    setCollapsedUris((current) => toggledSet(current, uri))
  }

  function moveTo(id: string) {
    const index = rows.findIndex((row) => row.id === id)
    setActive({ id, index })
    const row = rows[index]
    if (row?.kind === 'diagnostic') previewDiagnostic(row.target)
  }

  function commit(id: string) {
    const row = rows.find((candidate) => candidate.id === id)
    if (row?.kind === 'group') return toggle(row.uri)
    if (row) openDiagnostic(row.target)
  }

  function collapseOrExpand(id: string) {
    const row = rows.find((candidate) => candidate.id === id)
    if (row?.kind === 'group') toggle(row.uri)
  }

  const list = useListbox({
    role: 'tree',
    items: rows,
    activeId,
    onActiveChange: moveTo,
    onCommit: commit,
    onCollapse: collapseOrExpand,
    onExpand: collapseOrExpand,
  })

  if (resources.length === 0) {
    return (
      <FocusablePanel
        area='problems'
        target={{ kind: 'problems' }}
        className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      >
        {renderDiagnosticsState(
          diagnosticsEmptyState(statusBarSource ? status : 'idle', diagnostics?.freshness),
        )}
      </FocusablePanel>
    )
  }

  return (
    <FocusablePanel
      area='problems'
      target={{ kind: 'problems' }}
      className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
    >
      <div
        {...list.containerProps}
        aria-label='Problems'
        className='focus-ring-inset min-h-0 flex-1 overflow-auto py-1 text-xs'
      >
        {rows.map((row) =>
          row.kind === 'group' ? (
            <DiagnosticGroupRow
              key={row.id}
              row={row}
              rowProps={list.rowProps(row.id)}
              onToggle={() => toggle(row.uri)}
            />
          ) : (
            <DiagnosticRow
              key={row.id}
              row={row}
              rowProps={list.rowProps(row.id)}
              onOpen={() => openDiagnostic(row.target)}
              onPreview={() => previewDiagnostic(row.target)}
            />
          ),
        )}
      </div>
    </FocusablePanel>
  )
}

function renderDiagnosticsState(state: DiagnosticsEmptyState) {
  if (state === 'loading') return <DiagnosticsLoading />
  // No retry: no restart handle is exposed here; reopening the file restarts its language server.
  if (state === 'unavailable') {
    return <EmptyState className='min-h-0 flex-1' title='Diagnostics unavailable' tone='error' />
  }
  if (state === 'silent') {
    return (
      <EmptyState
        className='min-h-0 flex-1'
        description='The language server has not reported on this file.'
        title='No diagnostics received'
      />
    )
  }

  return (
    <EmptyState
      className='min-h-0 flex-1'
      description={
        state === 'rechecking' ? (
          <Shimmer>Checking again…</Shimmer>
        ) : (
          'A file is checked once it is opened.'
        )
      }
      title='No problems reported'
    />
  )
}
