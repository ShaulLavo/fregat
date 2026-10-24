import type { EditorState } from '@singapore-editor/core/editor'
import type {
  TypeScriptLspDiagnosticSummary,
  TypeScriptLspStatus,
} from '@singapore-editor/typescript-lsp'
import { el } from './dom.ts'

export type StatusBar = {
  readonly element: HTMLDivElement
  clear(): void
  update(filePath: string | undefined, state: EditorState): void
  updateTypeScriptLsp(
    status: TypeScriptLspStatus,
    summary: TypeScriptLspDiagnosticSummary | null,
  ): void
}

export function createStatusBar(): StatusBar {
  const element = el('div', { id: 'status' })
  const fileStatus = el('span', { id: 'status-file' })
  const cursorStatus = el('span', { id: 'status-cursor' })
  const lengthStatus = el('span', { id: 'status-length' })
  const syntaxStatus = el('span', { id: 'status-syntax' })
  const typeScriptStatus = el('span', { id: 'status-typescript' })
  const historyStatus = el('span', { id: 'status-history' })
  element.append(
    fileStatus,
    cursorStatus,
    lengthStatus,
    syntaxStatus,
    typeScriptStatus,
    historyStatus,
  )

  const clear = () => {
    fileStatus.textContent = 'No file'
    cursorStatus.textContent = ''
    lengthStatus.textContent = ''
    syntaxStatus.textContent = ''
    historyStatus.textContent = ''
  }

  return {
    element,
    clear,
    update: (filePath, state) => {
      if (!state.documentId) {
        clear()
        return
      }

      fileStatus.textContent = filePath ?? 'Untitled'
      cursorStatus.textContent = `Ln ${state.cursor.row + 1}, Col ${state.cursor.column + 1}`
      lengthStatus.textContent = `${state.length} chars`
      syntaxStatus.textContent = formatSyntaxStatus(state)
      historyStatus.textContent = `${state.canUndo ? 'Undo' : 'No undo'} / ${
        state.canRedo ? 'Redo' : 'No redo'
      }`
    },
    updateTypeScriptLsp: (status, summary) => {
      typeScriptStatus.textContent = formatTypeScriptLspStatus(status, summary)
    },
  }
}

function formatSyntaxStatus(state: EditorState): string {
  const language = state.languageId ?? 'Plain text'
  if (state.syntaxStatus === 'plain') return language
  return `${language} ${state.syntaxStatus}`
}

function formatTypeScriptLspStatus(
  status: TypeScriptLspStatus,
  summary: TypeScriptLspDiagnosticSummary | null,
): string {
  if (status === 'idle') return ''
  if (status === 'loading') return 'TS LSP loading'
  if (status === 'error') return 'TS LSP error'
  if (!summary || summary.counts.total === 0) return 'TS LSP ready'

  const parts = [
    countLabel(summary.counts.error, 'error'),
    countLabel(summary.counts.warning, 'warning'),
    countLabel(summary.counts.information, 'info'),
    countLabel(summary.counts.hint, 'hint'),
  ].filter(Boolean)
  return `TS ${parts.join(', ')}`
}

function countLabel(count: number, label: string): string {
  if (count === 0) return ''
  if (count === 1) return `1 ${label}`
  return `${count} ${label}s`
}
