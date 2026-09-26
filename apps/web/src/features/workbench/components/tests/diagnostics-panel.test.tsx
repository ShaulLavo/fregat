import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import type { LanguageServerDiagnosticSummary } from '@singapore-editor/lsp-plugin/websocket'
import type { ReactEditorController } from '@singapore-editor/react'
import { useEffect } from 'react'
import { afterEach } from 'vitest'

import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { markerStore } from '@/lib/markers/store'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

type Diagnostic = LanguageServerDiagnosticSummary['diagnostics'][number]

function diagnostic(
  line: number,
  message: string,
  severity: Diagnostic['severity'] = 1,
): Diagnostic {
  return {
    message,
    range: { end: { character: 1, line }, start: { character: 0, line } },
    severity,
  }
}

function publish(path: string, diagnostics: Diagnostic[]) {
  act(() => markerStore.changeOne('test', `file:///${path}`, diagnostics))
}

afterEach(() => markerStore.clear())

function renderPanel(disableBindings = false) {
  publish('src/a.ts', [diagnostic(1, 'First problem'), diagnostic(4, 'Second problem', 2)])
  publish('src/b.ts', [diagnostic(2, 'Third problem')])
  renderWithProviders(
    <TestEditorStateProvider>
      <DiagnosticsPanel />
    </TestEditorStateProvider>,
    disableBindings ? { command: { bindings: [] } } : undefined,
  )
  return screen.getByRole('tree', { name: 'Problems' })
}

function activeText(tree: HTMLElement) {
  const id = tree.getAttribute('aria-activedescendant')
  return id ? (document.getElementById(id)?.closest('div')?.textContent ?? '') : ''
}

test('the whole pane is one tab stop with every file inside it', () => {
  const tree = renderPanel()

  expect(tree).toHaveAttribute('tabindex', '0')
  expect(screen.getAllByRole('tree')).toHaveLength(1)
  expect(screen.getAllByRole('treeitem', { expanded: true })).toHaveLength(2)
  for (const row of screen.getAllByRole('treeitem')) expect(row).toHaveAttribute('tabindex', '-1')
})

test('arrows walk from one file into the next', async () => {
  const tree = renderPanel()
  tree.focus()
  await userEvent.keyboard('{Home}')

  for (let step = 0; step < 3; step += 1) await userEvent.keyboard('{ArrowDown}')

  expect(activeText(tree)).toContain('b.ts')
  await userEvent.keyboard('{ArrowDown}')
  expect(activeText(tree)).toContain('Third problem')
})

test('Enter on a file collapses it and the rows below stay reachable', async () => {
  const tree = renderPanel()
  tree.focus()
  await userEvent.keyboard('{Home}{Enter}')

  expect(screen.queryByText('First problem')).not.toBeInTheDocument()
  await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  expect(activeText(tree)).toContain('Third problem')
})

test('removing the active diagnostic moves to the row in its place', async () => {
  const tree = renderPanel()
  tree.focus()
  await userEvent.keyboard('{Home}{ArrowDown}{ArrowDown}')
  expect(activeText(tree)).toContain('Second problem')

  publish('src/a.ts', [diagnostic(1, 'First problem')])

  const active = tree.getAttribute('aria-activedescendant')
  expect(active && document.getElementById(active)).toBeTruthy()
  expect(activeText(tree)).toContain('b.ts')
})

test('a clean answer from one server does not hide another that failed', () => {
  const status = createEditorLanguageServerStatusSource()
  status.setServers(['typescript', 'oxlint'])
  status.setServerStatus('oxlint', 'ready')
  status.setServerDiagnostics('oxlint', summarizeDiagnostics('file:///src/a.ts', 1, [], 'current'))
  status.setServerStatus('typescript', 'error')

  function ActiveEditor() {
    const uiStore = useEditorUiStoreApi()
    useEffect(() => {
      uiStore.getState().setStatusBarSource({
        // The panel reads only the status source; no editor is mounted here.
        controller: {} as ReactEditorController,
        filePath: 'src/a.ts',
        languageServerStatusSource: status,
      })
    }, [uiStore])
    return null
  }

  renderWithProviders(
    <TestEditorStateProvider>
      <ActiveEditor />
      <DiagnosticsPanel />
    </TestEditorStateProvider>,
  )

  expect(screen.getByText('Diagnostics unavailable')).toBeInTheDocument()
  expect(screen.getByText('Not answering: typescript')).toBeInTheDocument()
  expect(screen.queryByText('No problems reported')).not.toBeInTheDocument()
})

test('disabling keybindings disables Fix with AI on the active diagnostic', async () => {
  const tree = renderPanel(true)
  tree.focus()
  await userEvent.keyboard('{Home}{ArrowDown}')
  const event = new KeyboardEvent('keydown', {
    key: '.',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    tree.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(false)
})
