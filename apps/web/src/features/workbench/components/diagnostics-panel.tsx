import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticSummary,
  LanguageServerStatus,
} from '@singapore-editor/lsp-plugin'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'

import { useEditorLanguageServerStatus } from '@/features/editor/hooks/use-editor-language-server-status'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import type { EditorStatusBarSource } from '@/features/editor/state/status-bar-source'
import { useEditorUiState, useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { DiagnosticsLoading } from '@/features/workbench/components/diagnostics-loading'
import { FocusablePanel } from '@/components/focusable-panel'
import { basename, parentPath } from '@/lib/path-formatters'
import {
  diagnosticMessageText,
  diagnosticSeverityLabel,
  diagnosticTarget,
  fileUriForPath,
} from '@/lib/diagnostic'

const idleLanguageServerStatusSource = createEditorLanguageServerStatusSource()

export function DiagnosticsPanel() {
  const statusBarSource = useEditorUiState((state) => state.statusBarSource)
  const commands = useEditorCommands()
  const uiStore = useEditorUiStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const languageServerStatus = useEditorLanguageServerStatus(
    statusBarSource?.languageServerStatusSource ?? idleLanguageServerStatusSource,
  )

  function previewDiagnostic(target: LanguageServerDefinitionTarget) {
    const tab = activeEditorTab(workspaceStore.getState().workbenchPanels.editorGroups)
    if (tab) uiStore.getState().setDefinitionTarget(target, tab.id)
  }

  return (
    <FocusablePanel
      area='problems'
      target={{ kind: 'problems' }}
      className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
    >
      {statusBarSource ? (
        renderDiagnosticsStatus({
          languageServerStatus,
          onOpenDiagnostic: (target) => {
            void commands.openDefinition(target)
          },
          onPreviewDiagnostic: previewDiagnostic,
          source: statusBarSource,
        })
      ) : (
        <EmptyState
          className='min-h-0 flex-1'
          description='Open a file to see its diagnostics.'
          title='No active editor'
        />
      )}
    </FocusablePanel>
  )
}

function renderDiagnosticsStatus({
  languageServerStatus,
  source,
  onOpenDiagnostic,
  onPreviewDiagnostic,
}: {
  readonly languageServerStatus: ReturnType<typeof useEditorLanguageServerStatus>
  readonly source: EditorStatusBarSource
  onOpenDiagnostic(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewDiagnostic(target: LanguageServerDefinitionTarget): void
}) {
  const { diagnostics, status } = languageServerStatus
  if (!diagnostics || diagnostics.counts.total === 0) {
    return renderDiagnosticsState(status)
  }
  const directory = parentPath(source.filePath)

  return (
    <div className='min-h-0 flex-1 overflow-auto p-3 text-xs'>
      <div className='text-muted-foreground mb-3 truncate' title={source.filePath}>
        <span className='text-foreground'>{basename(source.filePath)}</span>
        {directory ? <span className='ml-2'>{directory}</span> : null}
      </div>
      <div className='grid grid-cols-4 gap-2'>
        {renderDiagnosticCount({ label: 'Errors', severity: 1, value: diagnostics.counts.error })}
        {renderDiagnosticCount({
          label: 'Warnings',
          severity: 2,
          value: diagnostics.counts.warning,
        })}
        {renderDiagnosticCount({
          label: 'Info',
          severity: 3,
          value: diagnostics.counts.information,
        })}
        {renderDiagnosticCount({ label: 'Hints', severity: 4, value: diagnostics.counts.hint })}
      </div>
      {renderDiagnosticList({
        diagnostics,
        onOpenDiagnostic,
        onPreviewDiagnostic,
        path: source.filePath,
      })}
    </div>
  )
}

function renderDiagnosticCount({
  label,
  severity,
  value,
}: {
  readonly label: string
  readonly severity: number
  readonly value: number
}) {
  return (
    <div
      className={cn('rounded-lg border px-2 py-1', diagnosticTileClass(severity, value))}
      key={label}
    >
      <div className='text-muted-foreground'>{label}</div>
      <div className={cn('font-medium tabular-nums', diagnosticValueClass(severity, value))}>
        {value}
      </div>
    </div>
  )
}

function renderDiagnosticList({
  diagnostics,
  path,
  onOpenDiagnostic,
  onPreviewDiagnostic,
}: {
  readonly diagnostics: LanguageServerDiagnosticSummary
  readonly path: string
  onOpenDiagnostic(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewDiagnostic(target: LanguageServerDefinitionTarget): void
}) {
  if (diagnostics.diagnostics.length === 0) return null

  return (
    <ol className='mt-3 space-y-2'>
      {diagnostics.diagnostics.map((diagnostic, index) => {
        const target = diagnosticTarget(path, diagnostics.uri ?? fileUriForPath(path), diagnostic)

        return (
          <li
            className={cn('border border-l-2', diagnosticRuleClass(diagnostic.severity))}
            key={diagnosticKey(diagnostic, index)}
          >
            {/* Raw <button>: a full-width, two-line row; Button is a fixed-height centered control. */}
            <button
              className='focus-ring hover:bg-row-hover active:bg-row-active block w-full px-2 py-2 text-left outline-none'
              type='button'
              onClick={() => onOpenDiagnostic(target)}
              onFocus={() => onPreviewDiagnostic(target)}
              onMouseEnter={() => onPreviewDiagnostic(target)}
            >
              <div className='text-muted-foreground text-2xs'>
                {diagnosticSeverityLabel(diagnostic.severity)}
              </div>
              <div className='text-foreground'>{diagnosticMessageText(diagnostic.message)}</div>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function renderDiagnosticsState(status: LanguageServerStatus) {
  if (status === 'loading') {
    return <DiagnosticsLoading />
  }
  if (status === 'error') {
    return <EmptyState className='min-h-0 flex-1' title='Diagnostics unavailable' tone='error' />
  }

  return <EmptyState className='min-h-0 flex-1' title='No problems reported' />
}

/**
 * LSP severities: 1 error, 2 warning, 3 information, 4 hint. Hints have no
 * status token by design — the lowest severity should recede, not compete.
 */
function diagnosticValueClass(severity: number, value: number) {
  if (value === 0) return 'text-muted-foreground'
  if (severity === 1) return 'text-destructive'
  if (severity === 2) return 'text-warning'
  if (severity === 3) return 'text-info'

  return 'text-foreground'
}

function diagnosticTileClass(severity: number, value: number) {
  if (value === 0) return 'border-border'
  if (severity === 1) return 'border-destructive/30 bg-destructive/10'
  if (severity === 2) return 'border-warning/30 bg-warning/10'
  if (severity === 3) return 'border-info/30 bg-info/10'

  return 'border-border'
}

function diagnosticRuleClass(severity: number | undefined) {
  if (severity === 1) return 'border-l-destructive'
  if (severity === 2) return 'border-l-warning'
  if (severity === 3) return 'border-l-info'

  return 'border-l-border'
}

function diagnosticKey(
  diagnostic: LanguageServerDiagnosticSummary['diagnostics'][number],
  index: number,
) {
  return `${diagnosticMessageText(diagnostic.message)}:${index}`
}
